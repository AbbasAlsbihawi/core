#!/usr/bin/env node
// check-messages [--root src] [--locales en,ar] — fails when the message files of a project drift.
// For every <root>/**/i18n/[<prefix>.]<first locale>.json and its siblings in the other locales:
//   1. the same keys exist in every locale, and no value is empty;
//   2. the same ICU arguments ({name}, {count, plural, …}) are used in every locale;
//   3. every plural has all the CLDR categories of its locale (Intl.PluralRules): ar needs six
//      (zero one two few many other), en needs one + other. `=N` matches never replace a category.
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { parseArgs } from 'node:util';

const { values } = parseArgs({
  options: {
    root: { type: 'string', default: 'src' },
    locales: { type: 'string', default: 'en,ar' },
  },
});
const LOCALES = values.locales
  .split(',')
  .map((l) => l.trim())
  .filter(Boolean);
const PLURAL_CATEGORIES = Object.fromEntries(
  LOCALES.map((l) => [l, new Intl.PluralRules(l).resolvedOptions().pluralCategories]),
);

const walk = (dir) =>
  readdirSync(dir, { withFileTypes: true }).flatMap((e) =>
    e.isDirectory() ? walk(join(dir, e.name)) : [join(dir, e.name)],
  );

const flatten = (obj, prefix = '', out = new Map()) => {
  for (const [k, v] of Object.entries(obj)) {
    if (v !== null && typeof v === 'object') flatten(v, `${prefix}${k}.`, out);
    else out.set(`${prefix}${k}`, v);
  }
  return out;
};

/** Top-level ICU blocks of a message: { arg, type, body } (nested blocks are parsed recursively). */
function icuBlocks(message) {
  const blocks = [];
  let depth = 0;
  let start = -1;
  for (let i = 0; i < message.length; i++) {
    const ch = message[i];
    if (ch === "'" && (message[i + 1] === '{' || message[i + 1] === '}')) {
      i = message.indexOf("'", i + 1); // ICU quoting: '{literal}'
      if (i === -1) break;
      continue;
    }
    if (ch === '{') {
      if (depth === 0) start = i;
      depth++;
    } else if (ch === '}') {
      depth--;
      if (depth === 0 && start !== -1) {
        const inner = message.slice(start + 1, i);
        const [arg = '', type = '', ...rest] = inner.split(',');
        blocks.push({ arg: arg.trim(), type: type.trim(), body: rest.join(',') });
        start = -1;
      }
    }
  }
  return blocks;
}

/** Branch selectors of a plural/select body: "zero {…} one {…} =2 {…}" → ['zero', 'one', '=2']. */
function branches(body) {
  const out = [];
  let depth = 0;
  let token = '';
  for (const ch of body) {
    if (ch === '{') {
      if (depth === 0 && token.trim()) out.push(token.trim().split(/\s+/).pop());
      depth++;
      token = '';
    } else if (ch === '}') {
      depth--;
    } else if (depth === 0) {
      token += ch;
    }
  }
  return out;
}

/** Collect argument names and plural problems for one message (recursing into branches). */
function analyse(message, locale, args = new Set(), problems = []) {
  for (const { arg, type, body } of icuBlocks(message)) {
    args.add(arg);
    if (type === 'plural' || type === 'selectordinal' || type === 'select') {
      const found = branches(body);
      const required = type === 'plural' ? PLURAL_CATEGORIES[locale] : ['other'];
      for (const category of required ?? []) {
        if (!found.includes(category)) problems.push(`"${arg}" ${type} lacks "${category}"`);
      }
      // recurse into branch bodies for nested arguments
      for (const nested of body.match(/\{[^{}]*(\{[^{}]*\}[^{}]*)*\}/g) ?? []) {
        analyse(nested.slice(1, -1), locale, args, problems);
      }
    }
  }
  return { args, problems };
}

const [FIRST = 'en'] = LOCALES;
const FIRST_FILE = new RegExp(`[/\\\\]i18n[/\\\\](.+\\.)?${FIRST.replace(/[^\w-]/g, '')}\\.json$`);
const bases = walk(values.root)
  .filter((f) => FIRST_FILE.test(f))
  .map((f) => f.slice(0, -`${FIRST}.json`.length));

let failed = false;
const fail = (msg) => {
  console.error(msg);
  failed = true;
};

for (const base of bases) {
  const maps = Object.fromEntries(
    LOCALES.map((l) => [l, flatten(JSON.parse(readFileSync(`${base}${l}.json`, 'utf8')))]),
  );
  for (const a of LOCALES) {
    for (const b of LOCALES.filter((x) => x !== a)) {
      for (const key of maps[a].keys()) {
        if (!maps[b].has(key)) fail(`${base}${b}.json is missing "${key}"`);
      }
    }
    for (const [key, value] of maps[a]) {
      if (value === '') fail(`${base}${a}.json has an empty value for "${key}"`);
      if (typeof value !== 'string') continue;
      for (const p of analyse(value, a).problems) fail(`${base}${a}.json "${key}": ${p}`);
    }
  }
  const [first, ...others] = LOCALES;
  for (const [key, value] of maps[first]) {
    if (typeof value !== 'string') continue;
    const expected = [...analyse(value, first).args].sort().join(',');
    for (const l of others) {
      const other = maps[l].get(key);
      if (typeof other !== 'string') continue;
      const actual = [...analyse(other, l).args].sort().join(',');
      if (actual !== expected) {
        fail(`${base}${l}.json "${key}" uses {${actual}} but ${first} uses {${expected}}`);
      }
    }
  }
}

if (failed) process.exit(1);
console.log(`i18n parity OK (${String(bases.length)} namespaces)`);
