// @abbasalsbihawi/config/eslint — the flat config of the templates (template-admin, template-public).
// eslint 10, typescript-eslint 8.71.1, TypeScript 6. No eslint-config-next: it pulls
// eslint-plugin-react 7.37.5, which crashes on ESLint 10.
//
//   // eslint.config.mjs
//   import { nextAppConfig } from '@abbasalsbihawi/config/eslint';
//   export default nextAppConfig({ rootDir: import.meta.dirname });
//
// The rules encode the architecture both templates share (ARCHITECTURE.md): src/app → features →
// shared, server-only data/ and actions, kebab-case, no barrels, logical Tailwind classes, no
// hard-coded copy. Options cover what differs per project; append your own config objects after it.
import js from '@eslint/js';
import eslintReact from '@eslint-react/eslint-plugin';
import nextPlugin from '@next/eslint-plugin-next';
import pluginQuery from '@tanstack/eslint-plugin-query';
import { defineConfig, globalIgnores } from 'eslint/config';
import prettier from 'eslint-config-prettier/flat';
import { createTypeScriptImportResolver } from 'eslint-import-resolver-typescript';
import betterTailwind from 'eslint-plugin-better-tailwindcss';
import boundaries from 'eslint-plugin-boundaries';
import checkFile from 'eslint-plugin-check-file';
import i18next from 'eslint-plugin-i18next';
import { importX } from 'eslint-plugin-import-x';
import jsxA11y from 'eslint-plugin-jsx-a11y-x';
import noBarrelFiles from 'eslint-plugin-no-barrel-files';
import reactHooks from 'eslint-plugin-react-hooks';
import globals from 'globals';
import tseslint from 'typescript-eslint';

// eslint-plugin-react-hooks 7 (React Compiler backed) owns these; ESLint React re-implements them.
const HOOKS_OWNED = [
  'rules-of-hooks',
  'exhaustive-deps',
  'error-boundaries',
  'purity',
  'set-state-in-effect',
  'set-state-in-render',
  'static-components',
  'unsupported-syntax',
  'use-memo',
  'immutability',
  'refs',
];

const DEEP_RELATIVE = {
  group: ['../../*'],
  message: 'Use the @/ alias instead of deep relative paths.',
};
const NO_AXIOS = {
  name: 'axios',
  message: 'Use shared/api/http.server (nestFetch) or http.client (bffHttp).',
};
// Links and redirects without the locale prefix: use the next-intl wrappers instead.
// notFound, useSearchParams, useParams … from next/navigation stay allowed.
const NO_UNLOCALISED_NAVIGATION = [
  {
    name: 'next/link',
    message: 'Use Link from @/shared/i18n/navigation (adds the locale prefix).',
  },
  {
    name: 'next/navigation',
    importNames: ['redirect', 'permanentRedirect', 'useRouter', 'usePathname'],
    message: 'Use the locale-aware version from @/shared/i18n/navigation.',
  },
];
// Files that may read request cookies/headers (next/headers).
const BASE_SERVER_FILES = [
  'src/app/**',
  'src/i18n/**',
  'src/proxy.ts',
  'src/features/*/data/**',
  'src/features/*/actions.ts',
  'src/**/*.server.ts',
  'src/shared/auth/logout.action.ts',
];
// The only files allowed to `export default` (Next.js / next-intl / tool conventions).
const BASE_DEFAULT_EXPORT_FILES = [
  'src/app/**/{page,layout,template,loading,error,global-error,not-found,global-not-found,default,forbidden,unauthorized}.tsx',
  'src/app/**/{sitemap,robots,manifest,icon,apple-icon,opengraph-image,twitter-image}.{ts,tsx}',
  'src/i18n/request.ts',
  '*.config.{js,mjs,ts,mts}',
];
// Files that may read process.env: runtime vars injected by Next/PM2 (NEXT_RUNTIME,
// NODE_APP_INSTANCE, NEXT_DEPLOYMENT_ID), config files, and the e2e workers.
const BASE_ENV_FILES = [
  'src/shared/config/env.ts',
  'src/instrumentation.ts',
  'src/shared/logging/logger.ts',
  '*.config.{ts,mts}',
  'e2e/fixtures.ts',
];
// Translators take typed message keys, not copy: t('key'), tActions('key'), t.rich('key', …), and
// formatters take format names: format.dateTime(date, 'long'). With type information the rule
// already skips those strings (their contextual type is a union of literals); the fast pre-commit
// run has none, so the callees are named here: `t` or `t` + a capitalised suffix, and `format`.
// `callees` replaces the plugin's defaults (lib/options/defaults.js) instead of merging with them,
// so the remaining defaults are repeated.
const I18N_IGNORED_CALLEES = [
  't(?:[A-Z]\\w*)?(?:\\.(?:rich|markup|raw|has))?',
  'format\\.(?:dateTime|dateTimeRange|number|relativeTime|list)',
  'i18n(ext)?',
  'require',
  'addEventListener',
  'removeEventListener',
  'postMessage',
  'getElementById',
  'dispatch',
  'commit',
  'includes',
  'indexOf',
  'endsWith',
  'startsWith',
];

/**
 * @param {object} options
 * @param {string} options.rootDir the project root for typed linting: `import.meta.dirname`
 * @param {boolean} [options.fast] drop type-aware rules and import cycles (pre-commit); default ESLINT_FAST=1
 * @param {string[]} [options.ignores] more global ignores
 * @param {string[]} [options.defaultExportFiles] more files allowed to `export default` (React.lazy targets)
 * @param {string[]} [options.serverFiles] more files allowed to import next/headers
 * @param {string[]} [options.envFiles] more files allowed to read process.env
 * @param {string[]} [options.barrelFiles] files allowed to re-export (default: shadcn's lib/utils)
 * @param {string} [options.tailwindEntry] the Tailwind v4 stylesheet
 */
export function nextAppConfig({
  rootDir,
  fast = process.env.ESLINT_FAST === '1',
  ignores = [],
  defaultExportFiles = [],
  serverFiles = [],
  envFiles = [],
  barrelFiles = ['src/shared/lib/utils.ts'],
  tailwindEntry = 'src/shared/styles/globals.css',
}) {
  if (!rootDir) throw new Error('nextAppConfig: pass { rootDir: import.meta.dirname }');
  const SERVER_FILES = [...BASE_SERVER_FILES, ...serverFiles];
  const DEFAULT_EXPORT_FILES = [...BASE_DEFAULT_EXPORT_FILES, ...defaultExportFiles];
  const ENV_FILES = [...BASE_ENV_FILES, ...envFiles];
  return defineConfig([
    globalIgnores([
      '.next/**',
      'out/**',
      'build/**',
      'coverage/**',
      'next-env.d.ts',
      '**/*.d.json.ts',
      'src/shared/components/ui/**', // shadcn output: regenerated by `shadcn add`
      'playwright-report/**',
      'test-results/**',
      ...ignores,
    ]),

    // ---------- Plain JS (config files, scripts): no type information ----------
    {
      files: ['**/*.{js,mjs,cjs}'],
      extends: [js.configs.recommended],
      languageOptions: { globals: globals.node },
    },

    // ---------- TypeScript (type-aware) ----------
    {
      files: ['**/*.{ts,tsx,mts}'],
      extends: [
        js.configs.recommended,
        tseslint.configs.strictTypeChecked,
        tseslint.configs.stylisticTypeChecked,
      ],
      languageOptions: {
        parserOptions: { projectService: true, tsconfigRootDir: rootDir },
        globals: { ...globals.browser, ...globals.node },
      },
      linterOptions: { reportUnusedDisableDirectives: 'error' },
      rules: {
        '@typescript-eslint/consistent-type-imports': [
          'error',
          { prefer: 'type-imports', fixStyle: 'separate-type-imports' },
        ],
        // under verbatimModuleSyntax `import { type A } from './x.data'` keeps a side-effect import
        // that drags a server-only module into the browser graph
        '@typescript-eslint/no-import-type-side-effects': 'error',
        '@typescript-eslint/consistent-type-definitions': ['error', 'interface'],
        '@typescript-eslint/no-unused-vars': [
          'error',
          { argsIgnorePattern: '^_', varsIgnorePattern: '^_', caughtErrorsIgnorePattern: '^_' },
        ],
        '@typescript-eslint/switch-exhaustiveness-check': [
          'error',
          { considerDefaultExhaustiveForUnions: false },
        ],
        '@typescript-eslint/no-misused-promises': [
          'error',
          { checksVoidReturn: { attributes: false } },
        ],
        'no-restricted-syntax': [
          'error',
          {
            selector: 'TSEnumDeclaration',
            message: 'Use an `as const` object or z.enum() (erasableSyntaxOnly).',
          },
          {
            selector:
              "MemberExpression[object.object.name='process'][object.property.name='env'][property.name!='NODE_ENV']",
            message: 'Read env through @/shared/config/env (process.env.NODE_ENV is allowed).',
          },
        ],
        'no-console': ['warn', { allow: ['warn', 'error'] }],
      },
    },

    // ---------- React, hooks/compiler, a11y, TanStack Query, Next ----------
    {
      files: ['**/*.{ts,tsx}'],
      extends: [
        eslintReact.configs['recommended-type-checked'],
        reactHooks.configs.flat.recommended, // v7: includes the React Compiler rules
        jsxA11y.configs.strict,
        pluginQuery.configs['flat/recommended'],
        nextPlugin.configs['core-web-vitals'],
      ],
      rules: {
        ...Object.fromEntries(HOOKS_OWNED.map((rule) => [`@eslint-react/${rule}`, 'off'])),
        '@next/next/no-img-element': 'error',
      },
    },

    // ---------- Imports ----------
    {
      files: ['**/*.{js,mjs,ts,tsx,mts}'],
      extends: [importX.flatConfigs.recommended, importX.flatConfigs.typescript],
      settings: {
        'import-x/resolver-next': [createTypeScriptImportResolver({ alwaysTryTypes: true })],
        'import/resolver': { typescript: { alwaysTryTypes: true } }, // read by eslint-plugin-boundaries
      },
      rules: {
        'import-x/no-default-export': 'error',
        'import-x/no-named-as-default-member': 'off', // TS already checks this
        'import-x/no-cycle': fast ? 'off' : ['error', { maxDepth: 6, ignoreExternal: true }],
        'import-x/order': [
          'error',
          {
            groups: ['builtin', 'external', 'internal', ['parent', 'sibling', 'index']],
            pathGroups: [{ pattern: '@/**', group: 'internal' }],
            'newlines-between': 'always',
            alphabetize: { order: 'asc', caseInsensitive: true },
          },
        ],
        'no-restricted-imports': [
          'error',
          {
            paths: [
              {
                name: 'next/headers',
                message: 'Server-only: app/**, data/**, actions.ts or *.server.ts.',
              },
              NO_AXIOS,
              ...NO_UNLOCALISED_NAVIGATION,
            ],
            patterns: [DEEP_RELATIVE],
          },
        ],
      },
    },

    // ---------- Architecture: app -> features -> shared ----------
    {
      files: ['src/**/*.{ts,tsx}'],
      plugins: { boundaries },
      settings: {
        'boundaries/elements': [
          { type: 'app', pattern: 'src/app' },
          { type: 'i18n', pattern: 'src/i18n' },
          { type: 'feature-data', pattern: 'src/features/*/data', capture: ['feature'] },
          { type: 'feature-views', pattern: 'src/features/*/views', capture: ['feature'] },
          { type: 'feature-i18n', pattern: 'src/features/*/i18n', capture: ['feature'] },
          { type: 'feature', pattern: 'src/features/*', capture: ['feature'] },
          { type: 'shared', pattern: 'src/shared' },
        ],
        'boundaries/files': [
          { category: 'test', pattern: '**/*.{test,spec}.{ts,tsx}' },
          { category: 'server-action', pattern: '**/features/*/actions.ts' },
          // root files Next loads by convention (proxy.ts, instrumentation*.ts): never imported
          { category: 'entry', pattern: 'src/*.{ts,tsx}' },
        ],
      },
      rules: {
        'boundaries/dependencies': [
          'error',
          {
            default: 'disallow',
            message:
              '{{ from.element.type }} must not import {{ to.element.type }} (ARCHITECTURE.md)',
            policies: [
              // app/ is routing only: a feature's public surface (views, data), shared, i18n
              {
                from: { element: { type: 'app' } },
                allow: {
                  to: {
                    element: { types: ['app', 'feature-views', 'feature-data', 'shared', 'i18n'] },
                  },
                },
              },
              // i18n composes every feature's message files
              {
                from: { element: { type: 'i18n' } },
                allow: { to: { element: { types: ['i18n', 'feature-i18n', 'shared'] } } },
              },
              // inside a feature: same feature only (captured name must match) + shared
              {
                from: { element: { types: ['feature', 'feature-views', 'feature-data'] } },
                allow: {
                  to: [
                    {
                      element: {
                        types: ['feature', 'feature-views', 'feature-i18n'],
                        captured: { feature: '{{ from.element.captured.feature }}' },
                      },
                    },
                    { element: { type: 'shared' } },
                  ],
                },
              },
              // only views, data, actions.ts and tests may touch the server-only DAL (data/)
              {
                from: { element: { types: ['feature-views', 'feature-data'] } },
                allow: {
                  to: {
                    element: {
                      type: 'feature-data',
                      captured: { feature: '{{ from.element.captured.feature }}' },
                    },
                  },
                },
              },
              {
                from: { element: { type: 'feature' }, file: { categories: 'server-action' } },
                allow: {
                  to: {
                    element: {
                      type: 'feature-data',
                      captured: { feature: '{{ from.element.captured.feature }}' },
                    },
                  },
                },
              },
              {
                from: { file: { categories: 'test' } },
                allow: {
                  to: {
                    element: {
                      type: 'feature-data',
                      captured: { feature: '{{ from.element.captured.feature }}' },
                    },
                  },
                },
              },
              // shared never imports features or app
              {
                from: { element: { type: 'shared' } },
                allow: { to: { element: { type: 'shared' } } },
              },

              // root entry files compose shared and the i18n layer
              {
                from: { file: { categories: 'entry' } },
                allow: { to: { element: { types: ['shared', 'i18n'] } } },
              },
              // production code never imports tests (the last matching policy wins)
              {
                disallow: { to: { file: { categories: 'test' } } },
                message: 'Do not import test files.',
              },
              // nor the root entry files; only their own tests may
              {
                disallow: { to: { file: { categories: 'entry' } } },
                message: 'Do not import {{ to.file.path }}: Next loads it by convention.',
              },
              {
                from: { file: { categories: 'test' } },
                allow: { to: { file: { categories: 'entry' } } },
              },
            ],
          },
        ],
      },
    },

    // ---------- File and folder naming ----------
    {
      files: ['src/**/*.{ts,tsx}'],
      plugins: { 'check-file': checkFile },
      rules: {
        'check-file/filename-naming-convention': [
          'error',
          { 'src/**/*.{ts,tsx}': 'KEBAB_CASE' },
          { ignoreMiddleExtensions: true },
        ],
        'check-file/folder-naming-convention': [
          'error',
          {
            'src/app/**/': 'NEXT_JS_APP_ROUTER_CASE', // [locale] (dashboard) [...rest]
            'src/!(app)/**/': 'KEBAB_CASE',
          },
        ],
      },
    },

    // ---------- No barrel files ----------
    {
      files: ['src/**/*.{ts,tsx}'],
      plugins: { 'no-barrel-files': noBarrelFiles },
      // the only exception: shadcn's `utils` alias (export { cn } from 'cn')
      rules: { 'no-barrel-files/no-barrel-files': ['error', { allow: barrelFiles }] },
    },

    // ---------- Tailwind v4: unknown/conflicting classes + RTL logical properties ----------
    {
      files: ['src/**/*.tsx'],
      extends: [betterTailwind.configs.correctness], // ordering is Prettier's job
      settings: { 'better-tailwindcss': { entryPoint: tailwindEntry } },
      rules: {
        // inline axis only (ml- → ms-, left- → inset-s-, text-left → text-start), autofixable.
        // The block axis (top/bottom/h/w/mt/pb) does not flip between ar and en.
        'better-tailwindcss/enforce-logical-properties': [
          'error',
          {
            ignore: [
              '^(.*:)?-?(m|p|scroll-m|scroll-p)(t|b|y)-',
              '^(.*:)?-?(top|bottom)-',
              '^(.*:)?(min-|max-)?(h|w)-',
              '^(.*:)?size-',
              '^(.*:)?border-(t|b)(-|$)',
              '^(.*:)?rounded-(t|b)(-|$)',
            ],
          },
        ],
      },
    },

    // ---------- i18n: no hard-coded UI copy ----------
    {
      files: ['src/{app,features,shared}/**/*.tsx'],
      plugins: { i18next },
      rules: {
        'i18next/no-literal-string': [
          'error',
          {
            mode: 'jsx-only',
            'jsx-attributes': {
              include: ['alt', 'title', 'placeholder', 'aria-label', 'aria-description', 'label'],
            },
            callees: { exclude: I18N_IGNORED_CALLEES },
          },
        ],
      },
    },

    // ---------- Exceptions ----------
    { files: DEFAULT_EXPORT_FILES, rules: { 'import-x/no-default-export': 'off' } },
    {
      files: SERVER_FILES,
      // replaces the paths list above, so the navigation entries are repeated
      rules: {
        'no-restricted-imports': [
          'error',
          { paths: [NO_AXIOS, ...NO_UNLOCALISED_NAVIGATION], patterns: [DEEP_RELATIVE] },
        ],
      },
    },
    { files: ENV_FILES, rules: { 'no-restricted-syntax': 'off' } },
    // tests assert on copy; global-error.tsx has no i18n provider and ships static bilingual text
    {
      files: ['**/*.{test,spec}.{ts,tsx}', 'src/app/global-error.tsx'],
      rules: { 'i18next/no-literal-string': 'off' },
    },

    // ---------- Fast mode (pre-commit) ----------
    ...(fast
      ? [tseslint.configs.disableTypeChecked, eslintReact.configs['disable-type-checked']]
      : []),

    prettier, // eslint-config-prettier/flat — always last
  ]);
}
