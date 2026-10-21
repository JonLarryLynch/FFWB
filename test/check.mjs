// Everything that must pass before a release goes live: every test file, then the browser check.
// Netlify runs this as the build command; if anything fails, the build fails and the live site is unchanged.
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const files = fs.readdirSync(here).filter((f) => f.endsWith('.test.mjs')).sort();
const failed = [];
for (const f of [...files, 'smoke.mjs']) {
  console.log('\n== ' + f);
  const r = spawnSync(process.execPath, [path.join(here, f)], { stdio: 'inherit' });
  if (r.status !== 0) failed.push(f);
}
if (failed.length) { console.error('\nNot releasing. Failed: ' + failed.join(', ')); process.exit(1); }
console.log('\nAll checks passed. Releasing.');
