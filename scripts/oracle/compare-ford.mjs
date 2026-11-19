#!/usr/bin/env node
// Compares the parser with FORD 7.0.13, field by field, on every dummy argument both of them find: type, kind,
// length, intent, optional, value and dimensions. Procedures are matched by file name, procedure name and line.
// Known differences (FORD bugs, or deliberate choices of ours) go in ford-allow.json.
//
//   scripts/oracle/ford.sh DIR…   (writes .cache/ford/dump.json)
//   node scripts/oracle/compare-ford.mjs .cache/ford/dump.json DIR… [-D NAME]… [--differences]
//
// Development only; FORD itself never runs in the package.

import fs from 'node:fs';
import path from 'node:path';
import { extract } from '../../src/index.js';

const argv = process.argv.slice(2);
const dumpFile = argv.shift();
const macros = {};
const dirs = [];
for (let i = 0; i < argv.length; i++) {
  if (argv[i] === '-D') macros[argv[++i]] = 1;
  else if (!argv[i].startsWith('--')) dirs.push(argv[i]);
}
const dump = JSON.parse(fs.readFileSync(dumpFile, 'utf8'));
// ford-allow.json: groups of { reason, ids } for differences checked by hand (FORD's mistakes, or our deliberate choices)
const ALLOW = new URL('./ford-allow.json', import.meta.url);
const allow = new Set(fs.existsSync(ALLOW) ? JSON.parse(fs.readFileSync(ALLOW, 'utf8')).flatMap((g) => g.ids) : []);
const listAll = process.argv.includes('--differences');

// FORD's procedures: every subroutine or function with arguments, anywhere in the dump
const ford = new Map();
const visit = (o, file) => {
  if (Array.isArray(o)) return o.forEach((x) => visit(x, file));
  if (!o || typeof o !== 'object') return;
  if (o.kind === 'sourcefile') file = path.basename(o.path);
  if ((o.kind === 'subroutine' || o.kind === 'function') && Array.isArray(o.args) && o.line) ford.set(`${file}|${o.name.toLowerCase()}|${o.line}`, o);
  for (const v of Object.values(o)) if (v && typeof v === 'object') visit(v, file);
};
visit(dump.files, null);

const ir = await extract({ sources: dirs, cpp: { macros } });
const ours = new Map();
for (const e of Object.values(ir.entities)) if (e.kind === 'procedure' && e.args) ours.set(`${path.basename(e.file)}|${e.name.toLowerCase()}|${e.line}`, e);

const norm = (s) => (s ?? '').toString().toLowerCase().replace(/\s+/g, '');
// FORD keeps a derived type as `proto` ([ref or name, params]) and `dimension(…)` given as an attribute in `attribs`
const protoName = (p) => (Array.isArray(p) ? (typeof p[0] === 'string' ? p[0] : p[0]?.name) : p?.name);
const fordDims = (f) => f.dimension ?? (f.attribs ?? []).map((x) => /^dimension\s*(\(.*\))$/i.exec(x)?.[1]).find(Boolean) ?? '';
const fields = {
  type: (a, f) => [norm(a.type?.base), norm(f.vartype)],
  // deliberate: COMPLEX*16 has kind 8 here (the kind of each part), where FORD keeps 16
  kind: (a, f) => {
    const ours = norm(a.type?.kind);
    const theirs = norm(f.proto ? protoName(f.proto) : f.kind_param);
    const star = a.type?.base === 'complex' && /\*\s*\d+$/.test(a.type.text) && /^\d+$/.test(ours);
    return [star ? String(2 * Number(ours)) : ours, theirs];
  },
  // a character without a length has length 1
  len: (a, f) => [norm(a.type?.len ?? (a.type?.base === 'character' ? '1' : '')), norm(f.strlen)],
  intent: (a, f) => [norm(a.intent), norm(f.intent)],
  optional: (a, f) => [!!a.optional, !!f.optional],
  value: (a, f) => [!!a.value, (f.attribs ?? []).some((x) => norm(x) === 'value')],
  dims: (a, f) => [norm((a.dims ? `(${a.dims.join(',')})` : '') + (a.codims ? `[${a.codims.join(',')}]` : '')), norm(fordDims(f))],
};
const stats = Object.fromEntries(Object.keys(fields).map((k) => [k, { same: 0, differ: 0, examples: [] }]));
let matched = 0, onlyFord = 0, args = 0, nameDiff = 0;
for (const [key, f] of ford) {
  const e = ours.get(key);
  if (!e) { onlyFord++; continue; }
  matched++;
  f.args.forEach((fa, i) => {
    const a = e.args[i];
    if (!a || norm(a.name) !== norm(fa.name)) { nameDiff++; return; }
    if (fa.kind !== 'variable') return; // dummy procedures
    args++;
    for (const [k, get] of Object.entries(fields)) {
      const [x, y] = get(a, fa);
      const id = `${key}|${a.name}|${k}`;
      if (x === y || allow.has(id)) stats[k].same++;
      else {
        stats[k].differ++;
        if (listAll) console.log(id);
        if (stats[k].examples.length < 6) stats[k].examples.push(`${key.replace(/\|/g, ' ')} ${a.name}: ours "${x}", FORD "${y}"`);
      }
    }
  });
}
console.log(`procedures: ${matched} matched, ${onlyFord} only in FORD's dump, ${ours.size - matched} only in ours; ${args} arguments compared, ${nameDiff} with different names`);
for (const [k, s] of Object.entries(stats)) {
  console.log(`${k.padEnd(9)} ${s.same}/${s.same + s.differ} agree`);
  for (const x of s.examples) console.log(`          ${x}`);
}
