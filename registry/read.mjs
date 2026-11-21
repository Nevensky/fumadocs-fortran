// Reads the HPC registry: expands an entry of registry/*.json (family defaults, type templates, codes) and builds
// its links for every provider. Plain ESM, no dependencies, for build time only. It is not a public export: the
// package's own code imports it by path.
//
//   lookup('lapack', 'dgesv') → { lib, name, kind, args: [['n', 'in', 'integer'], …], family, summary, tags, links }
//   libraryOf('MPI_Comm')     → { lib: 'mpi', library: 'mpi', name: 'MPI_Comm', section: 'types', entry, link }
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';

const files = new Map();

/** The parsed registry file `id` (lapack, scalapack, mpi, openmp, openacc, intrinsics, vendors). */
export function load(id) {
  if (!files.has(id)) files.set(id, JSON.parse(readFileSync(new URL(`./${id}.json`, import.meta.url), 'utf8')));
  return files.get(id);
}

/** A value computed once per key, for the indexes below. */
const memo = new Map();
const once = (key, make) => {
  if (!memo.has(key)) memo.set(key, make());
  return memo.get(key);
};

// ------------------------------------------------------------------------------------------------ Doxygen pages

/** Doxygen's escaping of page names (_ → __, . → _8, capitals → _ and lower case). */
export const doxygenEscape = (name) => name.replace(/[_.A-Z]/g, (c) => (c === '_' ? '__' : c === '.' ? '_8' : `_${c.toLowerCase()}`));

/** Doxygen's CREATE_SUBDIRS folder of a page: d{md5[14]&0xf}/d{md5[15]:02x}. */
export function doxygenDir(page) {
  const md5 = createHash('md5').update(page).digest();
  return `d${(md5[14] & 0xf).toString(16)}/d${md5[15].toString(16).padStart(2, '0')}`;
}

// ------------------------------------------------------------------------------------------------ helpers

const INTENTS = { i: 'in', o: 'out', b: 'inout', '': '' };

/** gfortran and libgomp page names: _ is written _005f. */
const texinfo = (name) => name.replace(/_/g, '_005f');

/** The MKL page slug of a LAPACK or ScaLAPACK routine. */
export function mklSlug(name, lib) {
  if (lib === 'scalapack') return /^p[sdcz]/.test(name) ? `p-${name.slice(2)}` : null;
  if (/^i[sdcz]am(?:ax|in)$/.test(name)) return `i-${name.slice(2)}`;
  if (/^(?:ds|zc)/.test(name) && /gesv|posv/.test(name)) return name;
  return /^[sdcz]/.test(name) ? name.slice(1) : name;
}

/** The members of each precision family of lapack.json or scalapack.json: family id → names. */
const familyMembers = (id) =>
  once(`members:${id}`, () => {
    const out = new Map();
    for (const [n, e] of Object.entries(load(id).entries)) if (e.g) out.set(e.g, [...(out.get(e.g) ?? []), n]);
    return out;
  });

// ------------------------------------------------------------------------------------------------ LAPACK, ScaLAPACK

function linalg(id, name) {
  const reg = load(id);
  // own keys only: a project's procedure called constructor is no entry
  if (!Object.hasOwn(reg.entries, name)) return null;
  const e = reg.entries[name];
  const g = e.g ? reg.groups[e.g] : null;
  // precision letter: explicit, the letter at the family's ?, or the first letter
  const at = e.g?.indexOf('?') ?? -1;
  const p = e.p ?? (at >= 0 ? name[at] : id === 'lapack' && 'sdcz'.includes(name[0]) ? name[0] : null);
  const prec = 'sdcz'.includes(p) ? p : null;
  const complex = prec === 'c' || prec === 'z';
  const field = (k) => (k in e ? e[k] : g ? (complex && `${k}c` in g ? g[`${k}c`] : g[k]) : undefined);
  const { T, R } = load('lapack').legend.templates;
  const types = load('lapack').legend.types;
  const type = (t) => {
    if (!t) return t;
    const code = t.replace(/^[TR]/, (c) => (prec ? (c === 'T' ? T[prec] : R[prec]) : c));
    const m = /^(x?)([a-z]\*?\d*)(.*)$/.exec(code);
    if (!m) return code;
    const base = types[m[2]] ?? (m[2].startsWith('a') ? `character*${m[2].slice(1)}` : m[2]);
    return m[1] ? `procedure${m[2] ? ` (${base})` : ''}` : base + m[3];
  };
  const args = (field('a') ?? []).map(([n, i, t, scope]) => (scope ? [n, INTENTS[i] ?? i, type(t), scope] : [n, INTENTS[i] ?? i, type(t)]));
  const kind = field('k') === 'f' ? 'function' : 'subroutine';
  const members = g ? [...familyMembers(id).get(e.g)] : null;
  const family = g ? { id: e.g, name: g.n ?? e.g, title: g.title ?? null, members } : null;

  const links = {};
  const nl = reg.links.netlib;
  const file = e.f ?? `${name}.f`;
  const page = doxygenEscape(file);
  if (e.u) links.netlib = `${nl.base}${doxygenDir(`group__${doxygenEscape(e.g)}`)}/group__${doxygenEscape(e.g)}_ga${e.u}.html#ga${e.u}`;
  else if (e.v) links.netlib = `${nl.base}${doxygenDir(page)}/${page}_a${e.v}.html#a${e.v}`;
  else if (e.U) links.netlib = nl.base + e.U;
  links.netlibFile = `${nl.base}${doxygenDir(page)}/${page}.html`;
  const slug = id === 'scalapack' && e.l && e.l !== 'pblas' ? null : mklSlug(name, id);
  if (slug) links.mkl = `${reg.links.mkl.base}${slug}.html`;
  return {
    lib: id,
    // blas or lapack in lapack.json; scalapack, tools, pblas, redist or blacs in scalapack.json
    library: e.l ?? id,
    name,
    kind,
    result: kind === 'function' ? type(field('r')) ?? null : null,
    args,
    family,
    summary: field('s') ?? null,
    tags: field('t') ?? [],
    ld: field('ld') ?? null,
    links,
  };
}

// ------------------------------------------------------------------------------------------------ MPI

/** The keys of a section of mpi.json by their lower-case spelling (the first of a spelling, as a search would find). */
const mpiKeys = (section) =>
  once(`mpi:${section}`, () => {
    const out = new Map();
    for (const k of Object.keys(load('mpi')[section] ?? {})) if (!out.has(k.toLowerCase())) out.set(k.toLowerCase(), k);
    return out;
  });

function mpiEntry(name) {
  const reg = load('mpi');
  const key = mpiKeys('entries').get(name.toLowerCase());
  if (!key) return null;
  const e = reg.entries[key];
  const kinds = { s: 'subroutine', f: 'function', cb: 'callback interface', pf: 'predefined callback' };
  const links = {};
  const l = reg.links;
  if (e.k !== 'cb' && e.k !== 'pf') {
    links.openmpi = e.o === 0 ? l.openmpi.fallback.replace('{name}', key) : `${l.openmpi.base}${key}.3.html`;
    links.mpich = `${l.mpich.base}${key}.html`;
    if (e.std?.[0]) links['standard-5.0'] = l.standard['5.0'].replace('{std[0]}', e.std[0]);
    if (e.std?.[1]) links['standard-4.1'] = l.standard['4.1'].replace('{std[1]}', e.std[1]);
  }
  return {
    lib: 'mpi',
    name: key,
    kind: kinds[e.k ?? 's'],
    result: e.r ?? null,
    category: e.c,
    args: e.a.map(([n, i, t, f]) => (f ? [n, INTENTS[i] ?? i, t, f] : [n, INTENTS[i] ?? i, t])),
    summary: e.s ?? null,
    tags: e.t ?? [],
    since: e.since ?? null,
    see: e.see ?? null,
    links,
  };
}

/** A derived type of mpi_f08 (MPI_Comm, MPI_Status): what it holds, its `use mpi` form and its null handle. */
function mpiType(name) {
  const reg = load('mpi');
  const key = mpiKeys('types').get(name.toLowerCase());
  if (!key) return null;
  const e = reg.types[key];
  const links = {};
  if (e.std?.[0]) links['standard-5.0'] = reg.links.standard['5.0'].replace('{std[0]}', e.std[0]);
  if (e.std?.[1]) links['standard-4.1'] = reg.links.standard['4.1'].replace('{std[1]}', e.std[1]);
  return {
    lib: 'mpi',
    section: 'types',
    name: key,
    kind: 'type',
    module: 'mpi_f08',
    components: (e.c ?? []).map((c) => [...c]),
    legacy: e.old ?? null,
    nullHandle: e.n ?? null,
    summary: e.s ?? null,
    tags: e.t ?? [],
    links,
  };
}

// ------------------------------------------------------------------------------------------------ OpenMP, OpenACC

const SECTIONS = {
  mpi: ['entries', 'types'],
  openmp: ['directives', 'clauses', 'routines', 'env', 'types', 'constants'],
  openacc: ['directives', 'clauses', 'routines', 'env'],
};

/**
 * The keys a name may have in a section: directives are keyed lower case with blanks between words (target data),
 * but a few keep an underscore of their own (OpenACC's host_data), so both spellings are tried.
 */
function keysOf(section, name) {
  if (section === 'env') return [name.toUpperCase()];
  const key = name.toLowerCase().replace(/\s+/g, ' ').trim();
  return section === 'directives' ? [key.replace(/_/g, ' '), key, key.replace(/ /g, '_')] : [key];
}
const keyIn = (map, section, name) => (map ? keysOf(section, name).find((k) => Object.hasOwn(map, k)) : undefined);

function openmpEntry(section, name, version) {
  const reg = load('openmp');
  const key = keyIn(reg[section], section, name);
  if (key === undefined) return null;
  const e = reg[section][key];
  const links = {};
  if (e.l) {
    reg.versions.forEach((v, i) => {
      const p = e.l.p[i];
      if (p) links[`spec-${v}`] = `${reg.links.spec.base.replace('{version}', v)}openmp${p}.html#${e.l.fv?.[v] ?? e.l.f}`;
    });
    const want = version ?? reg.links.spec.default;
    links.spec = links[`spec-${want}`] ?? reg.versions.map((v) => links[`spec-${v}`]).find(Boolean);
  }
  if (section === 'routines' || section === 'env') links.libgomp = `${reg.links.libgomp.base}${texinfo(key)}.html`;
  // the types section holds omp_lib's kinds: integer kind parameters, not derived types
  const kinds = section === 'types';
  const kind = e.k === 'f' ? 'function' : section === 'routines' ? 'subroutine' : kinds ? 'kind' : null;
  return {
    lib: 'openmp',
    section,
    name: key,
    kind: kind ?? e.k ?? section.replace(/s$/, ''),
    leaves: e.c ?? null,
    spelling6: e.u ?? null,
    result: e.r ?? null,
    type: kinds ? 'integer' : e.ty ?? null,
    args: e.a ? e.a.map(([n, i, t]) => [n, INTENTS[i] ?? i, t]) : null,
    summary: e.s ?? null,
    tags: e.t ?? [],
    deprecated: e.dep ?? null,
    links,
  };
}

function openaccEntry(section, name) {
  const reg = load('openacc');
  const key = keyIn(reg[section], section, name);
  if (key === undefined) return null;
  const e = reg[section][key];
  const links = {};
  if (e.pg) links.spec = `${reg.links.spec.url}#page=${e.pg}`;
  if (section === 'routines' || section === 'env') links.libgomp = `${reg.links.libgomp.base}${texinfo(key)}.html`;
  return { lib: 'openacc', section, name: key, kind: e.k ?? section.replace(/s$/, ''), parts: e.c ?? null, summary: e.s ?? null, tags: e.t ?? [], links };
}

// ------------------------------------------------------------------------------------------------ intrinsics

function intrinsicEntry(name) {
  const reg = load('intrinsics');
  const key = name.toLowerCase();
  if (!Object.hasOwn(reg.entries, key)) return null;
  const e = reg.entries[key];
  const links = {};
  if (e.fl) links['fortran-lang'] = `${reg.links['fortran-lang'].base}${e.fl}/#${e.fa ?? key.replace(/_/g, '-')}`;
  if (e.gf !== 0) links.gfortran = `${reg.links.gfortran.base}${e.gp ?? texinfo(key.toUpperCase())}.html`;
  return {
    lib: 'intrinsics',
    name: key,
    kind: e.k === 's' ? 'subroutine' : 'function',
    category: e.c,
    module: e.m ?? null,
    result: e.r ?? null,
    args: e.a.map(([n, i, t, f]) => (f ? [n, INTENTS[i] ?? i, t, f] : [n, INTENTS[i] ?? i, t])),
    summary: e.s,
    links,
  };
}

// ------------------------------------------------------------------------------------------------ lookup

/**
 * The expanded entry `name` of registry file `id`, or null. MPI, OpenMP and OpenACC take a section; without one, the
 * first section that has the name wins, in the order of SECTIONS:
 * - mpi: entries (procedures and callbacks), types (the derived types of mpi_f08: lookup('mpi', 'MPI_Comm'));
 * - openmp: directives, clauses, routines, env, types (the kinds of omp_lib), constants;
 * - openacc: directives, clauses, routines, env.
 * lookup('openmp', 'parallel do', { section: 'directives', version: '5.2' }). Names are matched without regard to case.
 */
export function lookup(id, name, { section, version } = {}) {
  const one = (s) => {
    switch (id) {
      case 'mpi':
        return s === 'types' ? mpiType(name) : s === 'entries' ? mpiEntry(name) : null;
      case 'openmp':
        return openmpEntry(s, name, version);
      default:
        return openaccEntry(s, name);
    }
  };
  switch (id) {
    case 'lapack':
    case 'scalapack':
      return linalg(id, name.toLowerCase());
    case 'mpi':
    case 'openmp':
    case 'openacc':
      return section ? one(section) : SECTIONS[id].map(one).find(Boolean) ?? null;
    case 'intrinsics':
      return intrinsicEntry(name);
    default:
      throw new Error(`unknown registry ${id}`);
  }
}

/**
 * Every name of a registry file, or of one section of it: MPI's entries by default (its types with 'types'), OpenMP's
 * and OpenACC's directives.
 */
export function names(id, section) {
  const reg = load(id);
  if (id === 'mpi') return Object.keys(reg[section ?? 'entries'] ?? {});
  if (id === 'openmp' || id === 'openacc') return Object.keys(reg[section ?? 'directives'] ?? {});
  if (!reg.entries) throw new Error(`registry ${id} has no entries to name: read it with load('${id}')`);
  return Object.keys(reg.entries);
}

// ------------------------------------------------------------------------------------------------ libraryOf

/**
 * The sections of names a program writes (procedures, types, kinds, constants), in the order they are tried; the
 * directives, clauses and environment variables of OpenMP and OpenACC are left out. No name is in two of them.
 */
export const LIBRARY_SECTIONS = [
  ['lapack', 'entries'],
  ['scalapack', 'entries'],
  ['mpi', 'entries'],
  ['mpi', 'types'],
  ['openmp', 'routines'],
  ['openmp', 'types'],
  ['openmp', 'constants'],
  ['openacc', 'routines'],
  ['intrinsics', 'entries'],
];

/** Lower-case name → [id, section, key] over LIBRARY_SECTIONS; the first section that has a name keeps it. */
const libraryIndex = () =>
  once('library', () => {
    const out = new Map();
    for (const [id, section] of LIBRARY_SECTIONS) {
      for (const key of Object.keys(load(id)[section] ?? {})) {
        const k = key.toLowerCase();
        if (!out.has(k)) out.set(k, [id, section, key]);
      }
    }
    return out;
  });

/** The page a hover card on an entry links to: see libraryOf. */
function linkOf(entry) {
  const l = entry.links;
  switch (entry.lib) {
    case 'lapack':
    case 'scalapack':
      return l.netlib ?? l.netlibFile ?? null;
    case 'mpi':
      return l.openmpi ?? l['standard-5.0'] ?? l['standard-4.1'] ?? null;
    case 'intrinsics':
      return l['fortran-lang'] ?? l.gfortran ?? null;
    default:
      return l.spec ?? null;
  }
}

/**
 * The library a name a program writes belongs to, without regard to case, or null: a procedure of BLAS, LAPACK,
 * ScaLAPACK (with its tools, PBLAS, REDIST and BLACS), MPI, OpenMP or OpenACC, an intrinsic procedure, a derived type
 * of mpi_f08, or a kind or named constant of omp_lib. It looks the name up in an index built on the first call.
 *
 *   libraryOf('DGEMM') → { lib: 'lapack', library: 'blas', name: 'dgemm', section: 'entries', entry, link }
 *
 * - lib: the registry file (lapack, scalapack, mpi, openmp, openacc, intrinsics);
 * - library: blas or lapack for lapack.json; scalapack, tools, pblas, redist or blacs for scalapack.json; else lib;
 * - name: the registry's spelling (MPI_Allreduce); section: the section of the file that holds it;
 * - entry: what lookup(lib, name, { section }) returns, a fresh object;
 * - link: the page a card links to, or null: Netlib (BLAS, LAPACK, ScaLAPACK), Open MPI's manual page (an MPI
 *   procedure), the MPI 5.0 standard (an MPI type), the OpenMP or OpenACC specification, fortran-lang.org or
 *   gfortran's manual (an intrinsic).
 * A project's own procedure or type of the same name wins: ask only for names the project does not define.
 */
export function libraryOf(name) {
  const hit = libraryIndex().get(String(name ?? '').toLowerCase());
  if (!hit) return null;
  const [id, section, key] = hit;
  const entry = lookup(id, key, { section });
  return { lib: id, library: entry.library ?? id, name: entry.name, section, entry, link: linkOf(entry) };
}
