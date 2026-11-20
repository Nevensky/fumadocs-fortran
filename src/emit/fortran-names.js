// Names the call graphs need to know without a registry: the intrinsic procedures (a reference to one is not a call
// worth drawing) and the BLAS routines (drawn as BLAS calls). Lower case; Fortran names are case-insensitive.

const words = (s) => s.trim().split(/\s+/);

/**
 * The standard's intrinsic procedures (Fortran 2023): the generic names, the specific names of the old intrinsics
 * (DABS, AMAX1, …), and the procedures of the intrinsic modules. gfortran's extensions, which legacy code calls as if
 * they were standard, are listed at the end: DCMPLX, CALL EXIT, ETIME, the wrappers of system calls (CHDIR, STAT,
 * RENAME, …), and the specific names -fdec adds for each integer kind (BABS, IIAND, JIAND, KIAND, …). A project that
 * defines a procedure of one of these names still has its calls drawn: the graphs look its own names up first.
 * The coarray collectives (co_sum and the rest) are left out on purpose: the graphs draw them as coarray calls.
 */
export const INTRINSIC_PROCEDURES = new Set(words(`
  abs achar acos acosd acosh acospi adjustl adjustr aimag aint all allocated anint any asin asind asinh asinpi
  associated atan atan2 atan2d atan2pi atand atanh atanpi atomic_add atomic_and atomic_cas atomic_define
  atomic_fetch_add atomic_fetch_and atomic_fetch_or atomic_fetch_xor atomic_or atomic_ref atomic_xor bessel_j0
  bessel_j1 bessel_jn bessel_y0 bessel_y1 bessel_yn bge bgt bit_size ble blt btest ceiling char cmplx
  command_argument_count conjg cos cosd cosh coshape cospi count cpu_time cshift date_and_time dble digits dim
  dot_product dprod dshiftl dshiftr eoshift epsilon erf erfc erfc_scaled event_query execute_command_line exp exponent
  extends_type_of failed_images findloc floor fraction gamma get_command get_command_argument get_environment_variable
  get_team huge hypot iachar iall iand iany ibclr ibits ibset ichar ieor image_index image_status index int ior
  iparity is_contiguous is_iostat_end is_iostat_eor ishft ishftc kind lbound lcobound leadz len len_trim lge lgt lle
  llt log log10 log_gamma logical maskl maskr matmul max maxexponent maxloc maxval merge merge_bits min minexponent
  minloc minval mod modulo move_alloc mvbits nearest new_line nint norm2 not null num_images out_of_range pack parity
  popcnt poppar precision present product radix random_init random_number random_seed range rank real reduce repeat
  reshape rrspacing same_type_as scale scan selected_char_kind selected_int_kind selected_logical_kind
  selected_real_kind set_exponent shape shifta shiftl shiftr sign sin sind sinh sinpi size spacing split spread sqrt
  stopped_images storage_size sum system_clock tan tand tanh tanpi team_number this_image tiny tokenize trailz
  transfer transpose trim ubound ucobound unpack verify

  alog alog10 amax0 amax1 amin0 amin1 amod cabs ccos cexp clog csin csqrt dabs dacos dasin datan datan2 dcos dcosh
  ddim dexp dint dlog dlog10 dmax1 dmin1 dmod dnint dsign dsin dsinh dsqrt dtan dtanh float iabs idim idint idnint
  ifix isign max0 max1 min0 min1 sngl

  c_associated c_f_pointer c_f_procpointer c_f_strpointer c_funloc c_loc c_sizeof f_c_string
  compiler_options compiler_version

  ieee_class ieee_copy_sign ieee_fma ieee_get_flag ieee_get_halting_mode ieee_get_modes ieee_get_rounding_mode
  ieee_get_status ieee_get_underflow_mode ieee_int ieee_is_finite ieee_is_nan ieee_is_negative ieee_is_normal
  ieee_logb ieee_max ieee_max_mag ieee_max_num ieee_max_num_mag ieee_min ieee_min_mag ieee_min_num ieee_min_num_mag
  ieee_next_after ieee_next_down ieee_next_up ieee_quiet_eq ieee_quiet_ge ieee_quiet_gt ieee_quiet_le ieee_quiet_lt
  ieee_quiet_ne ieee_real ieee_rem ieee_rint ieee_scalb ieee_selected_real_kind ieee_set_flag ieee_set_halting_mode
  ieee_set_modes ieee_set_rounding_mode ieee_set_status ieee_set_underflow_mode ieee_signaling_eq ieee_signaling_ge
  ieee_signaling_gt ieee_signaling_le ieee_signaling_lt ieee_signaling_ne ieee_signbit ieee_support_datatype
  ieee_support_denormal ieee_support_divide ieee_support_flag ieee_support_halting ieee_support_inf ieee_support_io
  ieee_support_nan ieee_support_rounding ieee_support_sqrt ieee_support_standard ieee_support_subnormal
  ieee_support_underflow_control ieee_unordered ieee_value

  abort and cdabs cdcos cdexp cdlog cdsin cdsqrt dcmplx dconjg dfloat dimag dreal etime dtime exit fdate flush getarg
  getcwd getenv getpid hostnm iargc imag imagpart isnan loc lshift or realpart rshift sizeof sleep system xor zabs
  zcos zexp zlog zsin zsqrt

  access alarm backtrace chdir chmod complex ctime fget fgetc fnum fput fputc free fseek fstat ftell gerror getgid
  getlog getuid gmtime idate ierrno int2 int8 irand isatty itime kill link lnblnk long lstat ltime malloc mclock
  mclock8 perror ran rand rename secnds second short signal srand stat symlnk time time8 ttynam umask unlink
  algama besj0 besj1 besjn besy0 besy1 besyn cotan cotand dacosh dasinh datanh dbesj0 dbesj1 dbesjn dbesy0 dbesy1
  dbesyn dcotan dcotand derf derfc dgamma dlgama lgamma
  ccosd cdcosd cdsind csind dacosd dasind datan2d datand dcosd dsind dtand zcosd zsind floati floatj floatk
  babs iiabs jiabs kiabs bbclr iibclr jibclr kibclr bbits iibits jibits kibits bbset iibset jibset kibset bbtest bitest
  bjtest bktest biand iiand jiand kiand bieor iieor jieor kieor bior iior jior kior bmod imod jmod kmod bmvbits
  imvbits jmvbits kmvbits bnot inot jnot knot bshft iishft jishft kishft bshftc iishftc jishftc kishftc
`));

// stem: the type prefixes it takes in the reference BLAS (s, d, c, z)
const BLAS_STEMS = {
  // level 1
  rotg: 'sdcz', rotmg: 'sd', rot: 'sd', rotm: 'sd', swap: 'sdcz', scal: 'sdcz', copy: 'sdcz', axpy: 'sdcz', dot: 'sd',
  dotu: 'cz', dotc: 'cz', nrm2: 'sd', asum: 'sd', cabs1: 'sd', axpby: 'sdcz',
  // level 2
  gemv: 'sdcz', gbmv: 'sdcz', hemv: 'cz', hbmv: 'cz', hpmv: 'cz', symv: 'sd', sbmv: 'sd', spmv: 'sd', trmv: 'sdcz',
  tbmv: 'sdcz', tpmv: 'sdcz', trsv: 'sdcz', tbsv: 'sdcz', tpsv: 'sdcz', ger: 'sd', geru: 'cz', gerc: 'cz', her: 'cz',
  hpr: 'cz', her2: 'cz', hpr2: 'cz', syr: 'sd', spr: 'sd', syr2: 'sd', spr2: 'sd',
  // level 3
  gemm: 'sdcz', symm: 'sdcz', hemm: 'cz', syrk: 'sdcz', herk: 'cz', syr2k: 'sdcz', her2k: 'cz', trmm: 'sdcz',
  trsm: 'sdcz', gemmt: 'sdcz', gemmtr: 'sdcz', gemm3m: 'cz',
};

/**
 * The BLAS level 1 to 3 routines: the reference BLAS with its mixed-type names (csscal, dznrm2, idamax, …), the
 * index-of-minimum and axpby extensions most implementations add, gemmt and gemm3m, and the error handler and
 * character comparison every BLAS ships (xerbla, lsame).
 */
export const BLAS_ROUTINES = new Set([
  ...Object.entries(BLAS_STEMS).flatMap(([stem, types]) => [...types].map((t) => t + stem)),
  ...words(`
    csrot zdrot csscal zdscal dsdot sdsdot scnrm2 dznrm2 scasum dzasum
    isamax idamax icamax izamax isamin idamin icamin izamin
    xerbla xerbla_array lsame
  `),
]);
