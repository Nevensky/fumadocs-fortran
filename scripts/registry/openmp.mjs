// Builds registry/openmp.json: OpenMP 6.1, 6.0 and 5.2 directives, clauses, runtime routines, environment variables
// and Fortran kinds, with the page and fragment of each in the HTML edition of every version.
//
//   node scripts/registry/openmp.mjs [--refresh]
//
// Names, pages and fragment IDs come from the specification's contents pages (none of its prose); the Fortran
// interfaces of the routines from LLVM's omp_lib (Apache-2.0); the one-liners and tags are ours (data/openmp.mjs).
import {
  CLAUSE_GROUPS,
  CLAUSE_SINCE,
  COMPOUNDS,
  DEPRECATED,
  DIRECTIVE_HOMES,
  DIRECTIVE_TAGS,
  KIND_HOMES,
  KINDS,
  LEAF_TAGS,
  SUMMARIES,
} from './data/openmp.mjs';
import { statements } from './fortran.mjs';
import { fetchPinned, formatRegistry, isMain, loadSources, saveLock, source, squash, writeRegistry } from './lib.mjs';

export const VERSIONS = ['6.1', '6.0', '5.2'];

const decodeHtml = (s) =>
  s
    .replace(/<[^>]+>/g, '')
    .replace(/&#x([0-9a-f]+);/gi, (_, h) => String.fromCodePoint(parseInt(h, 16)))
    .replace(/&#(\d+);/g, (_, d) => String.fromCodePoint(Number(d)))
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>');

/** The rows of a contents page: { page, frag, title }, page without its openmp prefix and .html. */
export function contents(html) {
  return [...html.matchAll(/<span class='\w+Toc'\s*>[\dA-Z.]*\s*<a\s+href='openmp(\w+)\.html#([^']+)'[^>]*>([\s\S]*?)<\/a>/g)].map((m) => ({
    page: m[1],
    frag: m[2],
    title: squash(decodeHtml(m[3])),
  }));
}

/** Directive names are keyed with blanks: 6.x writes target_data and declare_simd, 5.2 target data. */
const directiveKey = (name) => name.replace(/_/g, ' ');

/** Classifies the rows of one version: kind → name → { page, frag, deprecated }. */
function classify(rows) {
  const out = { directives: new Map(), clauses: new Map(), routines: new Map(), env: new Map(), types: new Map() };
  const put = (kind, name, row, extra = {}) => {
    if (!out[kind].has(name)) out[kind].set(name, { page: row.page, frag: row.frag, ...extra });
  };
  for (const row of rows) {
    const deprecated = /\(Deprecated\)$/.test(row.title);
    const title = row.title.replace(/\s*\(Deprecated\)$/, '');
    let m;
    if ((m = /^((?:begin |end )?[a-z][a-z0-9_ ]*?) (?:Construct|Directive)$/.exec(title))) {
      put('directives', directiveKey(m[1]), row, { deprecated, raw: m[1] });
    } else if ((m = /^([a-z][a-z0-9_]*) Clause$/.exec(title))) {
      put('clauses', m[1], row);
    } else if (CLAUSE_GROUPS[title]) {
      for (const c of CLAUSE_GROUPS[title]) put('clauses', c, row, { group: title });
    } else if ((m = /^(omp_\w+(?: and omp_\w+)*)(?: Routines?)?$/.exec(title))) {
      for (const n of m[1].split(' and ')) put('routines', n, row, { deprecated });
    } else if ((m = /^(OMP_[A-Z_]+)$/.exec(title))) {
      put('env', m[1], row, { deprecated });
    } else if ((m = /^OpenMP (\w+) Type$/.exec(title))) {
      put('types', `omp_${m[1]}_kind`, row);
    } else if (/^metadirective$/.test(title) || /^(begin )?metadirective$/.test(title)) {
      put('directives', title, row);
    } else if (/^Worksharing-Loop Constructs?$/.test(title)) {
      out.worksharingLoop = row;
    } else if (/^Compound Directive Names$|^Combined and Composite Directive Names$/.test(title)) {
      out.compound = { page: row.page, frag: row.frag };
    }
  }
  // do has a section of its own in some versions only; otherwise the Worksharing-Loop section documents it
  if (!out.directives.has('do') && out.worksharingLoop) put('directives', 'do', out.worksharingLoop);
  return out;
}

/** The Fortran interfaces of LLVM's omp_lib: name → { kind, result, args: [[name, intent, type]] }, and its kinds. */
export function ompLib(text) {
  const routines = new Map();
  const kinds = new Set();
  const constants = new Map();
  let unit = null;
  for (const st of statements(text, { free: true })) {
    const t = st.text;
    const k = /^integer\s*,\s*parameter\s*,\s*public\s*::\s*(omp_\w+_kind)\b/i.exec(t);
    if (k) kinds.add(k[1].toLowerCase());
    // named constants: integer (kind=omp_sched_kind), parameter, public :: omp_sched_static = 1
    const c = /^integer\s*\(\s*kind\s*=\s*(\w+)\s*\)\s*,\s*parameter\s*,\s*public\s*::\s*((?:omp|openmp)_\w+)\s*=/i.exec(t);
    if (c && !/_kind$/i.test(c[2])) constants.set(c[2].toLowerCase(), c[1].toLowerCase());
    const h = /^(subroutine|function)\s+(\w+)\s*\(([^)]*)\)/i.exec(t);
    if (h) {
      unit = { name: h[2].toLowerCase(), kind: h[1].toLowerCase(), args: h[3].split(',').map((a) => a.trim().toLowerCase()).filter(Boolean), decl: new Map() };
      continue;
    }
    if (!unit) continue;
    if (/^end\s*(subroutine|function)\b/i.test(t)) {
      if (/^omp_/.test(unit.name) && !routines.has(unit.name)) routines.set(unit.name, unit);
      unit = null;
      continue;
    }
    const d = /^(integer|real|logical|character|type|complex|double precision)\s*(\([^)]*\))?\s*(?:,\s*([^:]*?))?\s*(?:::)?\s*(\w+(?:\s*\([^)]*\))?(?:\s*,\s*\w+(?:\s*\([^)]*\))?)*)\s*$/i.exec(t);
    if (!d) continue;
    const base = d[1].toLowerCase();
    let arg = d[2]?.replace(/[\s()]/g, '').replace(/^(?:kind|len)=/i, '').toLowerCase() ?? '';
    let type = arg ? `${base}(${arg})` : base;
    if (type === 'real(kmp_double_kind)' || type === 'real(c_double)') type = 'double precision';
    const attrs = (d[3] ?? '').toLowerCase();
    for (const ent of d[4].split(/,(?![^(]*\))/)) {
      const em = /^\s*(\w+)\s*(\([^)]*\))?/.exec(ent);
      if (em) unit.decl.set(em[1].toLowerCase(), { type: type + (em[2] ?? '').replace(/\s+/g, '').toLowerCase(), attrs });
    }
  }
  const out = new Map();
  for (const [name, u] of routines) {
    const intent = (attrs) => (/\bvalue\b/.test(attrs) ? 'i' : /intent\s*\(\s*inout\s*\)/.test(attrs) ? 'b' : /intent\s*\(\s*in\s*\)/.test(attrs) ? 'i' : /intent\s*\(\s*out\s*\)/.test(attrs) ? 'o' : '');
    out.set(name, {
      kind: u.kind === 'function' ? 'f' : 's',
      result: u.kind === 'function' ? u.decl.get(name)?.type ?? null : null,
      args: u.args.map((a) => [a, intent(u.decl.get(a)?.attrs ?? ''), u.decl.get(a)?.type ?? '?']),
    });
  }
  return { routines: out, kinds, constants };
}

export async function build() {
  const sources = await loadSources();
  const spec = source(sources, 'openmp-spec');
  const perVersion = {};
  for (const v of VERSIONS) {
    const html = (await fetchPinned('openmp-spec', spec.urls[v], { normalise: 'strip-scripts' })).toString('utf8');
    perVersion[v] = classify(contents(html));
  }
  const llvm = source(sources, 'llvm-openmp');
  const lib = ompLib((await fetchPinned('llvm-openmp', llvm.urls.omp_lib)).toString('utf8'));
  const licence = (await fetchPinned('llvm-openmp', llvm.urls.licence)).toString('utf8');

  const problems = [];
  // links: one page per version (null when absent) and the fragment, with per-version fragments where they differ
  const linkOf = (kind, name, fallback = null) => {
    const pages = VERSIONS.map((v) => perVersion[v][kind].get(name) ?? (fallback && fallback(v)) ?? null);
    if (!pages.some(Boolean)) return null;
    const frag = pages.find(Boolean).frag;
    const l = { p: pages.map((x) => x?.page ?? null), f: frag };
    const fv = {};
    VERSIONS.forEach((v, i) => {
      if (pages[i] && pages[i].frag !== frag) fv[v] = pages[i].frag;
    });
    if (Object.keys(fv).length) l.fv = fv;
    return l;
  };
  const names = (kind) => [...new Set(VERSIONS.flatMap((v) => [...perVersion[v][kind].keys()]))].sort();

  // directives: those of the contents pages (but not C/C++'s for), the compounds, and master
  const directives = {};
  const dirNames = names('directives').filter((n) => n !== 'for' && !/ for\b/.test(n));
  for (const n of [...dirNames, ...Object.keys(DIRECTIVE_HOMES), ...COMPOUNDS].filter((n, i, a) => a.indexOf(n) === i)) {
    const leaves = COMPOUNDS.includes(n) ? leafSplit(n, dirNames) : null;
    let l;
    if (leaves) {
      // a version has a compound when it has all its leaves; its link is the compound-names section
      const pages = VERSIONS.map((v) => (leaves.every((x) => perVersion[v].directives.has(x)) ? perVersion[v].compound : null));
      if (!pages.some(Boolean)) {
        // the master compounds left with master in 6.0; masked documents what replaced them
        if (n.includes('master')) l = linkOf('directives', DIRECTIVE_HOMES.master);
        else {
          problems.push(`compound ${n}: no version has all its leaves`);
          continue;
        }
      } else {
        const frag = pages.find(Boolean).frag;
        l = { p: pages.map((x) => x?.page ?? null), f: frag };
        const fv = {};
        VERSIONS.forEach((v, i) => {
          if (pages[i] && pages[i].frag !== frag) fv[v] = pages[i].frag;
        });
        if (Object.keys(fv).length) l.fv = fv;
      }
    } else {
      l = linkOf('directives', n) ?? (DIRECTIVE_HOMES[n] ? linkOf('directives', DIRECTIVE_HOMES[n]) : null);
    }
    const e = {};
    e.k = leaves ? 'compound' : 'directive';
    if (leaves) e.c = leaves;
    // the 6.x spelling, with underscores (target_data, begin declare_target)
    const raw = VERSIONS.map((v) => perVersion[v].directives.get(n)?.raw).find((r) => r && r.includes('_'));
    if (raw && raw !== n) e.u = raw;
    const tags = new Set();
    for (const leaf of leaves ?? [n]) for (const t of LEAF_TAGS[leaf] ?? []) tags.add(t);
    if (DEPRECATED[n] || VERSIONS.some((v) => perVersion[v].directives.get(n)?.deprecated)) tags.add('dep');
    if (tags.size) e.t = [...tags];
    if (SUMMARIES.directives[n]) e.s = SUMMARIES.directives[n];
    if (DEPRECATED[n]) e.dep = DEPRECATED[n];
    if (l) e.l = l;
    else problems.push(`directive ${n}: no link`);
    directives[n] = e;
  }

  const clauses = {};
  for (const n of names('clauses')) {
    const e = {};
    if (SUMMARIES.clauses[n]) e.s = SUMMARIES.clauses[n];
    const g = VERSIONS.map((v) => perVersion[v].clauses.get(n)?.group).find(Boolean);
    if (g) e.g = g.replace(/ Clauses$/, '');
    if (CLAUSE_SINCE[n]) e.since = CLAUSE_SINCE[n];
    e.l = linkOf('clauses', n);
    clauses[n] = e;
  }

  const routines = {};
  for (const n of names('routines')) {
    const e = {};
    const f = lib.routines.get(n);
    if (f) {
      if (f.kind === 'f') {
        e.k = 'f';
        if (f.result) e.r = f.result;
      }
      e.a = f.args;
    }
    if (SUMMARIES.routines[n]) e.s = SUMMARIES.routines[n];
    if (DEPRECATED[n] || VERSIONS.some((v) => perVersion[v].routines.get(n)?.deprecated)) e.t = ['dep'];
    if (DEPRECATED[n]) e.dep = DEPRECATED[n];
    e.l = linkOf('routines', n);
    routines[n] = e;
  }
  for (const n of lib.routines.keys()) if (!routines[n]) problems.push(`omp_lib routine ${n}: not in the contents of any version`);

  const env = {};
  for (const n of names('env')) {
    const e = {};
    if (SUMMARIES.env[n]) e.s = SUMMARIES.env[n];
    if (DEPRECATED[n] || VERSIONS.some((v) => perVersion[v].env.get(n)?.deprecated)) e.t = ['dep'];
    if (DEPRECATED[n]) e.dep = DEPRECATED[n];
    e.l = linkOf('env', n);
    env[n] = e;
  }

  // the kinds of omp_lib that the specification documents as OpenMP types, and those of data/openmp.mjs (the ones
  // LLVM's interfaces use without a section of their own); each is an integer kind parameter
  const types = {};
  for (const n of [...new Set([...names('types'), ...Object.keys(KINDS)])].sort()) {
    if (!lib.kinds.has(n)) {
      if (KINDS[n]) problems.push(`kind ${n}: not in omp_lib`);
      continue;
    }
    const e = {};
    if (KINDS[n]) e.s = KINDS[n];
    else problems.push(`kind ${n}: no one-liner in data/openmp.mjs`);
    const l = linkOf('types', n) ?? (KIND_HOMES[n] ? linkOf('types', KIND_HOMES[n]) : null);
    if (l) e.l = l;
    if (DEPRECATED[n]) {
      e.t = ['dep'];
      e.dep = DEPRECATED[n];
    }
    types[n] = e;
  }

  // named constants of omp_lib, linked through their kind's type section; the allocator-trait keys and values
  // (omp_atk_*, omp_atv_*) and the interop runtime IDs (omp_ifr_*) only matter inside those APIs and are left out
  const constants = {};
  for (const [n, kind] of [...lib.constants].sort(([a], [b]) => a.localeCompare(b))) {
    if (/^omp_(?:atk|atv|ifr)_/.test(n)) continue;
    const e = { ty: `integer(${kind})` };
    if (types[kind]) e.l = types[kind].l;
    if (DEPRECATED[n]) {
      e.t = ['dep'];
      e.dep = DEPRECATED[n];
    }
    constants[n] = e;
  }

  for (const [kind, map] of Object.entries(SUMMARIES)) {
    const target = { directives, clauses, routines, env }[kind];
    for (const n of Object.keys(map)) if (!target[n]) problems.push(`summary for ${kind} ${n}: no such entry`);
  }
  const marked = [directives, routines, env, types, constants];
  for (const n of Object.keys(DEPRECATED)) {
    if (!marked.some((m) => m[n])) problems.push(`deprecated ${n}: no such entry`);
  }

  const out = {
    format: 1,
    id: 'openmp',
    title: 'OpenMP',
    version: '6.1',
    versions: VERSIONS,
    sources: ['openmp-spec', 'llvm-openmp'],
    legend: {
      kinds: { directive: 'directive or construct', compound: 'compound construct (c lists its leaves)', f: 'function', s: 'subroutine (routines’ default)' },
      intents: { i: 'in (VALUE arguments)', o: 'out', b: 'inout', '': 'not stated in omp_lib' },
      tags: { ...DIRECTIVE_TAGS },
      fields: {
        k: 'kind',
        c: 'the leaf constructs of a compound',
        u: 'the 6.x spelling with underscores (directive names are keyed with blanks)',
        s: 'our own one-line summary (the most used items only)',
        t: 'tags',
        dep: 'the version that deprecated it',
        since: 'the version that added it, when no contents page lists it',
        g: 'the clause group whose section documents it',
        ty: 'the type of a named constant',
        r: 'function result type (from LLVM’s omp_lib)',
        a: 'arguments (from LLVM’s omp_lib): [name, intent, type]',
        l: 'link: p holds the page of each version in `versions` order (null: not in that version), f the fragment, fv the fragments that differ by version',
      },
      keys: 'directive names are lower case with blanks (target data, declare simd); clauses, routines, kinds and constants lower case; environment variables upper case',
      types:
        'the kinds of omp_lib: integer kind parameters (integer, parameter), so integer(omp_lock_kind) declares a ' +
        'lock; not derived types. The specification calls them OpenMP types; omp_integer_kind and ' +
        'omp_logical_kind are LLVM’s, and omp_lock_hint_kind links to the section of omp_sync_hint_kind',
      constants: 'the named constants of omp_lib, with their type (ty) and the link of their kind; the allocator-trait keys and values (omp_atk_*, omp_atv_*) and interop runtime IDs (omp_ifr_*) are left out',
    },
    links: {
      spec: { base: 'https://www.openmp.org/spec-html/{version}/', page: 'openmp{p}.html#{f}', default: '5.2' },
      libgomp: { base: 'https://gcc.gnu.org/onlinedocs/libgomp/', page: '{name}.html', rule: 'routines and environment variables; _ is written _005f (omp_get_thread_num → omp_005fget_005fthread_005fnum)' },
    },
    directives,
    clauses,
    routines,
    env,
    types,
    constants,
  };
  const text = formatRegistry(out, ['directives', 'clauses', 'routines', 'env', 'types', 'constants']);
  const bytes = await writeRegistry('openmp.json', text);
  const count = (o) => Object.keys(o).length;
  const stats = {
    entries: count(directives) + count(clauses) + count(routines) + count(env) + count(types) + count(constants),
    directives: count(directives),
    compounds: Object.values(directives).filter((e) => e.k === 'compound').length,
    clauses: count(clauses),
    routines: count(routines),
    withInterface: Object.values(routines).filter((e) => e.a).length,
    env: count(env),
    types: count(types),
    constants: count(constants),
    summaries: [directives, clauses, routines, env].reduce((n, o) => n + Object.values(o).filter((e) => e.s).length, 0),
    perVersion: Object.fromEntries(VERSIONS.map((v) => [v, Object.fromEntries(['directives', 'clauses', 'routines', 'env', 'types'].map((k) => [k, perVersion[v][k].size]))])),
    problems,
    bytes,
  };
  return { file: 'openmp.json', bytes, stats, licence };
}

/** Splits a compound name into leaves, longest first (target teams distribute parallel do → target, teams, …). */
function leafSplit(name, leaves) {
  const words = name.split(' ');
  const out = [];
  let i = 0;
  while (i < words.length) {
    let found = null;
    for (let j = words.length; j > i; j--) {
      const cand = words.slice(i, j).join(' ');
      if (leaves.includes(cand) || cand === 'master') {
        found = cand;
        i = j;
        break;
      }
    }
    if (!found) return null;
    out.push(found);
  }
  return out;
}

if (isMain(import.meta.url)) {
  const { stats } = await build();
  await saveLock();
  console.log(JSON.stringify(stats, null, 2));
}
