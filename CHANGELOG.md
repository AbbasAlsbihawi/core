# Changelog

Changes to `@abbasalsbihawi/core` and `@abbasalsbihawi/config`, newest first. Both packages share one version; every merge to `main` that changes them is a release (a `## <version> — <date>` entry here, both `package.json` versions, then the tag `v<version>`).

**Projects** says what a project does to take the release in. **Major**: a project must change its own code. **Minor**: something new it may use. **Patch**: a fix it should take.

## 1.2.0 — 2026-10-10

- `@abbasalsbihawi/core/csp`: `nonceCsp` and `staticCsp` take `upgradeInsecureRequests` (default `!dev`, so every existing header is unchanged). Turn it off on an http origin — e2e, a LAN preview: there is no https to upgrade to, and Chrome upgrades the redirects a `fetch` follows even on localhost, so a client navigation to a page behind a session gate (a 307 to sign-in) failed with `ERR_SSL_PROTOCOL_ERROR` (found by template-public's customer e2e).
- `@abbasalsbihawi/config`: unchanged (lockstep version).

Published on npm (`registry.npmjs.org`, public) since 2026-10-11, by hand; `release.yml` publishes the next versions there through trusted publishing. Earlier copies stay on GitHub Packages.

**Projects:** minor. A project whose e2e runs over http with redirects followed by client navigations passes `upgradeInsecureRequests: env.APP_ORIGIN.startsWith('https:')` (template-public 1.1.0 does).

## 1.1.0 — 2026-10-10

The BFF and its session, moved out of template-admin 2.0.0 so template-public can sign customers in with the same code.

- `@abbasalsbihawi/core`
  - `/envelope`: `envelope`, `unwrap`, `ApiError` (`messageKey`), `parseNestError`, `toApiError` — new-structure-backend's success and error bodies, unchanged.
  - `/session`: `tokenPairSchema`; `sessionCookies(appId)` (`__Host-<app-id>-at` / `-rt`, 14 min / 7 days); `writeSessionCookies(jar, names, pair | null | undefined)` for NextResponse#cookies, the `cookies()` jar or a plain Response (`headerCookieWriter`); `readCookie`, `serializeCookie`; `createRefresher({ apiUrl, path })` — the per-process single-flight rotation, its endpoint now an option; `resolveSession(cookies, refresh)` — active, rotated, signed out (and whether to clear) or unavailable, the one decision the proxy and the BFF share; `safeNextPath(value, locales)`.
  - `/bff`: `createBffHandler({ apiUrl, appOrigin, cookies, refresh, allow })` — the catch-all Route Handler as a plain `Request → Response` function; `bffUpstream(segments, apiUrl, allow)`. Two changes from template-admin's route: a retry after a NestJS 401 that cannot refresh answers 503 and keeps the cookies (it used to sign the user out), and an unreachable NestJS answers 502 instead of throwing.
  - `/http`: the `Http` interface and `createBffClient(prefix)`; a body-less call no longer sends `content-type`.
- `@abbasalsbihawi/config`: unchanged (lockstep version).

**Projects:** minor. template-admin 2.1.0 binds these modules and deletes its own copies; template-public 1.1.0 builds customer accounts on them.

## 1.0.0 — 2026-10-10

Extracted from template-admin 1.0.0 (the decisions scoped **common** in its DECISIONS.md) and the storefront spike.

- `@abbasalsbihawi/core`
  - `/csp`: `makeNonce` (Web Crypto, any runtime), `nonceCsp(nonce, options)` — byte for byte the header of template-admin 1.0.0 — and `staticCsp({ hashes })` for prerendered pages (hashes, or `'unsafe-inline'` as the fallback). `extend` adds sources per directive, `reportPath: null` drops reporting.
  - `/csp-report`: `parseCspReport` (both wire formats, capped and cut for logs).
  - `/read-body`: `readBodyCapped` (no `server-only` import any more: it is safe anywhere).
  - `/origin`: `isSameOrigin(request, appOrigin)` — the CSRF check of Route Handlers as a pure function.
  - `/document-nonce`: the document's nonce for elements created in the browser.
  - `/i18n`: `getDirection` (adds `ckb`), `toLocale(value, routing)`, `pickMessages`, `formats` (IQD, Western digits), `localeAlternates`.
  - `/brand`: the OKLCH ladder (`brandVars`, `maxChromaSrgb`, `seedToHex`, `hexToOklch`, `isBrightHue`) and `brandCss({ hue, vivid })`.
- `@abbasalsbihawi/config`
  - `/eslint`: `nextAppConfig({ rootDir, … })` — template-admin's rules unchanged; project paths are options.
  - `/prettier`, `/commitlint` (`commitlintConfig({ extraScopes })`), `/tsconfig.json`.
  - `check-messages [--root src] [--locales en,ar]`: plural categories now come from `Intl.PluralRules`, so any locale works.

**Projects:** template-admin 2.0.0 is the first consumer.
