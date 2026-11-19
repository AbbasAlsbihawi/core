# @abbasalsbihawi/core

Runtime building blocks of the templates. ESM with types; one entry point per module so a browser bundle never pulls server code.

| Import                                | Exports                                                                                                                                                                |
| ------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `@abbasalsbihawi/core/csp`            | `makeNonce`, `nonceCsp(nonce, { dev, reportPath, upgradeInsecureRequests, extend })`, `staticCsp({ hashes, … })`, `CSP_REPORT_PATH`                                    |
| `@abbasalsbihawi/core/csp-report`     | `parseCspReport(body)`, `MAX_REPORTS`, `CspViolation`                                                                                                                  |
| `@abbasalsbihawi/core/read-body`      | `readBodyCapped(request, maxBytes)`                                                                                                                                    |
| `@abbasalsbihawi/core/origin`         | `isSameOrigin(request, appOrigin)`                                                                                                                                     |
| `@abbasalsbihawi/core/envelope`       | `envelope`, `unwrap`, `ApiError`, `ErrorKey`, `parseNestError`, `toApiError`                                                                                           |
| `@abbasalsbihawi/core/session`        | `tokenPairSchema`, `sessionCookies`, `writeSessionCookies`, `headerCookieWriter`, `readCookie`, `serializeCookie`, `createRefresher`, `resolveSession`, `safeNextPath` |
| `@abbasalsbihawi/core/bff`            | `createBffHandler({ apiUrl, appOrigin, cookies, refresh, allow, extraHeaders })`, `bffUpstream`                                                                        |
| `@abbasalsbihawi/core/http`           | `Http`, `Method`, `createBffClient(prefix)` (browser)                                                                                                                  |
| `@abbasalsbihawi/core/document-nonce` | `documentNonce()`                                                                                                                                                      |
| `@abbasalsbihawi/core/i18n`           | `getDirection`, `toLocale(value, routing)`, `pickMessages`, `formats`, `localeAlternates`                                                                              |
| `@abbasalsbihawi/core/brand`          | `brandVars`, `brandCss`, `maxChromaSrgb`, `seedToHex`, `hexToOklch`, `isBrightHue`, `BRAND_STEPS`                                                                      |

`zod` (^4) is an optional peer, needed by `csp-report`, `envelope`, `session`, `bff` and `http`.

## The session, in one app

```ts
// shared/auth/session.ts — the app's bindings (env and APP_ID stay in the app)
export const SESSION = sessionCookies(APP_ID);
export const refreshOnce = createRefresher({ apiUrl: env.API_URL }); // path: 'auth/refresh'

// proxy.ts — the gate of protected pages
const session = await resolveSession(
  {
    access: req.cookies.get(SESSION.access)?.value,
    refresh: req.cookies.get(SESSION.refresh)?.value,
  },
  refreshOnce,
  req.headers.get('x-forwarded-for'),
);
// 'rotated' → put the pair on the request and writeSessionCookies(res.cookies, SESSION, pair)
// 'signed-out' → redirect to sign-in (expire the cookies when session.clear); 'unavailable' → render

// app/api/bff/[...path]/route.ts
const bff = createBffHandler({
  apiUrl: env.API_URL,
  appOrigin: env.APP_ORIGIN,
  cookies: SESSION,
  refresh: refreshOnce,
  allow: [/^users(?:\/|$)/],
});
async function handler(req: NextRequest, ctx: RouteContext<'/api/bff/[...path]'>) {
  return bff(req, (await ctx.params).path);
}
```

## One app on several hosts (1.3)

`appOrigin` may be a function, asked on every request: it returns the origin of the request's host, or `null` for a host the app does not serve (anything but a non-empty string counts as `null`), which answers 403 `{ code: 'csrf' }` to every method, reads included. `extraHeaders` adds headers to every upstream call of the request — the refresh too — and is asked again before each of them, so a signed timestamp (`x-tracker-client-ts`) is fresh on a retry. It can never set or override `authorization`, `cookie`, `host` or a header the handler forwards (`content-type`, `accept`, `accept-language`, `if-none-match`, `x-forwarded-for`, `x-request-id`): those names are dropped whatever their case. A throw from either function rejects the handler (it never turns into a 502), and no further call reaches NestJS. A refresh is shared only between calls with the same token and the same `x-tracker-site`. Cookies stay host-only (`__Host-`, no Domain).

```ts
// app/api/bff/[...path]/route.ts
const bff = createBffHandler({
  apiUrl: env.API_URL,
  appOrigin: async (req) => (await siteOf(req))?.origin ?? null, // null → 403 csrf
  extraHeaders: async (req) => {
    const site = await siteOf(req);
    return site ? { 'x-tracker-site': site.id } : {}; // no site: no header
  },
  cookies: SESSION,
  refresh: refreshOnce,
  allow: [/^users(?:\/|$)/],
});

// proxy.ts — the refresh carries the same headers
const session = await resolveSession(tokens, refreshOnce, forwardedFor, {
  'x-tracker-site': site.id,
});
```

`Refresher` takes `extraHeaders` as a third argument; `createRefresher` sends them minus `authorization`, `cookie`, `host`, `content-type`, `accept` and `x-forwarded-for`. Without them every function is called exactly as in 1.2, so 1.2 call sites need no change.

Sign-in and sign-out stay in the app (Server Actions: they call their own NestJS endpoints), and so does the session DAL (`getSession`/`requireSession`, which asks NestJS who the user is).
