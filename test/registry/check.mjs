// node test/registry/check.mjs: checks the committed HPC registry (registry/): counts, size, known entries, links,
// sources and notices. No framework and no network; each check counts, and failures are listed.
import { readdirSync, readFileSync, statSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { deflateSync, gzipSync } from 'node:zlib';
import * as MPI from '../../scripts/registry/data/mpi.mjs';
import * as OPENACC from '../../scripts/registry/data/openacc.mjs';
import * as OPENMP from '../../scripts/registry/data/openmp.mjs';
import * as SCALAPACK_DATA from '../../scripts/registry/data/scalapack.mjs';
import * as LAPACK_BUILDER from '../../scripts/registry/lapack.mjs';
import * as LIB from '../../scripts/registry/lib.mjs';
import * as MPI_BUILDER from '../../scripts/registry/mpi.mjs';
import { pdfOutline } from '../../scripts/registry/pdf.mjs';
import * as SCALAPACK_BUILDER from '../../scripts/registry/scalapack.mjs';
import { LIBRARY_SECTIONS, libraryOf, load, lookup, names } from '../../registry/read.mjs';

const { firstSentence } = LIB;

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const DIR = path.join(ROOT, 'registry');

let failures = 0;
let checks = 0;
const ok = (cond, msg) => {
  checks++;
  if (!cond) {
    failures++;
    console.error('FAIL', msg);
  }
};
const eq = (a, b, msg) => ok(JSON.stringify(a) === JSON.stringify(b), `${msg}: expected ${JSON.stringify(b)}, got ${JSON.stringify(a)}`);
const near = (n, target, msg) => ok(Math.abs(n - target) <= target * 0.05, `${msg}: ${n} is not within 5% of ${target}`);

const lapack = load('lapack');
const scalapack = load('scalapack');
const mpi = load('mpi');
const openmp = load('openmp');
const openacc = load('openacc');
const intrinsics = load('intrinsics');
const vendors = load('vendors');

// ---------------------------------------------------------------- counts (the plan's estimates, within 5%)
{
  near(Object.keys(lapack.entries).length, 2300, 'BLAS and LAPACK routines');
  // the plan estimated 890 for ScaLAPACK, its tools and PBLAS, which their Fortran and PBLAS's p?xxx_ in C give (922);
  // the Fortran-callable C routines of SRC, TOOLS and PBLAS/SRC/PTOOLS (18) come on top, as do REDIST and BLACS
  const sl = Object.values(scalapack.entries);
  const byLibrary = (l) => sl.filter((e) => (e.l ?? 'scalapack') === l).length;
  eq(['scalapack', 'tools', 'pblas', 'redist', 'blacs'].map(byLibrary), [703, 109, 128, 10, 78],
    'ScaLAPACK (13 in C), TOOLS (2 in C), PBLAS (3 of PTOOLS), REDIST (p?gemr2d, p?trmr2d) and BLACS routines');
  near(Object.keys(mpi.entries).length, 465, 'MPI entries');
  near(['directives', 'clauses', 'routines', 'env', 'types', 'constants'].reduce((n, s) => n + Object.keys(openmp[s]).length, 0), 463, 'OpenMP entries');
  ok(Object.keys(intrinsics.entries).length >= 210, 'intrinsic procedures');
  ok(Object.keys(openacc.routines).length >= 60 && Object.keys(openacc.directives).length >= 20, 'OpenACC routines and directives');
}

// ---------------------------------------------------------------- size
{
  const files = readdirSync(DIR).filter((f) => statSync(path.join(DIR, f)).isFile());
  const bytes = files.reduce((n, f) => n + statSync(path.join(DIR, f)).size, 0);
  const gz = files.reduce((n, f) => n + gzipSync(readFileSync(path.join(DIR, f)), { level: 9 }).length, 0);
  // 1.2 MB until the summaries kept their whole first sentences (up to 200 code points) and ScaLAPACK its C routines
  ok(bytes <= 1_250_000, `the registry is at most 1.25 MB: ${bytes} bytes`);
  ok(gz <= 250_000, `the registry gzips to at most 250,000 bytes: ${gz} bytes`);
  for (const f of ['lapack.json', 'scalapack.json', 'mpi.json', 'openmp.json', 'openacc.json', 'intrinsics.json', 'vendors.json', 'SOURCES.md', 'NOTICE', 'read.mjs']) {
    ok(files.includes(f), `registry/${f} exists`);
  }
  console.log(`registry: ${files.length} files, ${bytes.toLocaleString('en-GB')} bytes, ${gz.toLocaleString('en-GB')} gzipped`);
}

// ---------------------------------------------------------------- dgesv
{
  const e = lookup('lapack', 'DGESV');
  ok(e, 'dgesv is in lapack.json');
  eq(e.kind, 'subroutine', 'dgesv kind');
  eq(e.args.map((a) => a[0]), ['n', 'nrhs', 'a', 'lda', 'ipiv', 'b', 'ldb', 'info'], 'dgesv argument names');
  eq(e.args.map((a) => a[1]), ['in', 'in', 'inout', 'in', 'out', 'inout', 'in', 'out'], 'dgesv intents');
  eq(e.args[2][2], 'double precision(lda,n)', 'dgesv A type, with the documented dimensions');
  eq(e.args[4][2], 'integer(n)', 'dgesv IPIV type');
  eq(e.family.id, 'gesv', 'dgesv family');
  eq([...e.family.members].sort(), ['cgesv', 'dgesv', 'sgesv', 'zgesv'], 'gesv family members');
  ok(e.tags.includes('ld') && e.tags.includes('info'), 'dgesv tags: ld, info');
  eq(e.ld, { lda: 'max(1,n)', ldb: 'max(1,n)' }, 'dgesv leading dimensions');
  ok(/^Computes the solution to/.test(e.summary), `dgesv summary: ${e.summary}`);
  eq(e.links.netlib, 'https://netlib.org/lapack/explore-html/d8/da6/group__gesv_ga831ce6a40e7fd16295752d18aed2d541.html#ga831ce6a40e7fd16295752d18aed2d541', 'dgesv Netlib member page');
  eq(e.links.netlibFile, 'https://netlib.org/lapack/explore-html/d8/d72/dgesv_8f.html', 'dgesv Netlib file page (md5 rule)');
  eq(e.links.mkl, 'https://www.intel.com/content/www/us/en/docs/onemkl/developer-reference-fortran/2026-2/gesv.html', 'dgesv oneMKL page');
  const z = lookup('lapack', 'zgesv');
  eq(z.args[2][2], 'complex*16(lda,n)', 'zgesv A type from the T template');
  eq(lookup('lapack', 'cgesv').args[2][2], 'complex(lda,n)', 'cgesv A type');
}

// ---------------------------------------------------------------- families come from \ingroup, not from the prefix
{
  eq(lookup('lapack', 'dsyev').family.id, 'heev', 'dsyev is in heev');
  eq(lookup('lapack', 'dsgesv').family.id, 'gesv_mixed', 'dsgesv is in gesv_mixed');
  eq(lookup('lapack', 'dsgesv').family.name, 'gesv', 'gesv_mixed shows as gesv');
  eq(lookup('lapack', 'idamax').family.id, 'iamax', 'idamax is in iamax');
  eq(lookup('lapack', 'dznrm2').family.id, 'nrm2', 'dznrm2 is in nrm2');
  const zheev = lookup('lapack', 'zheev');
  eq(zheev.args.find((a) => a[0] === 'rwork')?.[2], 'double precision(max(1,3*n-2))', 'zheev RWORK: the R template is double precision');
  ok(zheev.tags.includes('wsq'), 'zheev documents the LWORK = -1 workspace query');
  eq(lookup('lapack', 'dlamch').result, 'double precision', 'dlamch result');
  eq(lookup('lapack', 'dgemm').args[0], ['transa', 'in', 'character'], 'dgemm TRANSA');
  ok(lookup('lapack', 'dgeqpf').tags.includes('dep'), 'dgeqpf is deprecated');
}

// ---------------------------------------------------------------- every LAPACK and ScaLAPACK entry expands, with a link
for (const id of ['lapack', 'scalapack']) {
  let bad = 0;
  let unlinked = 0;
  for (const n of names(id)) {
    const e = lookup(id, n);
    if (!e || e.args.some((a) => !a[0] || typeof a[2] !== 'string' || /^[TR?]/.test(a[2]) || a[2].includes('?'))) bad++;
    if (!e.links.netlib && !e.links.netlibFile) unlinked++;
  }
  eq(bad, 0, `${id}: entries with unresolved argument types`);
  eq(unlinked, 0, `${id}: entries without a Netlib link`);
  const tags = Object.keys(load(id).legend.tags);
  ok(names(id).every((n) => lookup(id, n).tags.every((t) => tags.includes(t))), `${id}: every tag is in the legend`);
}
{
  const counts = (t) => names('lapack').filter((n) => lookup('lapack', n).tags.includes(t)).length;
  near(counts('wsq'), 570, 'LAPACK routines with the LWORK = -1 workspace query');
  ok(counts('info') > 900, 'LAPACK routines with the INFO convention');
  ok(counts('ld') > 1400, 'LAPACK routines with leading-dimension arguments');
}

// ---------------------------------------------------------------- pdgesv
{
  const e = lookup('scalapack', 'pdgesv');
  ok(e, 'pdgesv is in scalapack.json');
  eq(e.library, 'scalapack', 'pdgesv library');
  eq(e.family.id, 'p?gesv', 'pdgesv family');
  eq(e.args.map((a) => a[0]), ['n', 'nrhs', 'a', 'ia', 'ja', 'desca', 'ipiv', 'b', 'ib', 'jb', 'descb', 'info'], 'pdgesv arguments');
  eq(e.args[0], ['n', 'in', 'integer', 'g'], 'pdgesv N: global input');
  eq(e.args[2].slice(1), ['inout', 'double precision(lld_a,locc(ja+n-1))', 'l'], 'pdgesv A: local input/output');
  eq(e.args[5].slice(1), ['in', 'integer(dlen_)', 'gl'], 'pdgesv DESCA: global and local input');
  ok(e.tags.includes('desc') && e.tags.includes('info'), 'pdgesv tags: desc, info');
  ok(/^https:\/\/netlib\.org\/scalapack\/explore-html\/d[0-9a-f]\/d[0-9a-f]{2}\/pdgesv_8f_a[0-9a-f]{32}\.html#a[0-9a-f]{32}$/.test(e.links.netlib), `pdgesv Netlib member page: ${e.links.netlib}`);
  eq(e.links.mkl, 'https://www.intel.com/content/www/us/en/docs/onemkl/developer-reference-fortran/2026-2/p-gesv.html', 'pdgesv oneMKL page');
  eq(lookup('scalapack', 'pzheevd').args.find((a) => a[0] === 'rwork')?.[2]?.startsWith('double precision'), true, 'pzheevd RWORK is double precision');
  for (const n of ['descinit', 'numroc', 'indxg2p', 'pdgemm', 'pdgemr2d', 'blacs_gridinit', 'blacs_gridinfo', 'dgesd2d', 'igsum2d']) ok(lookup('scalapack', n), `${n} is in scalapack.json`);
  eq(lookup('scalapack', 'numroc').kind, 'function', 'numroc is a function');
  ok(lookup('scalapack', 'blacs_gridinit').tags.includes('coll'), 'blacs_gridinit: every process must call');
  ok(lookup('scalapack', 'pdgemm').tags.includes('desc'), 'pdgemm takes descriptors');
  ok(names('scalapack').filter((n) => lookup('scalapack', n).tags.includes('wsq')).length > 200, 'ScaLAPACK routines with the workspace query');
}

// ---------------------------------------------------------------- MPI_Allreduce
{
  const e = lookup('mpi', 'mpi_allreduce');
  ok(e, 'MPI_Allreduce is in mpi.json (any case)');
  eq(e.name, 'MPI_Allreduce', 'MPI_Allreduce spelling');
  eq(e.category, 'collective', 'MPI_Allreduce category');
  ok(e.tags.includes('coll') && !e.tags.includes('p2p'), 'MPI_Allreduce is collective');
  ok(e.tags.includes('ierr'), 'MPI_Allreduce: ierror is optional in mpi_f08');
  eq(e.args.map((a) => a[0]), ['sendbuf', 'recvbuf', 'count', 'datatype', 'op', 'comm', 'ierror'], 'MPI_Allreduce arguments');
  eq(e.args[0].slice(1), ['in', 'type(*)(..)'], 'MPI_Allreduce sendbuf');
  eq(e.args[3][2], 'type(MPI_Datatype)', 'MPI_Allreduce datatype');
  eq(e.args[6], ['ierror', 'out', 'integer', '?'], 'MPI_Allreduce ierror');
  eq(e.links.openmpi, 'https://docs.open-mpi.org/en/v5.0.x/man-openmpi/man3/MPI_Allreduce.3.html', 'MPI_Allreduce Open MPI page');
  eq(e.links.mpich, 'https://www.mpich.org/static/docs/v5.0.2/www3/MPI_Allreduce.html', 'MPI_Allreduce MPICH page');
  eq(e.links['standard-5.0'], 'https://www.mpi-forum.org/docs/mpi-5.0/mpi50-report/node138.htm', 'MPI_Allreduce in MPI 5.0');
  eq(e.links['standard-4.1'], 'https://www.mpi-forum.org/docs/mpi-4.1/mpi41-report/node136.htm', 'MPI_Allreduce in MPI 4.1');
  ok(/^Combines values/.test(e.summary), `MPI_Allreduce summary: ${e.summary}`);
  const send = lookup('mpi', 'MPI_Send');
  ok(send.tags.includes('p2p') && !send.tags.includes('coll'), 'MPI_Send is point-to-point');
  ok(lookup('mpi', 'MPI_Isend').tags.includes('nb'), 'MPI_Isend is nonblocking');
  ok(lookup('mpi', 'MPI_Comm_split').tags.includes('coll'), 'MPI_Comm_split is collective');
  eq(lookup('mpi', 'MPI_Wtime').kind, 'function', 'MPI_Wtime is a function');
  eq(lookup('mpi', 'MPI_User_function').kind, 'callback interface', 'MPI_User_function');
  eq(lookup('mpi', 'MPI_Abi_get_version').since, '5.0', 'MPI_Abi_get_version is new in 5.0');
  ok(names('mpi').filter((n) => lookup('mpi', n).since).length <= 10, 'few procedures are new in 5.0');
  ok(names('mpi').every((n) => lookup('mpi', n).summary), 'every MPI entry has a summary');
  ok(names('mpi').filter((n) => lookup('mpi', n).links['standard-5.0']).length >= 430, 'MPI 5.0 definition pages');
  ok(names('mpi').filter((n) => lookup('mpi', n).links['standard-4.1']).length >= 420, 'MPI 4.1 definition pages');
  ok(mpi.modules['mpif.h'].deprecated === '4.1', 'mpif.h is deprecated since MPI 4.1');
}

// ---------------------------------------------------------------- omp_get_thread_num and parallel do
{
  const e = lookup('openmp', 'omp_get_thread_num');
  ok(e, 'omp_get_thread_num is in openmp.json');
  eq(e.section, 'routines', 'omp_get_thread_num section');
  eq(e.kind, 'function', 'omp_get_thread_num kind');
  eq(e.result, 'integer(omp_integer_kind)', 'omp_get_thread_num result');
  eq(e.links['spec-5.2'], 'https://www.openmp.org/spec-html/5.2/openmpsu140.html#ompgetthreadnum', 'omp_get_thread_num in OpenMP 5.2');
  ok(/^https:\/\/www\.openmp\.org\/spec-html\/6\.1\/openmp\w+\.html#ompgetthreadnum-routine$/.test(e.links['spec-6.1']), `omp_get_thread_num in OpenMP 6.1: ${e.links['spec-6.1']}`);
  eq(e.links.spec, e.links['spec-5.2'], 'the default OpenMP version is 5.2');
  eq(e.links.libgomp, 'https://gcc.gnu.org/onlinedocs/libgomp/omp_005fget_005fthread_005fnum.html', 'omp_get_thread_num in libgomp');

  const pd = lookup('openmp', 'parallel do', { section: 'directives' });
  ok(pd, 'parallel do is in openmp.json');
  eq(pd.kind, 'compound', 'parallel do kind');
  eq(pd.leaves, ['parallel', 'do'], 'parallel do leaves');
  ok(pd.tags.includes('par') && pd.tags.includes('ws'), 'parallel do opens a parallel region and shares work');
  ok(['6.1', '6.0', '5.2'].every((v) => pd.links[`spec-${v}`]), 'parallel do has a link in every version');
  ok(lookup('openmp', 'PARALLEL  DO', { section: 'directives' }), 'directive lookup ignores case and blanks');
  eq(lookup('openmp', 'declare_simd', { section: 'directives' })?.name, 'declare simd', 'the 6.x spelling declare_simd finds declare simd');
  eq(lookup('openmp', 'do', { section: 'directives' }).links['spec-6.1'].endsWith('#do-construct'), true, 'do links to its own section');
  ok(lookup('openmp', 'master', { section: 'directives' }).tags.includes('dep'), 'master is deprecated');
  ok(lookup('openmp', 'target teams distribute parallel do simd', { section: 'directives' }).tags.includes('offload'), 'target teams … offloads');
  ok(lookup('openmp', 'reduction', { section: 'clauses' }), 'the reduction clause');
  ok(lookup('openmp', 'OMP_NUM_THREADS', { section: 'env' }).links.libgomp.endsWith('OMP_005fNUM_005fTHREADS.html'), 'OMP_NUM_THREADS in libgomp');
  eq(lookup('openmp', 'omp_sched_dynamic', { section: 'constants' }).type, 'integer(omp_sched_kind)', 'omp_sched_dynamic type');
  for (const s of ['directives', 'clauses', 'routines', 'env']) {
    ok(Object.keys(openmp[s]).every((n) => lookup('openmp', n, { section: s }).links.spec), `every OpenMP ${s} entry has a link`);
  }
}

// ---------------------------------------------------------------- OpenACC, intrinsics, vendors
{
  const pl = lookup('openacc', 'parallel loop', { section: 'directives' });
  eq(pl.parts, ['parallel', 'loop'], 'OpenACC parallel loop');
  ok(/OpenACC_3\.4\.pdf#page=\d+$/.test(pl.links.spec), 'OpenACC parallel loop page');
  ok(lookup('openacc', 'acc_copyin', { section: 'routines' }).links.spec, 'acc_copyin page');
  ok(['directives', 'clauses', 'routines', 'env'].every((s) => Object.keys(openacc[s]).every((n) => openacc[s][n].pg)), 'every OpenACC entry has a page');
  // each runtime routine is a subroutine or a function, as its Fortran form in the specification says; the
  // deprecated names are those of the routines they stand for
  const accKind = (n) => lookup('openacc', n, { section: 'routines' })?.kind;
  const accNames = ['acc_init', 'acc_get_num_devices', 'acc_get_device_type', 'acc_get_property',
    'acc_get_property_string', 'acc_wait_all', 'acc_async_test_all', 'acc_on_device', 'acc_malloc', 'acc_free',
    'acc_delete', 'acc_is_present', 'acc_memcpy_d2d', 'acc_pcopyin', 'acc_present_or_create'];
  eq(accNames.map(accKind), ['subroutine', 'function', 'function', 'function', 'subroutine', 'subroutine', 'function',
    'function', 'function', 'subroutine', 'subroutine', 'function', 'subroutine', 'subroutine', 'subroutine'],
  'OpenACC routines: subroutines and functions');
  const accKinds = Object.values(openacc.routines).map((e) => e.k);
  eq([accKinds.filter((k) => k === 'function').length, accKinds.filter((k) => k === 'subroutine').length,
    accKinds.length], [16, 53, 69], 'every OpenACC routine is a subroutine or a function: 16 functions');
  eq(libraryOf('ACC_IS_PRESENT')?.entry.kind, 'function', 'libraryOf gives the kind');

  const mm = lookup('intrinsics', 'MATMUL');
  eq(mm.kind, 'function', 'matmul kind');
  eq(mm.links['fortran-lang'], 'https://fortran-lang.org/learn/intrinsics/transform/#matmul', 'matmul on fortran-lang.org');
  eq(mm.links.gfortran, 'https://gcc.gnu.org/onlinedocs/gcc-16.1.0/gfortran/MATMUL.html', 'matmul in gfortran');
  eq(lookup('intrinsics', 'sum').args.map((a) => a[3] ?? ''), ['', '?', '?'], 'sum: dim and mask are optional');
  eq(lookup('intrinsics', 'co_sum').links.gfortran, 'https://gcc.gnu.org/onlinedocs/gcc-16.1.0/gfortran/CO_005fSUM.html', 'co_sum in gfortran');
  eq(lookup('intrinsics', 'c_f_pointer').module, 'iso_c_binding', 'c_f_pointer comes from iso_c_binding');

  eq(vendors.mkl.lapack95.getrf, ['getrf'], 'lapack95 getrf');
  eq(vendors.mkl.lapack95.syev, ['heev'], 'lapack95 syev maps to the heev family');
  eq(vendors.mkl.blas95.gemmt, [], 'blas95 gemmt is an MKL extension');
  ok(vendors.cublas.overloads.includes('dgemm'), 'use cublas overloads dgemm');
  ok(Object.values(vendors.mkl.lapack95).every((f) => f.every((g) => lapack.groups[g])), 'lapack95 maps to existing LAPACK families');
}

// ---------------------------------------------------------------- BLAS and LAPACK apart: the library is the folder
{
  const library = (n) => lookup('lapack', n)?.library;
  // BLAS/SRC, with the lsame, xerbla and xerbla_array every BLAS ships (LAPACK has copies in SRC and INSTALL)
  for (const n of ['dgemm', 'ddot', 'idamax', 'dznrm2', 'srotmg', 'zgemmtr', 'lsame', 'xerbla', 'xerbla_array']) {
    eq(library(n), 'blas', `${n} is a BLAS routine`);
  }
  // SRC, SRC/DEPRECATED and INSTALL, the BLAS-like auxiliaries of SRC (csyr, icmax1) included
  for (const n of ['dgesv', 'dlamch', 'ilaenv', 'dgeqpf', 'csyr', 'zsyr', 'icmax1', 'scsum1']) {
    eq(library(n), 'lapack', `${n} is a LAPACK routine`);
  }
  eq(names('lapack').filter((n) => library(n) === 'blas').length, 155, 'the routines of BLAS/SRC');
  ok(Object.values(lapack.entries).every((e) => !('l' in e) || e.l === 'blas'), 'lapack.json marks only BLAS routines');
  ok(lapack.legend.libraries?.blas && lapack.legend.fields.l, 'the legend explains the library field');
}

// ---------------------------------------------------------------- summaries: Fortran's dotted names end no sentence
{
  const lsame = 'Returns .TRUE. if CA is the same letter as CB regardless of case.';
  eq(lookup('lapack', 'lsame').summary, lsame, 'lsame summary');
  eq(firstSentence('LSAME returns .TRUE. if CA is the same letter as CB.\n\nMore.'),
    'LSAME returns .TRUE. if CA is the same letter as CB.', 'a logical constant before a word in lower case goes on');
  eq(firstSentence('It is set to .TRUE. Otherwise it is .FALSE.'), 'It is set to .TRUE.',
    'a logical constant before a capital ends one');
  eq(firstSentence('Returns .NOT. A, e.g. for B.'), 'Returns .NOT. A, e.g. for B.', 'an operator takes its operand');
}

// ---------------------------------------------------------------- PXERBLA, ScaLAPACK's error handler
{
  const e = lookup('scalapack', 'PXERBLA');
  ok(e, 'pxerbla is in scalapack.json');
  eq(e?.library, 'pblas', 'pxerbla comes from PBLAS/SRC/PTZBLAS');
  const args = [['ictxt', 'in', 'integer', 'l'], ['srname', 'in', 'character(*)', 'g'], ['info', 'in', 'integer', 'g']];
  eq(e?.args, args, 'pxerbla arguments');
  ok(/^PXERBLA is an error handler for the ScaLAPACK routines/.test(e?.summary), `pxerbla summary: ${e?.summary}`);
  const member = /explore-html\/(d[0-9a-f]\/d[0-9a-f]{2})\/pxerbla_8f_a([0-9a-f]{32})\.html#a\2$/;
  const dir = member.exec(e?.links.netlib)?.[1];
  ok(dir, `pxerbla Netlib member page: ${e?.links.netlib}`);
  eq(e?.links.netlibFile, `https://netlib.org/scalapack/explore-html/${dir}/pxerbla_8f.html`,
    'pxerbla Netlib file page: pxerbla.f, not PTZBLAS/pxerbla.f');
}

// ---------------------------------------------------------------- OpenACC: the page that prints the heading
{
  const page = (section, n) => Number(/#page=(\d+)$/.exec(lookup('openacc', n, { section })?.links.spec ?? '')?.[1]);
  // hyperref left these sections' anchors at the foot of the page before their headings
  const moved = {
    directives: { loop: 64, cache: 75, atomic: 77, set: 87 },
    clauses: { copyin: 55, copyout: 56, create: 57, independent: 69, num_gangs: 38, read: 77, capture: 77 },
    routines: { acc_set_device_num: 108, acc_get_property: 109, acc_get_property_string: 109, acc_wait_any: 115 },
  };
  Object.assign(moved.clauses, { default_async: 87 });
  Object.assign(moved.routines, { acc_memcpy_to_device: 127, acc_memcpy_d2d: 132 });
  // these headings are on their anchors' pages, the foot of a page included (wait clause, page 37)
  const kept = {
    directives: { parallel: 33, 'enter data': 45 },
    clauses: { if: 37, wait: 37, num_workers: 38 },
    routines: { acc_copyin: 118 },
  };
  for (const want of [moved, kept]) {
    for (const [section, pages] of Object.entries(want)) {
      for (const [n, p] of Object.entries(pages)) eq(page(section, n), p, `OpenACC ${n}: page ${p}`);
    }
  }
}
{
  // a PDF of two pages: section 2's anchor is at the foot of page 1, its heading ("2 Second final section", with the
  // fi ligature of the font's encoding) on page 2, in a Flate stream; section 3's heading is on neither page
  const text1 = 'BT /F1 10 Tf 72 700 Td [(1)-1000(First)-333(section)]TJ 0 -400 Td (See 2 Second final section.) Tj ET';
  const text2 = 'BT /F1 10 Tf 72 750 Td [(2)-1000(Second)-333(\\002nal)-333(section)]TJ /F1 5 Tf 300 0 Td (42) Tj ET';
  const bytes = (s) => Buffer.from(s, 'latin1');
  const obj = (n, body) => bytes(`${n} 0 obj\n${body}\nendobj\n`);
  const stream = (n, data, filter = '') => {
    const head = bytes(`${n} 0 obj\n<< /Length ${data.length}${filter} >>\nstream\n`);
    return Buffer.concat([head, data, bytes('\nendstream\nendobj\n')]);
  };
  const dests = [[1, 712], [2, 90], [3, 80]].map(([n, y]) => `(section.${n}) [5 0 R /XYZ 72 ${y} null]`).join(' ');
  const resources = '/Resources << /Font << /F1 9 0 R >> >>';
  const page = (contents) => `<< /Type /Page /Parent 2 0 R ${resources} /Contents ${contents} 0 R >>`;
  const pdf = Buffer.concat([
    bytes('%PDF-1.4\n'),
    obj(1, '<< /Type /Catalog /Pages 2 0 R /Outlines 3 0 R /Names << /Dests 4 0 R >> >>'),
    obj(2, '<< /Type /Pages /Kids [5 0 R 6 0 R] /Count 2 >>'),
    obj(3, '<< /Type /Outlines /First 7 0 R /Last 13 0 R /Count 4 >>'),
    obj(4, `<< /Names [${dests}] >>`),
    obj(5, page(10)),
    obj(6, page(11)),
    obj(7, '<< /Title (First section) /Dest (section.1) /Parent 3 0 R /Next 8 0 R >>'),
    obj(8, '<< /Title (Second final section) /Dest (section.2) /Parent 3 0 R /Next 12 0 R >>'),
    obj(9, '<< /Type /Font /Subtype /Type1 /BaseFont /Times-Roman /Encoding 14 0 R >>'),
    stream(10, bytes(text1)),
    stream(11, deflateSync(bytes(text2)), ' /Filter /FlateDecode'),
    obj(12, '<< /Title (Third section) /Dest (section.3) /Parent 3 0 R /Next 13 0 R >>'),
    obj(13, '<< /Title (Index) /Dest [6 0 R /XYZ 72 750 null] /Parent 3 0 R >>'),
    obj(14, '<< /Type /Encoding /BaseEncoding /WinAnsiEncoding /Differences [2 /fi] >>'),
  ]);
  const { pages, outline, lines } = pdfOutline(pdf);
  eq(pages, 2, 'pdfOutline: pages');
  eq([lines?.(1), lines?.(2)], ['1 First section\nSee 2 Second final section.', '2 Second final section'],
    'pdfOutline: a page\'s text as lines, with blanks where a TJ array leaves a gap and without text below 7 points');
  const want = [
    ['First section', 1, 1, true],
    ['Second final section', 1, 2, true],
    ['Third section', 1, 1, false],
    ['Index', 2, 2, null],
  ];
  eq(outline.map((o) => [o.title, o.anchor, o.page, o.printed]), want,
    'pdfOutline: a heading printed only on the page after its anchor moves the entry; a mention in a line does not');
}

// ---------------------------------------------------------------- names() and lookup() agree
{
  ok(lookup('openacc', 'host_data'), 'lookup finds host_data, as names lists it');
  eq(lookup('openacc', 'host data', { section: 'directives' })?.name, 'host_data', 'host data finds host_data');
  eq(lookup('openacc', 'enter_data', { section: 'directives' })?.name, 'enter data', 'enter_data finds enter data');
  const sections = {
    mpi: ['entries', 'types'],
    openmp: ['directives', 'clauses', 'routines', 'env', 'types', 'constants'],
    openacc: ['directives', 'clauses', 'routines', 'env'],
  };
  for (const [id, list] of Object.entries(sections)) {
    for (const s of list) {
      const lost = names(id, s).filter((n) => lookup(id, n, { section: s })?.name !== n);
      eq(lost, [], `${id} ${s}: lookup finds every name names() lists`);
    }
  }
  const tried = (f) => {
    try {
      return f();
    } catch (err) {
      return err.message;
    }
  };
  const ids = ['lapack', 'scalapack', 'mpi', 'openmp', 'openacc', 'intrinsics'];
  eq(ids.map((id) => tried(() => lookup(id, 'constructor'))), Array(6).fill(null),
    'a name only Object.prototype has (constructor) is in no registry');
  const message = tried(() => names('vendors'));
  ok(/load\('vendors'\)/.test(message), `names('vendors') says to use load(): ${message}`);
}

// ---------------------------------------------------------------- mpi_f08's derived types
{
  const std = (v, n) => `https://www.mpi-forum.org/docs/mpi-${v}/mpi${v.replace('.', '')}-report/node${n}.htm`;
  const t = lookup('mpi', 'mpi_comm');
  ok(t, 'MPI_Comm is in mpi.json (any case)');
  eq([t?.section, t?.name, t?.kind, t?.module], ['types', 'MPI_Comm', 'type', 'mpi_f08'],
    'MPI_Comm: a derived type of mpi_f08');
  eq(t?.components, [['MPI_VAL', 'integer']], 'MPI_Comm holds one integer, MPI_VAL');
  eq(t?.legacy, 'integer', 'use mpi and mpif.h declare a communicator integer');
  eq(t?.nullHandle, 'MPI_COMM_NULL', 'the null communicator');
  eq(t?.links, { 'standard-5.0': std('5.0', 35), 'standard-4.1': std('4.1', 33) },
    'MPI_Comm: Opaque Objects in MPI 5.0 and 4.1');
  const st = lookup('mpi', 'MPI_Status');
  eq(st?.components?.map((c) => c[0]), ['MPI_SOURCE', 'MPI_TAG', 'MPI_ERROR'], 'MPI_Status: its public components');
  eq(st?.legacy, 'integer, dimension(MPI_STATUS_SIZE)', 'use mpi and mpif.h declare a status an integer array');
  eq(st?.nullHandle, null, 'a status is no handle');
  eq(st?.links, { 'standard-5.0': std('5.0', 62), 'standard-4.1': std('4.1', 60) },
    'MPI_Status: Return Status in MPI 5.0 and 4.1');
  const typeOf = (a) => /^type\((MPI_\w+)\)/.exec(a[2])?.[1];
  const used = new Set(names('mpi').flatMap((n) => lookup('mpi', n).args.map(typeOf).filter(Boolean)));
  eq(names('mpi', 'types'), [...used].sort(), 'an entry for each type the mpi_f08 arguments use');
  eq(names('mpi', 'types').length, 12, 'the 12 types');
  for (const n of Object.keys(mpi.types ?? {})) {
    const e = lookup('mpi', n, { section: 'types' });
    const full = e?.summary === MPI.TYPES?.[n] && e.legacy && e.components.length;
    ok(full && e.links['standard-5.0'] && e.links['standard-4.1'], `${n}: one-liner, use mpi form, components, links`);
    if (n !== 'MPI_Status') {
      const handle = [[['MPI_VAL', 'integer']], `${n.toUpperCase()}_NULL`];
      eq([e?.components, e?.nullHandle], handle, `${n}: a handle, with its null handle`);
    }
  }
  eq(lookup('mpi', 'MPI_Comm', { section: 'entries' }), null, 'the procedures and the types are apart');
  ok(!names('mpi').includes('MPI_Comm') && names('mpi').includes('MPI_Comm_rank'),
    'names(mpi) lists the procedures and callbacks');
  ok(mpi.legend.typeFields && mpi.legend.sections?.types, 'the legend explains the types');
}

// ---------------------------------------------------------------- omp_lib's kinds: integer kind parameters
{
  const k = lookup('openmp', 'OMP_LOCK_KIND');
  eq([k?.section, k?.kind, k?.type], ['types', 'kind', 'integer'],
    'omp_lock_kind: an integer kind parameter, not a derived type');
  ok(/^Integer kind of a simple lock/.test(k?.summary), `omp_lock_kind summary: ${k?.summary}`);
  ok(k?.links.spec?.endsWith('#openmp-lock-type'), 'omp_lock_kind links to the OpenMP lock type');
  for (const n of ['omp_integer_kind', 'omp_logical_kind']) {
    const e = lookup('openmp', n, { section: 'types' });
    ok(e?.kind === 'kind' && /LLVM’s omp_lib/.test(e.summary), `${n}: an entry, which says whose name it is`);
  }
  const sync = lookup('openmp', 'omp_sync_hint_kind').links.spec;
  eq(lookup('openmp', 'omp_lock_hint_kind')?.links.spec, sync, 'omp_lock_hint_kind links to omp_sync_hint_kind');
  const used = new Set();
  const scan = (t) => {
    for (const m of String(t ?? '').matchAll(/\bomp_\w+_kind\b/g)) used.add(m[0]);
  };
  for (const n of names('openmp', 'routines')) {
    const e = lookup('openmp', n, { section: 'routines' });
    scan(e.result);
    for (const a of e.args ?? []) scan(a[2]);
  }
  for (const n of names('openmp', 'constants')) scan(lookup('openmp', n, { section: 'constants' }).type);
  const missing = [...used].filter((n) => !Object.hasOwn(openmp.types, n)).sort();
  eq(missing, [], 'every omp_*_kind the interfaces and constants use has an entry');
  const kinds = names('openmp', 'types');
  ok(kinds.length >= 18 && kinds.every((n) => lookup('openmp', n, { section: 'types' }).summary === OPENMP.KINDS?.[n]),
    'every kind has our one-liner');
  // a one-liner that names constants of its kind names only those, and all of them unless it says … or such as
  // (omp_pause_resource_kind has four: omp_pause_resume, omp_pause_soft, omp_pause_hard and omp_pause_stop_tool)
  for (const n of kinds) {
    const s = openmp.types[n].s ?? '';
    const named = (s.match(/\bomp_\w+/g) ?? []).filter((c) => Object.hasOwn(openmp.constants, c)).sort();
    const all = Object.keys(openmp.constants).filter((c) => openmp.constants[c].ty === `integer(${n})`).sort();
    ok(named.every((c) => all.includes(c)), `${n}: the constants its one-liner names are of that kind`);
    if (named.length && !/…|such as/.test(s)) eq(named, all, `${n}: its one-liner names every constant of the kind`);
  }
  // OpenMP 5.0 renamed the lock hints of 4.5 to synchronisation hints: the old kind and constants are deprecated
  const dep = (section, n) => {
    const e = lookup('openmp', n, { section });
    return e && [e.tags.includes('dep'), e.deprecated];
  };
  eq(dep('types', 'omp_lock_hint_kind'), [true, '5.0'], 'omp_lock_hint_kind: deprecated in OpenMP 5.0');
  eq(dep('types', 'omp_sync_hint_kind'), [false, null], 'omp_sync_hint_kind: not deprecated');
  for (const h of ['none', 'uncontended', 'contended', 'nonspeculative', 'speculative']) {
    eq(dep('constants', `omp_lock_hint_${h}`), [true, '5.0'], `omp_lock_hint_${h}: deprecated in OpenMP 5.0`);
    eq(dep('constants', `omp_sync_hint_${h}`), [false, null], `omp_sync_hint_${h}: not deprecated`);
  }
  const marked = ['directives', 'routines', 'env', 'types', 'constants'].map((s) => openmp[s]);
  const unused = Object.keys(OPENMP.DEPRECATED).filter((n) => !marked.some((m) => Object.hasOwn(m, n)));
  eq(unused, [], 'every deprecation of data/openmp.mjs marks an entry');
}

// ---------------------------------------------------------------- libraryOf: the library of a name a program writes
{
  const of = (n) => {
    const r = libraryOf(n);
    return r && [r.lib, r.library, r.name, r.section];
  };
  const want = {
    DGEMM: ['lapack', 'blas', 'dgemm', 'entries'],
    xerbla: ['lapack', 'blas', 'xerbla', 'entries'],
    dgesv: ['lapack', 'lapack', 'dgesv', 'entries'],
    PDGESV: ['scalapack', 'scalapack', 'pdgesv', 'entries'],
    numroc: ['scalapack', 'tools', 'numroc', 'entries'],
    pdgemm: ['scalapack', 'pblas', 'pdgemm', 'entries'],
    pdgemr2d: ['scalapack', 'redist', 'pdgemr2d', 'entries'],
    blacs_gridinit: ['scalapack', 'blacs', 'blacs_gridinit', 'entries'],
    pxerbla: ['scalapack', 'pblas', 'pxerbla', 'entries'],
    mpi_allreduce: ['mpi', 'mpi', 'MPI_Allreduce', 'entries'],
    MPI_User_function: ['mpi', 'mpi', 'MPI_User_function', 'entries'],
    mpi_comm: ['mpi', 'mpi', 'MPI_Comm', 'types'],
    omp_get_thread_num: ['openmp', 'openmp', 'omp_get_thread_num', 'routines'],
    omp_lock_kind: ['openmp', 'openmp', 'omp_lock_kind', 'types'],
    omp_sched_static: ['openmp', 'openmp', 'omp_sched_static', 'constants'],
    acc_copyin: ['openacc', 'openacc', 'acc_copyin', 'routines'],
    MatMul: ['intrinsics', 'intrinsics', 'matmul', 'entries'],
  };
  for (const [n, w] of Object.entries(want)) eq(of(n), w, `libraryOf(${n})`);
  // directives, clauses and environment variables are no names a program calls or declares
  const none = ['parallel', 'do', 'reduction', 'host_data', 'OMP_NUM_THREADS', 'my_solver', 'constructor', '__proto__'];
  for (const n of [...none, '']) {
    eq(libraryOf(n), null, `libraryOf(${JSON.stringify(n)}): no library`);
  }
  const r = libraryOf('dgesv');
  eq(r?.entry, lookup('lapack', 'dgesv'), 'libraryOf gives what lookup gives');
  r?.entry.family.members.push('mine');
  ok(r && !libraryOf('dgesv').entry.family.members.includes('mine'), 'each call gives fresh objects');
  const ga = 'ga831ce6a40e7fd16295752d18aed2d541';
  eq(r?.link, `https://netlib.org/lapack/explore-html/d8/da6/group__gesv_${ga}.html#${ga}`,
    'link: the Netlib member page');
  const links = {
    MPI_Send: 'https://docs.open-mpi.org/en/v5.0.x/man-openmpi/man3/MPI_Send.3.html',
    MPI_Comm: 'https://www.mpi-forum.org/docs/mpi-5.0/mpi50-report/node35.htm',
    omp_get_thread_num: lookup('openmp', 'omp_get_thread_num').links.spec,
    acc_copyin: lookup('openacc', 'acc_copyin', { section: 'routines' }).links.spec,
    matmul: 'https://fortran-lang.org/learn/intrinsics/transform/#matmul',
    omp_integer_kind: null,
  };
  for (const [n, link] of Object.entries(links)) eq(libraryOf(n)?.link, link, `libraryOf(${n}).link`);
  const all = LIBRARY_SECTIONS.flatMap(([id, s]) => Object.keys(load(id)[s] ?? {}));
  ok(all.length > 4000, `the procedures, types, kinds and constants of the registry: ${all.length}`);
  const seen = new Map();
  for (const n of all) seen.set(n.toLowerCase(), (seen.get(n.toLowerCase()) ?? 0) + 1);
  eq([...seen].filter(([, k]) => k > 1).map(([n]) => n), ['reshape'],
    'one name is in two libraries: reshape, a TOOLS subroutine of ScaLAPACK and an intrinsic function');
  eq(all.filter((n) => libraryOf(n.toUpperCase())?.name !== n), [], 'libraryOf finds every name, in any case');

  // a CALL names a subroutine: libraryOf(name, { subroutine: true }) gives the subroutine of a name in two libraries
  const sub = (n) => {
    const x = libraryOf(n, { subroutine: true });
    return x && [x.lib, x.library, x.name, x.section, x.entry.kind];
  };
  eq(of('RESHAPE'), ['intrinsics', 'intrinsics', 'reshape', 'entries'], 'reshape: the intrinsic function, by default');
  eq(libraryOf('reshape')?.entry.kind, 'function', 'the intrinsic RESHAPE is a function');
  eq(sub('RESHAPE'), ['scalapack', 'tools', 'reshape', 'entries', 'subroutine'],
    'a CALL of reshape: ScaLAPACK\'s TOOLS subroutine (TOOLS/reshape.c)');
  eq(libraryOf('reshape', { subroutine: true })?.link,
    'https://netlib.org/scalapack/explore-html/d6/dbd/reshape_8c_ad850b10edd8fbfa9c231d84bdae6d349.html#ad850b10edd8fbfa9c231d84bdae6d349',
    'and its link: reshape_ on Netlib\'s page of reshape.c');
  // in one library, the option changes nothing; a function stays a function, which the caller can tell by its kind
  for (const n of ['dgesv', 'pb_topget', 'random_number', 'MPI_Send', 'dlamch', 'acc_is_present', 'MPI_Comm', 'nothing']) {
    eq(libraryOf(n, { subroutine: true }), libraryOf(n), `libraryOf(${n}, { subroutine: true }) is libraryOf(${n})`);
  }
  eq(libraryOf('reshape', {}), libraryOf('reshape'), 'no options: the default');
}

// ---------------------------------------------------------------- ScaLAPACK's Fortran-callable C routines
{
  // SRC (lamov.h's LAMOV for each ?lamov.c, pdlaiect.c, pslaiect.c, pcrot.c, pzrot.c), TOOLS (reshape.c,
  // SL_gridreshape.c) and PBLAS/SRC/PTOOLS (PB_topget_.c, PB_topset_.c, PB_freebuf_.c)
  const want = {
    slamov: 'scalapack', dlamov: 'scalapack', clamov: 'scalapack', zlamov: 'scalapack', pcrot: 'scalapack',
    pzrot: 'scalapack', pdlasnbt: 'scalapack', pslasnbt: 'scalapack', pdlaiectb: 'scalapack', pdlaiectl: 'scalapack',
    pslaiect: 'scalapack', pdlachkieee: 'scalapack', pslachkieee: 'scalapack', reshape: 'tools',
    sl_gridreshape: 'tools', pb_topget: 'pblas', pb_topset: 'pblas', pb_freebuf: 'pblas',
  };
  eq(Object.fromEntries(Object.keys(want).map((n) => [n, lookup('scalapack', n)?.library ?? null])), want,
    'the C routines of SRC, TOOLS and PTOOLS, each in its library');
  const base = 'https://netlib.org/scalapack/explore-html/';
  for (const n of Object.keys(want)) {
    const e = lookup('scalapack', n);
    ok(e?.summary && e.args.every((a) => a[1]) && e.links.netlib?.startsWith(base),
      `${n}: a summary, an intent for each argument and a Netlib member page: ${JSON.stringify(e?.links)}`);
  }
  const dlamov = lookup('scalapack', 'dlamov');
  eq(dlamov?.args, [['uplo', 'in', 'character'], ['m', 'in', 'integer'], ['n', 'in', 'integer'],
    ['a', 'in', 'double precision(lda,*)'], ['lda', 'in', 'integer'], ['b', 'out', 'double precision(ldb,*)'],
    ['ldb', 'in', 'integer']], 'dlamov: ?lacpy\'s arguments, with the types of lamov.h for TYPE double');
  eq([lookup('scalapack', 'zlamov')?.args[3][2], dlamov?.family?.id, dlamov?.family?.members.sort()],
    ['complex*16(lda,*)', '?lamov', ['clamov', 'dlamov', 'slamov', 'zlamov']], 'the ?lamov family');
  eq(dlamov?.links.netlib, `${base}d9/df7/lamov_8h_a492a3202ad065486791bc26ae32b23e2.html#a492a3202ad065486791bc26ae32b23e2`,
    'dlamov links to LAMOV in lamov.h, which dlamov.c names with its macros');
  const pcrot = lookup('scalapack', 'pcrot');
  eq(pcrot?.args.map((a) => a[0]), ['n', 'x', 'ix', 'jx', 'descx', 'incx', 'y', 'iy', 'jy', 'descy', 'incy', 'c', 's'],
    'pcrot: the documented names (DESCX, where the C code says desc_X)');
  eq([pcrot?.args[1], pcrot?.args[11][2], pcrot?.args[12][2], pcrot?.family?.id, pcrot?.tags],
    [['x', 'inout', 'complex(*)', 'l'], 'real', 'complex', 'p?rot', ['desc']],
    'pcrot: types from C, scopes from the prose');
  // the prose of pcrot.c and pzrot.c heads X and Y "(local input)", then says "On output, CX is overwritten with
  // C*X + S*Y", as p?porfs.f heads X "(local input)", then says "On exit, it contains the improved solution vectors"
  const updated = (n, a) => lookup('scalapack', n)?.args.find((x) => x[0] === a)?.[1];
  const inout = [['pcrot', 'x'], ['pcrot', 'y'], ['pzrot', 'x'], ['pzrot', 'y'], ['psporfs', 'x'], ['pdporfs', 'x'],
    ['pcporfs', 'x'], ['pzporfs', 'x']];
  eq(inout.map(([n, a]) => updated(n, a)), Array(8).fill('inout'),
    'an argument headed input whose prose says what it holds on exit is input/output');
  eq([['pdporfs', 'b'], ['pdlaed2', 'z'], ['pclattrs', 'normin'], ['pdgesvd', 'a']].map(([n, a]) => updated(n, a)),
    ['in', 'in', 'in', 'in'],
    'but not B of p?porfs, Z "destroyed" on exit, nor NORMIN, whose prose says what CNORM holds');
  eq([SCALAPACK_BUILDER.scopeIntent('(local input)', 'On output, CX is overwritten with C*X + S*Y.'),
    SCALAPACK_BUILDER.scopeIntent('(global input)', 'The order of A. Unchanged on exit.')],
  [{ intent: 'b', scope: 'l' }, { intent: 'i', scope: 'g' }],
  'scopeIntent: the heading, then what the prose says on exit');
  eq(lookup('scalapack', 'pzrot')?.args.slice(11).map((a) => a[2]), ['double precision', 'complex*16'],
    'pzrot: C and S are double, whatever its prose (copied from pcrot) says');
  eq(lookup('scalapack', 'sl_gridreshape')?.result, 'integer', 'sl_gridreshape is an integer function');
  eq(lookup('scalapack', 'pdlaiectb')?.args[2], ['d', 'in', 'double precision(2*n-1)'], 'pdlaiectb: D from the prose');
  const summaries = {
    pb_topget: 'Returns the row, column or all broadcast and combine topologies.',
    pb_topset: 'Initializes the row-, column- or all- broadcast and combine topologies.',
    pb_freebuf: 'Disposes the dynamic memory allocated by PB_Cgetbuf.',
    pdlasnbt: 'Finds the position of the signbit of a double precision floating point number.',
    pslasnbt: 'Finds the position of the signbit of a single precision floating point number.',
    pzrot: 'Applies a plane rotation, where the cos (C) is real and the sin (S) is complex, and the vectors CX and CY '
      + 'are complex…',
  };
  for (const [n, s] of Object.entries(summaries)) eq(lookup('scalapack', n)?.summary, s, `${n} summary`);
  // the C definitions as the builder reads them: typed, not K&R; neither declarations nor indented ones
  const c = SCALAPACK_BUILDER.cEntryPoints?.([
    '#ifdef __STDC__',
    'void PB_topget_( Int * ICTXT, F_CHAR_T OP, F_CHAR_T SCOPE, F_CHAR_T TOP )',
    '#else',
    'void PB_topget_( ICTXT, OP, SCOPE, TOP )',
    '#endif',
    '{',
    '   void        blacs_abort_();',
    '}',
    'void dlacpy_(const char *UPLO, const F_INTG_FCT *M);',
    'Int sl_gridreshape_(Int *ctxt, Int *pstart)',
    '{ }',
    'Int sl_gridreshape__(Int *ctxt, Int *pstart)',
    '{ }',
    'void reshape( Int* context_in )',
    'void pzaxpy_( n, alpha )',
    '{ }',
  ].join('\n'));
  eq(c && [...c].map(([n, x]) => [n, x.result, x.params?.map((q) => `${q.name}:${q.base}${q.array ? '[]' : ''}`)]), [
    ['pb_topget', null, ['ictxt:integer', 'op:character', 'scope:character', 'top:character']],
    ['sl_gridreshape', 'integer', ['ctxt:integer', 'pstart:integer']],
    ['pzaxpy', null, undefined],
  ], 'cEntryPoints: name_ and name__ (one routine), typed definitions only, K&R ones without parameters');
}

// ---------------------------------------------------------------- Netlib: netlib.org, which answers without a redirect
{
  // www.netlib.org answers each page with a 301 to the same path on netlib.org
  for (const id of ['lapack', 'scalapack']) {
    const base = `https://netlib.org/${id}/explore-html/`;
    eq(load(id).links.netlib.base, base, `${id}: Netlib's base`);
    const off = names(id).filter((n) => Object.entries(lookup(id, n).links)
      .some(([k, u]) => k.startsWith('netlib') && !u.startsWith(base)));
    eq(off, [], `${id}: every Netlib link is on ${base}`);
  }
  const md = readFileSync(path.join(DIR, 'SOURCES.md'), 'utf8');
  ok(md.includes('**Homepage:** <https://netlib.org/lapack/explore-html/>')
    && md.includes('**Homepage:** <https://netlib.org/scalapack/explore-html/>'), 'SOURCES.md links Netlib on netlib.org');
}

// ---------------------------------------------------------------- summaries: the whole first sentence, up to a card's
// 200 code points; no markup, escape or slip of the sources
{
  const all = [];
  const collect = (id, o) => {
    if (Array.isArray(o)) o.forEach((x) => collect(id, x));
    else if (o && typeof o === 'object') {
      for (const [k, v] of Object.entries(o)) {
        if ((k === 's' || k === 'sc') && typeof v === 'string') all.push([id, v]);
        else collect(id, v);
      }
    }
  };
  for (const id of ['lapack', 'scalapack', 'mpi', 'openmp', 'openacc', 'intrinsics', 'vendors']) {
    const { legend, links, ...rest } = load(id);
    collect(id, rest);
  }
  eq(LIB.SUMMARY_MAX, 200, 'the builders keep 200 code points, what routineCard shows');
  eq(all.filter(([, s]) => [...s].length > 200).map(([id, s]) => `${id}: ${s}`), [],
    'every summary fits a card: at most 200 code points');
  // what is still cut: a first sentence longer than 200, or one that goes on in a table or formula (at 110 and 120 code
  // points, 1,191 of LAPACK's 2,265 were cut, 687 of ScaLAPACK's 1,010 and 9 of MPI's 463)
  const cut = (id) => names(id).filter((n) => lookup(id, n).summary?.endsWith('…')).length;
  eq([cut('lapack'), cut('scalapack'), cut('mpi')], [344, 314, 0], 'summaries cut with an ellipsis: LAPACK, ScaLAPACK, MPI');
  // the first sentence whole where it fits (these were cut at 110), through the prose after a formula (dgemv), with
  // LAPACK's UTF-8 (≤, λ) and the words broken at the end of a line joined (infog2l)
  const whole = [
    ['lapack', 'dlarfx', 'Applies an elementary reflector to a general rectangular matrix, with loop unrolling when the '
      + 'reflector has order ≤ 10.'],
    ['lapack', 'cgemv', 'Performs one of the matrix-vector operations y := alpha*A*x + beta*y, or y := alpha*A**T*x + '
      + 'beta*y, or y := alpha*A**H*x + beta*y, where alpha and beta are scalars, x and y are vectors and A is an m…'],
    ['lapack', 'dgemv', 'Performs one of the matrix-vector operations y := alpha*A*x + beta*y, or y := alpha*A**T*x + '
      + 'beta*y, where alpha and beta are scalars, x and y are vectors and A is an m by n matrix.'],
    ['lapack', 'dlagtf', 'Computes an LU factorization of a matrix T-λI, where T is a general tridiagonal matrix, and λ a '
      + 'scalar, using partial pivoting with row interchanges.'],
    ['scalapack', 'infog2l', 'Computes the starting local indexes LRINDX, LCINDX corresponding to the distributed '
      + 'submatrix starting globally at the entry pointed by GRINDX, GCINDX.'],
  ];
  for (const [id, n, s] of whole) eq(lookup(id, n)?.summary, s, `${n}: its whole first sentence, or 200 code points`);
  const maths = `${'𝑥'.repeat(150)} ${'a'.repeat(49)}`;
  eq([LIB.clip?.(maths, 200), LIB.clip?.(`${maths}b c`, 200)], [maths, `${'𝑥'.repeat(150)}…`],
    'clip counts code points (200 of them fit, though they are 350 UTF-16 units), the ellipsis within the limit');
  eq([...(LIB.clip?.('x'.repeat(300), 200) ?? '')].length, 200, 'a text without a blank is cut at the limit');
  // an ellipsis inside a sentence ends none: "W( CLSTRT ), W( CLSTRT+1 ), ... W( CLEND ), DLARRF2 finds …" (?larrf2,
  // whose summary stopped there once 110 code points no longer cut it before), "i = KF, ... , KL-1, have …" (p?laecv)
  eq(firstSentence('Given W( 1 ), W( 2 ), ...\nW( N ), it finds X. Then Y.'),
    'Given W( 1 ), W( 2 ), ... W( N ), it finds X.', 'an ellipsis inside a sentence goes on');
  eq(firstSentence('It stops here...'), 'It stops here...', 'an ellipsis at the end of the text ends it');
  eq(all.filter(([, s]) => /\.\.\.$/.test(s)).map(([id, s]) => `${id}: ${s}`), [],
    'no summary stops at an ellipsis inside its sentence');
  eq(lookup('scalapack', 'pdlaecv')?.summary,
    'Checks if the input intervals [ INTVL(2*i-1), INTVL(2*i) ], i = KF, ... , KL-1, have "converged".',
    'p?laecv summary');

  // Open MPI's RST: substitutions expanded (|mdash|, |deprecated_favor|), escapes undone (*n*\ th is nth)
  eq(lookup('mpi', 'MPI_Info_get_nthkey').summary, 'Returns the nth defined key in info.', 'MPI_Info_get_nthkey summary');
  eq(lookup('mpi', 'MPI_Attr_delete').summary,
    'Deletes attribute value associated with a key — this routine is deprecated in favor of MPI_Comm_delete_attr.',
    'MPI_Attr_delete summary');
  eq(names('mpi').filter((n) => /\\|\|\w+\||\*|``|:ref:/.test(lookup('mpi', n).summary)), [],
    'no MPI summary keeps RST markup');
  const subs = MPI_BUILDER.rstSubstitutions?.([
    '.. |mdash|  unicode:: U+02014 .. Em dash',
    '.. |year| replace:: {year}',
    '.. |deprecated_favor| replace:: this routine is deprecated in favor of',
  ].join('\n'));
  eq(subs && [...subs], [['mdash', '—'], ['deprecated_favor', 'this routine is deprecated in favor of']],
    'rstSubstitutions: unicode and replace, without the configuration\'s variables');
  eq(MPI_BUILDER.rstSummary('.. include_body\n\n:ref:`MPI_X` |mdash| Gets the *n*\\ th **key** \\*not\\* '
    + '|deprecated_favor| :ref:`MPI_Y`.', subs ?? new Map()),
  'Gets the nth key *not* this routine is deprecated in favor of MPI_Y.', 'rstSummary: markup off, escapes undone');

  // slips of the sources, corrected in the builders' CORRECTIONS (registry/SOURCES.md lists them)
  eq(lookup('mpi', 'MPI_Buffer_detach').summary, 'Removes an existing buffer (for use in MPI_Bsend, etc.)',
    'MPI_Buffer_detach: "for use in in" corrected');
  eq(lookup('mpi', 'MPI_Comm_detach_buffer').summary,
    'Removes an existing buffer previously attached to the communicator (for use in MPI_Bsend, etc.)',
    'MPI_Comm_detach_buffer: "communicator(for use in in" corrected');
  eq(lookup('mpi', 'MPI_Session_detach_buffer').summary,
    'Removes an existing buffer previously attached to the session (for use in MPI_Bsend, etc.)',
    'MPI_Session_detach_buffer: "session(for use in in" corrected');
  eq(all.filter(([, s]) => /\b([a-z]{2,}) \1\b/i.test(s)).map(([id, s]) => `${id}: ${s}`), [],
    'no summary repeats a word');
  const md = readFileSync(path.join(DIR, 'SOURCES.md'), 'utf8');
  const tables = [
    ['lapack', LAPACK_BUILDER.CORRECTIONS],
    ['mpi', MPI_BUILDER.CORRECTIONS],
    ['scalapack', SCALAPACK_BUILDER.CORRECTIONS],
  ];
  ok(tables.every(([, t]) => t && Object.keys(t).length), 'the LAPACK, MPI and ScaLAPACK builders have corrections');
  for (const [id, table] of tables) {
    for (const [n, fixes] of Object.entries(table ?? {})) {
      const s = lookup(id, n)?.summary ?? '';
      ok(fixes.every(([from, to]) => !s.includes(from) && md.includes(`\`${from}\` → \`${to}\``)) && md.includes(`\`${n}\``),
        `${n}: corrected, and listed in SOURCES.md`);
    }
  }
  // words LAPACK's and ScaLAPACK's prose breaks at the end of a line, joined; compounds keep their hyphen (row- or
  // column-major, upper- or lower-triangular are no broken words)
  const words = new Set(['topologies', 'problem', 'dependent', 'guard']);
  eq(LIB.dehyphenate?.('combine topo-\n  logies, problem-\n  dependent, row- or column-major', words),
    'combine topologies, problem-dependent, row- or column-major', 'dehyphenate');
  eq(all.filter(([id, s]) => /^(?:sca)?lapack$/.test(id) && /[a-z]- [a-z]/.test(s.replace(/\b(?:row|column|all|upper)- /g, '')))
    .map(([, s]) => s), [], 'no LAPACK or ScaLAPACK summary keeps a word broken at the end of a line');
}

// ---------------------------------------------------------------- our own text only (no specification prose)
{
  const ours = new Set([...Object.values(OPENMP.SUMMARIES).flatMap((m) => Object.values(m))]);
  const omp = ['directives', 'clauses', 'routines', 'env'].flatMap((s) => Object.values(openmp[s]).map((e) => e.s).filter(Boolean));
  ok(omp.every((s) => ours.has(s)), 'every OpenMP summary is one of ours');
  const kindsOurs = new Set(Object.values(OPENMP.KINDS ?? {}));
  ok(Object.values(openmp.types).every((e) => kindsOurs.has(e.s)), 'every OpenMP kind summary is one of ours');
  // ScaLAPACK's C routines without prose: ?lamov, reshape and sl_gridreshape
  const cOurs = Object.entries(SCALAPACK_DATA.C_ROUTINES ?? {}).flatMap(([key, [s]]) =>
    (key.includes('?') ? [...'sdcz'].map((p) => key.replace('?', p)) : [key]).map((n) => [n, s]));
  eq(cOurs.filter(([n, s]) => lookup('scalapack', n)?.summary !== s).map(([n]) => n), [],
    'the summaries of ScaLAPACK\'s C routines without prose are our one-liners');
  ok(cOurs.length === 6, `six such routines: ${cOurs.map(([n]) => n)}`);
  const typesOurs = new Set(Object.values(MPI.TYPES ?? {}));
  ok(Object.values(mpi.types ?? {}).every((e) => typesOurs.has(e.s)), 'every MPI type summary is one of ours');
  const accOurs = new Set([...Object.values(OPENACC.DIRECTIVES).map((d) => d[2]), ...Object.values(OPENACC.CLAUSE_SUMMARIES), ...Object.values(OPENACC.ROUTINE_SUMMARIES), ...Object.values(OPENACC.ENV)]);
  const acc = ['directives', 'clauses', 'routines', 'env'].flatMap((s) => Object.values(openacc[s]).map((e) => e.s).filter(Boolean));
  ok(acc.every((s) => accOurs.has(s)), 'every OpenACC summary is one of ours');
  ok(Object.keys(OPENMP.SUMMARIES.directives).length + Object.keys(OPENMP.SUMMARIES.clauses).length + Object.keys(OPENMP.SUMMARIES.routines).length + Object.keys(OPENMP.SUMMARIES.env).length + acc.length >= 100, 'one-liners for the 100 or so most used OpenMP and OpenACC items');
}

// ---------------------------------------------------------------- sources and notices
{
  const sources = JSON.parse(readFileSync(path.join(ROOT, 'scripts/registry/sources.json'), 'utf8'));
  const lock = JSON.parse(readFileSync(path.join(ROOT, 'scripts/registry/sources.lock.json'), 'utf8')).files;
  const md = readFileSync(path.join(DIR, 'SOURCES.md'), 'utf8');
  const notice = readFileSync(path.join(DIR, 'NOTICE'), 'utf8');
  for (const s of sources.sources) {
    ok(md.includes(`### ${s.name}`) && md.includes(s.version) && md.includes(s.licence), `SOURCES.md covers ${s.id}`);
    for (const u of Object.values(s.urls)) {
      if (!u.includes('{')) ok(/^[0-9a-f]{64}$/.test(lock[u] ?? ''), `${u} is pinned`);
      else ok(Object.keys(lock).some((k) => new RegExp(`^${u.replace(/[.*+?^$()|[\]\\]/g, '\\$&').replace(/\\?\{[^}]+\\?\}/g, '[^/]+')}$`).test(k)), `${u} has pinned downloads`);
    }
  }
  for (const id of new Set([lapack, scalapack, mpi, openmp, openacc, intrinsics].flatMap((r) => r.sources))) {
    ok(sources.sources.some((s) => s.id === id), `source ${id} of a registry file is described in sources.json`);
  }
  for (const marker of ['Reference-LAPACK', 'Reference-ScaLAPACK', 'Open MPI', 'MPI ABI stubs', 'LLVM', 'M_intrinsics', 'fortran-lang.org', 'Apache License', 'LLVM Exceptions', 'Redistribution and use', 'Permission is hereby granted']) {
    ok(notice.includes(marker), `NOTICE includes ${marker}`);
  }
  for (const l of sources.links) ok(md.includes(l.url), `SOURCES.md lists the link target ${l.name}`);
  // the OpenACC builder reads the text of the PDF's pages too, to find the page that prints each heading
  const acc = sources.sources.find((s) => s.id === 'openacc-spec')?.name;
  ok(!/outline only/.test(acc) && /heading/.test(acc), `the OpenACC source says what is read: ${acc}`);
  // and whether each routine is a subroutine or a function, from its Fortran form
  const accUses = sources.sources.find((s) => s.id === 'openacc-spec')?.uses ?? '';
  ok(/Fortran form/.test(acc) && /subroutine or a function/.test(accUses)
    && md.includes('whether each routine is a subroutine or a function'),
  'the OpenACC source names the routines\' forms');
}

console.log(`${checks - failures}/${checks} registry checks passed`);
if (failures) process.exit(1);
