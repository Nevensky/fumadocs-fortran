#!/usr/bin/env node
// The M0 parser gate (PLAN.md §14). It runs the parser on public code and checks it against oracles that share no code
// with it:
//   1. modern_ford.F90: all 41 dummy arguments carry the right type, kind, intent, optional, value, dimensions and
//      codimensions (a golden file checked by hand);
//   2. Reference-LAPACK: at least 99% of the routines whose doc header gives their signature are found with the
//      same argument names;
//   3. json-fortran, Quantum ESPRESSO PW/src, stdlib, Wannier90, ScaLAPACK and LAPACK lose no program unit, both
//      with cpp evaluated (checked against gcc's cpp) and with every branch kept;
//   4. a private project (--private DIR) parses completely; only aggregate figures are printed;
//   5. the parser runs at 200,000 lines per second or faster.
//
//   scripts/fetch-corpus.sh && scripts/dev.sh node scripts/gate.mjs [--private /private] [--json out.json]

import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { performance } from 'node:perf_hooks';
import { fileURLToPath } from 'node:url';
import { extractFiles, discover, readText, resolveForm } from '../src/index.js';
import { census, irUnits, missing } from './oracle/census.mjs';
import { documentedSignature } from './oracle/lapack.mjs';
import { formatArg } from './oracle/format.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const argv = process.argv.slice(2);
const opt = (name) => {
  const i = argv.indexOf(name);
  return i >= 0 ? argv[i + 1] : undefined;
};
const CORPUS = path.resolve(opt('--corpus') ?? path.join(ROOT, '.corpus'));
const PRIVATE = opt('--private');
const JSON_OUT = opt('--json');

const results = [];
const report = {};
function check(name, pass, detail = '') {
  results.push({ name, pass, detail });
  console.log(`${pass === null ? 'SKIP' : pass ? 'PASS' : 'FAIL'}  ${name}${detail ? `: ${detail}` : ''}`);
}
const pct = (a, b) => (b ? ((100 * a) / b).toFixed(2) : '0.00');
const fmt = (n) => n.toLocaleString('en-GB');

// ---------------------------------------------------------------- 1. modern_ford

{
  const file = path.join(ROOT, 'test/fixtures/modern/modern_ford.F90');
  const want = JSON.parse(fs.readFileSync(path.join(ROOT, 'test/fixtures/modern/modern_ford.args.json'), 'utf8'));
  const ir = extractFiles([file], { root: ROOT, cpp: { macros: { USE_MPI: 1, _OPENMP: 1 } } });
  let total = 0, ok = 0;
  const bad = [];
  for (const [id, lines] of Object.entries(want)) {
    const have = (ir.entities[id]?.args ?? []).map(formatArg);
    lines.forEach((l, i) => {
      total++;
      if (have[i] === l) ok++;
      else bad.push(`${id}: want "${l}", got "${have[i]}"`);
    });
  }
  const parsed = Object.values(ir.entities).reduce((n, e) => n + (e.args?.length ?? 0), 0);
  check('modern_ford.F90: argument attributes', ok === 41 && total === 41 && parsed === 41, `${ok}/${total} (${parsed} arguments parsed)`);
  for (const b of bad.slice(0, 10)) console.log(`      ${b}`);
}

// ---------------------------------------------------------------- shared

const hasCorpus = (name) => fs.existsSync(path.join(CORPUS, name, '.fetched'));
const cppOK = spawnSync('cpp', ['--version'], { encoding: 'utf8' }).status === 0;
const HAS_CPP = /^[ \t]*#[ \t]*(if|ifdef|ifndef|elif|else|endif|define|undef|include)/m;

function loadCorpus(dirs, root) {
  const files = discover(dirs, { root });
  const texts = new Map(files.map((f) => [f, readText(f)]));
  return { files, texts, lines: [...texts.values()].reduce((n, t) => n + t.split('\n').length - (t.endsWith('\n') ? 1 : 0), 0) };
}

function preprocessed(file, text, includeDirs) {
  if (!HAS_CPP.test(text)) return text;
  const r = spawnSync('cpp', ['-traditional-cpp', '-P', '-undef', '-nostdinc', '-w', ...includeDirs.flatMap((d) => ['-I', d]), file], { encoding: 'latin1', maxBuffer: 1 << 28 });
  return r.status === 0 ? r.stdout : null;
}

/** Checks that no unit in the census is missing from the IR, with cpp evaluated and with every branch kept. */
function unitChecks(label, c, includeDirs, root, { quiet = false } = {}) {
  const read = (f) => c.texts.get(f) ?? readText(f);
  const opts = { root, cpp: { includeDirs } };
  const ir = extractFiles(c.files, opts, read);
  const irAll = extractFiles(c.files, { ...opts, cpp: { includeDirs, keepAllBranches: true } }, read);
  const raw = [], evaluated = [];
  let cppFailed = 0;
  for (const f of c.files) {
    const text = c.texts.get(f);
    const form = resolveForm(f, text);
    if (/^[ \t]*#:|\$\{[^}\n]*\}\$/m.test(text)) continue; // fypp sources are skipped by design
    raw.push(...census(text, form));
    if (cppOK) {
      const pre = preprocessed(f, text, includeDirs);
      if (pre === null) cppFailed++;
      else evaluated.push(...census(pre, form));
    }
  }
  const lostAll = missing(raw, irUnits(irAll));
  const name = (x) => (quiet ? '' : `: ${x.slice(0, 8).join(', ')}${x.length > 8 ? ', …' : ''}`);
  if (cppOK) {
    const lost = missing(evaluated, irUnits(ir));
    check(`${label}: no program unit lost, cpp evaluated`, lost.length === 0, `${fmt(evaluated.length)} units in gcc's cpp output, ${fmt(irUnits(ir).length)} parsed, ${lost.length} lost${lost.length ? name(lost) : ''}${cppFailed ? `, cpp failed on ${cppFailed} files` : ''}`);
  } else check(`${label}: no program unit lost, cpp evaluated`, null, 'cpp is not installed here (use scripts/dev.sh)');
  check(`${label}: no program unit lost, every branch kept`, lostAll.length === 0, `${fmt(raw.length)} units in the raw text, ${fmt(irUnits(irAll).length)} parsed, ${lostAll.length} lost${lostAll.length ? name(lostAll) : ''}`);
  return { ir, irAll };
}

// ---------------------------------------------------------------- 2. LAPACK signatures

const speed = [];
if (hasCorpus('lapack')) {
  const root = path.join(CORPUS, 'lapack');
  const c = loadCorpus(['SRC', 'BLAS/SRC', 'INSTALL'], root);
  speed.push({ name: 'lapack', c, root, includeDirs: [] });
  const ir = extractFiles(c.files, { root }, (f) => c.texts.get(f));
  const byFile = new Map();
  for (const e of Object.values(ir.entities)) {
    if (e.kind !== 'procedure' || e.parent) continue;
    const list = byFile.get(e.file) ?? [];
    list.push(e);
    byFile.set(e.file, list);
  }
  let total = 0, ok = 0, params = 0, paramsOK = 0;
  const bad = [];
  for (const f of c.files) {
    const sig = documentedSignature(c.texts.get(f));
    if (!sig) continue;
    total++;
    const rel = path.relative(root, f).split(path.sep).join('/');
    const proc = (byFile.get(rel) ?? []).find((e) => e.name.toLowerCase() === sig.name);
    const have = (proc?.args ?? []).map((a) => a.name.toLowerCase());
    if (proc && have.join(',') === sig.args.join(',')) ok++;
    else bad.push(`${rel}: ${sig.name}(${sig.args.join(',')}) → ${proc ? `(${have.join(',')})` : 'not found'}`);
    if (sig.params.length) {
      params++;
      if (proc && have.join(',') === sig.params.join(',')) paramsOK++;
    }
  }
  report.lapack = { routines: total, matching: ok, files: c.files.length, lines: c.lines };
  check('Reference-LAPACK 3.12.1: routines with matching argument names', ok / total >= 0.99, `${fmt(ok)}/${fmt(total)} (${pct(ok, total)}%) against the documented signatures; ${fmt(paramsOK)}/${fmt(params)} against the \\param lists`);
  for (const b of bad.slice(0, 12)) console.log(`      ${b}`);
  unitChecks('Reference-LAPACK 3.12.1', c, [], root);
} else check('Reference-LAPACK: routines with matching argument names', null, 'not fetched (scripts/fetch-corpus.sh)');

// ---------------------------------------------------------------- 3. program units

const CORPORA = [
  { name: 'json-fortran', label: 'json-fortran 9.3.1, with its include files', dirs: ['src'], include: [] },
  { name: 'qe', label: 'Quantum ESPRESSO 7.6 PW/src', dirs: ['PW/src'], include: ['include'] },
  { name: 'stdlib', label: 'stdlib (stdlib-fpm)', dirs: ['src'], include: ['src', 'include'] },
  { name: 'wannier90', label: 'Wannier90 4.0.3', dirs: ['src'], include: ['src'] },
  { name: 'scalapack', label: 'ScaLAPACK 2.2.3', dirs: ['SRC', 'PBLAS/SRC', 'TOOLS'], include: [] },
  { name: 'miniweather', label: 'miniWeather (Fortran: MPI, OpenMP, OpenACC)', dirs: ['fortran'], include: [] },
];
for (const k of CORPORA) {
  if (!hasCorpus(k.name)) {
    check(`${k.label}: no program unit lost`, null, 'not fetched (scripts/fetch-corpus.sh)');
    continue;
  }
  const root = path.join(CORPUS, k.name);
  const c = loadCorpus(k.dirs, root);
  const includeDirs = k.include.map((d) => path.join(root, d)).filter((d) => fs.existsSync(d));
  speed.push({ name: k.name, c, root, includeDirs });
  const { ir } = unitChecks(k.label, c, includeDirs, root);
  report[k.name] = { files: c.files.length, lines: c.lines, entities: Object.keys(ir.entities).length, diagnostics: ir.diagnostics.length };
}

// ---------------------------------------------------------------- 4. a private project, aggregates only

if (PRIVATE) {
  const root = path.resolve(PRIVATE);
  const c = loadCorpus(['.'], root);
  const { ir } = unitChecks('private project', c, [root], root, { quiet: true });
  const files = new Set(Object.values(ir.entities).map((e) => e.file));
  const empty = ir.files.filter((f) => !f.skipped && !files.has(f.path)).length;
  const procs = Object.values(ir.entities).filter((e) => e.kind === 'procedure');
  const args = procs.reduce((n, e) => n + (e.args?.length ?? 0), 0);
  const typed = procs.reduce((n, e) => n + (e.args?.filter((a) => a.type).length ?? 0), 0);
  const codes = {};
  for (const d of ir.diagnostics) codes[d.code] = (codes[d.code] ?? 0) + 1;
  check('private project: every file parses', empty === 0 && !ir.files.some((f) => f.skipped), `${c.files.length} files, ${fmt(c.lines)} lines; ${procs.length} procedures, ${typed}/${args} arguments typed; diagnostics ${JSON.stringify(codes)}`);
  speed.push({ name: 'private', c, root, includeDirs: [root] });
}

// ---------------------------------------------------------------- 5. speed

if (speed.length) {
  let lines = 0, ms = 0;
  const rows = [];
  for (const s of speed) {
    let best = Infinity;
    for (let r = 0; r < 3; r++) {
      const t0 = performance.now();
      extractFiles(s.c.files, { root: s.root, cpp: { includeDirs: s.includeDirs } }, (f) => s.c.texts.get(f) ?? readText(f));
      best = Math.min(best, performance.now() - t0);
    }
    lines += s.c.lines;
    ms += best;
    rows.push(`${s.name} ${fmt(Math.round(s.c.lines / best * 1000))}/s`);
  }
  const rate = Math.round((lines / ms) * 1000);
  report.speed = { lines, ms: Math.round(ms), linesPerSecond: rate };
  check('speed', rate >= 200000, `${fmt(rate)} lines/s over ${fmt(lines)} lines (best of 3, sources in memory; ${rows.join(', ')})`);
}

const failed = results.filter((r) => r.pass === false).length;
const skipped = results.filter((r) => r.pass === null).length;
console.log(`\n${results.length - failed - skipped} passed, ${failed} failed, ${skipped} skipped`);
if (JSON_OUT) fs.writeFileSync(JSON_OUT, JSON.stringify({ results, report }, null, 2) + '\n');
process.exitCode = failed ? 1 : 0;
