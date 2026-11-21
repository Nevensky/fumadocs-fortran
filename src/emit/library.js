// The HPC registry as the pages use it: which library a name a program writes belongs to, for the hover cards of
// library routines in "Calls:" lines and of MPI's and OpenMP's types and kinds in argument rows, and for the colours of
// the call graphs. Node only: it reads registry/*.json, through registry/read.mjs, the first time a name is looked up,
// and gives nothing once that fails, so that the pages show the names as they did before the registry.

import { libraryOf } from '../../registry/read.mjs';
import { BLAS_ROUTINES } from './fortran-names.js';

/**
 * A lookup of names over `read` (the registry's libraryOf): the registry's answer for a name, by its lower-case
 * spelling, asked once per name; null for every name once `read` has thrown (the registry cannot be read).
 * @param {(name: string) => object|null} [read]
 */
export function libraryLookup(read = libraryOf) {
  const memo = new Map();
  let failed = false;
  return (name) => {
    const key = String(name ?? '').toLowerCase();
    if (failed || !key) return null;
    if (memo.has(key)) return memo.get(key);
    let hit = null;
    try {
      hit = read(key) ?? null;
    } catch {
      failed = true;
      return null;
    }
    memo.set(key, hit);
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
 * coarray calls), for a name the registry does not have, and for a type, a kind or a named constant.
 */
export function classifyLibrary(name, find = findLibrary) {
  const key = String(name ?? '').toLowerCase();
  if (BLAS_ROUTINES.has(key)) return 'blas';
  const hit = find(key);
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
 * The page a card on a library name links to: Netlib's for BLAS, LAPACK and ScaLAPACK, or Intel oneMKL's when `mkl`
 * (the code uses MKL's modules) and the registry gives the routine an MKL address (made from its name and not
 * checked, as intel.com refuses scripts); Open MPI 5.0's manual page for an MPI procedure (the development manual's
 * for one 5.0 lacks), the MPI 5.0 standard for an MPI type; the OpenMP 5.2 specification (a later one for what 5.2
 * lacks); the OpenACC 3.4 specification; fortran-lang.org for an intrinsic (gfortran's manual for what it lacks).
 * Undefined when there is none.
 */
function linkOf(hit, mkl) {
  const l = hit.entry.links ?? {};
  if (hit.lib === 'lapack' || hit.lib === 'scalapack') return (mkl && l.mkl) || l.netlib || l.netlibFile || undefined;
  return hit.link ?? undefined;
}

/**
 * The card of a library routine a "Calls:" line names: { href, title, detail }, the title such as `subroutine
 * MPI_Allreduce (MPI)`, the detail the registry's summary; null when `name` is no routine the registry knows, is an
 * intrinsic procedure and `intrinsic` is false, or is a function and `called` is true (a CALL statement names it, so
 * it is some other subroutine of that name: ScaLAPACK's RESHAPE is no intrinsic RESHAPE).
 * @param {string} name the routine's own name (after any rename of a use statement)
 * @param {{ mkl?: boolean, intrinsic?: boolean, called?: boolean, find?: (name: string) => object|null }} [options]
 */
export function routineCard(name, { mkl = false, intrinsic = true, called = false, find = findLibrary } = {}) {
  const hit = find(name);
  if (!isRoutine(hit) || (!intrinsic && hit.lib === 'intrinsics')) return null;
  const e = hit.entry;
  if (called && e.kind === 'function') return null;
  const word = e.kind === 'subroutine' || e.kind === 'function' ? `${e.kind} ` : '';
  const label = (hit.lib === 'intrinsics' && e.module) || LABELS[hit.library] || LABELS[hit.lib] || hit.lib;
  const card = { title: `${word}${hit.name} (${label})` };
  const href = linkOf(hit, mkl);
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
 * integers, gives none.
 */
export function moduleName(module, name, want, find = findLibrary) {
  const m = MODULES.get(String(module ?? '').toLowerCase());
  if (!m || m.want !== want) return null;
  const hit = find(name);
  if (!hit || hit.lib !== m.lib || hit.section !== m.section) return null;
  const out = { name: hit.name, summary: hit.entry.summary ?? '' };
  const href = linkOf(hit, false);
  if (href) out.href = href;
  return out;
}
