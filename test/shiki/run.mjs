// node test/shiki/run.mjs [name…] — tests of the Shiki grammar pack (shiki/). No framework: each check counts,
// failures are listed. They need Node 20 or later and the development tools shiki and tm-grammars, which CI installs
// without saving them; the fumadocs checks also need fumadocs-core and are skipped without it. UPDATE_SNAPSHOTS=1
// rewrites the scope snapshots in test/shiki/snapshots. Each test/shiki/*.test.mjs exports a default function that
// receives { ok, eq, here, out }, as in test/run.mjs; names given on the command line select test files.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const OUT = path.join(HERE, '..', 'out', 'shiki');
fs.mkdirSync(OUT, { recursive: true });

try {
  await import('shiki');
} catch {
  // the package saves no development dependencies: CI installs these, at the versions the pack was tested with
  console.error('test/shiki needs Node 20 or later, shiki and tm-grammars (and fumadocs-core, optionally):');
  console.error('install the versions in .github/workflows/ci.yml (job "Shiki grammars") with npm install --no-save');
  process.exit(1);
}

let failures = 0;
let checks = 0;
const ok = (cond, msg) => {
  checks++;
  if (!cond) {
    failures++;
    console.error('FAIL', msg);
  }
};
const eq = (a, b, msg) => ok(JSON.stringify(a) === JSON.stringify(b), `${msg}: expected ${JSON.stringify(b)}, got ${JSON.stringify(a)}`);

const only = process.argv.slice(2);
for (const f of fs.readdirSync(HERE).filter((x) => x.endsWith('.test.mjs')).sort()) {
  if (only.length && !only.some((name) => f.includes(name))) continue;
  const before = checks;
  const t0 = performance.now();
  const mod = await import(new URL(f, import.meta.url));
  await mod.default({ ok, eq, here: HERE, out: OUT });
  console.log(`${f.padEnd(24)} ${String(checks - before).padStart(4)} checks  ${((performance.now() - t0) / 1000).toFixed(1)} s`);
}

console.log(`${checks - failures}/${checks} checks passed`);
if (failures) process.exit(1);
