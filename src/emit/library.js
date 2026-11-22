// The HPC registry as the pages use it: which library a name a program writes belongs to, for the hover cards of
// library routines in "Calls:" lines and of MPI's and OpenMP's types and kinds in argument rows, and for the colours of
// the call graphs. Node only: it reads registry/*.json, through registry/read.mjs, the first time a name is looked up,
// and gives nothing once that fails, so that the pages show the names as they did before the registry.

import { libraryOf } from '../../registry/read.mjs';
import { BLAS_ROUTINES } from './fortran-names.js';

/**
 * A lookup of names over `read` (the registry's libraryOf): the registry's answer for a name, by its lower-case
 * spelling, asked once per name and option; null for every name once `read` has thrown (the registry cannot be read).
 * With `subroutine`, a name that has two meanings is the subroutine a CALL names: ScaLAPACK's reshape, not the
 * intrinsic function RESHAPE (see libraryOf).
 * @param {(name: string, options: { subroutine: boolean }) => object|null} [read]
 */
export function libraryLookup(read = libraryOf) {
  const memo = new Map();
  let failed = false;
  return (name, { subroutine = false } = {}) => {
    const key = String(name ?? '').toLowerCase();
    if (failed || !key) return null;
    const k = subroutine ? `${key}\0s` : key;
    if (memo.has(k)) return memo.get(k);
    let hit = null;
    try {
      hit = read(key, { subroutine }) ?? null;
    } catch {
      failed = true;
      return null;
    }
    memo.set(k, hit);
    return hit;
  };
}

/** The registry's lookup, shared by every page build of the process. */
export const findLibrary = libraryLookup();

// the sections of the registry that hold procedures (the others hold types, kinds and named constants)
const ROUTINES = new Set(['lapack:entries', 'scalapack:entries', 'mpi:entries', 'openmp:routines', 'openacc:routines',
  'intrinsics:entries']);
const isRoutine = (hit) => !!hit && ROUTINES.has(`${hit.lib}:${hit.section}`);

/**
 * The call graphs' library of a routine called by name, for buildGraphs' classify: BLAS first (the reference BLAS and
 * the extensions fortran-names.js knows), then LAPACK, ScaLAPACK (with PBLAS, BLACS, its tools and REDIST), MPI,
 * OpenMP and OpenACC. Null for an intrinsic procedure (the graphs drop those, and draw the coarray collectives as
 * coarray calls), for a name the registry does not have, and for a type, a kind or a named constant. `subroutine`:
 * the name is a subroutine's, as a CALL names it (ScaLAPACK's reshape, where a function reference of reshape is the
 * intrinsic).
 * @param {string} name
 * @param {{ subroutine?: boolean, find?: typeof findLibrary }} [options]
 */
export function classifyLibrary(name, { subroutine = false, find = findLibrary } = {}) {
  const key = String(name ?? '').toLowerCase();
  if (BLAS_ROUTINES.has(key)) return 'blas';
  const hit = find(key, { subroutine });
  if (!isRoutine(hit)) return null;
  if (hit.library === 'blas') return 'blas';
  return hit.lib === 'intrinsics' ? null : hit.lib;
}

// what a card calls each library, by the registry's library
const LABELS = {
  blas: 'BLAS', lapack: 'LAPACK', scalapack: 'ScaLAPACK', tools: 'ScaLAPACK', redist: 'ScaLAPACK', pblas: 'PBLAS',
  blacs: 'BLACS', mpi: 'MPI', openmp: 'OpenMP', openacc: 'OpenACC', intrinsics: 'intrinsic',
};

/** At most n characters (code points), cut at a word when one is near. */
function clip(s, n) {
  const cps = Array.from(s);
  if (cps.length <= n) return s;
  const cut = cps.slice(0, n).join('');
  const sp = cut.lastIndexOf(' ');
  return `${sp > n / 2 ? cut.slice(0, sp) : cut}…`;
}

/**
 * The providers a site may choose for the pages a card links to (PageOptions' hpc.links), by the registry file of the
 * library, the default first:
 * - lapack (BLAS and LAPACK), scalapack (ScaLAPACK, PBLAS, BLACS, its tools and REDIST): netlib, or mkl (Intel
 *   oneMKL). Without a choice, MKL when the code uses one of MKL's modules, else Netlib;
 * - mpi: openmpi (Open MPI 5.0's manual), mpich (MPICH's), or standard (the MPI 5.0 standard);
 * - openmp: a version of the OpenMP specification (5.2, 6.0 or 6.1), or libgomp (GCC's manual);
 * - openacc: spec (the OpenACC 3.4 specification), or libgomp;
 * - intrinsics: fortran-lang (fortran-lang.org), or gfortran (GCC's manual).
 * A name the chosen provider has no page for links where it would by default.
 */
export const LINK_PROVIDERS = Object.freeze({
  lapack: Object.freeze(['netlib', 'mkl']),
  scalapack: Object.freeze(['netlib', 'mkl']),
  mpi: Object.freeze(['openmpi', 'mpich', 'standard']),
  openmp: Object.freeze(['5.2', '6.0', '6.1', 'libgomp']),
  openacc: Object.freeze(['spec', 'libgomp']),
  intrinsics: Object.freeze(['fortran-lang', 'gfortran']),
});

const or = (list) => (list.length > 1 ? `${list.slice(0, -1).join(', ')} or ${list.at(-1)}` : list.join(''));
const LIBRARIES = 'lapack (BLAS and LAPACK), scalapack (with PBLAS, BLACS, its tools and REDIST), mpi, openmp, '
  + 'openacc and intrinsics';

/**
 * The link providers a site chose, checked against LINK_PROVIDERS: a plain object of library → provider, without the
 * libraries left undefined. Throws, with `what` (the option's name) in the message, on a library or provider it does
 * not know.
 * @param {Record<string, string|undefined>|undefined|null} links
 * @param {string} [what]
 */
export function linkProviders(links, what = 'hpc.links') {
  if (links === undefined || links === null) return {};
  if (typeof links !== 'object' || Array.isArray(links)) {
    throw new TypeError(`${what} takes an object of library → provider, such as { mpi: 'mpich' }`);
  }
  const out = {};
  for (const [lib, provider] of Object.entries(links)) {
    if (!Object.hasOwn(LINK_PROVIDERS, lib)) {
      throw new Error(`${what}: unknown library ${JSON.stringify(lib)}; the libraries are ${LIBRARIES}`);
    }
    if (provider === undefined) continue;
    if (typeof provider !== 'string') {
      throw new TypeError(`${what}: ${lib} takes ${or(LINK_PROVIDERS[lib])} as a string, not the ${typeof provider} `
        + `${String(provider)}`);
    }
    if (!LINK_PROVIDERS[lib].includes(provider)) {
      throw new Error(`${what}: ${lib} takes ${or(LINK_PROVIDERS[lib])}, not ${JSON.stringify(provider)}`);
    }
    out[lib] = provider;
  }
  return out;
}

/**
 * The page a card on a library name links to, from the providers `links` names (see LINK_PROVIDERS), else the
 * default: Netlib's for BLAS, LAPACK and ScaLAPACK, or Intel oneMKL's when `mkl` (the code uses MKL's modules) and the
 * registry gives the routine an MKL address (made from its name and not checked, as intel.com refuses scripts); Open
 * MPI 5.0's manual page for an MPI procedure (the development manual's for one 5.0 lacks), the MPI 5.0 standard for an
 * MPI type; the OpenMP 5.2 specification (a later one for what 5.2 lacks); the OpenACC 3.4 specification;
 * fortran-lang.org for an intrinsic (gfortran's manual for what it lacks). A provider without a page for the name
 * gives the default's. Undefined when there is none.
 */
function linkOf(hit, { links = {}, mkl = false } = {}) {
  const l = hit.entry.links ?? {};
  const want = Object.hasOwn(links, hit.lib) ? links[hit.lib] : undefined;
  let chosen;
  switch (hit.lib) {
    case 'lapack':
    case 'scalapack':
      return ((want ? want === 'mkl' : mkl) && l.mkl) || l.netlib || l.netlibFile || undefined;
    case 'mpi':
      chosen = want === 'mpich' ? l.mpich : want === 'standard' ? l['standard-5.0'] ?? l['standard-4.1'] : undefined;
      break;
    case 'openmp':
      chosen = want === 'libgomp' ? l.libgomp : want ? l[`spec-${want}`] : undefined;
      break;
    case 'openacc':
    case 'intrinsics':
      chosen = want && want !== LINK_PROVIDERS[hit.lib][0] ? l[want] : undefined;
      break;
  }
  return chosen || hit.link || undefined;
}

/**
 * The card of a library routine a "Calls:" line names: { href, title, detail }, the title such as `subroutine
 * MPI_Allreduce (MPI)`, the detail the registry's summary; null when `name` is no routine the registry knows, is an
 * intrinsic procedure and `intrinsic` is false, or is a function and `called` is true (a CALL statement names it, so
 * it is some other subroutine of that name). A CALL of a name that has two meanings names the subroutine: `call
 * reshape` is ScaLAPACK's, not the intrinsic function RESHAPE.
 * @param {string} name the routine's own name (after any rename of a use statement)
 * @param {{ mkl?: boolean, links?: Record<string, string>, intrinsic?: boolean, called?: boolean,
 *   find?: typeof findLibrary }} [options] links: the providers linkProviders checked
 */
export function routineCard(name, { mkl = false, links, intrinsic = true, called = false, find = findLibrary } = {}) {
  const hit = find(name, { subroutine: called });
  if (!isRoutine(hit) || (!intrinsic && hit.lib === 'intrinsics')) return null;
  const e = hit.entry;
  if (called && e.kind === 'function') return null;
  const word = e.kind === 'subroutine' || e.kind === 'function' ? `${e.kind} ` : '';
  const label = (hit.lib === 'intrinsics' && e.module) || LABELS[hit.library] || LABELS[hit.lib] || hit.lib;
  const card = { title: `${word}${hit.name} (${label})` };
  const href = linkOf(hit, { links, mkl });
  if (href) card.href = href;
  if (e.summary) card.detail = clip(e.summary, 200);
  return card;
}

// the modules outside a project whose derived types or kinds the registry knows: what a declaration names from them
// (`want`), and where the registry keeps it
const MODULES = new Map([
  ['mpi_f08', { want: 'type', lib: 'mpi', section: 'types' }],
  ['omp_lib', { want: 'kind', lib: 'openmp', section: 'types' }],
  ['omp_lib_kinds', { want: 'kind', lib: 'openmp', section: 'types' }],
]);

/**
 * What a module outside the project gives under its own name `name` as a declaration's derived type (`want` type) or
 * kind (`want` kind), when the registry knows it: { name, summary, href } for mpi_f08's handle types and MPI_Status
 * (type(MPI_Comm)) and omp_lib's kinds (integer(omp_lock_kind)); null otherwise. `use mpi`, whose handles are
 * integers, gives none. `links`: the providers linkProviders checked.
 * @param {{ links?: Record<string, string>, find?: typeof findLibrary }} [options]
 */
export function moduleName(module, name, want, { links, find = findLibrary } = {}) {
  const m = MODULES.get(String(module ?? '').toLowerCase());
  if (!m || m.want !== want) return null;
  const hit = find(name);
  if (!hit || hit.lib !== m.lib || hit.section !== m.section) return null;
  const out = { name: hit.name, summary: hit.entry.summary ?? '' };
  const href = linkOf(hit, { links });
  if (href) out.href = href;
  return out;
}
