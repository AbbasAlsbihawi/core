# core

Code shared by the templates (`template-admin`, `template-public`) and the projects created from them, published as two private packages on GitHub Packages. One version for both; [CHANGELOG.md](./CHANGELOG.md) lists every release.

| Package                                       | Install as    | What                                                                                                                                                        |
| --------------------------------------------- | ------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------- |
| [`@abbasalsbihawi/core`](./packages/core)     | dependency    | CSP builders, CSP report parser, capped body reader, Origin check, document nonce, NestJS envelope, BFF + session cookies, i18n helpers, OKLCH brand ladder |
| [`@abbasalsbihawi/config`](./packages/config) | devDependency | ESLint preset, Prettier, commitlint, tsconfig, `check-messages`                                                                                             |

## What belongs here

Only what both kinds of app need and what has been used twice — the decisions scoped **common** in template-admin's DECISIONS.md, proven by the storefront spike. Not here: anything with a feature (`features/*`), UI components (copy them with shadcn), the API contract (each app generates it from NestJS's OpenAPI), and code only one template uses so far. The ISR cache handler follows once template-public runs it in production.

The rules: pure functions with their inputs as parameters (no `process.env`, no app routing, no `@/` imports), no `server-only` (a cache handler or a script runs outside Next), compiled ESM + types, tests next to the code.

## Using it in a project

```ini
# .npmrc (committed): this scope comes from GitHub Packages — and no token: pnpm 12 ignores auth here
@abbasalsbihawi:registry=https://npm.pkg.github.com
```

- Locally, once per machine: `gh auth refresh -h github.com -s read:packages`, then append `//npm.pkg.github.com/:_authToken=<token>` to `~/.npmrc` (`echo "//npm.pkg.github.com/:_authToken=$(gh auth token)" >> ~/.npmrc`).
- CI: `actions/setup-node` with `registry-url: https://npm.pkg.github.com` and `scope: '@abbasalsbihawi'` (it writes a user-level .npmrc), `permissions: packages: read` and `NODE_AUTH_TOKEN: ${{ secrets.GITHUB_TOKEN }}`. The packages are public, so no repository needs a grant — but GitHub Packages asks for a token even for public packages.
- `pnpm-workspace.yaml`: add `'@abbasalsbihawi/*'` to `minimumReleaseAgeExclude`, or a release waits a day.

## Releasing

1. Change the code, with tests. `pnpm check` runs format, lint, typecheck, tests, build and the version check.
2. Bump `version` in both `packages/*/package.json`, add the CHANGELOG entry (with its **Projects** line).
3. Merge to `main`, then `git tag -a vX.Y.Z -m "core X.Y.Z" && git push origin vX.Y.Z`: `release.yml` publishes both packages.

Requirements: Node 24 (`nvm use`), pnpm 12.9.1.
