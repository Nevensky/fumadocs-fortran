// node test/registry/check.mjs: checks the committed HPC registry (registry/): counts, size, known entries, links,
// sources and notices. No framework and no network; each check counts, and failures are listed.
import { readdirSync, readFileSync, statSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { gzipSync } from 'node:zlib';
import * as OPENACC from '../../scripts/registry/data/openacc.mjs';
import * as OPENMP from '../../scripts/registry/data/openmp.mjs';
import { load, lookup, names } from '../../registry/read.mjs';

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
  // the estimate of 890 covered ScaLAPACK, its tools and PBLAS; REDIST and BLACS come on top
  const sl = Object.values(scalapack.entries);
  near(sl.filter((e) => !e.l || e.l === 'tools' || e.l === 'pblas').length, 890, 'ScaLAPACK, TOOLS and PBLAS routines');
  eq(sl.filter((e) => e.l === 'redist').length, 10, 'REDIST routines (p?gemr2d, p?trmr2d)');
  ok(sl.filter((e) => e.l === 'blacs').length >= 70, 'BLACS routines');
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
  ok(bytes <= 1_200_000, `the registry is at most 1.2 MB: ${bytes} bytes`);
  ok(gz <= 250_000, `the registry gzips to about 0.2 MB: ${gz} bytes`);
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
  eq(e.links.netlib, 'https://www.netlib.org/lapack/explore-html/d8/da6/group__gesv_ga831ce6a40e7fd16295752d18aed2d541.html#ga831ce6a40e7fd16295752d18aed2d541', 'dgesv Netlib member page');
  eq(e.links.netlibFile, 'https://www.netlib.org/lapack/explore-html/d8/d72/dgesv_8f.html', 'dgesv Netlib file page (md5 rule)');
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
  ok(/^https:\/\/www\.netlib\.org\/scalapack\/explore-html\/d[0-9a-f]\/d[0-9a-f]{2}\/pdgesv_8f_a[0-9a-f]{32}\.html#a[0-9a-f]{32}$/.test(e.links.netlib), `pdgesv Netlib member page: ${e.links.netlib}`);
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

// ---------------------------------------------------------------- our own text only (no specification prose)
{
  const ours = new Set([...Object.values(OPENMP.SUMMARIES).flatMap((m) => Object.values(m))]);
  const omp = ['directives', 'clauses', 'routines', 'env'].flatMap((s) => Object.values(openmp[s]).map((e) => e.s).filter(Boolean));
  ok(omp.every((s) => ours.has(s)), 'every OpenMP summary is one of ours');
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
}

console.log(`${checks - failures}/${checks} registry checks passed`);
if (failures) process.exit(1);
