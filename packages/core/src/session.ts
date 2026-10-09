// A NestJS session behind a BFF: two httpOnly `__Host-` cookies, token rotation shared per process,
// and the `?next=` of a sign-in page. Pure: the app binds its app id, API URL and locales.
import * as z from 'zod';

import { envelope } from './envelope.js';

/** TokensEntity of new-structure-backend: `data` of POST auth/refresh and of every sign-in. */
export const tokenPairSchema = z.object({
  accessToken: z.string().min(20),
  refreshToken: z.string().min(20),
  expiresIn: z.number().optional(), // seconds (900); the cookie lifetimes are SessionCookies'
});
export type TokenPair = z.infer<typeof tokenPairSchema>;

// ---------- Cookies ----------

export interface CookieOptions {
  httpOnly: boolean;
  secure: boolean;
  sameSite: 'lax' | 'strict';
  path: string;
  maxAge: number;
}

/** `__Host-` requires Secure, Path=/ and no Domain (Chrome treats http://localhost as secure). */
export const COOKIE_BASE = { httpOnly: true, secure: true, sameSite: 'lax', path: '/' } as const;

export interface SessionCookies {
  readonly access: string;
  readonly refresh: string;
  readonly accessMaxAge: number;
  readonly refreshMaxAge: number;
}

const APP_ID = /^[a-z][a-z0-9-]*[a-z0-9]$/;

/**
 * `__Host-<appId>-at` / `-rt`: the app id keeps apps on one host (localhost ports) apart. The access
 * cookie dies before the 15-minute access JWT, so "access cookie missing" means "time to refresh".
 */
export function sessionCookies(
  appId: string,
  options: { accessMaxAge?: number; refreshMaxAge?: number } = {},
): SessionCookies {
  if (!APP_ID.test(appId))
    throw new Error(`sessionCookies: invalid app id ${JSON.stringify(appId)}`);
  return {
    access: `__Host-${appId}-at`,
    refresh: `__Host-${appId}-rt`,
    accessMaxAge: options.accessMaxAge ?? 14 * 60,
    refreshMaxAge: options.refreshMaxAge ?? 7 * 24 * 60 * 60,
  };
}

/** NextResponse#cookies, the `cookies()` jar of a Server Action, or `headerCookieWriter`. */
export interface CookieWriter {
  set(name: string, value: string, options: CookieOptions): unknown;
}

/**
 * pair → set both; null → expire both; undefined → leave them alone. An expiry repeats Secure and
 * Path=/: browsers ignore a `__Host-` cookie written without them, delete included — so never
 * `jar.delete()`, which drops Secure.
 */
export function writeSessionCookies(
  jar: CookieWriter,
  names: SessionCookies,
  pair: TokenPair | null | undefined,
): void {
  if (pair === undefined) return;
  jar.set(names.access, pair?.accessToken ?? '', {
    ...COOKIE_BASE,
    maxAge: pair ? names.accessMaxAge : 0,
  });
  jar.set(names.refresh, pair?.refreshToken ?? '', {
    ...COOKIE_BASE,
    maxAge: pair ? names.refreshMaxAge : 0,
  });
}

/** One `Set-Cookie` value, encoded as Next encodes it. */
export function serializeCookie(name: string, value: string, options: CookieOptions): string {
  const parts = [
    `${name}=${encodeURIComponent(value)}`,
    `Path=${options.path}`,
    `Max-Age=${String(options.maxAge)}`,
  ];
  if (options.secure) parts.push('Secure');
  if (options.httpOnly) parts.push('HttpOnly');
  parts.push(options.sameSite === 'lax' ? 'SameSite=Lax' : 'SameSite=Strict');
  return parts.join('; ');
}

/** Cookies on a plain Response: each `set` appends one `Set-Cookie` header. */
export function headerCookieWriter(headers: Headers): CookieWriter {
  return {
    set(name, value, options) {
      headers.append('set-cookie', serializeCookie(name, value, options));
    },
  };
}

/** One cookie of a `Cookie` request header, decoded as Next decodes it. */
export function readCookie(header: string | null, name: string): string | undefined {
  for (const part of header?.split(';') ?? []) {
    const eq = part.indexOf('=');
    if (eq === -1 || part.slice(0, eq).trim() !== name) continue;
    const raw = part.slice(eq + 1).trim();
    try {
      return decodeURIComponent(raw);
    } catch {
      return raw;
    }
  }
  return undefined;
}

// ---------- Rotation ----------

export type RefreshResult =
  { ok: true; tokens: TokenPair } | { ok: false; reason: 'invalid' | 'unavailable' };

/** `forwardedFor` is the browser's X-Forwarded-For: NestJS rate-limits per client, not per BFF. */
export type Refresher = (
  refreshToken: string,
  forwardedFor?: string | null,
) => Promise<RefreshResult>;

export interface RefresherOptions {
  /** The NestJS base, ending in `/api/v1/`. */
  apiUrl: string;
  /** Relative to `apiUrl`; NestJS reads `{ refreshToken }` from the body. */
  path?: string;
  timeoutMs?: number;
}

/**
 * One NestJS call per refresh token and process: parallel requests of one browser (tabs,
 * prefetches, the BFF) share it. Across processes NestJS covers the rest: it serialises refreshes
 * per session and answers a token rotated less than 30 s ago with the current pair, so they all
 * converge. 400/401/403 → 'invalid' (sign in again); anything else → 'unavailable', because an
 * outage must not sign anyone out.
 */
export function createRefresher({
  apiUrl,
  path = 'auth/refresh',
  timeoutMs = 5_000,
}: RefresherOptions): Refresher {
  const endpoint = new URL(path, apiUrl);
  const inflight = new Map<string, Promise<RefreshResult>>();

  async function call(refreshToken: string, forwardedFor?: string | null): Promise<RefreshResult> {
    const headers = new Headers({ 'content-type': 'application/json', accept: 'application/json' });
    if (forwardedFor) headers.set('x-forwarded-for', forwardedFor);
    try {
      const res = await fetch(endpoint, {
        method: 'POST',
        headers,
        body: JSON.stringify({ refreshToken }),
        cache: 'no-store',
        redirect: 'manual',
        signal: AbortSignal.timeout(timeoutMs),
      });
      if (res.status === 400 || res.status === 401 || res.status === 403) {
        return { ok: false, reason: 'invalid' };
      }
      if (!res.ok) return { ok: false, reason: 'unavailable' };
      const parsed = envelope(tokenPairSchema).safeParse(await res.json());
      return parsed.success
        ? { ok: true, tokens: parsed.data.data }
        : { ok: false, reason: 'unavailable' };
    } catch {
      return { ok: false, reason: 'unavailable' };
    }
  }

  return (refreshToken, forwardedFor) => {
    let pending = inflight.get(refreshToken);
    if (!pending) {
      pending = call(refreshToken, forwardedFor).finally(() => inflight.delete(refreshToken));
      inflight.set(refreshToken, pending);
    }
    return pending;
  };
}

export type SessionState =
  | { status: 'active'; accessToken: string }
  | { status: 'rotated'; tokens: TokenPair }
  | { status: 'signed-out'; clear: boolean }
  | { status: 'unavailable' };

/**
 * What a request's cookies are worth before NestJS sees them. The access cookie is not verified
 * here (NestJS does that on every call): present means "use it". Without it the refresh cookie is
 * rotated. `clear` = NestJS rejected the refresh cookie, so the response expires both.
 */
export async function resolveSession(
  cookies: { access?: string | undefined; refresh?: string | undefined },
  refresh: Refresher,
  forwardedFor?: string | null,
): Promise<SessionState> {
  if (cookies.access) return { status: 'active', accessToken: cookies.access };
  if (!cookies.refresh) return { status: 'signed-out', clear: false };
  const result = await refresh(cookies.refresh, forwardedFor);
  if (result.ok) return { status: 'rotated', tokens: result.tokens };
  return result.reason === 'invalid'
    ? { status: 'signed-out', clear: true }
    : { status: 'unavailable' };
}

// ---------- After sign-in ----------

const BASE = 'http://n.invalid';
const INTERNAL = /^\/(?:api|_next)(?:\/|$)/;

/**
 * `?next=` is attacker-controlled: only a same-origin app path survives, without its locale prefix
 * (the redirect adds the locale of the page that signs the user in), else '/'. URL parsing, not
 * string checks, rejects "//evil", "/\evil" and "/\t/evil": the parser strips tabs and newlines and
 * reads a backslash as a slash, so all three resolve to another host.
 */
export function safeNextPath(value: unknown, locales: readonly string[]): string {
  if (typeof value !== 'string' || !value.startsWith('/')) return '/';
  let url: URL;
  try {
    url = new URL(value, BASE);
  } catch {
    return '/';
  }
  if (url.origin !== BASE || INTERNAL.test(url.pathname)) return '/';
  const [, first = ''] = url.pathname.split('/');
  const path = locales.includes(first) ? url.pathname.slice(first.length + 1) || '/' : url.pathname;
  return INTERNAL.test(path) ? '/' : path + url.search;
}
