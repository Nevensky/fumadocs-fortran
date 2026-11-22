// Hand-written data for the Fortran-callable C routines of ScaLAPACK's SRC and TOOLS whose sources carry no
// Purpose/Arguments prose: argument intents and dimensions, and our own one-line summaries. The routines' names, their
// arguments and the arguments' types come from the C sources, and scalapack.mjs checks the names here against them.
// `?` stands for the precision letters s, d, c and z.
//
// Argument spec: 'name:intent' or 'name:intent:dims', with intent i (in), o (out) or b (inout); dims, such as
// (lda,*), make the argument an array.

export const C_ROUTINES = {
  // SRC/?lamov.c: lamov.h's LAMOV, which hands its arguments to ?lacpy when A and B do not overlap
  '?lamov': [
    'Copies all or part of a matrix A to B, as ?lacpy does, but A and B may overlap.',
    'uplo:i m:i n:i a:i:(lda,*) lda:i b:o:(ldb,*) ldb:i',
  ],
  // TOOLS/reshape.c: major_in and major_out are 1 for row-major order and 2 for column-major order
  reshape: [
    'Maps the processes of context_in, from first_proc on, onto a new nprow_new × npcol_new BLACS grid; major_in and '
      + 'major_out are each grid’s order: row-major (1) or column-major (2).',
    'context_in:i major_in:i context_out:o major_out:i first_proc:i nprow_new:i npcol_new:i',
  ],
  // TOOLS/SL_gridreshape.c: a function, whose result is the new context; row_major_in and row_major_out are flags
  sl_gridreshape: [
    'Returns a new BLACS context with a p × q grid of the processes of ctxt, from pstart on; row_major_in and '
      + 'row_major_out choose row-major order for each grid (else column-major).',
    'ctxt:i pstart:i row_major_in:i row_major_out:i p:i q:i',
  ],
};
