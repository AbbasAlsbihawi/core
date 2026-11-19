import { afterEach, describe, expect, it, vi } from 'vitest';

import {
  createRefresher,
  headerCookieWriter,
  readCookie,
  resolveSession,
  safeNextPath,
  serializeCookie,
  sessionCookies,
  writeSessionCookies,
  type CookieOptions,
  type RefreshResult,
  type Refresher,
} from './session.js';

const API = 'http://127.0.0.1:4010/api/v1/';
const PAIR = {
  accessToken: 'access-0123456789abcdef',
  refreshToken: 'refresh-0123456789abcdef',
  expiresIn: 900,
};
const NAMES = sessionCookies('shop');

describe('sessionCookies', () => {
  it('names both cookies __Host-<app id>-at/-rt, the access cookie dying before the 15-min JWT', () => {
    expect(NAMES).toEqual({
      access: '__Host-shop-at',
      refresh: '__Host-shop-rt',
      accessMaxAge: 840,
      refreshMaxAge: 604_800,
    });
    expect(sessionCookies('admin-panel', { accessMaxAge: 60 }).accessMaxAge).toBe(60);
  });

  it.each(['', 'Shop', '1shop', 'shop-', 'my shop', 'a;b'])(
    'rejects %j: not a cookie-name token of the agreed shape',
    (id) => {
      expect(() => sessionCookies(id)).toThrow(/invalid app id/);
    },
  );
});

describe('writeSessionCookies', () => {
  const jar = () => {
    const set = vi.fn<(name: string, value: string, options: CookieOptions) => void>();
    return { set };
  };
  const base = { httpOnly: true, secure: true, sameSite: 'lax', path: '/' };

  it('sets both cookies for a pair', () => {
    const j = jar();
    writeSessionCookies(j, NAMES, PAIR);
    expect(j.set.mock.calls).toEqual([
      ['__Host-shop-at', PAIR.accessToken, { ...base, maxAge: 840 }],
      ['__Host-shop-rt', PAIR.refreshToken, { ...base, maxAge: 604_800 }],
    ]);
  });

  it('expires both for null, repeating Secure and Path=/ (or the browser ignores it)', () => {
    const j = jar();
    writeSessionCookies(j, NAMES, null);
    expect(j.set.mock.calls).toEqual([
      ['__Host-shop-at', '', { ...base, maxAge: 0 }],
      ['__Host-shop-rt', '', { ...base, maxAge: 0 }],
    ]);
  });

  it('leaves them alone for undefined', () => {
    const j = jar();
    writeSessionCookies(j, NAMES, undefined);
    expect(j.set).not.toHaveBeenCalled();
  });

  it('writes Set-Cookie headers on a plain Response', () => {
    const headers = new Headers();
    writeSessionCookies(headerCookieWriter(headers), NAMES, PAIR);
    expect(headers.getSetCookie()).toEqual([
      `__Host-shop-at=${PAIR.accessToken}; Path=/; Max-Age=840; Secure; HttpOnly; SameSite=Lax`,
      `__Host-shop-rt=${PAIR.refreshToken}; Path=/; Max-Age=604800; Secure; HttpOnly; SameSite=Lax`,
    ]);
  });
});

describe('serializeCookie / readCookie', () => {
  it('round-trips a value that needs encoding', () => {
    const header = serializeCookie('__Host-a', 'x y;z=', {
      httpOnly: false,
      secure: true,
      sameSite: 'strict',
      path: '/',
      maxAge: 5,
    });
    expect(header).toBe('__Host-a=x%20y%3Bz%3D; Path=/; Max-Age=5; Secure; SameSite=Strict');
    const value = header.split(';')[0]?.split('=').slice(1).join('=') ?? '';
    expect(readCookie(`other=1; __Host-a=${value}`, '__Host-a')).toBe('x y;z=');
  });

  it.each([
    [null, undefined],
    ['', undefined],
    ['a=1; b=2', '2'],
    ['a=1;b=2', '2'],
    ['ba=1; b=2', '2'], // not a suffix match
    ['b=%E0%A4%A', '%E0%A4%A'], // malformed encoding is kept as is
    ['b=', ''],
    ['flag; b=3', '3'],
  ])('reads b from %j', (header, expected) => {
    expect(readCookie(header, 'b')).toBe(expected);
  });
});

const success = () => Response.json({ success: true, data: PAIR, timestamp: 't' });
const failure = (status: number) =>
  Response.json(
    { success: false, statusCode: status, message: 'x', timestamp: 't', path: '/' },
    { status },
  );
const stubFetch = (respond: () => Promise<Response>) => {
  const fetchMock = vi.fn<typeof fetch>().mockImplementation(respond);
  vi.stubGlobal('fetch', fetchMock);
  return fetchMock;
};

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('createRefresher', () => {
  it('posts the refresh token to auth/refresh under the API URL and returns the new pair', async () => {
    const fetchMock = stubFetch(() => Promise.resolve(success()));
    const refresh = createRefresher({ apiUrl: API });
    await expect(refresh('token-a-0123456789')).resolves.toEqual({ ok: true, tokens: PAIR });
    const [url, init] = fetchMock.mock.calls[0] ?? [];
    expect(url).toEqual(new URL(`${API}auth/refresh`));
    expect(init?.method).toBe('POST');
    expect(init?.body).toBe(JSON.stringify({ refreshToken: 'token-a-0123456789' }));
    expect(new Headers(init?.headers).has('x-forwarded-for')).toBe(false);
  });

  it('takes another path (a second kind of user on the same NestJS)', async () => {
    const fetchMock = stubFetch(() => Promise.resolve(success()));
    await createRefresher({ apiUrl: API, path: 'customers/auth/refresh' })('token-g-0123456789');
    expect(fetchMock.mock.calls[0]?.[0]).toEqual(new URL(`${API}customers/auth/refresh`));
  });

  it("passes the browser's X-Forwarded-For on, so NestJS limits per client and not per BFF", async () => {
    const fetchMock = stubFetch(() => Promise.resolve(success()));
    await createRefresher({ apiUrl: API })('token-f-0123456789', '203.0.113.7, 10.0.0.2');
    const [, init] = fetchMock.mock.calls[0] ?? [];
    expect(new Headers(init?.headers).get('x-forwarded-for')).toBe('203.0.113.7, 10.0.0.2');
  });

  it('shares one NestJS call between concurrent requests with the same token', async () => {
    const pending: ((res: Response) => void)[] = [];
    const fetchMock = stubFetch(
      () =>
        new Promise<Response>((resolve) => {
          pending.push(resolve);
        }),
    );
    const refresh = createRefresher({ apiUrl: API });
    const calls = [refresh('token-b-0123456789'), refresh('token-b-0123456789')];
    const other = refresh('token-c-0123456789'); // a different session is not merged
    expect(fetchMock).toHaveBeenCalledTimes(2);
    for (const release of pending.splice(0)) release(success());
    const [first, second] = await Promise.all(calls);
    expect(second).toBe(first);
    await other;

    // settled: the next request with that token asks NestJS again
    const again = refresh('token-b-0123456789');
    expect(fetchMock).toHaveBeenCalledTimes(3);
    for (const release of pending.splice(0)) release(success());
    await again;
  });

  it.each([400, 401, 403])(
    'reports %i as an invalid token (the user signs in again)',
    async (status) => {
      stubFetch(() => Promise.resolve(failure(status)));
      await expect(createRefresher({ apiUrl: API })('token-d-0123456789')).resolves.toEqual({
        ok: false,
        reason: 'invalid',
      });
    },
  );

  it.each([
    ['a 500', () => Promise.resolve(failure(500))],
    ['a 503', () => Promise.resolve(failure(503))],
    ['a network error', () => Promise.reject(new TypeError('fetch failed'))],
    [
      'a body that is not a token pair',
      () => Promise.resolve(Response.json({ success: true, data: {}, timestamp: 't' })),
    ],
  ])('reports %s as unavailable (nobody is signed out)', async (_, respond) => {
    stubFetch(respond);
    await expect(createRefresher({ apiUrl: API })('token-e-0123456789')).resolves.toEqual({
      ok: false,
      reason: 'unavailable',
    });
  });
});

describe('resolveSession', () => {
  const refresher = (result: RefreshResult) =>
    vi.fn<(token: string) => Promise<RefreshResult>>().mockResolvedValue(result);

  it('uses an access cookie as it is, without asking NestJS', async () => {
    const refresh = refresher({ ok: true, tokens: PAIR });
    await expect(resolveSession({ access: 'a', refresh: 'r' }, refresh)).resolves.toEqual({
      status: 'active',
      accessToken: 'a',
    });
    expect(refresh).not.toHaveBeenCalled();
  });

  it('is signed out without cookies, with nothing to clear', async () => {
    await expect(resolveSession({}, refresher({ ok: true, tokens: PAIR }))).resolves.toEqual({
      status: 'signed-out',
      clear: false,
    });
  });

  it('rotates the refresh cookie when the access cookie has expired', async () => {
    const refresh = refresher({ ok: true, tokens: PAIR });
    await expect(resolveSession({ refresh: 'r' }, refresh, '203.0.113.7')).resolves.toEqual({
      status: 'rotated',
      tokens: PAIR,
    });
    expect(refresh).toHaveBeenCalledWith('r', '203.0.113.7');
  });

  it('clears a refresh cookie NestJS rejects', async () => {
    await expect(
      resolveSession({ refresh: 'r' }, refresher({ ok: false, reason: 'invalid' })),
    ).resolves.toEqual({ status: 'signed-out', clear: true });
  });

  it('keeps the cookies when NestJS is unavailable', async () => {
    await expect(
      resolveSession({ refresh: 'r' }, refresher({ ok: false, reason: 'unavailable' })),
    ).resolves.toEqual({ status: 'unavailable' });
  });
});

describe('safeNextPath', () => {
  const LOCALES = ['en', 'ar'];

  it.each([
    ['/users', '/users'],
    ['/users?q=ali&page=2', '/users?q=ali&page=2'],
    ['/settings/appearance', '/settings/appearance'],
    ['/ar/users?q=ali', '/users?q=ali'], // a locale prefix is dropped: the redirect adds the current one
    ['/en', '/'],
    ['/fr/users', '/fr/users'], // not a configured locale: an ordinary path
    ['/users/../settings', '/settings'], // normalised by the URL parser
  ])('keeps the app path %j → %j', (value, expected) => {
    expect(safeNextPath(value, LOCALES)).toBe(expected);
  });

  it.each([
    [undefined],
    [null],
    [42],
    [''],
    ['users'], // not absolute
    ['https://evil.example/x'],
    ['//evil.example/x'],
    ['/\\evil.example/x'],
    ['/\t/evil.example/x'], // ?next=/%09/evil.example arrives decoded
    ['/\n/evil.example/x'],
    ['/api/bff/users'],
    ['/_next/static/x.js'],
    ['/en/api/health'], // internal once the locale is dropped
  ])('falls back to "/" for %j', (value) => {
    expect(safeNextPath(value, LOCALES)).toBe('/');
  });
});

describe('createRefresher with extra headers (1.3)', () => {
  const sent = async (forwardedFor: string | null, extra: Record<string, string>) => {
    const fetchMock = stubFetch(() => Promise.resolve(success()));
    await createRefresher({ apiUrl: API })('token-h-0123456789', forwardedFor, extra);
    return new Headers(fetchMock.mock.calls[0]?.[1]?.headers);
  };

  it('sends them on the refresh call, whatever their case', async () => {
    const headers = await sent('203.0.113.7', {
      'X-Tracker-Site': 'site_a',
      'x-tracker-client-ip': '203.0.113.7',
    });
    expect(headers.get('x-tracker-site')).toBe('site_a');
    expect(headers.get('x-tracker-client-ip')).toBe('203.0.113.7');
    expect(headers.get('x-forwarded-for')).toBe('203.0.113.7');
  });

  it.each([
    ['authorization', null],
    ['Authorization', null],
    ['COOKIE', null],
    ['Host', null],
    ['content-type', 'application/json'],
    ['Content-Type', 'application/json'],
    ['ACCEPT', 'application/json'],
    ['x-forwarded-for', '203.0.113.7'],
    ['X-Forwarded-For', '203.0.113.7'],
  ])('never sets or overrides %s through them', async (name, expected) => {
    const headers = await sent('203.0.113.7', { [name]: 'forged', 'x-tracker-site': 'site_a' });
    expect(headers.get(name)).toBe(expected);
    expect(headers.get('x-tracker-site')).toBe('site_a');
  });

  it('never shares one flight between two sites, even for the same token', async () => {
    const pending: ((res: Response) => void)[] = [];
    const fetchMock = stubFetch(
      () =>
        new Promise<Response>((resolve) => {
          pending.push(resolve);
        }),
    );
    const refresh = createRefresher({ apiUrl: API });
    const token = 'token-j-0123456789';
    const a = refresh(token, null, { 'x-tracker-site': 'site_a' });
    const b = refresh(token, null, { 'x-tracker-site': 'site_b' });
    const none = refresh(token, null);
    const sameSite = refresh(token, null, { 'X-Tracker-Site': 'site_a' }); // any case: one flight
    expect(fetchMock).toHaveBeenCalledTimes(3);
    expect(
      fetchMock.mock.calls.map(([, init]) => new Headers(init?.headers).get('x-tracker-site')),
    ).toEqual(['site_a', 'site_b', null]);
    for (const release of pending.splice(0)) release(success());
    const [first, second, third, fourth] = await Promise.all([a, b, none, sameSite]);
    expect(fourth).toBe(first);
    expect(second).not.toBe(first);
    expect(third).not.toBe(first);
  });

  it('never sets X-Forwarded-For through them when the browser sent none', async () => {
    const headers = await sent(null, { 'X-Forwarded-For': '10.0.0.1' });
    expect(headers.has('x-forwarded-for')).toBe(false);
  });
});

describe('resolveSession with extra headers (1.3)', () => {
  it('hands them to the refresher', async () => {
    const refresh = vi.fn<Refresher>().mockResolvedValue({ ok: true, tokens: PAIR });
    await expect(
      resolveSession({ refresh: 'r' }, refresh, null, { 'x-tracker-site': 'site_a' }),
    ).resolves.toEqual({ status: 'rotated', tokens: PAIR });
    expect(refresh.mock.calls).toEqual([['r', null, { 'x-tracker-site': 'site_a' }]]);
  });

  it('calls the refresher with the two 1.2 arguments when there are none', async () => {
    const refresh = vi.fn<Refresher>().mockResolvedValue({ ok: true, tokens: PAIR });
    await resolveSession({ refresh: 'r' }, refresh, '203.0.113.7');
    expect(refresh.mock.calls[0]).toEqual(['r', '203.0.113.7']);
    expect(refresh.mock.calls[0]).toHaveLength(2);
  });
});

describe('1.2 call sites', () => {
  it('compile and behave unchanged: a 1.2 refresher, a 1.2 wrapper, two- and three-argument calls', async () => {
    const seen: [string, string | null | undefined][] = [];
    // a refresher written against 1.2, and a wrapper of the kind apps write around createRefresher
    const legacy = (token: string, forwardedFor?: string | null): Promise<RefreshResult> => {
      seen.push([token, forwardedFor]);
      return Promise.resolve({ ok: true, tokens: PAIR });
    };
    const wrap =
      (inner: Refresher): Refresher =>
      (token, forwardedFor) =>
        inner(token, forwardedFor);
    const refresh: Refresher = wrap(legacy);

    await expect(resolveSession({ refresh: 'r' }, refresh)).resolves.toEqual({
      status: 'rotated',
      tokens: PAIR,
    });
    await resolveSession({ refresh: 'r' }, legacy, '203.0.113.7');
    await expect(refresh('r2')).resolves.toEqual({ ok: true, tokens: PAIR });
    expect(seen).toEqual([
      ['r', undefined],
      ['r', '203.0.113.7'],
      ['r2', undefined],
    ]);
  });
});
