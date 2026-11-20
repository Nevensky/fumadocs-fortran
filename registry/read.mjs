// Reads the HPC registry: expands an entry of registry/*.json (family defaults, type templates, codes) and builds
// its links for every provider. Plain ESM, no dependencies, for build time only.
//
//   import { lookup } from 'fumadocs-fortran/registry/read.mjs';
//   lookup('lapack', 'dgesv') → { lib, name, kind, args: [['n', 'in', 'integer'], …], family, summary, tags, links }
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';

const files = new Map();

/** The parsed registry file `id` (lapack, scalapack, mpi, openmp, openacc, intrinsics, vendors). */
export function load(id) {
  if (!files.has(id)) files.set(id, JSON.parse(readFileSync(new URL(`./${id}.json`, import.meta.url), 'utf8')));
  return files.get(id);
}

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

// ------------------------------------------------------------------------------------------------ LAPACK, ScaLAPACK

function linalg(id, name) {
  const reg = load(id);
  const e = reg.entries[name];
  if (!e) return null;
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
  const family = g ? { id: e.g, name: g.n ?? e.g, title: g.title ?? null, members: Object.keys(reg.entries).filter((n) => reg.entries[n].g === e.g) } : null;

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

function mpiEntry(name) {
  const reg = load('mpi');
  const key = Object.keys(reg.entries).find((k) => k.toLowerCase() === name.toLowerCase());
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

// ------------------------------------------------------------------------------------------------ OpenMP, OpenACC

const SECTIONS = { openmp: ['directives', 'clauses', 'routines', 'env', 'types', 'constants'], openacc: ['directives', 'clauses', 'routines', 'env'] };

function directiveKey(section, name) {
  return section === 'directives' ? name.toLowerCase().replace(/_/g, ' ').replace(/\s+/g, ' ').trim() : section === 'env' ? name.toUpperCase() : name.toLowerCase();
}

function openmpEntry(section, name, version) {
  const reg = load('openmp');
  const key = directiveKey(section, name);
  const e = reg[section]?.[key];
  if (!e) return null;
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
  return {
    lib: 'openmp',
    section,
    name: key,
    kind: e.k === 'f' ? 'function' : section === 'routines' ? 'subroutine' : e.k ?? section.replace(/s$/, ''),
    leaves: e.c ?? null,
    spelling6: e.u ?? null,
    result: e.r ?? null,
    type: e.ty ?? null,
    args: e.a ? e.a.map(([n, i, t]) => [n, INTENTS[i] ?? i, t]) : null,
    summary: e.s ?? null,
    tags: e.t ?? [],
    deprecated: e.dep ?? null,
    links,
  };
}

function openaccEntry(section, name) {
  const reg = load('openacc');
  const key = directiveKey(section, name);
  const e = reg[section]?.[key];
  if (!e) return null;
  const links = {};
  if (e.pg) links.spec = `${reg.links.spec.url}#page=${e.pg}`;
  if (section === 'routines' || section === 'env') links.libgomp = `${reg.links.libgomp.base}${texinfo(key)}.html`;
  return { lib: 'openacc', section, name: key, kind: e.k ?? section.replace(/s$/, ''), parts: e.c ?? null, summary: e.s ?? null, tags: e.t ?? [], links };
}

// ------------------------------------------------------------------------------------------------ intrinsics

function intrinsicEntry(name) {
  const reg = load('intrinsics');
  const key = name.toLowerCase();
  const e = reg.entries[key];
  if (!e) return null;
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
 * The expanded entry `name` of registry file `id`, or null. OpenMP and OpenACC take a section (directives, clauses,
 * routines, env, types, constants): lookup('openmp', 'parallel do', { section: 'directives', version: '5.2' }).
 * Names are matched without regard to case.
 */
export function lookup(id, name, { section, version } = {}) {
  switch (id) {
    case 'lapack':
    case 'scalapack':
      return linalg(id, name.toLowerCase());
    case 'mpi':
      return mpiEntry(name);
    case 'openmp':
      return section ? openmpEntry(section, name, version) : SECTIONS.openmp.map((s) => openmpEntry(s, name, version)).find(Boolean) ?? null;
    case 'openacc':
      return section ? openaccEntry(section, name) : SECTIONS.openacc.map((s) => openaccEntry(s, name)).find(Boolean) ?? null;
    case 'intrinsics':
      return intrinsicEntry(name);
    default:
      throw new Error(`unknown registry ${id}`);
  }
}

/** Every name of a registry file (of one section for OpenMP and OpenACC). */
export function names(id, section) {
  const reg = load(id);
  if (id === 'openmp' || id === 'openacc') return Object.keys(reg[section ?? 'directives']);
  return Object.keys(reg.entries);
}
