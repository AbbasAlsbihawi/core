# core

Code shared by the templates (`template-admin`, `template-public`) and the projects created from them, published as two public packages on npm. One version for both; [CHANGELOG.md](./CHANGELOG.md) lists every release.

| Package                                       | Install as    | What                                                                                                                                                        |
| --------------------------------------------- | ------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------- |
| [`@abbasalsbihawi/core`](./packages/core)     | dependency    | CSP builders, CSP report parser, capped body reader, Origin check, document nonce, NestJS envelope, BFF + session cookies, i18n helpers, OKLCH brand ladder |
| [`@abbasalsbihawi/config`](./packages/config) | devDependency | ESLint preset, Prettier, commitlint, tsconfig, `check-messages`                                                                                             |

## What belongs here

Only what both kinds of app need and what has been used twice — the decisions scoped **common** in template-admin's DECISIONS.md, proven by the storefront spike. Not here: anything with a feature (`features/*`), UI components (copy them with shadcn), the API contract (each app generates it from NestJS's OpenAPI), and code only one template uses so far. The ISR cache handler follows once template-public runs it in production.

The rules: pure functions with their inputs as parameters (no `process.env`, no app routing, no `@/` imports), no `server-only` (a cache handler or a script runs outside Next), compiled ESM + types, tests next to the code.

## Using it in a project

```sh
pnpm add @abbasalsbihawi/core
pnpm add -D @abbasalsbihawi/config
```

- Public on npm: a plain `pnpm install` / `npm install` / `yarn` fetches them, locally and in CI — no `.npmrc` scope line, no token.
- `pnpm-workspace.yaml`: add `'@abbasalsbihawi/*'` to `minimumReleaseAgeExclude`, or a release waits a day.

## Releasing

1. Change the code, with tests. `pnpm check` runs format, lint, typecheck, tests, build and the version check.
2. Bump `version` in both `packages/*/package.json`, add the CHANGELOG entry (with its **Projects** line).
3. Merge to `main`, then `git tag -a vX.Y.Z -m "core X.Y.Z" && git push origin vX.Y.Z`: `release.yml` publishes both packages to npm through trusted publishing (OIDC, no token: on npmjs.com each package's **Settings → Trusted publisher** names GitHub Actions, `AbbasAlsbihawi/core`, `release.yml`).

Requirements: Node 24 (`nvm use`), pnpm 12.9.1.
