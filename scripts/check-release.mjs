// Both packages move in lockstep: one version, one CHANGELOG entry, one tag (vX.Y.Z).
// In the release workflow GITHUB_REF_NAME is the tag being published; it must match too.
import { readFileSync } from 'node:fs';

const version = (pkg) => JSON.parse(readFileSync(`packages/${pkg}/package.json`, 'utf8')).version;
const core = version('core');
const config = version('config');
const newest = /^## (\S+)/m.exec(readFileSync('CHANGELOG.md', 'utf8'))?.[1];
const tag = process.env.GITHUB_REF_TYPE === 'tag' ? process.env.GITHUB_REF_NAME : undefined;

const errors = [];
if (!/^\d+\.\d+\.\d+$/.test(core)) errors.push(`core version "${core}" is not x.y.z`);
if (config !== core) errors.push(`config ${config} ≠ core ${core}`);
if (newest !== core)
  errors.push(`CHANGELOG.md: the newest entry is "${String(newest)}", expected "${core}"`);
if (tag && tag !== `v${core}`) errors.push(`tag ${tag} ≠ v${core}`);

if (errors.length > 0) {
  console.error(`check-release:\n  ${errors.join('\n  ')}`);
  process.exit(1);
}
console.log(`check-release: ${core} ✓${tag ? ` (${tag})` : ''}`);
