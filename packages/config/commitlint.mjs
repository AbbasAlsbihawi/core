// @abbasalsbihawi/config/commitlint — Conventional Commits, 72-character headers, and scopes = the
// folders of src/features plus the cross-cutting ones:
//
//   import { commitlintConfig } from '@abbasalsbihawi/config/commitlint';
//   export default commitlintConfig({ extraScopes: ['template'] });
import { readdirSync } from 'node:fs';
import { createRequire } from 'node:module';

export const BASE_SCOPES = ['app', 'shared', 'i18n', 'theme', 'deps', 'ci', 'tooling', 'release'];

// By absolute path: with pnpm the project cannot resolve this package's own dependencies by name.
const conventional = createRequire(import.meta.url).resolve('@commitlint/config-conventional');

/**
 * @param {object} [options]
 * @param {string} [options.featuresDir] relative to the working directory
 * @param {string[]} [options.extraScopes]
 */
export function commitlintConfig({ featuresDir = 'src/features', extraScopes = [] } = {}) {
  const features = readdirSync(featuresDir, { withFileTypes: true })
    .filter((d) => d.isDirectory())
    .map((d) => d.name);
  return {
    extends: [conventional],
    rules: {
      'header-max-length': [2, 'always', 72],
      'scope-enum': [2, 'always', [...features, ...BASE_SCOPES, ...extraScopes]],
    },
  };
}
