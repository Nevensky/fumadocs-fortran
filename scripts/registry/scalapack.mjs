// Builds registry/scalapack.json: ScaLAPACK 2.2.2 with its TOOLS, PBLAS, REDIST and BLACS, from the Purpose and
// Arguments prose of Reference-ScaLAPACK, with Netlib's member pages from its Doxygen search index.
//
//   node scripts/registry/scalapack.mjs [--refresh]
//
// "(global input)" and its kin give each argument's scope and intent. Precision families follow the names (pdgesv is
// in p?gesv), since ScaLAPACK has no \ingroup.
import { BLACS, BLACS_COLLECTIVE, BLACS_P2P, REDIST } from './data/blacs.mjs';
import { typeCode, units } from './fortran.mjs';
import { netlibAnchors, PREC_R, PREC_T, template } from './lapack.mjs';
import {
  capitalise,
  clip,
  doxygenDir,
  doxygenEscape,
  fetchPinned,
  firstSentence,
  formatRegistry,
  isMain,
  loadSources,
  mode,
  readTarGz,
  saveLock,
  source,
  squash,
  writeRegistry,
} from './lib.mjs';

const SUMMARY_MAX = 110;

/** ScaLAPACK's error handler, as XERBLA is LAPACK's: code written in ScaLAPACK's style calls it too. */
const PXERBLA = 'PBLAS/SRC/PTZBLAS/pxerbla.f';

/** Prose sections of a comment block (lines without their comment marks): heading → lines. */
export function proseSections(lines) {
  const sections = new Map();
  let current = null;
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    // a heading: a short title (Purpose, Purpose:, Arguments), then a rule of = signs, maybe after a blank line
    const title = /^\s*([A-Z][A-Za-z ]{2,30}?):?\s*$/.exec(line);
    const rule = [1, 2].find((k) => /^\s*={3,}\s*$/.test(lines[i + k] ?? '') && (k === 1 || !lines[i + 1].trim()));
    if (title && rule) {
      current = title[1].trim();
      if (!sections.has(current)) sections.set(current, []);
      i += rule;
      continue;
    }
    if (/^\s*={20,}\s*$/.test(line) || /^\s*-{20,}\s*$/.test(line)) {
      current = null;
      continue;
    }
    if (current) sections.get(current).push(line);
  }
  return sections;
}

const ARG_RE = /^ {1,6}([A-Z][A-Z0-9_]*)\s+\(([^)]*)\)\s*(.*)$/;

/** Arguments prose → name → { scope, intent, head }, where head is the first three lines of its description. */
export function proseArgs(lines) {
  const out = new Map();
  let cur = null;
  for (const line of lines) {
    const m = ARG_RE.exec(line);
    if (m) {
      cur = { scope: m[2].toLowerCase(), head: [m[3]], body: [m[3]] };
      out.set(m[1].toLowerCase(), cur);
    } else if (cur) {
      if (cur.head.length < 3 && line.trim()) cur.head.push(line.trim());
      cur.body.push(line);
    }
  }
  for (const a of out.values()) {
    a.head = a.head.join(' ');
    a.body = a.body.join('\n');
  }
  return out;
}

/** "(local input/local output)" → { intent: 'b', scope: 'l' }. */
export function scopeIntent(text) {
  const t = text.toLowerCase();
  const input = /\binput\b/.test(t);
  const output = /\boutput\b/.test(t);
  const intent = input && output ? 'b' : input ? 'i' : output || /workspace/.test(t) ? 'o' : '';
  const global = /\bglobal\b/.test(t);
  const local = /\blocal\b/.test(t);
  return { intent, scope: global && local ? 'gl' : global ? 'g' : local ? 'l' : '' };
}

const PROSE_TYPES = [
  ['DOUBLE PRECISION', 'd'],
  ['COMPLEX*16', 'z'],
  ['DOUBLE COMPLEX', 'z'],
  ['COMPLEX', 'c'],
  ['REAL', 'r'],
  ['INTEGER', 'i'],
  ['LOGICAL', 'l'],
  ['CHARACTER*(*)', 'a*'],
  ['CHARACTER', 'a'],
];

/** The type code and dimensions an argument's prose gives: "DOUBLE PRECISION pointer into … dimension (LLD_A,…)". */
function proseType(head) {
  const t = head.toUpperCase().replace(/\s+/g, ' ');
  const base = PROSE_TYPES.find(([k]) => t.startsWith(k))?.[1] ?? '?';
  const m = /dimension\s*(?:at\s+least\s*)?(\((?:[^()]|\((?:[^()]|\([^()]*\))*\))*\)|[A-Z_][A-Z0-9_]*)/i.exec(head);
  let dims = null;
  if (m && /array|pointer|dimension/i.test(head)) dims = m[1].startsWith('(') ? m[1] : `(${m[1]})`;
  return { base, dims: dims && dims.replace(/\s+/g, '').toLowerCase() };
}

const WSQ_RE = /\bL\w*\s*=\s*-1\b[\s\S]{0,300}?workspace\s+query/i;

/** The precision letter at the ? of a family name (p?gesv → index 1). */
const precisionAt = (name, family) => {
  const i = family ? family.indexOf('?') : -1;
  return i >= 0 && 'sdcz'.includes(name[i]) ? name[i] : null;
};

/** Precision families by name: p[sdcz] after p, or [sdcz] first, when another precision of the name exists. */
function familyOf(name, all) {
  const tries = [];
  if (/^p[sdczi]/.test(name)) tries.push(1);
  if (/^[sdczi]/.test(name)) tries.push(0);
  for (const i of tries) {
    const sib = [...'sdczi'].filter((c) => c !== name[i]).map((c) => name.slice(0, i) + c + name.slice(i + 1));
    if (sib.some((s) => all.has(s))) return `${name.slice(0, i)}?${name.slice(i + 1)}`;
  }
  return null;
}

/** Parses the C prototype of a Fortran entry point: `void pdgemm_( F_CHAR_T TRANSA, Int * M, … )` → names. */
function cArgs(text, fname) {
  const re = new RegExp(`\\b${fname}\\s*\\(([^)]*)\\)`, 'g');
  for (const m of text.matchAll(re)) {
    if (/^\s*(?:void)?\s*$/.test(m[1]) && /^\s*(?:#\s*endif\s*)?\{/.test(text.slice(m.index + m[0].length))) return [];
    const parts = m[1].split(',').map((p) => p.trim()).filter(Boolean);
    if (parts.length && parts.every((p) => /\s|\*/.test(p))) {
      return parts.map((p) => /(\w+)\s*(?:\[\s*\])?$/.exec(p)[1].toLowerCase());
    }
  }
  return null;
}

function record(name, folder, file, doc) {
  return { name, folder, file, ...doc };
}

export async function build() {
  const sources = await loadSources();
  const src = source(sources, 'scalapack');
  const tar = readTarGz(await fetchPinned('scalapack', src.urls.tarball), (p) =>
    /^(SRC|TOOLS|PBLAS\/SRC|REDIST\/SRC|BLACS\/SRC)\/[^/]+\.(f|c)$/.test(p) || p === PXERBLA || p === 'LICENSE',
  );
  const routines = new Map();
  const dropped = [];

  // Fortran: SRC, TOOLS, PBLAS's own pilaenv.f and its error handler PXERBLA (the rest of PBLAS/SRC/PTZBLAS is
  // internal); the prose sits inside each unit, after its header.
  for (const [prefix, folder] of [['SRC/', 'scalapack'], ['TOOLS/', 'tools'], ['PBLAS/SRC/', 'pblas']]) {
    for (const path of [...tar.keys()].filter((p) => p.startsWith(prefix) && p.endsWith('.f')).sort()) {
      // Doxygen names a file's page by its base name (pxerbla.f, not PTZBLAS/pxerbla.f)
      const file = path.split('/').pop();
      const text = tar.get(path).toString('latin1');
      const lines = text.split(/\r?\n/);
      for (const u of units(text)) {
        const comments = lines.slice(u.start, u.end).filter((l) => /^[*cC]/.test(l)).map((l) => l.slice(1));
        const sections = proseSections(comments);
        const args = proseArgs(sections.get('Arguments') ?? []);
        if (routines.has(u.name)) {
          dropped.push(`${path} (${u.name} already read)`);
          continue;
        }
        routines.set(u.name, record(u.name, folder, file, {
          kind: u.kind === 'function' ? 'f' : 's',
          resultBase: u.kind === 'function' ? u.result : null,
          argNames: u.args,
          decls: u.decls,
          externals: u.externals,
          purpose: (sections.get('Purpose') ?? []).join('\n'),
          prose: args,
        }));
      }
    }
  }

  // PBLAS: the Fortran-callable C functions p?xxx_ in p?xxx_.c, with the same prose in C comments.
  for (const path of [...tar.keys()].filter((p) => /^PBLAS\/SRC\/p\w+_\.c$/.test(p)).sort()) {
    const file = path.slice('PBLAS/SRC/'.length);
    const name = file.replace(/_\.c$/, '');
    const text = tar.get(path).toString('latin1');
    const comments = text.split(/\r?\n/).filter((l) => /^\s*\*/.test(l)).map((l) => l.replace(/^\s*\*/, ''));
    const sections = proseSections(comments);
    const prose = proseArgs(sections.get('Arguments') ?? []);
    let argNames = cArgs(text, `${name}_`);
    // the prose is the documented interface (TRANSA where the C code says TRANS); its order is the prototype's
    if (argNames && prose.size === argNames.length) argNames = [...prose.keys()];
    if (!argNames) {
      dropped.push(`${path} (no prototype)`);
      continue;
    }
    const kind = new RegExp(`^\\s*(?:void|F_VOID_FUNC)\\s+${name}_\\s*\\(`, 'm').test(text) ? 's' : 'f';
    routines.set(name, record(name, 'pblas', file, {
      kind,
      resultBase: kind === 'f' ? 'integer' : null,
      argNames,
      decls: {},
      externals: new Set(),
      purpose: (sections.get('Purpose') ?? []).join('\n'),
      prose,
    }));
  }

  // REDIST: p?gemr2d and p?trmr2d; arguments from data/blacs.mjs, summaries from the Purpose prose.
  for (const [fam, spec] of Object.entries(REDIST)) {
    for (const p of 'sdczi') {
      const name = fam.replace('?', p);
      const file = `${name.replace(/2d$/, '')}.c`;
      const text = tar.get(`REDIST/SRC/${file}`)?.toString('latin1');
      if (!text) throw new Error(`REDIST/SRC/${file} is missing`);
      const purpose = /Purpose\s*\n\s*=+\s*\n([\s\S]*?)\n\s*\n/.exec(text)?.[1] ?? '';
      if (!new RegExp(`\\b${name}_?\\b`, 'i').test(text)) throw new Error(`${file} does not define ${name}`);
      routines.set(name, record(name, 'redist', file, { kind: 's', curated: { spec, purpose, prec: p } }));
    }
  }

  // BLACS: names and argument lists from the C sources, intents and our own one-liners from data/blacs.mjs.
  const blacsText = new Map([...tar].filter(([p]) => p.startsWith('BLACS/SRC/')).map(([p, b]) => [p, b.toString('latin1')]));
  for (const [key, [summary, spec]] of Object.entries(BLACS)) {
    for (const p of key.includes('?') ? 'isdcz' : ['']) {
      const name = key.replace('?', p);
      const hit = [...blacsText].find(([, t]) => new RegExp(`\\b${name}_\\s*\\(`).test(t) && cArgs(t, `${name}_`));
      if (!hit) throw new Error(`BLACS: no C source defines ${name}_`);
      const [path, text] = hit;
      const cNames = cArgs(text, `${name}_`);
      const want = spec ? spec.split(' ').map((s) => s.split(':')[0]) : [];
      if (cNames.length !== want.length) throw new Error(`BLACS ${name}: the source has ${cNames.length} arguments, data/blacs.mjs ${want.length}`);
      const fn = new RegExp(`^\\s*(?:F_INT_FUNC|Int|double|F_DOUBLE_FUNC)\\s+${name}_\\s*\\(`, 'm').exec(text);
      routines.set(name, record(name, 'blacs', path.slice('BLACS/SRC/'.length), {
        kind: fn ? 'f' : 's',
        resultBase: fn ? (/double/i.test(fn[0]) ? 'double precision' : 'integer') : null,
        curated: { spec, summary, prec: p, key },
      }));
    }
  }

  // Families, precision letters, arguments and tags.
  const names = new Set(routines.keys());
  const typeOfPrec = { i: 'i', s: 'r', d: 'd', c: 'c', z: 'z' };
  for (const r of routines.values()) {
    r.family = familyOf(r.name, names);
    const p = precisionAt(r.name, r.family);
    r.p = p;
    r.tags = [];
    if (r.curated) {
      const { spec, summary, purpose, prec, key } = r.curated;
      r.args = (spec ? spec.split(' ') : []).map((s) => {
        const [a, intent, scope] = s.split(':');
        const matrix = intent.endsWith('*');
        let type = matrix ? `${typeOfPrec[prec]}(${r.folder === 'redist' ? '*' : 'lda,*'})` : /^(scope|top|uplo|diag|layout)$/.test(a) ? 'a' : 'i';
        if (a === 'ra' || a === 'ca') type = 'i(ldia,*)';
        const arg = [a, intent.replace('*', ''), template(type, p)];
        if (scope) arg.push(scope);
        return arg;
      });
      r.summary = summary ?? clip(capitalise(squash(firstSentence(purpose).replace(new RegExp(`^${r.name}\\b\\s*`, 'i'), ''))), SUMMARY_MAX);
      r.result = r.resultBase ? template(typeCode(r.resultBase, p), p) : null;
      if (r.folder === 'blacs') {
        if (BLACS_COLLECTIVE.has(key)) r.tags.push('coll');
        if (BLACS_P2P.has(key)) r.tags.push('p2p');
      } else r.tags.push('desc');
      continue;
    }
    r.args = r.argNames.map((a) => {
      const d = r.decls[a];
      const pr = r.prose.get(a);
      const pt = pr ? proseType(pr.head) : { base: '?', dims: null };
      let type = d ? typeCode(d.base, p) : pt.base;
      if (r.externals.has(a)) type = d ? `x${type}` : 'x';
      const dims = d ? d.dims && (pt.dims ?? d.dims) : pt.dims;
      if (dims && !type.startsWith('x')) type += dims;
      const { intent, scope } = pr ? scopeIntent(pr.scope) : { intent: '', scope: '' };
      const arg = [a, intent, template(type, p)];
      if (scope) arg.push(scope);
      return arg;
    });
    r.result = r.resultBase ? template(typeCode(r.resultBase, p), p) : null;
    let summary = firstSentence(r.purpose);
    summary = summary.replace(new RegExp(`^(?:the\\s+)?${r.name}\\b(?![\\s:,-]*(?:is|are|has)\\b)[\\s:,-]*`, 'i'), '');
    r.summary = clip(capitalise(squash(summary)), SUMMARY_MAX);
    const bodies = [...r.prose.values()].map((x) => x.body);
    if (bodies.some((b) => WSQ_RE.test(b))) r.tags.push('wsq');
    if (r.argNames.some((a) => /^desc/.test(a))) r.tags.push('desc');
    if (r.prose.get('info') && /illegal\s+value/i.test(r.prose.get('info').body)) r.tags.push('info');
  }

  // Netlib member pages (file members: ScaLAPACK has no groups); PBLAS's C functions carry the trailing underscore.
  const anchors = await netlibAnchors(sources, 'netlib-scalapack');
  let linked = 0;
  for (const r of routines.values()) {
    const a = anchors.get(r.name) ?? anchors.get(`${r.name}_`);
    const f = a?.files.find((x) => x.base === doxygenEscape(r.file));
    if (!f) continue;
    if (f.dir === doxygenDir(f.base)) r.fileHash = f.hash;
    else r.page = `${f.dir}/${f.base}_a${f.hash}.html#a${f.hash}`;
    linked++;
  }

  // Families factored out as for LAPACK, with complex defaults where the complex members differ.
  const FIELDS = [
    ['k', (r) => (r.kind === 'f' ? 'f' : null)],
    ['r', (r) => r.result],
    ['s', (r) => r.summary || null],
    ['a', (r) => r.args],
    ['t', (r) => (r.tags.length ? r.tags : null)],
  ];
  const isComplex = (r) => r.p === 'c' || r.p === 'z';
  const same = (a, b) => JSON.stringify(a ?? null) === JSON.stringify(b ?? null);
  const families = new Map();
  for (const r of routines.values()) {
    const g = r.family ?? `\0${r.name}`;
    if (!families.has(g)) families.set(g, []);
    families.get(g).push(r);
  }
  const groups = {};
  const entries = {};
  for (const [g, members] of [...families].sort(([a], [b]) => a.localeCompare(b))) {
    const standalone = g.startsWith('\0');
    const defaults = {};
    const real = members.filter((r) => !isComplex(r));
    const cplx = members.filter(isComplex);
    for (const [key, get] of FIELDS) {
      const base = mode((real.length ? real : members).map(get));
      if (base !== null && base !== '') defaults[key] = base;
      if (real.length && cplx.length > 1) {
        const c = mode(cplx.map(get));
        if (!same(c, base) && cplx.filter((r) => same(get(r), c)).length > 1) defaults[`${key}c`] = c;
      }
    }
    if (!standalone) groups[g] = defaults;
    for (const r of members) {
      const e = {};
      if (!standalone) e.g = g;
      if (r.folder !== 'scalapack') e.l = r.folder;
      for (const [key, get] of FIELDS) {
        const v = get(r);
        const d = standalone ? undefined : isComplex(r) && `${key}c` in defaults ? defaults[`${key}c`] : defaults[key];
        if (!same(v, d)) e[key] = v ?? (key === 't' ? [] : null);
      }
      if (r.fileHash) e.v = r.fileHash;
      if (r.page) e.U = r.page;
      if (r.file !== `${r.name}.f`) e.f = r.file;
      entries[r.name] = e;
    }
  }

  const out = {
    format: 1,
    id: 'scalapack',
    title: 'ScaLAPACK, PBLAS, REDIST and BLACS',
    version: src.version,
    sources: ['scalapack', 'netlib-scalapack'],
    legend: {
      libraries: { scalapack: 'ScaLAPACK (SRC)', tools: 'ScaLAPACK tools (TOOLS)', pblas: 'PBLAS', redist: 'REDIST', blacs: 'BLACS' },
      kinds: { s: 'subroutine (the default, not stored)', f: 'function' },
      intents: { i: 'in', o: 'out', b: 'inout' },
      scopes: { g: 'global: the same value on every process', l: 'local: each process has its own', gl: 'global and local (descriptors)' },
      types: 'as in lapack.json',
      templates: {
        note: 'A type starting with T or R takes the routine’s precision, the letter at the ? of its family (p?gesv: pdgesv is d): T is its own type, R the real type of the same precision.',
        T: PREC_T,
        R: PREC_R,
      },
      tags: {
        wsq: 'documents a workspace query: called with LWORK = -1 (or LIWORK, LRWORK), it only computes the workspace sizes',
        desc: 'takes array descriptors (DESCA, …): set them up with DESCINIT, and the local sizes with NUMROC',
        info: 'returns INFO: 0 on success; -(i*100+j) when entry j of array argument i is illegal, -i for a scalar argument i',
        coll: 'every process in the scope (row, column or grid) must call it',
        p2p: 'point-to-point: one sender, one receiver',
      },
      fields: {
        g: 'precision family; its record in `groups` holds the defaults, and a key ending in c is the default for the complex members (c, z)',
        l: 'library (see libraries), when it is not scalapack',
        k: 'kind',
        r: 'function result type',
        s: 'summary',
        a: 'arguments: [name, intent, type, scope]',
        t: 'hint tags',
        v: 'Netlib member-page anchor in the file’s page',
        U: 'Netlib member page, when it does not follow the rule',
        f: 'source file, when it is not <name>.f',
      },
    },
    links: {
      netlib: {
        base: 'https://www.netlib.org/scalapack/explore-html/',
        fileMember: '{dir}/{file}_a{v}.html#a{v}',
        file: '{dir}/{file}.html',
        rule: 'as in lapack.json: file escaped as Doxygen does, dir from the md5 of the escaped name',
      },
      mkl: {
        base: 'https://www.intel.com/content/www/us/en/docs/onemkl/developer-reference-fortran/2026-2/',
        page: '{slug}.html',
        rule: 'slug: p-{name without p and its precision letter} for ScaLAPACK and PBLAS (pdgesv → p-gesv); BLACS and the tools have no MKL pages of their own',
      },
    },
    groups,
    entries: Object.fromEntries([...routines.keys()].sort().map((n) => [n, entries[n]])),
  };
  const text = formatRegistry(out, ['groups', 'entries']);
  const bytes = await writeRegistry('scalapack.json', text);
  const all = [...routines.values()];
  const stats = {
    routines: routines.size,
    byLibrary: Object.fromEntries(['scalapack', 'tools', 'pblas', 'redist', 'blacs'].map((l) => [l, all.filter((r) => r.folder === l).length])),
    families: Object.keys(groups).length,
    linked,
    noSummary: all.filter((r) => !r.summary).map((r) => r.name),
    noArgsDocs: all.filter((r) => !r.curated && r.args.some((a) => !a[1])).map((r) => r.name),
    unknownTypes: all.filter((r) => r.args.some((a) => a[2].includes('?'))).map((r) => r.name),
    tags: Object.fromEntries(['wsq', 'desc', 'info', 'coll', 'p2p'].map((t) => [t, all.filter((r) => r.tags.includes(t)).length])),
    dropped,
    bytes,
  };
  return { file: 'scalapack.json', bytes, stats, licence: tar.get('LICENSE').toString('utf8') };
}

if (isMain(import.meta.url)) {
  const { stats } = await build();
  await saveLock();
  console.log(JSON.stringify(stats, (k, v) => (Array.isArray(v) && v.length > 30 ? [...v.slice(0, 30), `… ${v.length} in all`] : v), 2));
}
