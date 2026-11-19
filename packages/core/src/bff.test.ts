import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { bffUpstream, createBffHandler, type BffOptions } from './bff.js';
import { sessionCookies, type RefreshResult, type Refresher, type TokenPair } from './session.js';

const API = 'http://127.0.0.1:4000/api/v1/';
const ORIGIN = 'https://shop.example';
const ALLOW = [/^users(?:\/|$)/];

describe('bffUpstream', () => {
  const target = (...segments: string[]) => bffUpstream(segments, API, ALLOW)?.href ?? null;

  it('maps an allowed resource under the API URL', () => {
    expect(target('users')).toBe('http://127.0.0.1:4000/api/v1/users');
    expect(target('users', 'u1')).toBe('http://127.0.0.1:4000/api/v1/users/u1');
    expect(target('users', 'john doe')).toBe('http://127.0.0.1:4000/api/v1/users/john%20doe');
  });

  it.each([
    [['auth', 'me']], // tokens and sessions are never reachable from the browser
    [['auth', 'refresh']],
    [['health']], // not on the allow-list
    [['usersx']], // a look-alike of an allowed prefix
    [['users', '..', 'auth', 'me']],
    [['users', '.']],
    [['users', '']],
    [['users/../auth', 'me']], // a decoded %2F inside one segment
    [['users\\..\\auth']],
    [['users', 'a\nb']],
  ])('rejects %j', (segments) => {
    expect(bffUpstream(segments, API, ALLOW)).toBeNull();
  });

  it('allows nothing with an empty list', () => {
    expect(bffUpstream(['users'], API, [])).toBeNull();
  });
});

const NAMES = sessionCookies('shop');
const pair = (n: number): TokenPair => ({
  accessToken: `access-${String(n)}-0123456789abcdef`,
  refreshToken: `refresh-${String(n)}-0123456789abcdef`,
});
const OLD = pair(1);
const NEW = pair(2);

const refresh = vi.fn<(token: string, forwardedFor?: string | null) => Promise<RefreshResult>>();
const upstream = vi.fn<typeof fetch>();
const bff = createBffHandler({
  apiUrl: API,
  appOrigin: ORIGIN,
  cookies: NAMES,
  refresh,
  allow: ALLOW,
});

beforeEach(() => {
  refresh.mockReset().mockResolvedValue({ ok: true, tokens: NEW });
  upstream.mockReset().mockResolvedValue(Response.json({ success: true, data: [] }));
  vi.stubGlobal('fetch', upstream);
});
afterEach(() => {
  vi.unstubAllGlobals();
});

const cookieHeader = (tokens: Partial<Record<'access' | 'refresh', string>>) =>
  [
    tokens.access && `${NAMES.access}=${tokens.access}`,
    tokens.refresh && `${NAMES.refresh}=${tokens.refresh}`,
    'theme=dark',
  ]
    .filter(Boolean)
    .join('; ');

const request = (
  path: string,
  init: { method?: string; body?: string; headers?: Record<string, string> } = {},
) =>
  new Request(`${ORIGIN}/api/bff/${path}`, {
    method: init.method ?? 'GET',
    body: init.body ?? null,
    headers: { origin: ORIGIN, 'sec-fetch-site': 'same-origin', ...init.headers },
  });

const call = (n = 0) => {
  const [url, init] = upstream.mock.calls[n] ?? [];
  return {
    url: url instanceof URL ? url.href : url instanceof Request ? url.url : url,
    init,
    headers: new Headers(init?.headers),
  };
};

describe('createBffHandler', () => {
  it('forwards an allowed call with the Bearer from the cookie, never the browser cookies', async () => {
    upstream.mockResolvedValue(
      Response.json(
        { success: true, data: [] },
        { headers: { etag: '"v1"', 'set-cookie': 'nest=1', 'x-powered-by': 'Express' } },
      ),
    );
    const res = await bff(
      request('users?page=2', {
        headers: {
          cookie: cookieHeader({ access: OLD.accessToken, refresh: OLD.refreshToken }),
          authorization: 'Bearer forged',
          'accept-language': 'ar',
          'x-forwarded-for': '203.0.113.7',
        },
      }),
      ['users'],
    );
    expect(res.status).toBe(200);
    await expect(res.json()).resolves.toEqual({ success: true, data: [] });
    const { url, init, headers } = call();
    expect(url).toBe(`${API}users?page=2`);
    expect(init?.method).toBe('GET');
    expect(headers.get('authorization')).toBe(`Bearer ${OLD.accessToken}`);
    expect(headers.has('cookie')).toBe(false);
    expect(headers.get('accept-language')).toBe('ar');
    expect(headers.get('x-forwarded-for')).toBe('203.0.113.7');
    expect(refresh).not.toHaveBeenCalled();
    // only listed response headers come back, and never a cookie of NestJS
    expect(res.headers.get('etag')).toBe('"v1"');
    expect(res.headers.get('cache-control')).toBe('no-store');
    expect(res.headers.has('x-powered-by')).toBe(false);
    expect(res.headers.getSetCookie()).toEqual([]);
  });

  it('refuses a cross-site write (CSRF) before anything else', async () => {
    const res = await bff(
      request('users', {
        method: 'POST',
        body: '{}',
        headers: { origin: 'https://evil.example', 'sec-fetch-site': 'cross-site' },
      }),
      ['users'],
    );
    expect(res.status).toBe(403);
    await expect(res.json()).resolves.toEqual({ code: 'csrf' });
    expect(upstream).not.toHaveBeenCalled();
  });

  it('answers 404 for a path off the allow-list', async () => {
    const res = await bff(
      request('auth/me', { headers: { cookie: cookieHeader({ access: 'a' }) } }),
      ['auth', 'me'],
    );
    expect(res.status).toBe(404);
    expect(upstream).not.toHaveBeenCalled();
  });

  it('answers 401 without cookies and sets none', async () => {
    const res = await bff(request('users'), ['users']);
    expect(res.status).toBe(401);
    expect(res.headers.getSetCookie()).toEqual([]);
    expect(upstream).not.toHaveBeenCalled();
  });

  it('rotates an expired access cookie first and stores the new pair', async () => {
    const res = await bff(
      request('users', {
        headers: {
          cookie: cookieHeader({ refresh: OLD.refreshToken }),
          'x-forwarded-for': '203.0.113.7',
        },
      }),
      ['users'],
    );
    expect(res.status).toBe(200);
    expect(refresh).toHaveBeenCalledWith(OLD.refreshToken, '203.0.113.7');
    expect(call().headers.get('authorization')).toBe(`Bearer ${NEW.accessToken}`);
    expect(res.headers.getSetCookie()).toEqual([
      expect.stringMatching(new RegExp(`^${NAMES.access}=${NEW.accessToken}; .*Max-Age=840`)),
      expect.stringMatching(new RegExp(`^${NAMES.refresh}=${NEW.refreshToken}; .*Max-Age=604800`)),
    ]);
  });

  it('clears a refresh cookie NestJS rejects', async () => {
    refresh.mockResolvedValue({ ok: false, reason: 'invalid' });
    const res = await bff(
      request('users', { headers: { cookie: cookieHeader({ refresh: 'r' }) } }),
      ['users'],
    );
    expect(res.status).toBe(401);
    expect(res.headers.getSetCookie()).toEqual([
      expect.stringMatching(new RegExp(`^${NAMES.access}=; .*Max-Age=0; Secure`)),
      expect.stringMatching(new RegExp(`^${NAMES.refresh}=; .*Max-Age=0; Secure`)),
    ]);
  });

  it('answers 503 and keeps the cookies when NestJS cannot refresh', async () => {
    refresh.mockResolvedValue({ ok: false, reason: 'unavailable' });
    const res = await bff(
      request('users', { headers: { cookie: cookieHeader({ refresh: 'r' }) } }),
      ['users'],
    );
    expect(res.status).toBe(503);
    expect(res.headers.getSetCookie()).toEqual([]);
  });

  it('rotates once after a 401 from NestJS and sends the same body again', async () => {
    upstream
      .mockResolvedValueOnce(new Response(null, { status: 401 }))
      .mockResolvedValueOnce(Response.json({ success: true, data: { id: 'u1' } }, { status: 201 }));
    const res = await bff(
      request('users', {
        method: 'POST',
        body: '{"name":"Ali"}',
        headers: {
          'content-type': 'application/json',
          cookie: cookieHeader({ access: OLD.accessToken, refresh: OLD.refreshToken }),
        },
      }),
      ['users'],
    );
    expect(res.status).toBe(201);
    expect(upstream).toHaveBeenCalledTimes(2);
    expect(call(0).init?.body).toBe('{"name":"Ali"}');
    expect(call(1).init?.body).toBe('{"name":"Ali"}');
    expect(call(1).headers.get('authorization')).toBe(`Bearer ${NEW.accessToken}`);
    expect(res.headers.getSetCookie()).toHaveLength(2);
  });

  it('answers 503 without signing out when the retry cannot refresh', async () => {
    upstream.mockResolvedValue(new Response(null, { status: 401 }));
    refresh.mockResolvedValue({ ok: false, reason: 'unavailable' });
    const res = await bff(
      request('users', { headers: { cookie: cookieHeader({ access: 'a', refresh: 'r' }) } }),
      ['users'],
    );
    expect(res.status).toBe(503);
    expect(res.headers.getSetCookie()).toEqual([]);
  });

  it('signs out when NestJS refuses even a fresh token (a deleted user)', async () => {
    upstream.mockResolvedValue(new Response(null, { status: 401 }));
    const res = await bff(
      request('users', { headers: { cookie: cookieHeader({ refresh: 'r' }) } }),
      ['users'],
    );
    expect(res.status).toBe(401);
    expect(refresh).toHaveBeenCalledTimes(1); // rotated already: no second attempt
    expect(res.headers.getSetCookie()).toEqual([
      expect.stringContaining('Max-Age=0'),
      expect.stringContaining('Max-Age=0'),
    ]);
  });

  it.each([
    ['a body that is not JSON', { 'content-type': 'text/plain' }, 'x', 415],
    ['a body over the cap', { 'content-type': 'application/json' }, 'x'.repeat(1_000_001), 413],
  ])('refuses %s', async (_, headers, body, status) => {
    const res = await bff(
      request('users', {
        method: 'PATCH',
        body,
        headers: { ...headers, cookie: cookieHeader({ access: 'a' }) },
      }),
      ['users'],
    );
    expect(res.status).toBe(status);
    expect(upstream).not.toHaveBeenCalled();
  });

  it('answers 502 when NestJS cannot be reached', async () => {
    upstream.mockRejectedValue(new TypeError('fetch failed'));
    const res = await bff(
      request('users', { headers: { cookie: cookieHeader({ access: 'a' }) } }),
      ['users'],
    );
    expect(res.status).toBe(502);
  });

  it.each([204, 304])('passes a %i through without a body', async (status) => {
    upstream.mockResolvedValue(new Response(null, { status }));
    const res = await bff(
      request('users/u1', { method: 'DELETE', headers: { cookie: cookieHeader({ access: 'a' }) } }),
      ['users', 'u1'],
    );
    expect(res.status).toBe(status);
    expect(res.body).toBeNull();
  });
});

const headerNames = (headers: Headers) => {
  const names: string[] = [];
  headers.forEach((_, name) => names.push(name));
  return names.sort();
};

describe('createBffHandler with 1.2 options (no extraHeaders, appOrigin a string)', () => {
  it('calls the 1.2 refresher with the same two arguments, on rotation and on the retry', async () => {
    upstream
      .mockResolvedValueOnce(new Response(null, { status: 401 }))
      .mockResolvedValueOnce(Response.json({ success: true, data: [] }));
    const res = await bff(
      request('users', {
        headers: {
          cookie: cookieHeader({ access: OLD.accessToken, refresh: OLD.refreshToken }),
          'x-forwarded-for': '203.0.113.7',
        },
      }),
      ['users'],
    );
    expect(res.status).toBe(200);
    expect(refresh.mock.calls).toEqual([[OLD.refreshToken, '203.0.113.7']]);
    expect(refresh.mock.calls[0]).toHaveLength(2);
  });

  it('sends upstream only the headers it sent before', async () => {
    await bff(
      request('users', {
        headers: {
          cookie: cookieHeader({ access: OLD.accessToken }),
          'accept-language': 'ar',
          'x-tracker-site': 'site_forged', // not on the forward list: a browser cannot pick a site
        },
      }),
      ['users'],
    );
    expect(headerNames(call().headers)).toEqual(['accept-language', 'authorization']);
  });
});

describe('createBffHandler with a per-request appOrigin and extraHeaders (1.3)', () => {
  const SITES: Partial<Record<string, string>> = { 'a.example': 'site_a', 'b.example': 'site_b' };
  const hostOf = (req: Request) => new URL(req.url).host;
  const siteRefresh = vi.fn<Refresher>();
  const siteOrigin = vi.fn((req: Request) =>
    SITES[hostOf(req)] ? `https://${hostOf(req)}` : null,
  );
  const siteHeaders = vi.fn((req: Request) => ({ 'x-tracker-site': SITES[hostOf(req)] ?? '' }));
  const siteBff = (overrides: Partial<BffOptions> = {}) =>
    createBffHandler({
      apiUrl: API,
      appOrigin: siteOrigin,
      cookies: NAMES,
      refresh: siteRefresh,
      allow: ALLOW,
      extraHeaders: siteHeaders,
      ...overrides,
    });
  const at = (
    host: string,
    init: { method?: string; origin?: string; headers?: Record<string, string> } = {},
  ) => {
    const method = init.method ?? 'GET';
    const write = method !== 'GET' && method !== 'HEAD';
    return new Request(`https://${host}/api/bff/users`, {
      method,
      body: write ? '{}' : null,
      headers: {
        origin: init.origin ?? `https://${host}`,
        ...(write && { 'content-type': 'application/json' }),
        ...init.headers,
      },
    });
  };

  beforeEach(() => {
    siteRefresh.mockReset().mockResolvedValue({ ok: true, tokens: NEW });
    siteOrigin.mockClear();
    siteHeaders.mockClear();
  });

  it("resolves the origin per request: a host accepts its own origin, never another host's", async () => {
    const handler = siteBff();
    const cookie = cookieHeader({ access: OLD.accessToken });
    const own = await handler(at('b.example', { method: 'POST', headers: { cookie } }), ['users']);
    expect(own.status).toBe(200);
    expect(siteOrigin).toHaveBeenCalledTimes(1);
    expect(siteOrigin.mock.calls[0]?.[0].url).toBe('https://b.example/api/bff/users');
    expect(call().headers.get('x-tracker-site')).toBe('site_b');

    const other = await handler(
      at('b.example', { method: 'POST', origin: 'https://a.example', headers: { cookie } }),
      ['users'],
    );
    expect(other.status).toBe(403);
    await expect(other.json()).resolves.toEqual({ code: 'csrf' });
    expect(upstream).toHaveBeenCalledTimes(1);
  });

  it('takes an async appOrigin like a string one', async () => {
    const handler = siteBff({ appOrigin: (req) => Promise.resolve(`https://${hostOf(req)}`) });
    const cookie = cookieHeader({ access: OLD.accessToken });
    const res = await handler(at('a.example', { method: 'PATCH', headers: { cookie } }), ['users']);
    expect(res.status).toBe(200);
  });

  it.each<[string, BffOptions['appOrigin']]>([
    ['null', () => null],
    ['a promise of null', () => Promise.resolve(null)],
    // what an untyped (JavaScript) app may return: treated as null
    ['undefined', (() => undefined) as unknown as BffOptions['appOrigin']],
    ['a promise of undefined', (() => Promise.resolve()) as unknown as BffOptions['appOrigin']],
    ["''", () => ''],
  ])(
    'answers 403 csrf to every method when appOrigin gives %s, before NestJS',
    async (_, appOrigin) => {
      const handler = siteBff({ appOrigin });
      const cookie = cookieHeader({ refresh: OLD.refreshToken });
      for (const method of ['GET', 'HEAD', 'POST']) {
        const res = await handler(at('unknown.example', { method, headers: { cookie } }), [
          'users',
        ]);
        expect(res.status).toBe(403);
        if (method !== 'HEAD') await expect(res.json()).resolves.toEqual({ code: 'csrf' });
      }
      expect(siteHeaders).not.toHaveBeenCalled();
      expect(siteRefresh).not.toHaveBeenCalled();
      expect(upstream).not.toHaveBeenCalled();
    },
  );

  it('sends the extra headers on the rotation and on the upstream call, asked for each', async () => {
    const res = await siteBff()(
      at('a.example', {
        headers: {
          cookie: cookieHeader({ refresh: OLD.refreshToken }),
          'x-forwarded-for': '1.2.3.4',
        },
      }),
      ['users'],
    );
    expect(res.status).toBe(200);
    expect(siteRefresh).toHaveBeenCalledWith(OLD.refreshToken, '1.2.3.4', {
      'x-tracker-site': 'site_a',
    });
    expect(call().headers.get('x-tracker-site')).toBe('site_a');
    expect(call().headers.get('authorization')).toBe(`Bearer ${NEW.accessToken}`);
    expect(siteHeaders).toHaveBeenCalledTimes(2);
  });

  it('asks again before each call, so the retry after a refresh carries a new timestamp', async () => {
    upstream
      .mockResolvedValueOnce(new Response(null, { status: 401 }))
      .mockResolvedValueOnce(Response.json({ success: true, data: [] }));
    let ts = 1_763_000_000_000; // Unix ms, as x-tracker-client-ts
    const res = await siteBff({
      extraHeaders: () => ({ 'x-tracker-site': 'site_a', 'x-tracker-client-ts': String(ts++) }),
    })(
      at('a.example', {
        headers: { cookie: cookieHeader({ access: OLD.accessToken, refresh: OLD.refreshToken }) },
      }),
      ['users'],
    );
    expect(res.status).toBe(200);
    expect(call(0).headers.get('x-tracker-client-ts')).toBe('1763000000000');
    expect(siteRefresh.mock.calls[0]?.[2]).toEqual({
      'x-tracker-site': 'site_a',
      'x-tracker-client-ts': '1763000000001',
    });
    expect(call(1).headers.get('x-tracker-client-ts')).toBe('1763000000002');
  });

  it('rejects when extraHeaders throws, even on the retry, instead of answering 502', async () => {
    upstream.mockResolvedValueOnce(new Response(null, { status: 401 }));
    let calls = 0;
    const handler = siteBff({
      extraHeaders: () => {
        if (++calls > 1) throw new Error('site lookup failed');
        return { 'x-tracker-site': 'site_a' };
      },
    });
    await expect(
      handler(
        at('a.example', {
          headers: {
            cookie: cookieHeader({ access: OLD.accessToken, refresh: OLD.refreshToken }),
          },
        }),
        ['users'],
      ),
    ).rejects.toThrow('site lookup failed');
    expect(siteRefresh).not.toHaveBeenCalled();
    expect(upstream).toHaveBeenCalledTimes(1);
  });

  it('sends them on the refresh after a NestJS 401 and on both upstream calls', async () => {
    upstream
      .mockResolvedValueOnce(new Response(null, { status: 401 }))
      .mockResolvedValueOnce(Response.json({ success: true, data: [] }));
    const res = await siteBff({
      extraHeaders: () =>
        Promise.resolve({ 'X-Tracker-Site': 'site_a', 'x-tracker-client-ip': '203.0.113.9' }),
    })(
      at('a.example', {
        headers: { cookie: cookieHeader({ access: OLD.accessToken, refresh: OLD.refreshToken }) },
      }),
      ['users'],
    );
    expect(res.status).toBe(200);
    const extra = { 'x-tracker-site': 'site_a', 'x-tracker-client-ip': '203.0.113.9' };
    expect(siteRefresh.mock.calls).toEqual([[OLD.refreshToken, null, extra]]);
    for (const n of [0, 1]) {
      expect(call(n).headers.get('x-tracker-site')).toBe('site_a');
      expect(call(n).headers.get('x-tracker-client-ip')).toBe('203.0.113.9');
    }
    expect(call(1).headers.get('authorization')).toBe(`Bearer ${NEW.accessToken}`);
  });

  // every name the handler sets itself or never passes, in several spellings
  const RESERVED_NAMES = [
    'authorization',
    'Authorization',
    'AUTHORIZATION',
    'cookie',
    'Cookie',
    'host',
    'HOST',
    'content-type',
    'Content-Type',
    'accept',
    'Accept',
    'accept-language',
    'Accept-Language',
    'if-none-match',
    'If-None-Match',
    'x-forwarded-for',
    'X-Forwarded-For',
    'x-request-id',
    'X-Request-ID',
  ];
  /** What the browser sends for the name, and what NestJS must get whatever extraHeaders says. */
  const BROWSER: Record<string, string> = {
    'content-type': 'application/json',
    accept: 'application/json',
    'accept-language': 'ar',
    'if-none-match': '"v1"',
    'x-forwarded-for': '203.0.113.7',
    'x-request-id': 'req-1',
    authorization: 'Bearer from-the-browser',
    host: 'a.example',
  };
  const forged = (name: string) => () => ({ [name]: 'forged', 'x-tracker-site': 'site_a' });

  it.each(RESERVED_NAMES)('never sets %s through extraHeaders', async (name) => {
    const res = await siteBff({ extraHeaders: forged(name) })(
      at('a.example', { headers: { cookie: cookieHeader({ refresh: OLD.refreshToken }) } }),
      ['users'],
    );
    expect(res.status).toBe(200);
    const lower = name.toLowerCase();
    const sent = call().headers;
    expect(sent.get(lower)).toBe(lower === 'authorization' ? `Bearer ${NEW.accessToken}` : null);
    expect(sent.get('x-tracker-site')).toBe('site_a');
    expect(siteRefresh.mock.calls[0]?.[2]).toEqual({ 'x-tracker-site': 'site_a' });
  });

  it.each(RESERVED_NAMES)('never overrides %s through extraHeaders', async (name) => {
    const lower = name.toLowerCase();
    const browser = lower === 'cookie' ? {} : { [lower]: BROWSER[lower] ?? '' };
    const res = await siteBff({ extraHeaders: forged(name) })(
      at('a.example', {
        method: 'POST',
        headers: { ...browser, cookie: cookieHeader({ access: OLD.accessToken }) },
      }),
      ['users'],
    );
    expect(res.status).toBe(200);
    const expected: Record<string, string | null> = {
      authorization: `Bearer ${OLD.accessToken}`,
      cookie: null,
      host: null,
    };
    expect(call().headers.get(lower)).toBe(
      lower in expected ? expected[lower] : (BROWSER[lower] ?? null),
    );
    expect(call().headers.get('x-tracker-site')).toBe('site_a');
  });
});
