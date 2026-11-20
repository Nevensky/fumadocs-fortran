// Hand-curated vendor data: names (facts about the APIs), our own one-liners, and link targets. Nothing is copied
// from Intel's, NVIDIA's or OpenBLAS's documentation.

/** Generic names of MKL's lapack95 module (Netlib's LAPACK95 without its la_ prefix). */
export const LAPACK95 = `
gesv gesvx gbsv gbsvx gtsv gtsvx posv posvx ppsv ppsvx pbsv pbsvx ptsv ptsvx sysv sysvx hesv hesvx spsv spsvx hpsv hpsvx
gels gelsy gelss gelsd gglse ggglm
syev heev syevd heevd syevx heevx syevr heevr spev hpev spevd hpevd spevx hpevx sbev hbev sbevd hbevd sbevx hbevx
stev stevd stevx stevr gees geesx geev geevx gesvd gesdd ggsvd3 sygv hegv sygvd hegvd sygvx hegvx spgv hpgv spgvd hpgvd
spgvx hpgvx sbgv hbgv sbgvd hbgvd sbgvx hbgvx gges ggesx ggev ggevx
getrf getrs getri gecon gerfs geequ gbtrf gbtrs gbcon gttrf gttrs potrf potrs potri pocon porfs poequ pptrf pptrs pbtrf
pbtrs pttrf pttrs sytrf sytrs sytri sycon hetrf hetrs hetri hecon sptrf sptrs hptrf hptrs trtrs trtri trcon tptrs
geqrf geqp3 orgqr ungqr ormqr unmqr gelqf orglq unglq ormlq unmlq gerqf geqlf
gebrd orgbr ungbr ormbr unmbr bdsqr bdsdc gehrd orghr unghr hseqr trevc trsen sytrd hetrd orgtr ungtr ormtr unmtr
steqr sterf stedc stegr stein stebz pteqr lange lansy lanhe lacpy laset lamch
`.trim().split(/\s+/);

/** Generic names of MKL's blas95 module, with the extensions MKL adds. */
export const BLAS95 = `
asum axpy copy dot dotc dotu nrm2 rot rotg rotm rotmg scal swap iamax iamin sdot
gbmv gemv ger gerc geru hbmv hemv her her2 hpmv hpr hpr2 sbmv spmv spr spr2 symv syr syr2 tbmv tbsv tpmv tpsv trmv trsv
gemm hemm herk her2k symm syrk syr2k trmm trsm gemmt axpby gemm3m
`.trim().split(/\s+/);

/** MKL routines beyond Reference BLAS and LAPACK: name → our one-liner (? stands for s, d, c, z). */
export const MKL_EXTENSIONS = {
  '?gemmt': 'Matrix-matrix product that computes only the upper or lower triangle of the result.',
  '?gemm_batch': 'Computes groups of matrix-matrix products in one call.',
  '?gemm_batch_strided': 'Computes matrix-matrix products of matrices at a fixed stride, in one call.',
  '?gemm3m': 'Complex matrix-matrix product with three real products instead of four.',
  '?axpby': 'y := a*x + b*y.',
  'i?amin': 'Index of the element with the smallest absolute value.',
  '?imatcopy': 'Scales and transposes a matrix in place.',
  '?omatcopy': 'Scales and transposes a matrix out of place.',
  '?omatcopy2': 'Two-stride variant of ?omatcopy.',
  '?omatadd': 'Scales, transposes and adds two matrices.',
  '?getrf_batch': 'LU factorisations of groups of matrices in one call.',
  '?getrs_batch': 'Solves with groups of LU factorisations in one call.',
  mkl_set_num_threads: 'Sets the number of threads MKL uses.',
  mkl_get_max_threads: 'Returns the number of threads MKL may use.',
  mkl_set_num_threads_local: 'Sets the number of MKL threads for the calling thread only.',
  mkl_domain_set_num_threads: 'Sets the number of threads for one MKL domain (BLAS, FFT, …).',
  mkl_set_dynamic: 'Lets MKL lower its number of threads, or stops it.',
  mkl_get_dynamic: 'Returns whether MKL may lower its number of threads.',
  mkl_free_buffers: 'Frees the memory MKL keeps in its buffers.',
  mkl_malloc: 'Allocates aligned memory.',
  mkl_calloc: 'Allocates and zeroes aligned memory.',
  mkl_realloc: 'Changes the size of memory from mkl_malloc.',
  mkl_free: 'Frees memory from mkl_malloc.',
  mkl_get_version_string: 'Returns the MKL version as text.',
  mkl_verbose: 'Turns MKL’s verbose mode on or off.',
  mkl_cbwr_set: 'Sets the conditional numerical reproducibility mode.',
  mkl_enable_instructions: 'Limits the instruction sets MKL dispatches to.',
};

export const MKL_MODULES = {
  lapack95: 'Fortran 95 interfaces to LAPACK: generic names (getrf) with optional arguments',
  blas95: 'Fortran 95 interfaces to BLAS: generic names (gemm) with optional arguments',
  f95_precision: 'the kind parameters (wp, sp, dp) of lapack95 and blas95',
  mkl_service: 'service routines: threads, memory, version',
  mkl_vsl: 'vector statistics: random numbers, convolution, summary statistics',
  mkl_vsl_type: 'the types and constants of mkl_vsl',
  mkl_dfti: 'FFTs (DFTI)',
  mkl_spblas: 'sparse BLAS',
  mkl_rci: 'reverse-communication solvers',
  mkl_pardiso: 'the PARDISO sparse direct solver',
  mkl_cluster_sparse_solver: 'the distributed-memory sparse direct solver',
};

export const MKL_ENV = {
  MKL_NUM_THREADS: 'The number of threads MKL uses.',
  MKL_DYNAMIC: 'Whether MKL may lower its number of threads.',
  MKL_DOMAIN_NUM_THREADS: 'The number of threads per MKL domain.',
  MKL_ENABLE_INSTRUCTIONS: 'The newest instruction set MKL may dispatch to.',
  MKL_CBWR: 'Conditional numerical reproducibility.',
  MKL_VERBOSE: 'Prints the MKL calls and their timings.',
  MKL_THREADING_LAYER: 'The threading layer of the single dynamic library (INTEL, SEQUENTIAL, GNU, TBB).',
  MKL_INTERFACE_LAYER: 'LP64 or ILP64 integers, for the single dynamic library.',
};

/** OpenBLAS: extensions to BLAS (? stands for s, d, c, z) and utility functions, with their documentation section. */
export const OPENBLAS = {
  '?axpby': ['y := a*x + b*y.', 'blas-like-extensions'],
  '?omatcopy': ['Scales and transposes a matrix out of place.', 'blas-like-extensions'],
  '?imatcopy': ['Scales and transposes a matrix in place.', 'blas-like-extensions'],
  '?geadd': ['Adds two scaled matrices: C := a*A + b*C.', 'blas-like-extensions'],
  '?gemmt': ['Matrix-matrix product that computes only the upper or lower triangle of the result.', 'blas-like-extensions'],
  sbgemm: ['Matrix-matrix product in bfloat16, accumulated in single precision.', 'bfloat16-functionality'],
  sbgemv: ['Matrix-vector product in bfloat16.', 'bfloat16-functionality'],
  sbdot: ['Dot product in bfloat16.', 'bfloat16-functionality'],
  shgemm: ['Matrix-matrix product in half precision, accumulated in single precision.', 'half-precision-float-or-fp16-functionality'],
  openblas_set_num_threads: ['Sets the number of threads OpenBLAS uses.', 'utility-functions'],
  openblas_get_num_threads: ['Returns the number of threads OpenBLAS uses.', 'utility-functions'],
  openblas_get_num_procs: ['Returns the number of processors OpenBLAS sees.', 'utility-functions'],
  openblas_get_parallel: ['Returns how OpenBLAS was built to run in parallel: none, threads or OpenMP.', 'utility-functions'],
  openblas_get_config: ['Returns the options OpenBLAS was built with.', 'utility-functions'],
  openblas_get_corename: ['Returns the name of the CPU core OpenBLAS optimises for.', 'utility-functions'],
  openblas_set_affinity: ['Pins an OpenBLAS thread to CPUs.', 'utility-functions'],
};

export const OPENBLAS_ENV = {
  OPENBLAS_NUM_THREADS: 'The number of threads OpenBLAS uses.',
  GOTO_NUM_THREADS: 'An older name of OPENBLAS_NUM_THREADS.',
  OPENBLAS_DEFAULT_NUM_THREADS: 'The number of threads when no other setting applies.',
  OPENBLAS_MAIN_FREE: 'Turns off OpenBLAS’s thread affinity.',
  OPENBLAS_THREAD_TIMEOUT: 'How long idle threads wait before they sleep.',
  OPENBLAS_VERBOSE: 'Prints the core OpenBLAS chose (2) or more.',
  OPENBLAS_CORETYPE: 'Forces the CPU core type of a dynamic-architecture build.',
  OPENBLAS_BLOCK_FACTOR: 'Scales the blocking of the BLAS kernels.',
};

/**
 * cuBLAS through the NVIDIA HPC SDK's `cublas` module: its own routines (anchors in the Fortran CUDA Interfaces page
 * are the lower-case names) and the BLAS names it overloads for device arrays.
 */
export const CUBLAS_ROUTINES = `
cublasCreate cublasDestroy cublasGetVersion cublasSetStream cublasGetStream cublasGetStatusName cublasGetStatusString
cublasGetPointerMode cublasSetPointerMode cublasGetAtomicsMode cublasSetAtomicsMode cublasGetMathMode cublasSetMathMode
cublasGetSmCountTarget cublasSetSmCountTarget cublasGetHandle cublasSetVector cublasGetVector cublasSetMatrix
cublasGetMatrix cublasSetVectorAsync cublasGetVectorAsync cublasSetMatrixAsync cublasGetMatrixAsync
cublasSgeam cublasDgeam cublasCgeam cublasZgeam
cublasSgemvBatched cublasDgemvBatched cublasCgemvBatched cublasZgemvBatched cublasHgemvBatched
cublasSgemmBatched cublasDgemmBatched cublasCgemmBatched cublasZgemmBatched cublasHgemmBatched
cublasSgelsBatched cublasDgelsBatched cublasCgelsBatched cublasZgelsBatched
cublasSgeqrfBatched cublasDgeqrfBatched cublasCgeqrfBatched cublasZgeqrfBatched
cublasSgetrfBatched cublasDgetrfBatched cublasCgetrfBatched cublasZgetrfBatched
cublasSgetriBatched cublasDgetriBatched cublasCgetriBatched cublasZgetriBatched
cublasSgetrsBatched cublasDgetrsBatched cublasCgetrsBatched cublasZgetrsBatched
cublasSmatinvBatched cublasDmatinvBatched cublasCmatinvBatched cublasZmatinvBatched
cublasStrsmBatched cublasDtrsmBatched cublasCtrsmBatched cublasZtrsmBatched
cublasSgemvStridedBatched cublasDgemvStridedBatched cublasCgemvStridedBatched cublasZgemvStridedBatched cublasHgemvStridedBatched
cublasSgemmStridedBatched cublasDgemmStridedBatched cublasCgemmStridedBatched cublasZgemmStridedBatched cublasHgemmStridedBatched
cublasHgemm cublasGemmEx cublasGemmBatchedEx cublasGemmStridedBatchedEx
cublasIamaxEx cublasIaminEx cublasAsumEx cublasAxpyEx cublasCopyEx cublasDotEx cublasDotcEx cublasNrm2Ex cublasRotEx
cublasRotgEx cublasRotmEx cublasRotmgEx cublasScalEx cublasSwapEx
`.trim().split(/\s+/);

/** BLAS routines that `use cublas` overloads for device arrays (each has its own section, named in lower case). */
export const CUBLAS_BLAS = `
isamax isamin sasum saxpy scopy sdot snrm2 srot srotg srotm srotmg sscal sswap sgbmv sgemv sger ssbmv sspmv sspr sspr2
ssymv ssyr ssyr2 stbmv stbsv stpmv stpsv strmv strsv sgemm ssymm ssyrk ssyr2k ssyrkx strmm strsm
idamax idamin dasum daxpy dcopy ddot dnrm2 drot drotg drotm drotmg dscal dswap dgbmv dgemv dger dsbmv dspmv dspr dspr2
dsymv dsyr dsyr2 dtbmv dtbsv dtpmv dtpsv dtrmv dtrsv dgemm dsymm dsyrk dsyr2k dsyrkx dtrmm dtrsm
icamax icamin scasum caxpy ccopy cdotc cdotu scnrm2 crot csrot crotg cscal csscal cswap cgbmv cgemv cgerc cgeru csymv
csyr csyr2 ctbmv ctbsv ctpmv ctpsv ctrmv ctrsv chbmv chemv chpmv cher cher2 chpr chpr2 cgemm csymm csyrk csyr2k csyrkx
ctrmm ctrsm chemm cherk cher2k cherkx
izamax izamin dzasum zaxpy zcopy zdotc zdotu dznrm2 zrot zsrot zrotg zscal zdscal zswap zgbmv zgemv zgerc zgeru zsymv
zsyr zsyr2 ztbmv ztbsv ztpmv ztpsv ztrmv ztrsv zhbmv zhemv zhpmv zher zher2 zhpr zhpr2 zgemm zsymm zsyrk zsyr2k zsyrkx
ztrmm ztrsm zhemm zherk zher2k zherkx
`.trim().split(/\s+/);
