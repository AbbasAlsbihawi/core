# Changelog

Changes to `@abbasalsbihawi/core` and `@abbasalsbihawi/config`, newest first. Both packages share one version; every merge to `main` that changes them is a release (a `## <version> — <date>` entry here, both `package.json` versions, then the tag `v<version>`).

**Projects** says what a project does to take the release in. **Major**: a project must change its own code. **Minor**: something new it may use. **Patch**: a fix it should take.

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
