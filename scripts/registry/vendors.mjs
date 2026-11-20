// Builds registry/vendors.json from the hand-curated data/vendors.mjs: Intel oneMKL (with the generic names of its
// lapack95 and blas95 modules, mapped to LAPACK families), OpenBLAS and cuBLAS. It reads registry/lapack.json, so
// lapack.mjs runs first.
//
//   node scripts/registry/vendors.mjs
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import {
  BLAS95,
  CUBLAS_BLAS,
  CUBLAS_ROUTINES,
  LAPACK95,
  MKL_ENV,
  MKL_EXTENSIONS,
  MKL_MODULES,
  OPENBLAS,
  OPENBLAS_ENV,
} from './data/vendors.mjs';
import { formatRegistry, isMain, OUT_DIR, writeRegistry } from './lib.mjs';

export const MKL_VERSION = '2026-2';

/** Generic name → the LAPACK families of its precision variants (getrf → getrf; syev → heev, as dsyev is in heev). */
function familiesOf(generic, entries) {
  const out = new Set();
  for (const [name, e] of Object.entries(entries)) {
    for (let i = 0; i < name.length; i++) {
      if ('sdcz'.includes(name[i]) && name.slice(0, i) + name.slice(i + 1) === generic && e.g) out.add(e.g);
    }
  }
  return [...out].sort();
}

export async function build() {
  const lapack = JSON.parse(await readFile(path.join(OUT_DIR, 'lapack.json'), 'utf8'));
  const problems = [];
  const map = (names, extensions) =>
    Object.fromEntries(
      names.map((g) => {
        const fams = familiesOf(g, lapack.entries);
        if (!fams.length && !extensions.has(g)) problems.push(`${g}: no LAPACK or BLAS routine`);
        return [g, fams];
      }),
    );
  const mklExtensions = new Set(Object.keys(MKL_EXTENSIONS).map((n) => n.replace('?', '')));

  const out = {
    format: 1,
    id: 'vendors',
    title: 'Vendor libraries',
    sources: [],
    legend: {
      note: 'Hand-curated names and our own one-liners; ? stands for the precision letters s, d, c and z.',
      generic: 'lapack95 and blas95 map each generic name to the LAPACK families of its precision variants (lapack.json groups); an empty list marks an MKL extension',
    },
    mkl: {
      name: 'Intel oneMKL',
      version: MKL_VERSION.replace('-', '.'),
      modules: MKL_MODULES,
      lapack95: map(LAPACK95, mklExtensions),
      blas95: map(BLAS95, mklExtensions),
      extensions: MKL_EXTENSIONS,
      env: MKL_ENV,
      links: {
        base: `https://www.intel.com/content/www/us/en/docs/onemkl/developer-reference-fortran/${MKL_VERSION}/`,
        page: '{slug}.html',
        rule: 'see lapack.json and scalapack.json; intel.com answers scripts with 403',
      },
    },
    openblas: {
      name: 'OpenBLAS',
      extensions: Object.fromEntries(Object.entries(OPENBLAS).map(([n, [s, section]]) => [n, { s, section }])),
      env: OPENBLAS_ENV,
      links: {
        extensions: 'https://www.openmathlib.org/OpenBLAS/docs/extensions/#{section}',
        env: 'https://www.openmathlib.org/OpenBLAS/docs/runtime_variables/',
      },
    },
    cublas: {
      name: 'cuBLAS (NVIDIA HPC SDK Fortran interfaces)',
      modules: { cublas: 'cuBLAS, with the BLAS names overloaded for device arrays', cublas_v2: 'the cuBLAS v2 interfaces, which take a handle' },
      routines: CUBLAS_ROUTINES,
      overloads: CUBLAS_BLAS,
      links: { base: 'https://docs.nvidia.com/hpc-sdk/compilers/fortran-cuda-interfaces/index.html', anchor: '#{lower-case name}' },
    },
  };
  const text = formatRegistry(out, []);
  const bytes = await writeRegistry('vendors.json', text);
  const stats = {
    lapack95: LAPACK95.length,
    blas95: BLAS95.length,
    mklExtensions: Object.keys(MKL_EXTENSIONS).length,
    openblas: Object.keys(OPENBLAS).length,
    cublasRoutines: CUBLAS_ROUTINES.length,
    cublasOverloads: CUBLAS_BLAS.length,
    entries: LAPACK95.length + BLAS95.length + Object.keys(MKL_EXTENSIONS).length + Object.keys(MKL_ENV).length + Object.keys(OPENBLAS).length + Object.keys(OPENBLAS_ENV).length + CUBLAS_ROUTINES.length + CUBLAS_BLAS.length,
    problems,
    bytes,
  };
  return { file: 'vendors.json', bytes, stats };
}

if (isMain(import.meta.url)) {
  const { stats } = await build();
  console.log(JSON.stringify(stats, null, 2));
}
