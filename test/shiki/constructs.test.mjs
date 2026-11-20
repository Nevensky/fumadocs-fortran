// What the patches and injections give: directives, Fortran 2018/2023, doc comments, the fixed-form column limit,
// fypp, and the colours of directives in the GitHub themes.
import { highlighter, scoped, scopeOf } from './helpers.mjs';
import { getFortranLanguages } from '../../shiki/index.js';

const OMP = (s) => `${s}.openmp.fortran`;
const ACC = (s) => `${s}.openacc.fortran`;

// [lang, line of code, token, the token's innermost scope]
const CASES = [
  // OpenMP: sentinels, names matched longest first in either spelling, clauses, modifiers, comments
  ['fortran', '!$omp parallel do private(i)', '!$omp', OMP('keyword.control.directive')],
  ['fortran', '  !$OMP PARALLEL DO PRIVATE(I)', 'PARALLEL DO', OMP('keyword.other.directive')],
  ['fortran', '!$omp target teams distribute parallel do simd collapse(2)', 'target teams distribute parallel do simd', OMP('keyword.other.directive')],
  ['fortran', '!$omp target teams distribute parallel do simd collapse(2)', 'collapse', OMP('entity.other.attribute-name.clause')],
  ['fortran', '!$omp declare simd(f) notinbranch', 'declare simd', OMP('keyword.other.directive')],
  ['fortran', '!$omp declare_simd(f) notinbranch', 'declare_simd', OMP('keyword.other.directive')],
  ['fortran', '!$omp declare_simd(f) notinbranch', 'notinbranch', OMP('entity.other.attribute-name.clause')],
  ['fortran', '!$omp cancellation point parallel', 'cancellation point', OMP('keyword.other.directive')],
  ['fortran', '!$omp cancellation point parallel', 'parallel', OMP('entity.other.attribute-name.clause')],
  ['fortran', '!$omp end target data', 'end target data', OMP('keyword.other.directive')],
  ['fortran', '!$omp target_enter_data map(to: a)', 'target_enter_data', OMP('keyword.other.directive')],
  ['fortran', '!$omp begin declare_target device_type(nohost)', 'begin declare_target', OMP('keyword.other.directive')],
  ['fortran', '!$omp begin declare_target device_type(nohost)', 'nohost', OMP('keyword.other.modifier')],
  ['fortran', '!$omp end declare target', 'end declare target', OMP('keyword.other.directive')],
  ['fortran', '!$omp section', 'section', OMP('keyword.other.directive')],
  ['fortran', '!$omp end sections nowait', 'nowait', OMP('entity.other.attribute-name.clause')],
  ['fortran', '!$omp critical(update) hint(h)', 'critical', OMP('keyword.other.directive')],
  ['fortran', '!$omp critical(update) hint(h)', 'update', OMP('meta.directive')],
  ['fortran', '!$omp map(tofrom: a)', 'map', OMP('entity.other.attribute-name.clause')],
  ['fortran', '!$omp target map(tofrom: a)', 'tofrom', OMP('keyword.other.modifier')],
  ['fortran', '!$omp parallel do schedule(dynamic, 4)', 'dynamic', OMP('keyword.other.modifier')],
  ['fortran', '!$omp parallel do schedule(dynamic, 4)', '4', 'constant.numeric.fortran'],
  ['fortran', '!$omp parallel do reduction(max: m) if(n > 1)', 'max', OMP('keyword.other.modifier')],
  ['fortran', '!$omp error message("not tuned")', '"not tuned"', 'string.quoted.double.fortran'],
  ['fortran', '!$omp parallel do ! the loop over cells', 'the loop over cells', 'comment.line.fortran'],
  ['fortran', '!$omp parallel do private(i) &', '&', 'keyword.operator.line-continuation.fortran'],
  ['fortran', '!$omp& shared(a)', '&', 'keyword.operator.line-continuation.fortran'],
  ['fortran', '!$omp& shared(a)', 'shared', OMP('entity.other.attribute-name.clause')],
  ['fortran', '!$ompx bare ompx_attribute(x)', '!$ompx', OMP('keyword.control.directive')],
  ['fortran', '!$ompx bare ompx_attribute(x)', 'ompx_attribute', OMP('entity.other.attribute-name.clause')],
  // OpenACC
  ['fortran', '!$acc parallel loop gang vector copyin(b)', 'parallel loop', ACC('keyword.other.directive')],
  ['fortran', '!$acc parallel loop gang vector copyin(b)', 'vector', ACC('entity.other.attribute-name.clause')],
  ['fortran', '!$acc enter data copyin(readonly: a)', 'enter data', ACC('keyword.other.directive')],
  ['fortran', '!$acc enter data copyin(readonly: a)', 'readonly', ACC('keyword.other.modifier')],
  ['fortran', '!$acc routine(solve) seq', 'routine', ACC('keyword.other.directive')],
  ['fortran', '!$acc routine(solve) seq', 'seq', ACC('entity.other.attribute-name.clause')],
  ['fortran', '!$acc wait(1) async(2)', 'async', ACC('entity.other.attribute-name.clause')],
  // CUDA Fortran, compiler directives, conditional compilation
  ['fortran', '!$cuf kernel do(2) <<<*,*>>>', 'kernel do', 'keyword.other.directive.cuf.fortran'],
  ['fortran', '!$cuf kernel do(2) <<<*,*>>>', '<<<', 'punctuation.section.launch.fortran'],
  ['fortran', '!dir$ ivdep', 'ivdep', 'keyword.other.directive.compiler.fortran'],
  ['fortran', '!DEC$ ATTRIBUTES DLLEXPORT :: solve', '!DEC$', 'keyword.control.directive.compiler.fortran'],
  ['fortran', '!DEC$ ATTRIBUTES DLLEXPORT :: solve', 'DLLEXPORT', 'entity.other.attribute-name.compiler.fortran'],
  ['fortran', '!GCC$ unroll 4', '4', 'constant.numeric.fortran'],
  ['fortran', '  !$ nthreads = omp_get_max_threads()', '!$', 'keyword.control.directive.conditional.fortran'],
  ['fortran', '  !$ nthreads = omp_get_max_threads()', '=', 'keyword.operator.assignment.fortran'],
  ['fortran', '!@cuf call sync()', '!@cuf', 'keyword.control.directive.conditional.cuf.fortran'],
  // not directives
  ['fortran', 'x = 1 !$omp parallel', '$omp parallel', 'comment.line.fortran'],
  ['fortran', '!!$omp parallel do', '!$omp parallel do', 'comment.line.fortran'],
  ['fortran', "print *, '!$omp parallel'", '!$omp parallel', 'string.quoted.single.fortran'],
  // fixed form
  ['f77', 'C$OMP PARALLEL DO PRIVATE(I)', 'C$OMP', OMP('keyword.control.directive')],
  ['f77', '*$OMP& SHARED(X)', 'SHARED', OMP('entity.other.attribute-name.clause')],
  ['f77', 'c$acc kernels', 'kernels', ACC('keyword.other.directive')],
  ['f77', 'C$    CALL OMP_SET_NUM_THREADS(4)', 'C$', 'keyword.control.directive.conditional.fortran'],
  ['f77', 'CDIR$ IVDEP', 'IVDEP', 'keyword.other.directive.compiler.fortran'],
  ['f77', 'C     $OMP is only a comment here', '$OMP is only a comment here', 'comment.line.fortran'],

  // Fortran 2018 and 2023
  ['fortran', 'enumeration type :: colour', 'enumeration', 'keyword.control.enumeration.fortran'],
  ['fortran', 'enumeration type, public :: colour', 'colour', 'entity.name.type.fortran'],
  ['fortran', 'typeof(x) :: y', 'typeof', 'storage.type.typeof.fortran'],
  ['fortran', 'classof(x), allocatable :: y', 'classof', 'storage.type.typeof.fortran'],
  ['fortran', 'simple function twice(x) result(y)', 'simple', 'storage.modifier.simple.fortran'],
  ['fortran', 'y = ( x > 0 ? x : -x )', '?', 'keyword.operator.ternary.fortran'],
  ['fortran', 'y = ( x > 0 ? x : -x )', ':', 'keyword.operator.ternary.fortran'],
  ['fortran', 'do concurrent (i = 1:n) local_init(t) reduce(+:s)', 'local_init', 'storage.modifier.locality.fortran'],
  ['fortran', 'do concurrent (i = 1:n) local_init(t) reduce(+:s)', 'reduce', 'storage.modifier.locality.fortran'],
  ['fortran', 'change team (t)', 'change team', 'keyword.control.change-team.fortran'],
  ['fortran', 'notify wait (nv)', 'notify wait', 'keyword.control.notify-wait.fortran'],
  ['fortran', "error stop 'failed', quiet=.true.", 'quiet', 'variable.parameter.dummy-variable.fortran.modern'],
  // upstream slips
  ['fortran', 'y = a**2', '**', 'keyword.operator.power.fortran'],
  ['fortran', 'y = a*b', '*', 'keyword.operator.multiplication.fortran'],
  ['fortran', 'y = a/b', '/', 'keyword.operator.division.fortran'],
  ['fortran', '#pragma omp parallel', 'pragma', 'keyword.control.preprocessor.pragma.fortran'],

  // doc comments
  ['fortran', '!> Before the item.', 'Before the item.', 'comment.line.documentation.fortran'],
  ['fortran', 'real :: x !! after the item', 'after the item', 'comment.line.documentation.fortran'],
  ['fortran', 'real :: x !< after the item', 'after the item', 'comment.line.documentation.fortran'],
  ['fortran', 'real :: x ! a plain comment', 'a plain comment', 'comment.line.fortran'],
  ['fortran', '!!!!!!!!!!!!!!!!!!!!', '!!!!!!!!!!!!!!!!!!!', 'comment.line.fortran'],
  ['f77', '*> \\brief Before the item.', '\\brief Before the item.', 'comment.line.documentation.fortran'],
  ['f77', 'C> Before the item.', 'Before the item.', 'comment.line.documentation.fortran'],
  ['f77', 'C     A plain comment.', 'A plain comment.', 'comment.line.fortran'],
  ['f77', "D     PRINT *, 'debug'", "PRINT *, 'debug'", 'comment.line.debug.fortran'],

  // fypp
  ['fypp', "#:if defined('WITH_QP')", '#:', 'keyword.control.directive.fypp'],
  ['fypp', "#:if defined('WITH_QP')", "'WITH_QP'", 'string.quoted.single.fypp'],
  ['fypp', '#:for k in KINDS', 'in', 'keyword.operator.word.fypp'],
  ['fypp', 'real(${k}$) :: x', '${', 'punctuation.section.embedded.begin.fypp'],
  ['fypp', 'real(${k}$) :: x', 'k', 'meta.embedded.inline.fypp'],
  ['fypp', "print *, 'kind ${k}$'", '}$', 'punctuation.section.embedded.end.fypp'],
  ['fypp', '! kind ${k}$', '${', 'punctuation.section.embedded.begin.fypp'],
  ['fypp', '@:assert(n > 0)', 'assert', 'entity.name.function.macro.fypp'],
  ['fypp', '#! a fypp comment', 'a fypp comment', 'comment.line.fypp'],
  ['fypp', '$:x', '$:', 'keyword.control.directive.fypp'],
];

export default async function ({ ok, eq }) {
  const hl = await highlighter('js');
  for (const [lang, code, token, scope] of CASES) {
    const line = scoped(hl, `${code}\n`, lang)[0];
    eq(scopeOf(line, token), scope, `${lang}: ${code} → ${token}`);
  }

  // a continued fypp directive ends at the first line that does not start with &
  {
    const lines = scoped(hl, "#:if defined('A') &\n    & and B\nx = 1\n", 'fypp');
    eq(scopeOf(lines[1], '&'), 'keyword.operator.line-continuation.fypp', 'fypp: & continues a directive');
    ok(!lines[2].some((t) => t.scopes.includes('meta.preprocessor.fypp')), 'fypp: the directive ends before the next line');
  }
  // fypp is free form only
  ok(!scoped(hl, '      X = ${K}$\n', 'f77')[0].some((t) => t.scopes.includes('meta.embedded.inline.fypp')), 'f77: no fypp');
  // an enumeration type ends, and the code after it is read as before
  {
    const lines = scoped(hl, 'enumeration type :: c\n  enumerator :: red\nend enumeration type c\ntype :: t\nend type t\n', 'fortran');
    eq(scopeOf(lines[1], 'enumerator'), 'keyword.other.enumerator.fortran', 'enumerator');
    eq(scopeOf(lines[2], 'end enumeration type'), 'keyword.control.end-enumeration-type.fortran', 'end enumeration type');
    ok(!lines[3].some((t) => t.scopes.includes('meta.enumeration-type.fortran')), 'the enumeration type has ended');
    eq(scopeOf(lines[4], 'end type'), 'keyword.control.endtype.fortran', 'a derived type after it');
  }
  // an array section in a conditional expression is not a conditional colon
  eq(scopeOf(scoped(hl, 'y = f( c ? a(1:2) : b )\n', 'fortran')[0].filter((t) => t.text === ':'), ':'), 'meta.parameter.fortran', 'a(1:2)');

  // the fixed-form column limit: 72 by default, 132, or none
  {
    const long = `      X = A + B${' '.repeat(57)}SEQ00010\n      Y = 'A STRING THAT RUNS PAST COLUMN SEVENTY-TWO, WHERE COMPILERS CUT'\n`;
    const at72 = scoped(hl, long, 'f77');
    eq(scopeOf(at72[0], 'SEQ00010'), 'comment.line-end.fortran', 'column 72: a sequence number');
    eq(scopeOf(at72[1], "UT'"), 'comment.line-end.fortran', 'column 72: the end of a long string');
    const wide = await highlighter('js', getFortranLanguages({ fixedLineLength: 132 }));
    const at132 = scoped(wide, `${long}      Z = 1${' '.repeat(121)}SEQ00020\n`, 'f77');
    ok(!at132[0].some((t) => t.scopes.includes('comment.line-end.fortran')), 'column 132: column 73 is code');
    eq(scopeOf(at132[2], 'SEQ00020'), 'comment.line-end.fortran', 'column 132: column 133 is not');
    const free = await highlighter('js', getFortranLanguages({ fixedLineLength: false }));
    ok(!scoped(free, long, 'f77').flat().some((t) => t.scopes.includes('comment.line-end.fortran')), 'no column limit');
    // the limit does not apply to cpp lines
    ok(!scoped(hl, `#define LONG ${'X'.repeat(80)}\n`, 'f77')[0].some((t) => t.scopes.includes('comment.line-end.fortran')), 'cpp lines have no limit');
  }

  // directives stand out in the GitHub themes: no part of a directive has the colour of comments
  for (const theme of ['github-light', 'github-dark']) {
    const comment = scoped(hl, '! c\n', 'fortran', theme)[0].at(-1).color;
    const plain = scoped(hl, 'x\n', 'fortran', theme)[0][0].color;
    for (const [lang, code] of [
      ['fortran', '!$omp parallel do private(i) schedule(static)'],
      ['fortran', '!$acc parallel loop gang copyin(a)'],
      ['fortran', '!dir$ ivdep'],
      ['f77', 'C$OMP PARALLEL DO PRIVATE(I)'],
    ]) {
      const tokens = scoped(hl, `${code}\n`, lang, theme)[0].filter((t) => t.text.trim());
      const [sentinel, name, clause] = tokens;
      ok(sentinel.color !== comment && sentinel.color !== plain, `${theme}: the sentinel of ${code} stands out`);
      ok(name.color !== comment && name.color !== plain, `${theme}: the name of ${code} stands out`);
      if (clause && /\w/.test(clause.text)) ok(clause.color !== comment && clause.color !== plain, `${theme}: the first clause of ${code} stands out`);
      ok(tokens.every((t) => t.color !== comment), `${theme}: nothing in ${code} has the comment colour`);
    }
  }
}
