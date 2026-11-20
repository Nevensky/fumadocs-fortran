// Builds registry/lapack.json: BLAS and LAPACK 3.12.1 from Reference-LAPACK's Doxygen comments, with Netlib's member
// pages from its Doxygen search index.
//
//   node scripts/registry/lapack.mjs [--refresh]
//
// Precision families come from `\ingroup`: stripping the s/d/c/z prefix would put a quarter of the routines in the
// wrong family (dsyev belongs to heev, dsgesv to gesv_mixed, idamax to iamax, dznrm2 to nrm2).
import { units, typeCode } from './fortran.mjs';
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
  parseSearchData,
  readTarGz,
  saveLock,
  searchSections,
  source,
  squash,
  writeRegistry,
} from './lib.mjs';

export const SUMMARY_MAX = 110;

/** Library folders read, in order; a name seen earlier wins (lsame.f is both in BLAS/SRC and INSTALL). */
const FOLDERS = [
  ['BLAS/SRC/', 'blas'],
  ['SRC/', 'lapack'],
  ['SRC/DEPRECATED/', 'deprecated'],
  ['INSTALL/', 'install'],
];
// INSTALL/ holds test programs and timer variants too; these are the files the library is built from.
const INSTALL_FILES = new Set(['dlamch.f', 'slamch.f', 'ilaver.f', 'lsame.f', 'droundup_lwork.f', 'sroundup_lwork.f', 'dsecnd_INT_ETIME.f', 'second_INT_ETIME.f']);

const INTENT = { in: 'i', out: 'o', 'in,out': 'b', inout: 'b' };
export const PREC_T = { s: 'r', d: 'd', c: 'c', z: 'z' };
export const PREC_R = { s: 'r', d: 'd', c: 'r', z: 'd' };

/** The precision letter a decoder assumes without a `p` field: the first letter when it is s, d, c or z. */
export const precisionOf = (name) => ('sdcz'.includes(name[0]) ? name[0] : null);

/**
 * A routine's precision letter: the s, d, c or z whose removal leaves its family's name (icamax in iamax, ilaslc in
 * ilalc), else its first letter when that is one of them (dsgesv, dznrm2).
 */
export function precisionIn(name, families) {
  for (const target of families) {
    if (!target) continue;
    for (let i = 0; i < name.length; i++) {
      if ('sdcz'.includes(name[i]) && name.slice(0, i) + name.slice(i + 1) === target) return name[i];
    }
  }
  return precisionOf(name);
}

/** Writes a type code relative to the routine's precision: its own type becomes T, its real counterpart R. */
export function template(type, p) {
  if (!p || !type) return type;
  const m = /^([a-z]\*?\d*)(.*)$/.exec(type);
  if (!m) return type;
  if (m[1] === PREC_T[p]) return 'T' + m[2];
  if (m[1] === PREC_R[p]) return 'R' + m[2];
  return type;
}

const decode = (s) =>
  s.replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&amp;/g, '&').replace(/&quot;/g, '"').replace(/&#39;/g, "'");

/** Doxygen markup out of a one-line text: tags, \b \e \c, maths delimiters. */
const plain = (s) =>
  squash(decode(s.replace(/<\/?[a-z][^>]*>?/gi, ' ').replace(/\\[bec]\s+/g, '').replace(/\\f[$[\]()]/g, '')));

/** Parses the `*>` / `!>` documentation lines that precede a unit. */
export function parseDoc(lines) {
  const text = lines.join('\n');
  const doc = { brief: '', group: null, purpose: '', params: new Map() };
  const brief = /\\brief\s+([\s\S]*?)(?=\n\s*\n|\n\s*\\|$)/.exec(text);
  if (brief) doc.brief = plain(brief[1]);
  doc.group = /\\ingroup\s+(\w+)/.exec(text)?.[1] ?? /\\addtogroup\s+(\w+)/.exec(text)?.[1] ?? null;
  const purpose = /\\par\s+Purpose:?[\s\S]*?\\verbatim([\s\S]*?)\\endverbatim/.exec(text);
  if (purpose) doc.purpose = purpose[1];
  const re = /\\param\[([a-z, ]+)\]\s+(\w+)\s*\n(?:\s*\n)*\s*\\verbatim\s*\n([\s\S]*?)\\endverbatim/g;
  for (const m of text.matchAll(re)) {
    doc.params.set(m[2].toLowerCase(), { intent: INTENT[m[1].replace(/\s+/g, '')] ?? '', body: m[3] });
  }
  return doc;
}

/** The dimensions a \param body gives ("A is DOUBLE PRECISION array, dimension (LDA,N)") → "(lda,n)". */
export function docDims(body) {
  const head = body.split('\n').slice(0, 3).join(' ');
  const m = /\barray\b[^.]*?dimension\s*(\((?:[^()]|\((?:[^()]|\([^()]*\))*\))*\))/i.exec(head);
  return m ? m[1].replace(/\s+/g, '').toLowerCase() : null;
}

/** The base type a \param body states, as a type code, when the code has no declaration for it. */
function docType(body) {
  const m = /^\s*\w+\s+is\s+(.*)$/im.exec(body);
  if (!m) return '?';
  const t = m[1].toUpperCase();
  for (const [k, v] of [
    ['DOUBLE PRECISION', 'd'],
    ['COMPLEX*16', 'z'],
    ['DOUBLE COMPLEX', 'z'],
    ['COMPLEX', 'c'],
    ['REAL', 'r'],
    ['INTEGER', 'i'],
    ['LOGICAL', 'l'],
    ['CHARACTER*(*)', 'a*'],
    ['CHARACTER', 'a'],
  ]) {
    if (t.startsWith(k)) return v;
  }
  return '?';
}

const LD_RE = />=\s*(max\s*\((?:[^()]|\([^()]*\))*\)|\d+)/i;
const INFO_RE = /<\s*0\s*:?[\s\S]{0,80}?illegal\s+value/i;
const WSQ_RE = /\bL\w*\s*=\s*-1\b[\s\S]{0,200}?workspace\s+query/i;

/** One routine's record, before families are factored out. */
function routine(u, doc, folder, file) {
  // types stay literal here; the T and R templates are applied once the families are known
  const tags = [];
  const ld = {};
  const args = u.args.map((a) => {
    const d = u.decls[a];
    const pd = doc.params.get(a);
    let type = d ? typeCode(d.base, precisionOf(u.name)) : pd ? docType(pd.body) : '?';
    if (u.externals.has(a)) type = 'x' + (d ? type : '');
    // the documented dimensions say more ((LDA,N) rather than (LDA,*)), but only an array has any
    const dims = d ? d.dims && ((pd && docDims(pd.body)) ?? d.dims) : pd && docDims(pd.body);
    if (dims && !type.startsWith('x')) type += dims;
    if (/^ld/.test(a) && pd && /leading\s+dimension/i.test(pd.body)) {
      const m = LD_RE.exec(pd.body);
      if (m) ld[a] = m[1].replace(/\s+/g, '').toLowerCase();
    }
    return [a, pd?.intent || INTENT[d?.intent] || '', type];
  });
  const bodies = [...doc.params.values()].map((x) => x.body);
  if (bodies.some((b) => WSQ_RE.test(b))) tags.push('wsq');
  if (Object.keys(ld).length) tags.push('ld');
  if (doc.params.get('info') && INFO_RE.test(doc.params.get('info').body)) tags.push('info');
  if (folder === 'deprecated') tags.push('dep');

  let summary = doc.brief;
  const bare = summary.replace(/[^\w]/g, '').toLowerCase();
  if (!summary || bare === u.name || bare.length < 3) summary = firstSentence(doc.purpose);
  // "DGESV computes …" → "Computes …"; "ILAENV is called …" keeps its subject
  summary = summary.replace(new RegExp(`^(?:the\\s+)?${u.name}\\b(?![\\s:,-]*(?:is|are|has)\\b)[\\s:,-]*`, 'i'), '');
  summary = clip(capitalise(squash(summary)), SUMMARY_MAX);

  return {
    name: u.name,
    p: null,
    kind: u.kind === 'function' ? 'f' : 's',
    result: u.kind === 'function' && u.result ? typeCode(u.result, precisionOf(u.name)) : null,
    args,
    summary,
    ld,
    tags,
    group: doc.group,
    file,
    folder,
  };
}

/**
 * Netlib member pages from a Doxygen search index: name → { group: {dir, group, hash} | null, files: [{dir, base, hash}] }.
 * Group pages exist for LAPACK's \\ingroup families; every documented routine also has a member page in its file.
 */
export async function netlibAnchors(sources, srcId) {
  const src = source(sources, srcId);
  const sections = searchSections((await fetchPinned(srcId, src.urls.searchdata)).toString('utf8'));
  const count = sections.letters[sections.names.functions]?.length ?? 0;
  if (!count) throw new Error(`${srcId}: no functions section in searchdata.js`);
  const anchors = new Map();
  for (let n = 0; n < count; n++) {
    const url = src.urls.functions.replace('{n}', n.toString(16));
    for (const item of parseSearchData((await fetchPinned(srcId, url)).toString('utf8'))) {
      const [name, ...targets] = item[1];
      const key = name.toLowerCase();
      const rec = anchors.get(key) ?? { group: null, files: [] };
      for (const [href] of targets) {
        const rel = String(href).replace(/^\.\.\//, '');
        const g = /^(d[0-9a-f]\/d[0-9a-f]{2})\/group__(\w+?)_ga([0-9a-f]{32})\.html#ga\3$/.exec(rel);
        const f = /^(d[0-9a-f]\/d[0-9a-f]{2})\/(\w+?_8(?:f|f90|F|F90|c))_a([0-9a-f]{32})\.html#a\3$/.exec(rel);
        if (g && !rec.group) rec.group = { dir: g[1], group: g[2], hash: g[3] };
        if (f) rec.files.push({ dir: f[1], base: f[2], hash: f[3] });
      }
      anchors.set(key, rec);
    }
  }
  return anchors;
}

/** Group ids → { stem, title } from DOCS/groups-usr.dox. */
function groupTitles(dox) {
  const out = new Map();
  for (const m of dox.matchAll(/@defgroup\s+(\w+)\s+(.*)/g)) {
    const label = m[2].trim();
    const c = /^([\w?{},]+):\s*(.*)$/.exec(label);
    out.set(m[1], c ? { stem: c[1], title: squash(c[2]) } : { stem: null, title: squash(label) });
  }
  return out;
}

export async function build() {
  const sources = await loadSources();
  const src = source(sources, 'lapack');
  const tar = readTarGz(await fetchPinned('lapack', src.urls.tarball), (p) =>
    /^(BLAS\/SRC|SRC|SRC\/DEPRECATED|INSTALL)\/[^/]+\.(f|F|f90|F90)$/.test(p) || p === 'DOCS/groups-usr.dox' || p === 'LICENSE',
  );
  const titles = groupTitles(tar.get('DOCS/groups-usr.dox').toString('utf8'));

  const routines = new Map();
  const dropped = [];
  for (const [prefix, folder] of FOLDERS) {
    const files = [...tar.keys()].filter((p) => p.startsWith(prefix) && !p.slice(prefix.length).includes('/')).sort();
    for (const path of files) {
      const file = path.slice(prefix.length);
      if (folder === 'install' && !INSTALL_FILES.has(file)) continue;
      const text = tar.get(path).toString('latin1');
      const free = /\.f90$/i.test(file);
      const lines = text.split(/\r?\n/);
      let from = 0;
      for (const u of units(text, { free })) {
        const docLines = [];
        for (let i = from; i < u.start - 1; i++) {
          const m = /^\s*[*cC!]>\s?(.*)$/.exec(lines[i]);
          if (m) docLines.push(m[1]);
        }
        from = u.end;
        const doc = parseDoc(docLines);
        if (routines.has(u.name)) {
          dropped.push(`${path} (${u.name} already read)`);
          continue;
        }
        if (!doc.brief && !doc.params.size && !doc.purpose) {
          dropped.push(`${path} (${u.name}: no documentation)`);
          continue;
        }
        routines.set(u.name, routine(u, doc, folder, file));
      }
    }
  }

  // Deprecated routines keep the old \ingroup names (doubleGEcomputational), which are not families: their family is
  // the name without its precision letter, as on Netlib before 3.12.
  const oldGroups = new Map();
  for (const r of routines.values()) {
    if (r.group && !titles.has(r.group)) {
      oldGroups.set(r.name, r.group);
      r.group = precisionOf(r.name) ? r.name.slice(1) : r.name;
    }
  }

  // Netlib member pages. Their folders must be the ones Doxygen derives from the page names, as the URL rules assume;
  // a page that breaks the rule is kept whole.
  const anchors = await netlibAnchors(sources, 'netlib-lapack');
  let linked = 0;
  for (const r of routines.values()) {
    const a = anchors.get(r.name);
    const g = a?.group;
    if (g) {
      if (g.dir === doxygenDir(`group__${g.group}`) && r.group && doxygenEscape(r.group) === g.group) r.hash = g.hash;
      else r.page = `${g.dir}/group__${g.group}_ga${g.hash}.html#ga${g.hash}`;
      linked++;
      continue;
    }
    const f = a?.files.find((x) => x.base === doxygenEscape(r.file));
    if (f) {
      if (f.dir === doxygenDir(f.base)) r.fileHash = f.hash;
      else r.page = `${f.dir}/${f.base}_a${f.hash}.html#a${f.hash}`;
      linked++;
    }
  }

  // Precision letters and type templates, now that the families are known.
  for (const r of routines.values()) {
    r.p = precisionIn(r.name, [r.group, titles.get(r.group)?.stem]);
    r.args = r.args.map(([a, i, t]) => [a, i, template(t, r.p)]);
    r.result = template(r.result, r.p);
  }

  // Families: the defaults are the most common value among the real members (s, d, or no precision), with a second
  // default for the complex members (c, z) where theirs differs (sy/he, or/un, RWORK); members override the rest.
  const families = new Map();
  for (const r of routines.values()) {
    const g = r.group ?? `\0${r.name}`;
    if (!families.has(g)) families.set(g, []);
    families.get(g).push(r);
  }
  const FIELDS = [
    ['k', (r) => (r.kind === 'f' ? 'f' : null)],
    ['r', (r) => r.result],
    ['s', (r) => r.summary],
    ['a', (r) => r.args],
    ['ld', (r) => (Object.keys(r.ld).length ? r.ld : null)],
    ['t', (r) => (r.tags.length ? r.tags : null)],
  ];
  const isComplex = (r) => r.p === 'c' || r.p === 'z';
  const same = (a, b) => JSON.stringify(a ?? null) === JSON.stringify(b ?? null);
  const groups = {};
  const entries = {};
  const names = [...routines.keys()].sort();
  for (const [g, members] of [...families].sort(([a], [b]) => a.localeCompare(b))) {
    const standalone = g.startsWith('\0');
    const defaults = {};
    if (!standalone) {
      const t = titles.get(g);
      if (t?.stem && t.stem !== g) defaults.n = t.stem;
      if (t?.title && !/^\?+$/.test(t.title)) defaults.title = t.title;
    }
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
      for (const [key, get] of FIELDS) {
        const v = get(r);
        const d = standalone ? undefined : isComplex(r) && `${key}c` in defaults ? defaults[`${key}c`] : defaults[key];
        if (!same(v, d)) e[key] = v ?? (key === 't' ? [] : null);
      }
      if (r.p !== precisionOf(r.name)) e.p = r.p;
      if (r.hash) e.u = r.hash;
      if (r.fileHash) e.v = r.fileHash;
      if (r.page) e.U = r.page;
      if (r.file !== `${r.name}.f`) e.f = r.file;
      entries[r.name] = e;
    }
  }
  const sortedEntries = Object.fromEntries(names.map((n) => [n, entries[n]]));

  const out = {
    format: 1,
    id: 'lapack',
    title: 'BLAS and LAPACK',
    version: src.version,
    sources: ['lapack', 'netlib-lapack'],
    legend: {
      kinds: { s: 'subroutine (the default, not stored)', f: 'function' },
      intents: { i: 'in', o: 'out', b: 'inout' },
      types: {
        i: 'integer',
        r: 'real',
        d: 'double precision',
        c: 'complex',
        z: 'complex*16',
        l: 'logical',
        a: 'character',
        'a*': 'character(*)',
        x: 'procedure (EXTERNAL); the code after x is its result type',
      },
      templates: {
        note: 'A type starting with T or R takes the routine’s precision (its `p`, else the first letter of its name when that is s, d, c or z): T is its own type, R the real type of the same precision.',
        T: PREC_T,
        R: PREC_R,
      },
      tags: {
        wsq: 'documents a workspace query: called with LWORK = -1 (or LIWORK, LRWORK), it only returns the optimal workspace size in WORK(1)',
        ld: 'has leading-dimension arguments; `ld` gives each one’s lower bound, such as max(1,n)',
        info: 'returns INFO: 0 on success, -i when argument i had an illegal value, > 0 for a routine-specific failure',
        dep: 'deprecated: only built with BUILD_DEPRECATED',
      },
      fields: {
        p: 'precision letter for the T and R templates, when it is not the first letter of the name (icamax: c)',
        g: 'precision family (the \\ingroup; for deprecated routines, the name without its precision letter); its record in `groups` holds the defaults, and a key ending in c (ac, sc, …) is the default for the complex members (c, z)',
        k: 'kind',
        r: 'function result type',
        s: 'summary',
        a: 'arguments: [name, intent, type]',
        ld: 'lower bounds of the leading dimensions',
        t: 'hint tags',
        u: 'Netlib member-page anchor in the family’s group page',
        v: 'Netlib member-page anchor in the file’s page, for routines without a group page',
        U: 'Netlib member page, when it does not follow the rules',
        f: 'source file, when it is not <name>.f',
        n: 'family display name, when it is not the group id (gesv_mixed shows as gesv)',
        title: 'family title from LAPACK’s DOCS/groups-usr.dox',
      },
    },
    links: {
      netlib: {
        base: 'https://www.netlib.org/lapack/explore-html/',
        member: '{dir}/group__{group}_ga{u}.html#ga{u}',
        fileMember: '{dir}/{file}_a{v}.html#a{v}',
        file: '{dir}/{file}.html',
        rule: 'group and file are escaped as Doxygen does (_ → __, . → _8, so dgesv.f → dgesv_8f); dir is d{md5(page)[14]&0xf}/d{md5(page)[15]:02x} of the page name (group__{group} or the escaped file); the file page, from `f` or <name>.f, is the fallback when an anchor is missing or stale',
      },
      mkl: {
        base: 'https://www.intel.com/content/www/us/en/docs/onemkl/developer-reference-fortran/2026-2/',
        page: '{slug}.html',
        rule: 'slug: the lower-case name without its precision letter (dgesv → gesv); i?amax and i?amin become i-amax and i-amin; the mixed-precision solvers keep their names (dsgesv, zcposv); intel.com answers scripts with 403, so the slugs are not checked',
      },
    },
    groups,
    entries: sortedEntries,
  };
  const text = formatRegistry(out, ['groups', 'entries']);
  const bytes = await writeRegistry('lapack.json', text);
  const stats = {
    routines: routines.size,
    families: Object.keys(groups).length,
    linked,
    withoutGroup: [...routines.values()].filter((r) => !r.group).length,
    oldGroups: [...oldGroups].map(([n, g]) => `${n}:${g}${routines.get(n).hash ? '' : routines.get(n).page ? ' (U)' : ' (no page)'}`),
    overrides: Object.fromEntries(['s', 'a', 'ld', 't'].map((k) => [k, Object.values(entries).filter((e) => k in e).length])),
    tags: Object.fromEntries(['wsq', 'ld', 'info', 'dep'].map((t) => [t, [...routines.values()].filter((r) => r.tags.includes(t)).length])),
    unknownTypes: [...routines.values()].filter((r) => r.args.some((a) => a[2].startsWith('?'))).map((r) => r.name),
    noIntent: [...routines.values()].filter((r) => r.args.some((a) => !a[1])).map((r) => r.name),
    dropped,
    bytes,
  };
  return { file: 'lapack.json', bytes, stats, licence: tar.get('LICENSE').toString('utf8') };
}

if (isMain(import.meta.url)) {
  const { stats } = await build();
  await saveLock();
  console.log(JSON.stringify(stats, (k, v) => (Array.isArray(v) && v.length > 30 ? [...v.slice(0, 30), `… ${v.length} in all`] : v), 2));
}
