# @abbasalsbihawi/core

Runtime building blocks of the templates. ESM with types; one entry point per module so a browser bundle never pulls server code.

| Import                                | Exports                                                                                                                                                                |
| ------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `@abbasalsbihawi/core/csp`            | `makeNonce`, `nonceCsp(nonce, { dev, reportPath, extend })`, `staticCsp({ hashes, dev, reportPath, extend })`, `CSP_REPORT_PATH`                                       |
| `@abbasalsbihawi/core/csp-report`     | `parseCspReport(body)`, `MAX_REPORTS`, `CspViolation`                                                                                                                  |
| `@abbasalsbihawi/core/read-body`      | `readBodyCapped(request, maxBytes)`                                                                                                                                    |
| `@abbasalsbihawi/core/origin`         | `isSameOrigin(request, appOrigin)`                                                                                                                                     |
| `@abbasalsbihawi/core/envelope`       | `envelope`, `unwrap`, `ApiError`, `ErrorKey`, `parseNestError`, `toApiError`                                                                                           |
| `@abbasalsbihawi/core/session`        | `tokenPairSchema`, `sessionCookies`, `writeSessionCookies`, `headerCookieWriter`, `readCookie`, `serializeCookie`, `createRefresher`, `resolveSession`, `safeNextPath` |
| `@abbasalsbihawi/core/bff`            | `createBffHandler({ apiUrl, appOrigin, cookies, refresh, allow })`, `bffUpstream`                                                                                      |
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

Sign-in and sign-out stay in the app (Server Actions: they call their own NestJS endpoints), and so does the session DAL (`getSession`/`requireSession`, which asks NestJS who the user is).
