// The browser's only door to NestJS, as a Request → Response handler for a catch-all Route Handler
// (`app/api/bff/[...path]/route.ts`): same-origin only, allow-listed paths, the Bearer token added
// from the httpOnly cookie. A proxy does not run for /api, so the handler refreshes on its own.
import { isSameOrigin } from './origin.js';
import { readBodyCapped } from './read-body.js';
import {
  headerCookieWriter,
  readCookie,
  resolveSession,
  writeSessionCookies,
  type Refresher,
  type SessionCookies,
  type TokenPair,
} from './session.js';

/**
 * Catch-all params arrive percent-decoded and may contain "/" ("users%2F..%2Fauth" is one segment),
 * so each segment is checked and re-encoded, and the result must still sit under `apiUrl`.
 */
export function bffUpstream(
  segments: readonly string[],
  apiUrl: string,
  allow: readonly RegExp[],
): URL | null {
  if (segments.some((s) => s === '' || s === '.' || s === '..' || /[/\\]|\p{Cc}/u.test(s))) {
    return null;
  }
  const relative = segments.map(encodeURIComponent).join('/');
  if (!allow.some((r) => r.test(relative))) return null;
  const base = new URL(apiUrl);
  const url = new URL(relative, base);
  return url.origin === base.origin && url.pathname.startsWith(base.pathname) ? url : null;
}

const FORWARD_REQUEST = [
  'content-type',
  'accept',
  'accept-language',
  'if-none-match',
  'x-forwarded-for', // NestJS rate-limits per client (trust proxy)
  'x-request-id',
] as const;
const FORWARD_RESPONSE = [
  'content-type',
  'content-disposition',
  'etag',
  'retry-after',
  'x-request-id',
] as const;
const NULL_BODY = new Set([204, 205, 304]);
/** What the handler sets itself (auth, forwarding) or never passes: extra headers cannot touch it. */
const RESERVED: ReadonlySet<string> = new Set([
  'authorization',
  'cookie',
  'host',
  ...FORWARD_REQUEST,
]);

export interface BffOptions {
  apiUrl: string;
  /**
   * The origin a write must come from. A function is asked on every request (one app serving
   * several hosts); null (or anything but a non-empty string) answers 403 `{ code: 'csrf' }` to
   * every method, reads included.
   */
  appOrigin: string | ((req: Request) => string | null | Promise<string | null>);
  cookies: SessionCookies;
  refresh: Refresher;
  /** Upstream prefixes the browser may reach, one per feature, e.g. `/^users(?:\/|$)/` — never auth. */
  allow: readonly RegExp[];
  maxBodyBytes?: number;
  timeoutMs?: number;
  /**
   * Headers for every upstream call of the request, the refresh included (a site id, a signed
   * client IP); asked again before each call, so a signed timestamp is fresh on a retry.
   * Authorization, cookie, host and the forwarded headers are dropped whatever their case: the
   * handler's own values always win. A throw rejects the handler; nothing more reaches NestJS.
   */
  extraHeaders?: (req: Request) => Record<string, string> | Promise<Record<string, string>>;
}

/** The extra headers minus RESERVED; Headers lower-cases the names and refuses malformed ones. */
function allowedExtra(headers: Record<string, string>): Record<string, string> {
  const allowed: Record<string, string> = {};
  new Headers(headers).forEach((value, name) => {
    if (!RESERVED.has(name)) allowed[name] = value;
  });
  return allowed;
}

export type BffHandler = (request: Request, segments: readonly string[]) => Promise<Response>;

const empty = (status: number) => new Response(null, { status });

export function createBffHandler(options: BffOptions): BffHandler {
  const { apiUrl, appOrigin, cookies: names, refresh, allow, extraHeaders } = options;
  const maxBody = options.maxBodyBytes ?? 1_000_000;
  const timeoutMs = options.timeoutMs ?? 15_000;

  /** A response that also writes (pair), expires (null) or leaves (undefined) the cookies. */
  const withCookies = (res: Response, pair: TokenPair | null | undefined) => {
    writeSessionCookies(headerCookieWriter(res.headers), names, pair);
    return res;
  };

  return async (req, segments) => {
    const origin = typeof appOrigin === 'string' ? appOrigin : await appOrigin(req);
    // anything but a non-empty string (an untyped caller's undefined, '') counts as null
    if (typeof origin !== 'string' || !origin || !isSameOrigin(req, origin)) {
      return Response.json({ code: 'csrf' }, { status: 403 });
    }
    const url = bffUpstream(segments, apiUrl, allow);
    if (!url) return empty(404);
    url.search = new URL(req.url).search;

    let body: string | null = null;
    if (req.method !== 'GET' && req.method !== 'HEAD' && req.method !== 'DELETE') {
      if (!req.headers.get('content-type')?.startsWith('application/json')) return empty(415);
      body = await readBodyCapped(req, maxBody); // buffered: a retry after a 401 sends it again
      if (body === null) return empty(413);
    }

    /** Asked before each NestJS call; a throw rejects the handler (it is not an outage). */
    const fresh = async () => (extraHeaders ? allowedExtra(await extraHeaders(req)) : undefined);
    const cookieHeader = req.headers.get('cookie');
    const accessCookie = readCookie(cookieHeader, names.access);
    const refreshToken = readCookie(cookieHeader, names.refresh);
    const forwardedFor = req.headers.get('x-forwarded-for');
    const session = await resolveSession(
      { access: accessCookie, refresh: refreshToken },
      refresh,
      forwardedFor,
      accessCookie || !refreshToken ? undefined : await fresh(), // only a rotation sends them
    );
    if (session.status === 'unavailable') return empty(503);
    if (session.status === 'signed-out') {
      return withCookies(empty(401), session.clear ? null : undefined);
    }
    let rotated = session.status === 'rotated' ? session.tokens : undefined;
    const access = session.status === 'rotated' ? session.tokens.accessToken : session.accessToken;

    const call = async (token: string, extra: Record<string, string> | undefined) => {
      const h = new Headers(extra); // first, so nothing below can be overridden by it
      for (const name of FORWARD_REQUEST) {
        const value = req.headers.get(name);
        if (value) h.set(name, value);
      }
      h.set('authorization', `Bearer ${token}`); // the browser's Cookie and Authorization never pass
      return fetch(url, {
        method: req.method,
        headers: h,
        body,
        cache: 'no-store',
        redirect: 'manual',
        signal: AbortSignal.timeout(timeoutMs),
      });
    };
    const rotate = async (token: string, extra: Record<string, string> | undefined) =>
      extra ? refresh(token, forwardedFor, extra) : refresh(token, forwardedFor);
    /** null = NestJS unreachable or too slow; only the call itself is caught, never `fresh`. */
    const reach = <T>(work: Promise<T>) => work.catch(() => null);

    let upstream = await reach(call(access, await fresh()));
    if (upstream?.status === 401 && refreshToken && !rotated) {
      // the access cookie outlived its token (revoked, clock skew): rotate once and retry
      const retry = await reach(rotate(refreshToken, await fresh()));
      if (!retry) return empty(502);
      if (!retry.ok && retry.reason === 'unavailable') return empty(503);
      if (retry.ok) {
        rotated = retry.tokens;
        upstream = await reach(call(rotated.accessToken, await fresh()));
      }
    }
    if (!upstream) return empty(502);
    if (upstream.status === 401) return withCookies(empty(401), null);

    // never content-encoding/length: fetch has already decoded the body
    const headers = new Headers({ 'cache-control': 'no-store' });
    for (const name of FORWARD_RESPONSE) {
      const value = upstream.headers.get(name);
      if (value) headers.set(name, value);
    }
    const res = new Response(NULL_BODY.has(upstream.status) ? null : upstream.body, {
      status: upstream.status,
      headers,
    });
    return withCookies(res, rotated);
  };
}
