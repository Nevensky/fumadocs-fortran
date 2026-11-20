// Hand-written data for the BLACS and REDIST routines, whose sources have no Purpose/Arguments prose: argument
// intents and scopes, and our own one-line summaries. Names and argument lists are checked against the C sources of
// Reference-ScaLAPACK by scalapack.mjs. `?` stands for the precision letters i, s, d, c and z.
//
// Argument spec: 'name:intent' with intent i (in), o (out) or b (inout); a trailing * marks the matrix argument,
// whose type is the routine's precision with dimension (lda,*).

export const BLACS = {
  blacs_pinfo: ['Returns the number of the calling process and the number of processes available.', 'mypnum:o nprocs:o'],
  blacs_setup: ['Like blacs_pinfo, but also spawns the processes on systems that need it.', 'mypnum:o nprocs:b'],
  blacs_get: ['Gets an internal BLACS value, such as the default system context (what = 0).', 'icontxt:i what:i val:o'],
  blacs_set: ['Sets an internal BLACS value, such as the message ID range.', 'icontxt:i what:i val:i'],
  blacs_gridinit: ['Maps the processes of a system context onto an nprow × npcol grid, in row- or column-major order.', 'icontxt:b layout:i nprow:i npcol:i'],
  blacs_gridmap: ['Maps processes onto a grid from a table of process numbers.', 'icontxt:b usermap:i ldumap:i nprow:i npcol:i'],
  blacs_freebuff: ['Frees the BLACS buffers, waiting first for pending sends when wait ≠ 0.', 'icontxt:i wait:i'],
  blacs_gridexit: ['Frees a grid context; every process in it must call.', 'icontxt:i'],
  blacs_abort: ['Aborts all BLACS processes.', 'icontxt:i errornum:i'],
  blacs_exit: ['Frees all contexts and buffers at the end of the program; continue ≠ 0 leaves MPI usable.', 'continue:i'],
  blacs_gridinfo: ['Returns the shape of a grid and the row and column of the calling process (-1 outside it).', 'icontxt:i nprow:o npcol:o myrow:o mycol:o'],
  blacs_pnum: ['Returns the process number of the process at grid row prow, column pcol.', 'icontxt:i prow:i pcol:i'],
  blacs_pcoord: ['Returns the grid row and column of a process number.', 'icontxt:i pnum:i prow:o pcol:o'],
  blacs_barrier: ['Waits until every process of the scope (row, column or all) has called it.', 'icontxt:i scope:i'],
  ksendid: ['Returns the message ID for point-to-point sends to a process.', 'icontxt:i rdest:i cdest:i'],
  krecvid: ['Returns the message ID for point-to-point receives from a process.', 'icontxt:i rsrc:i csrc:i'],
  kbsid: ['Returns the message ID for broadcast sends in a scope.', 'icontxt:i scope:i'],
  kbrid: ['Returns the message ID for broadcast receives in a scope.', 'icontxt:i scope:i rsrc:i csrc:i'],
  dcputime00: ['Returns the CPU time used by the process, in seconds.', ''],
  dwalltime00: ['Returns the wall-clock time, in seconds.', ''],
  blacs2sys_handle: ['Returns the MPI communicator of a BLACS context.', 'blacsctxt:i'],
  sys2blacs_handle: ['Returns a BLACS system context for an MPI communicator.', 'syscontxt:i'],
  free_blacs_system_handle: ['Frees a BLACS system context made by sys2blacs_handle.', 'isyscxt:i'],
  '?gesd2d': ['Sends a general matrix to one process (point-to-point).', 'icontxt:i m:i n:i a:i* lda:i rdest:i cdest:i'],
  '?trsd2d': ['Sends a trapezoidal matrix to one process (point-to-point).', 'icontxt:i uplo:i diag:i m:i n:i a:i* lda:i rdest:i cdest:i'],
  '?gerv2d': ['Receives a general matrix from one process (point-to-point).', 'icontxt:i m:i n:i a:o* lda:i rsrc:i csrc:i'],
  '?trrv2d': ['Receives a trapezoidal matrix from one process (point-to-point).', 'icontxt:i uplo:i diag:i m:i n:i a:o* lda:i rsrc:i csrc:i'],
  '?gebs2d': ['Broadcasts a general matrix to the scope; the others receive it with ?gebr2d.', 'icontxt:i scope:i top:i m:i n:i a:i* lda:i'],
  '?trbs2d': ['Broadcasts a trapezoidal matrix to the scope; the others receive it with ?trbr2d.', 'icontxt:i scope:i top:i uplo:i diag:i m:i n:i a:i* lda:i'],
  '?gebr2d': ['Receives a general matrix broadcast by ?gebs2d.', 'icontxt:i scope:i top:i m:i n:i a:o* lda:i rsrc:i csrc:i'],
  '?trbr2d': ['Receives a trapezoidal matrix broadcast by ?trbs2d.', 'icontxt:i scope:i top:i uplo:i diag:i m:i n:i a:o* lda:i rsrc:i csrc:i'],
  '?gsum2d': ['Sums matrices element-wise over the scope; the result goes to one process (rdest ≥ 0) or all (-1).', 'icontxt:i scope:i top:i m:i n:i a:b* lda:i rdest:i cdest:i'],
  '?gamx2d': ['Finds the element-wise maximum by absolute value over the scope, with where it occurs unless ldia = -1.', 'icontxt:i scope:i top:i m:i n:i a:b* lda:i ra:o ca:o ldia:i rdest:i cdest:i'],
  '?gamn2d': ['Finds the element-wise minimum by absolute value over the scope, with where it occurs unless ldia = -1.', 'icontxt:i scope:i top:i m:i n:i a:b* lda:i ra:o ca:o ldia:i rdest:i cdest:i'],
};

/** BLACS routines that every process of the scope or grid must call. */
export const BLACS_COLLECTIVE = new Set([
  'blacs_gridinit',
  'blacs_gridmap',
  'blacs_gridexit',
  'blacs_barrier',
  'blacs_exit',
  '?gebs2d',
  '?trbs2d',
  '?gebr2d',
  '?trbr2d',
  '?gsum2d',
  '?gamx2d',
  '?gamn2d',
]);
export const BLACS_P2P = new Set(['?gesd2d', '?trsd2d', '?gerv2d', '?trrv2d']);

/**
 * REDIST: the C entry points sit behind macros, so their Fortran arguments are listed here; the summaries come from
 * the sources' Purpose prose. Scopes as in ScaLAPACK: g global, l local.
 */
export const REDIST = {
  'p?gemr2d': 'm:i:g n:i:g a:i*:l ia:i:g ja:i:g desca:i:gl b:o*:l ib:i:g jb:i:g descb:i:gl ictxt:i:g',
  'p?trmr2d': 'uplo:i:g diag:i:g m:i:g n:i:g a:i*:l ia:i:g ja:i:g desca:i:gl b:o*:l ib:i:g jb:i:g descb:i:gl ictxt:i:g',
};
