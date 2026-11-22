// Builds registry/mpi.json: the MPI 5.0 procedures callable from Fortran, with MPI 4.1 as an alias (procedures new
// in 5.0 are marked), their callback interfaces and predefined callbacks.
//
//   node scripts/registry/mpi.mjs [--refresh]
//
// Sources: Open MPI's API catalogue (names, categories, mpi_f08 arguments) and the man pages of Open MPI 5.0.11
// (summaries), Open MPI's Fortran callback interfaces and handle types, the MPI ABI stubs (to check the catalogue and
// the handle types against MPI 5.0), and the contents and function indexes of the MPI 5.0 and 4.1 standards (which
// page defines each procedure or describes each type; no text).
import { CALLBACKS, COLLECTIVE, COLLECTIVE_IO, DEPRECATED, TYPES } from './data/mpi.mjs';
import { statements } from './fortran.mjs';
import {
  clip,
  correct,
  fetchPinned,
  formatRegistry,
  isMain,
  loadSources,
  mode,
  pool,
  readTarGz,
  saveLock,
  source,
  squash,
  SUMMARY_MAX,
  writeRegistry,
} from './lib.mjs';

const MPICH_VERSION = 'v5.0.2';
// Open MPI's Sphinx configuration, whose rst_prolog defines the substitutions its man pages use (|mdash|, …)
const DOCS_CONF = 'docs/conf.py';

/**
 * Slips in Open MPI's man-page summaries (as rstSummary gives them), corrected here: procedure → [[text, replacement],
 * …] (see correct in lib.mjs; registry/SOURCES.md lists them). The pages of 5.0.11 and of the main branch say "for use
 * in in", and the main branch's leave out a blank before the parenthesis.
 */
export const CORRECTIONS = {
  MPI_Buffer_detach: [['for use in in', 'for use in']],
  MPI_Comm_detach_buffer: [['communicator(for use in in', 'communicator (for use in']],
  MPI_Session_detach_buffer: [['session(for use in in', 'session (for use in']],
};

// Open MPI's definitions of the mpi_f08 types, and its named constants of them (the null handles among them)
const F08_TYPES = 'ompi/mpi/fortran/use-mpi/mpi-types.F90.in';
const F08_HANDLES = 'ompi/mpi/fortran/use-mpi-f08/mod/mpi-f08-types.F90';
// the sections of the standard that describe the handles, and the status
const HANDLES_SECTION = 'Opaque Objects';
const STATUS_SECTION = 'Return Status';
const DIRECTION = { in: 'i', out: 'o', inout: 'b' };

/** Splits at top-level commas. */
function splitTop(s) {
  const out = [];
  let depth = 0;
  let cur = '';
  for (const c of s) {
    if (c === '(') depth++;
    if (c === ')') depth--;
    if (c === ',' && !depth) {
      out.push(cur.trim());
      cur = '';
    } else cur += c;
  }
  if (cur.trim()) out.push(cur.trim());
  return out;
}

/** A Fortran type spec, compact: INTEGER(KIND=MPI_ADDRESS_KIND) → integer(MPI_ADDRESS_KIND), TYPE(MPI_Comm) kept. */
export function fortranType(spec) {
  const s = spec.trim().replace(/\s+/g, ' ');
  if (/^<type>$/i.test(s)) return 'type(*)';
  const m = /^(\w+(?: precision)?)\s*(?:\((.*)\))?(?:\s*\*\s*(\w+))?$/i.exec(s);
  if (!m) return s.toLowerCase();
  const base = m[1].toLowerCase();
  let arg = m[2]?.replace(/^\s*(?:kind|len)\s*=\s*/i, '').trim();
  if (base === 'type' || base === 'class' || base === 'procedure') return `${base}(${/^c_/i.test(arg) ? arg.toLowerCase() : arg})`;
  if (m[3]) arg = m[3];
  return arg ? `${base}(${arg})` : base;
}

/** The header of a Fortran binding as Open MPI prints it: { result, names } (`DOUBLE PRECISION MPI_Wtime()`). */
export function parseBinding(signature) {
  const first = signature.split('\n')[0].trim();
  const head = /^(?:(.*?)\s+)?(P?MPI_\w+)\s*\(([^)]*)\)\s*$/i.exec(first);
  if (!head) throw new Error(`unreadable binding: ${first}`);
  return { result: head[1] ? fortranType(head[1]) : null, names: splitTop(head[3]).map((n) => n.toLowerCase()) };
}

/**
 * The substitutions of a Sphinx rst_prolog (`.. |mdash| unicode:: U+02014`, `.. |deprecated_favor| replace:: this
 * routine is deprecated in favor of`): name → text. Those whose text comes from the configuration's variables
 * ({ompi_ver}) are left out. The configuration is read as text, never run.
 */
export function rstSubstitutions(conf) {
  const out = new Map();
  for (const m of conf.matchAll(/^\.\.\s+\|(\w+)\|\s+(unicode|replace)::\s+(.*?)\s*$/gm)) {
    if (m[2] === 'unicode') {
      const code = /^U\+([0-9A-Fa-f]{4,6})\b/.exec(m[3]);
      if (code) out.set(m[1], String.fromCodePoint(parseInt(code[1], 16)));
    } else if (!/[{}]/.test(m[3])) out.set(m[1], m[3]);
  }
  return out;
}

/**
 * The summary of an Open MPI man page (`:ref:`MPI_Send` |mdash| Performs …` or `… - Combines …`), as plain text: with
 * the roles, literals and emphasis of RST taken off, the substitutions `subs` expanded (|mdash|, |deprecated_favor|)
 * and its escapes undone (`*n*\ th` is "nth": an escaped blank is no blank).
 */
export function rstSummary(text, subs = new Map()) {
  const body = text.split('.. include_body')[1] ?? '';
  // `:ref:`MPI_Send` |mdash| …`, or a literal block `::` with `MPI_Lookup_name - …`
  const para = body.split(/\n\s*\n/).map((p) => p.trim()).find((p) => /^(?::ref:`|MPI_\w+\s+-\s)/.test(p));
  if (!para) return null;
  const m = /^(?:(?::ref:`[^`]+`|MPI_\w+)[\s,]*)+(?:\|mdash\||-|—)\s*([\s\S]*)$/.exec(para);
  if (!m) return null;
  const plain = m[1]
    .replace(/:ref:`([^`<]+?)(?:\s*<[^>]+>)?`/g, '$1')
    .replace(/``([^`]+)``/g, '$1')
    .replace(/(?<!\\)\*\*([^*]+)\*\*/g, '$1')
    .replace(/(?<!\\)\*([^*]+)\*/g, '$1')
    .replace(/\|(\w+)\|/g, (all, name) => subs.get(name) ?? all)
    .replace(/\\(\s|.)/g, (all, c) => (/\s/.test(c) ? '' : c));
  return squash(plain);
}

/** The page an Open MPI man page includes, when it is a stub (`.. include:: ../man3/MPI_Allreduce.3.rst`). */
const rstInclude = (text) => /\.\.\s+include::\s+(?:\.\.\/man3\/|\.\/)?(\w+)\.3\.rst/.exec(text)?.[1] ?? null;

/** Function index of an MPI standard: upper-case name → node numbers. */
function functionIndex(html) {
  const out = new Map();
  for (const part of html.split(/<li>/i).slice(1)) {
    const m = /^\s*:?([A-Za-z]\w*):/.exec(part);
    if (!m) continue;
    const nodes = [...part.matchAll(/href="node(\d+)\.htm/g)].map((x) => Number(x[1]));
    const key = m[1].toUpperCase();
    out.set(key, [...new Set([...(out.get(key) ?? []), ...nodes])]);
  }
  return out;
}

/** The contents page of an MPI standard: page → title path of its section, and title path → page. */
function contentsPaths(html) {
  const byPage = new Map();
  const byPath = new Map();
  const stack = [];
  let last = null;
  for (const m of html.matchAll(/<ul>|<\/ul>|<li><a href="node(\d+)\.htm#Node(\d+)">([\s\S]*?)<\/a>/gi)) {
    if (/^<ul>$/i.test(m[0])) {
      stack.push(last);
      continue;
    }
    if (/^<\/ul>$/i.test(m[0])) {
      stack.pop();
      continue;
    }
    const title = squash(m[3].replace(/<[^>]+>/g, ''));
    last = title;
    const path = [...stack.filter(Boolean), title].join(' > ');
    if (m[1] === m[2] && !byPage.has(Number(m[1]))) byPage.set(Number(m[1]), path);
    if (!byPath.has(path)) byPath.set(path, Number(m[1]));
  }
  // the pages that exist: a subsection may share its parent's page (node64.htm#Node65)
  const pages = new Set([...html.matchAll(/href="node(\d+)\.htm/gi)].map((m) => Number(m[1])));
  return { byPage, byPath, pages };
}

/**
 * For each procedure, the first page (before the annexes) whose binding box starts with its name. The pages to try
 * come from the function index; `hints` (name → section title path) adds the page of the same section, since the
 * 4.1 index leaves most definitions out. Every page found is checked for the binding.
 */
async function definitionNodes(src, version, names, hints = new Map(), reference = new Map()) {
  const idx = functionIndex((await fetchPinned('mpi-standard', src.urls[`index-${version}`])).toString('latin1'));
  const contents = (await fetchPinned('mpi-standard', src.urls[`contents-${version}`])).toString('latin1');
  const annex = Number(/href="node(\d+)\.htm[^"]*"[^>]*>\s*Language Bindings Summary/.exec(contents)?.[1]);
  if (!annex) throw new Error(`MPI ${version}: no Language Bindings Summary in the contents`);
  const toc = contentsPaths(contents);
  const wanted = new Map();
  for (const name of names) {
    const nodes = new Set((idx.get(name.toUpperCase()) ?? []).filter((n) => n < annex));
    const hinted = hints.has(name) ? toc.byPath.get(hints.get(name)) : null;
    if (hinted) for (const n of [hinted, hinted + 1, hinted - 1]) if (toc.pages.has(n) && n < annex) nodes.add(n);
    if (nodes.size) wanted.set(name, [...nodes].sort((a, b) => a - b));
  }
  const pages = [...new Set([...wanted.values()].flat())].sort((a, b) => a - b);
  const html = new Map();
  await pool(pages, 6, async (n) => {
    const buf = await fetchPinned('mpi-standard', src.urls[`node-${version}`].replace('{n}', n));
    html.set(n, buf.toString('latin1'));
  });
  const out = new Map();
  const paths = new Map();
  // the binding box starts with the name and its arguments; 4.1 draws a box without arguments as an image, but its
  // C binding follows as text
  const binding = (name) => new RegExp(`COLSPAN=2>\\s*${name}\\s*(?:\\(|<)|C binding</b><br>\\s*<tt>\\s*[\\w ]+?\\b${name}\\s*\\(`, 'i');
  for (const [name, nodes] of wanted) {
    const hit = nodes.find((n) => binding(name).test(html.get(n)));
    if (hit) out.set(name, hit);
  }
  // Sections renamed between versions: predict the page from the nearest procedure already found (by its page in
  // the reference version), and try the pages around the prediction.
  const pairs = [...out].filter(([n]) => reference.has(n)).map(([n, p]) => [reference.get(n), p]).sort((a, b) => a[0] - b[0]);
  const late = new Map();
  for (const name of names) {
    if (out.has(name) || !reference.has(name) || !pairs.length) continue;
    const ref = reference.get(name);
    const [r0, p0] = pairs.reduce((best, pair) => (Math.abs(pair[0] - ref) < Math.abs(best[0] - ref) ? pair : best));
    const guess = ref + (p0 - r0);
    const nodes = [0, 1, -1, 2, -2, 3, -3].map((d) => guess + d).filter((n) => toc.pages.has(n) && n < annex);
    if (nodes.length) late.set(name, nodes);
  }
  const more = [...new Set([...late.values()].flat())].filter((n) => !html.has(n));
  await pool(more, 6, async (n) => {
    html.set(n, (await fetchPinned('mpi-standard', src.urls[`node-${version}`].replace('{n}', n))).toString('latin1'));
  });
  for (const [name, nodes] of late) {
    const hit = nodes.find((n) => binding(name).test(html.get(n)));
    if (hit) out.set(name, hit);
  }
  // Chapters that moved (MPI_Init, MPI_Wtime): read every remaining page before the annexes, once.
  const left = names.filter((n) => !out.has(n) && reference.has(n) && idx.has(n.toUpperCase()));
  let rest = [];
  if (left.length) {
    rest = [...toc.pages].filter((n) => n < annex && !html.has(n)).sort((a, b) => a - b);
    await pool(rest, 6, async (n) => {
      html.set(n, (await fetchPinned('mpi-standard', src.urls[`node-${version}`].replace('{n}', n))).toString('latin1'));
    });
    for (const name of left) {
      const hit = [...html.keys()].sort((a, b) => a - b).find((n) => n < annex && binding(name).test(html.get(n)));
      if (hit) out.set(name, hit);
    }
  }
  for (const [name, n] of out) if (toc.byPage.has(n)) paths.set(name, toc.byPage.get(n));
  return { nodes: out, paths, names: new Set(idx.keys()), pages: pages.length + more.length + rest.length };
}

/**
 * The derived types of Open MPI's module mpi_types (ompi/mpi/fortran/use-mpi/mpi-types.F90.in), which mpi_f08 uses:
 * name → public components [[name, type]]. A private component (MPI_Status's padding) is no part of the interface.
 */
export function derivedTypes(text) {
  const out = new Map();
  let cur = null;
  for (const st of statements(text, { free: true })) {
    const h = /^type\s*,\s*bind\s*\(\s*c\s*\)\s*::\s*(\w+)$/i.exec(st.text);
    if (h) {
      cur = [];
      out.set(h[1], cur);
    } else if (/^end\s*type\b/i.test(st.text)) cur = null;
    else if (cur) {
      const d = /^(integer|logical|real|double precision)\s*(\w+)?\s*::\s*(.*)$/i.exec(st.text);
      if (d && !d[2]) for (const n of splitTop(d[3])) cur.push([n.replace(/\(.*$/, ''), d[1].toLowerCase()]);
    }
  }
  return out;
}

/** The page of the section of a standard's contents page with this title, when exactly one has it. */
function sectionNode(contents, title) {
  const hits = [...contentsPaths(contents).byPath].filter(([path]) => path.split(' > ').pop() === title);
  return hits.length === 1 ? hits[0][1] : null;
}

/** Units of Open MPI's Fortran callback sources: name → { args: [[name, '', type]] }. */
function callbackUnits(text) {
  const out = new Map();
  let unit = null;
  for (const st of statements(text, { free: true })) {
    const h = /^(?:recursive\s+)?(subroutine|function)\s+(\w+)\s*\(([^)]*)\)/i.exec(st.text);
    if (h) {
      unit = { name: h[2], args: splitTop(h[3]).map((a) => a.toLowerCase()), types: new Map() };
      continue;
    }
    if (!unit) continue;
    if (/^end\s*(subroutine|function)?\b/i.test(st.text) && !/^end\s*interface/i.test(st.text)) {
      out.set(unit.name.toUpperCase(), unit);
      unit = null;
      continue;
    }
    const d = /^(type\s*\(\s*\w+\s*\)|integer(?:\s*\(\s*kind\s*=\s*\w+\s*\))?|logical|character(?:\s*\(\s*len\s*=\s*[\w*]+\s*\))?|real|double precision)\s*(?:,\s*([^:]*))?::\s*(.*)$/i.exec(st.text);
    if (!d) continue;
    for (const ent of splitTop(d[3])) {
      const em = /^(\w+)\s*(\(.*\))?/.exec(ent);
      if (em) unit.types.set(em[1].toLowerCase(), fortranType(d[1]) + (em[2] ?? '').replace(/\s+/g, '').toLowerCase());
    }
  }
  return out;
}

export async function build() {
  const sources = await loadSources();
  const catalogue = (await fetchPinned('openmpi-api', source(sources, 'openmpi-api').urls.jsonl)).toString('utf8');
  const records = catalogue.split('\n').filter((l) => l.trim()).map((l) => JSON.parse(l));
  const docset = records[0]?.docset?.ompi_version ?? '?';
  const fortran = records.filter((r) => r.languages.some((l) => l.startsWith('fortran')) && /^MPI_/.test(r.name));

  const ompiSrc = source(sources, 'openmpi');
  const tar = readTarGz(await fetchPinned('openmpi', ompiSrc.urls.tarball), (p) =>
    /^docs\/man-openmpi\/man3\/\w+\.3\.rst$/.test(p) ||
    /^ompi\/mpi\/fortran\/use-mpi-f08\/mod\/mpi-f08-(interfaces-)?callbacks\.F90$/.test(p) ||
    p === 'ompi/mpi/fortran/base/attr-fn-int-callback-interfaces.h' ||
    p === F08_TYPES ||
    p === F08_HANDLES ||
    p === DOCS_CONF ||
    p === 'LICENSE',
  );
  const pages = new Map();
  for (const [p, b] of tar) {
    const m = /^docs\/man-openmpi\/man3\/(\w+)\.3\.rst$/.exec(p);
    if (m) pages.set(m[1], b.toString('utf8'));
  }
  // the substitutions of 5.0.11's pages, which the main branch's use too
  const subs = rstSubstitutions(tar.get(DOCS_CONF).toString('utf8'));
  const summaryOf = (name, seen = new Set()) => {
    const text = pages.get(name);
    if (!text || seen.has(name)) return null;
    seen.add(name);
    const inc = rstInclude(text);
    return inc && inc !== name ? summaryOf(inc, seen) : rstSummary(text, subs);
  };

  // MPI 5.0 as the ABI stubs declare it: every Fortran-callable procedure of the catalogue should be there
  const abiSrc = source(sources, 'mpi-abi-stubs');
  const abi = readTarGz(await fetchPinned('mpi-abi-stubs', abiSrc.urls.tarball), (p) => p === 'mpi.h' || p === 'LICENSE.md');
  const mpiH = abi.get('mpi.h').toString('utf8');
  const abiNames = new Set([...mpiH.matchAll(/\b(MPI_\w+)\s*\(/g)].map((m) => m[1]));
  for (const m of mpiH.matchAll(/typedef\s+\w+\s*\(\s*(MPI_\w+)\s*\)/g)) abiNames.add(m[1]);
  for (const m of mpiH.matchAll(/#define\s+(MPI_\w+_FN\w*)\s/g)) abiNames.add(m[1]);

  // the standard: definition pages and which procedures are new in 5.0
  const std = source(sources, 'mpi-standard');
  const names = fortran.map((r) => r.name);
  const s50 = await definitionNodes(std, '5.0', names);
  const s41 = await definitionNodes(std, '4.1', names, s50.paths, s50.nodes);

  // summaries missing from 5.0.x come from the development branch's man pages, pinned to a commit
  const mainSrc = source(sources, 'openmpi-main');
  const mainSummaries = new Map();
  const missing = fortran.filter((r) => !summaryOf(r.name)).map((r) => r.name);
  await pool(missing, 4, async (name) => {
    const get = async (n) => (await fetchPinned('openmpi-main', mainSrc.urls.rst.replace('{name}', n))).toString('utf8');
    let text = await get(name);
    const inc = rstInclude(text);
    if (inc && inc !== name) text = await get(inc);
    const s = rstSummary(text, subs);
    if (s) mainSummaries.set(name, s);
  });

  const collective = new Set(COLLECTIVE);
  const entries = {};
  const problems = [];
  for (const r of fortran.sort((a, b) => a.name.localeCompare(b.name))) {
    const f08 = r.bindings.find((b) => b.language === 'fortran_mpi_f08' && !b.large_count);
    const binding = f08 ?? r.bindings.find((b) => b.language === 'fortran_use_mpi') ?? r.bindings.find((b) => b.language === 'fortran_mpifh');
    const parsed = parseBinding(binding.signature);
    const types = new Map();
    for (const line of binding.signature.split('\n').slice(1)) {
      for (const [n, v] of parseArgsLine(line)) types.set(n, v);
    }
    // the binding's own header decides which parameters it has (no varargs, no large-count-only ones)
    const meta = new Map(binding.parameters.map((p) => [p.name.toLowerCase(), p]));
    const args = parsed.names.map((n) => {
      const p = meta.get(n) ?? { name: n, direction: '', optional: false };
      const t = types.get(n);
      const arg = [n, DIRECTION[p.direction] ?? '', t?.type ?? '?'];
      const flags = `${p.optional === true ? '?' : ''}${t?.attrs.includes('asynchronous') ? 'a' : ''}`;
      if (flags) arg.push(flags);
      return arg;
    });
    for (const a of args) if (!meta.has(a[0])) problems.push(`${r.name}: ${a[0]} is not in the catalogue's parameters`);
    const tags = [];
    if (r.category === 'collective' || collective.has(r.name) || COLLECTIVE_IO.test(r.name)) tags.push('coll');
    if (r.category === 'point-to-point') tags.push('p2p');
    const request = args.find((a) => a[0] === 'request' && a[1] === 'o');
    if (request && /_init$/.test(r.name)) tags.push('pers');
    else if (request) tags.push('nb');
    if (f08 && f08.parameters.some((p) => p.name === 'ierror' && p.optional === true)) tags.push('ierr');
    if (r.bindings.some((b) => b.language === 'fortran_mpi_f08' && b.large_count)) tags.push('lc');
    if (r.kind === 'deprecated' || DEPRECATED.has(r.name)) tags.push('dep');
    const e = {};
    if (parsed.result) {
      e.k = 'f';
      e.r = parsed.result;
    }
    e.c = r.category;
    const summary = summaryOf(r.name) ?? mainSummaries.get(r.name);
    if (summary) e.s = clip(correct(CORRECTIONS, r.name, summary, problems), SUMMARY_MAX);
    else problems.push(`${r.name}: no summary`);
    e.a = args;
    if (tags.length) e.t = tags;
    if (!f08) e.f08 = 0;
    if (!pages.has(r.name)) e.o = 0;
    const n50 = s50.nodes.get(r.name) ?? null;
    const n41 = s41.nodes.get(r.name) ?? null;
    if (n50 || n41) e.std = [n50, n41];
    // new in 5.0: neither a definition page nor an entry in 4.1 (whose HTML index leaves out many procedures)
    if (!n41 && !s41.names.has(r.name.toUpperCase())) e.since = '5.0';
    if (!abiNames.has(r.name) && !tags.includes('dep') && !/^MPI_(?:F_sync_reg|Sizeof|Status_f2f08|Status_f082f)$/.test(r.name)) {
      problems.push(`${r.name}: not in the MPI 5.0 ABI stubs`);
    }
    entries[r.name] = e;
  }

  // callback interfaces and predefined callbacks, from Open MPI's Fortran sources: mpi_f08's, else (for the deprecated
  // predefined callbacks, which mpi_f08 lacks) those of the old `use mpi` interface
  const cbText = (re) => [...tar].filter(([p]) => re.test(p)).map(([, b]) => b.toString('utf8')).join('\n');
  const f08Units = callbackUnits(cbText(/use-mpi-f08\/mod\/mpi-f08-(interfaces-)?callbacks\.F90$/));
  const oldUnits = callbackUnits(cbText(/attr-fn-int-callback-interfaces\.h$/));
  for (const [name, [summary, see]] of Object.entries(CALLBACKS)) {
    const u = f08Units.get(name.toUpperCase()) ?? oldUnits.get(name.toUpperCase());
    if (!u) {
      problems.push(`${name}: no Fortran interface in Open MPI`);
      continue;
    }
    const predefined = /_FN(_NULL)?$|_FN$/.test(name) || name === 'MPI_CONVERSION_FN_NULL';
    entries[name] = {
      k: predefined ? 'pf' : 'cb',
      c: 'callback',
      s: summary,
      a: u.args.map((a) => [a, '', u.types.get(a) ?? '?']),
      see,
      ...(/Deprecated/.test(summary) ? { t: ['dep'] } : {}),
      ...(abiNames.has(name) ? {} : { abi: 0 }),
    };
  }

  // The derived types of mpi_f08 that the arguments use: the handle types and MPI_Status. Their public components come
  // from Open MPI, their null handles from the ABI stubs' mpi.h (checked against Open MPI's), the type `use mpi` and
  // mpif.h declare them with from the catalogue (the same argument in that binding), and their pages from the contents
  // of each standard (checked against the pages).
  const typeOf = (t) => /^type\((MPI_\w+)\)/.exec(t)?.[1];
  const used = [...new Set(Object.values(entries).flatMap((e) => e.a.map((a) => typeOf(a[2]))))].filter(Boolean).sort();
  const defs = derivedTypes(tar.get(F08_TYPES).toString('utf8'));
  const handleTypedef = /typedef\s+struct\s+MPI_ABI_\w+\s*\*\s*(MPI_\w+)\s*;/g;
  const abiHandles = new Set([...mpiH.matchAll(handleTypedef)].map((m) => m[1]));
  const abiNull = new Map([...mpiH.matchAll(/#define\s+(MPI_\w+_NULL)\s+\(\((MPI_\w+)\)/g)].map((m) => [m[2], m[1]]));
  const ompiNull = new Map();
  for (const st of statements(tar.get(F08_HANDLES).toString('utf8'), { free: true })) {
    const m = /^type\s*\(\s*(MPI_\w+)\s*\)\s*,\s*parameter\s*::\s*(MPI_\w+_NULL)\b/i.exec(st.text);
    if (!m) continue;
    if (ompiNull.has(m[1])) problems.push(`${m[1]}: two null handles in Open MPI, ${ompiNull.get(m[1])} and ${m[2]}`);
    ompiNull.set(m[1], m[2]);
  }
  const legacy = new Map();
  const declared = (b) => new Map(b.signature.split('\n').slice(1).flatMap((line) => [...parseArgsLine(line)]));
  for (const r of fortran) {
    const f08 = r.bindings.find((b) => b.language === 'fortran_mpi_f08' && !b.large_count);
    const old = r.bindings.find((b) => b.language === 'fortran_use_mpi');
    if (!f08 || !old) continue;
    const oldTypes = declared(old);
    for (const [n, t] of declared(f08)) {
      const type = /^type\((MPI_\w+)\)$/.exec(t.type)?.[1];
      const o = oldTypes.get(n);
      if (!type || !o) continue;
      // integer, dimension(MPI_STATUS_SIZE): integer(MPI_STATUS_SIZE) would read as a kind
      const form = o.dims ? `${o.base}, dimension${o.dims.replace(/\bmpi_\w+/gi, (x) => x.toUpperCase())}` : o.base;
      legacy.set(type, [...(legacy.get(type) ?? []), form]);
    }
  }
  const sections = {};
  for (const v of ['5.0', '4.1']) {
    const contents = (await fetchPinned('mpi-standard', std.urls[`contents-${v}`])).toString('latin1');
    sections[v] = {};
    for (const [title, mark] of [[HANDLES_SECTION, 'MPI_VAL'], [STATUS_SECTION, 'MPI_Status']]) {
      const n = sectionNode(contents, title);
      const page = n && (await fetchPinned('mpi-standard', std.urls[`node-${v}`].replace('{n}', n))).toString('latin1');
      if (!page || !page.includes(mark)) problems.push(`MPI ${v}: the section "${title}" (page ${n}) lacks ${mark}`);
      sections[v][title] = n;
    }
  }
  const types = {};
  for (const name of used) {
    const e = {};
    if (TYPES[name]) e.s = TYPES[name];
    else problems.push(`type ${name}: no one-liner in data/mpi.mjs`);
    if (defs.get(name)?.length) e.c = defs.get(name);
    else problems.push(`type ${name}: not defined in Open MPI's ${F08_TYPES}`);
    const old = mode(legacy.get(name) ?? []);
    if (old) e.old = old;
    else problems.push(`type ${name}: no \`use mpi\` binding declares it`);
    if (name !== 'MPI_Status') {
      const [abi, ompi] = [abiNull.get(name), ompiNull.get(name)];
      if (!abiHandles.has(name)) problems.push(`type ${name}: not a handle type of the MPI 5.0 ABI`);
      if (abi && abi === ompi) e.n = abi;
      else problems.push(`type ${name}: null handle ${abi} in mpi.h, ${ompi} in Open MPI`);
    }
    const section = name === 'MPI_Status' ? STATUS_SECTION : HANDLES_SECTION;
    e.std = [sections['5.0'][section], sections['4.1'][section]];
    types[name] = e;
  }
  for (const name of Object.keys(TYPES)) {
    if (!types[name]) problems.push(`type ${name}: in data/mpi.mjs, but no argument uses it`);
  }

  const out = {
    format: 1,
    id: 'mpi',
    title: 'MPI',
    version: '5.0',
    aliases: { '4.1': 'the same procedures; those marked since 5.0 are not in MPI 4.1' },
    sources: ['openmpi-api', 'openmpi', 'openmpi-main', 'mpi-abi-stubs', 'mpi-standard'],
    catalogue: docset,
    legend: {
      kinds: { s: 'subroutine (the default)', f: 'function', cb: 'callback interface (abstract interface in mpi_f08)', pf: 'predefined callback procedure' },
      intents: { i: 'in', o: 'out', b: 'inout', '': 'not stated' },
      flags: { '?': 'optional', a: 'asynchronous' },
      tags: {
        coll: 'collective: every process of the communicator (group, window or file) must call it',
        p2p: 'point-to-point communication',
        nb: 'nonblocking: returns a request to complete with MPI_Wait or MPI_Test',
        pers: 'persistent: creates a request to start with MPI_Start and complete with MPI_Wait or MPI_Test',
        ierr: 'in mpi_f08, ierror is optional (in mpi and mpif.h it is required)',
        lc: 'mpi_f08 also has a large-count form, with integer(MPI_COUNT_KIND) counts',
        dep: 'deprecated',
      },
      sections: {
        entries: 'procedures, callback interfaces and predefined callbacks',
        types: 'the derived types of mpi_f08 that the arguments use: the handle types and MPI_Status',
      },
      fields: {
        k: 'kind, when it is not s',
        r: 'function result type',
        c: 'category, as Open MPI files it',
        s: 'summary',
        a: 'arguments of the mpi_f08 binding (or of `use mpi`, when f08 is 0): [name, intent, type, flags]',
        t: 'hint tags',
        f08: '0: not in mpi_f08',
        o: '0: no page in the Open MPI 5.0.x documentation (link to its main branch instead)',
        std: 'page numbers of the definition in the MPI 5.0 and 4.1 standards (null: none found)',
        since: 'the MPI version that added it, when that is 5.0',
        see: 'the procedure that takes this callback',
        abi: '0: not in the MPI 5.0 ABI',
      },
      typeFields: {
        s: 'our own one-line summary',
        c: 'public components of the derived type: [name, type] (a handle has one, MPI_VAL, the integer handle of mpi)',
        old: 'the type `use mpi` and mpif.h declare it with',
        n: 'the null handle',
        std: 'pages of the section that describes it in the MPI 5.0 and 4.1 standards (Opaque Objects; Return Status)',
      },
    },
    modules: {
      mpi_f08: { note: 'Fortran 2008 bindings; ierror is optional; handles are derived types (type(MPI_Comm))' },
      mpi: { note: 'Fortran 90 bindings; handles are integers' },
      'mpif.h': { note: 'deprecated since MPI 4.1; use mpi_f08 (or mpi)', deprecated: '4.1', link: 'https://www.mpi-forum.org/docs/mpi-5.0/mpi50-report/node449.htm' },
    },
    links: {
      openmpi: { base: 'https://docs.open-mpi.org/en/v5.0.x/man-openmpi/man3/', page: '{name}.3.html', fallback: 'https://docs.open-mpi.org/en/main/man-openmpi/man3/{name}.3.html' },
      mpich: { base: `https://www.mpich.org/static/docs/${MPICH_VERSION}/www3/`, page: '{name}.html', note: 'MPICH answers scripts with 403' },
      standard: {
        '5.0': 'https://www.mpi-forum.org/docs/mpi-5.0/mpi50-report/node{std[0]}.htm',
        '4.1': 'https://www.mpi-forum.org/docs/mpi-4.1/mpi41-report/node{std[1]}.htm',
        index: { '5.0': 'https://www.mpi-forum.org/docs/mpi-5.0/mpi50-report/node632.htm', '4.1': 'https://www.mpi-forum.org/docs/mpi-4.1/mpi41-report/node606.htm' },
      },
    },
    entries: Object.fromEntries(Object.keys(entries).sort((a, b) => a.localeCompare(b)).map((k) => [k, entries[k]])),
    types,
  };
  const text = formatRegistry(out, ['entries', 'types']);
  const bytes = await writeRegistry('mpi.json', text);
  const all = Object.values(entries);
  const stats = {
    entries: all.length + Object.keys(types).length,
    procedures: fortran.length,
    types: Object.keys(types).length,
    callbacks: all.filter((e) => e.k === 'cb' || e.k === 'pf').length,
    withSummary: all.filter((e) => e.s).length,
    fromMain: mainSummaries.size,
    noOpenMPI50Page: all.filter((e) => e.o === 0).length,
    std50: s50.nodes.size,
    std41: s41.nodes.size,
    pagesFetched: s50.pages + s41.pages,
    since50: all.filter((e) => e.since).length,
    tags: Object.fromEntries(['coll', 'p2p', 'nb', 'pers', 'ierr', 'lc', 'dep'].map((t) => [t, all.filter((e) => e.t?.includes(t)).length])),
    unknownTypes: Object.entries(entries).filter(([, e]) => e.a.some((a) => a[2] === '?')).map(([n]) => n),
    problems,
    bytes,
  };
  return {
    file: 'mpi.json',
    bytes,
    stats,
    licences: { openmpi: tar.get('LICENSE').toString('utf8'), 'mpi-abi-stubs': abi.get('LICENSE.md').toString('utf8') },
  };
}

/** One declaration line of a binding → name → { type, attrs, base, dims }: type is base and dims together. */
function parseArgsLine(line) {
  const out = new Map();
  const l = line.trim();
  let spec;
  let attrs = [];
  let names;
  const m = /^(.*?)\s*::\s*(.*)$/.exec(l);
  if (m) {
    [spec, ...attrs] = splitTop(m[1]);
    names = m[2];
  } else {
    const old = /^(<type>|DOUBLE PRECISION|INTEGER(?:\s*\(\s*KIND\s*=\s*\w+\s*\))?|LOGICAL|CHARACTER\*\(\*\)|CHARACTER(?:\*\d+)?|EXTERNAL|REAL|COMPLEX)\s+(.*)$/i.exec(l);
    if (!old) return out;
    spec = old[1];
    names = old[2];
  }
  const a = attrs.map((x) => x.toLowerCase().replace(/\s+/g, ''));
  const dimAttr = a.find((x) => x.startsWith('dimension('));
  for (const ent of splitTop(names)) {
    const em = /^(\w+)\s*(\(.*\))?$/.exec(ent);
    if (!em) continue;
    const dims = em[2]?.replace(/\s+/g, '') ?? (dimAttr ? dimAttr.slice('dimension'.length) : '');
    const base = /^external$/i.test(spec) ? 'external' : fortranType(spec);
    const type = base === 'external' ? base : base + dims.toLowerCase();
    out.set(em[1].toLowerCase(), { type, attrs: a, base, dims });
  }
  return out;
}

if (isMain(import.meta.url)) {
  const { stats } = await build();
  await saveLock();
  console.log(JSON.stringify(stats, (k, v) => (Array.isArray(v) && v.length > 40 ? [...v.slice(0, 40), `… ${v.length} in all`] : v), 2));
}
