// @abbasalsbihawi/config/prettier — spread it and point the Tailwind plugin at your stylesheet
// (a path relative to your own config file, which a shared config cannot know):
//
//   import base from '@abbasalsbihawi/config/prettier';
//   export default { ...base, tailwindStylesheet: './src/shared/styles/globals.css' };
//
// The plugin is passed as a module, not a name: the project does not need it installed.
import * as tailwind from 'prettier-plugin-tailwindcss';

/** @type {import('prettier').Config & import('prettier-plugin-tailwindcss').PluginOptions} */
const config = {
  semi: true,
  singleQuote: true,
  trailingComma: 'all',
  printWidth: 100,
  tabWidth: 2,
  arrowParens: 'always',
  endOfLine: 'lf',
  plugins: [tailwind],
  tailwindFunctions: ['cn', 'cva', 'clsx'],
  tailwindAttributes: ['classNames', '/.*ClassName$/'],
};

export default config;
