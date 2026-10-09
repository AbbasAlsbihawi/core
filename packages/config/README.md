# @abbasalsbihawi/config

Tooling presets of the templates. Install as a devDependency together with its peers `eslint`, `typescript`, `prettier` and `tailwindcss`; every ESLint plugin comes with it.

```js
// eslint.config.mjs
import { nextAppConfig } from '@abbasalsbihawi/config/eslint';
export default nextAppConfig({ rootDir: import.meta.dirname });

// prettier.config.mjs
import base from '@abbasalsbihawi/config/prettier';
export default { ...base, tailwindStylesheet: './src/shared/styles/globals.css' };

// commitlint.config.mjs
import { commitlintConfig } from '@abbasalsbihawi/config/commitlint';
export default commitlintConfig({ extraScopes: ['template'] });
```

```jsonc
// tsconfig.json — paths, include and tsBuildInfoFile stay in the project
{
  "extends": "@abbasalsbihawi/config/tsconfig.json",
  "compilerOptions": { "paths": { "@/*": ["./src/*"] } },
}
```

`check-messages [--root src] [--locales en,ar]` (a bin): en/ar key parity, ICU argument parity, and every CLDR plural category of each locale.

`nextAppConfig` options: `rootDir` (required), `fast` (default `ESLINT_FAST=1`), `ignores`, `defaultExportFiles`, `serverFiles`, `envFiles`, `barrelFiles`, `tailwindEntry`.
