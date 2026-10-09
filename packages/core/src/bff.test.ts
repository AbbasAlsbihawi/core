import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { bffUpstream, createBffHandler } from './bff.js';
import { sessionCookies, type RefreshResult, type TokenPair } from './session.js';

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
