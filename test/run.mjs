// node test/run.mjs — unit and regression tests for the parser. No framework: each check counts, failures are listed.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { extractFiles, parseSource, detectForm, evaluate, parseDirective, readEvents } from '../src/index.js';
import { canon, lower, splitTop, scanComment, matchClose } from '../src/parse/text.js';
import { macroTable, preprocess, CondTable } from '../src/source/cpp.js';
import { formatArg } from '../scripts/oracle/format.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const OUT = path.join(HERE, 'out');
fs.mkdirSync(OUT, { recursive: true });

let failures = 0, checks = 0;
const ok = (cond, msg) => {
  checks++;
  if (!cond) {
    failures++;
    console.error('FAIL', msg);
  }
};
const eq = (a, b, msg) => ok(JSON.stringify(a) === JSON.stringify(b), `${msg}: expected ${JSON.stringify(b)}, got ${JSON.stringify(a)}`);
const ents = (ir) => Object.values(ir.entities);
const byName = (ir, name, kind) => ents(ir).find((e) => e.name.toLowerCase() === name && (!kind || e.kind === kind));
const parse = (text, opts = {}) => parseSource(text, { root: OUT, ...opts });

// ---------------------------------------------------------------- lexical helpers
{
  eq(canon('real ( dp ) , intent ( in ) :: x'), 'real(dp),intent(in)::x', 'canon drops blanks next to punctuation');
  eq(canon('double  precision a( lda, * )'), 'double precision a(lda,*)', 'canon keeps one blank between words');
  eq(canon("print *, 'a  b'"), "print*,'a  b'", 'canon leaves strings alone');
  eq(lower("CALL Foo('ABC')"), "call foo('ABC')", 'lower keeps string case');
  eq(splitTop("a(1,2), 'x,y', b", ','), ['a(1,2)', " 'x,y'", ' b'], 'splitTop respects brackets and strings');
  eq(scanComment("x = '!!' ! c", null).cut, 9, 'a ! inside a string is not a comment');
  eq(scanComment("x = 'abc", null).q, "'", 'an open string is reported');
  eq(scanComment("def' ! c", "'").cut, 5, 'a continued string closes, then the comment');
  eq(scanComment('      DATA X /4HAB!C/ ! c', null, true).cut, 22, 'a Hollerith constant may hold a !');
  eq(matchClose('f(a(1), "(")', 1), 11, 'matchClose');
}

// ---------------------------------------------------------------- source form
{
  eq(detectForm('      PROGRAM P\nC     comment\n      X = 1\n     $  + 2\n      END\n'), 'fixed', 'fixed-form text');
  eq(detectForm('module m\n  implicit none\ncontains\n  subroutine s(a, &\n      b)\n  end subroutine\nend module\n'), 'free', 'free-form text');
  eq(detectForm('#ifdef X\n  use m\n#endif\nprogram p\nend\n'), 'free', 'free form behind cpp lines');
  const ir = parse('      SUBROUTINE S(A)\n      REAL A\nC     a comment in column 1\n      END\n', { path: 'old.F' });
  eq(ir.files[0].form, 'fixed', '.F decided from the text');
  ok(byName(ir, 's').args[0].type.base === 'real', 'fixed-form .F parses');
}

// ---------------------------------------------------------------- cpp
{
  eq(evaluate('1 + 2 * 3 == 7 && !(4 > 5)'), 1, 'cpp arithmetic and logic');
  eq(evaluate('0x10 >> 2 | 1'), 5, 'hex, shifts and bitwise or');
  eq(evaluate('1 ? 2 : 3'), 2, 'ternary');
  const run = (text, macros = {}, keepAll = false) => {
    const env = { macros: macroTable(macros), conds: new CondTable(), keepAll, form: 'free', diagnostics: [], readInclude: () => null };
    const r = preprocess(text, 0, env);
    return { text: r.lines.map((l) => l.s).join('\n'), conds: r.lines.map((l) => env.conds.get(l.c).join(' && ')), env };
  };
  eq(run('#ifdef A\na\n#elif defined(B) && B > 1\nb\n#else\nc\n#endif\n', { B: 2 }).text, 'b', '#elif evaluates');
  eq(run('#if A\na\n#else\nc\n#endif\n', {}, true).text, 'a\nc', 'keepAllBranches keeps both');
  eq(run('#ifdef A\na\n#else\nc\n#endif\n', {}, true).conds, ['defined(A)', '!defined(A)'], 'branch conditions are recorded');
  eq(run('#define K 8\nreal(K) :: x ! K\nprint *, "K"\n').text, 'real(8) :: x ! K\nprint *, "K"', 'no expansion in comments or strings');
  // json-fortran's traditional paste
  eq(run('#define WRAP(P) P, wrap_/**/P\nprocedure :: WRAP(add)\n').text, 'procedure :: add, wrap_add', 'traditional /**/ paste');
  eq(run('#define CAT(a,b) a ## b\nx = CAT(foo, bar)\n').text, 'x = foobar', '## paste');
  eq(run('#define ID(x) x\ny = 1.0e-3_ID\n').text, 'y = 1.0e-3_ID', 'a pp-number suffix is not a macro');
  ok(run('#if FOO(\n#endif\n').env.diagnostics.some((d) => d.code === 'cpp-expr'), 'a bad #if expression is a diagnostic');
}

// ---------------------------------------------------------------- includes
{
  fs.writeFileSync(path.join(OUT, 'args.inc'), '      a, b, &\n');
  fs.writeFileSync(path.join(OUT, 'decls.inc'), 'real :: a, b\n');
  fs.writeFileSync(path.join(OUT, 'inc_main.F90'), 'subroutine s( &\n#include "args.inc"\n      c)\n  include "decls.inc"\n  integer :: c\nend subroutine\n');
  const ir = extractFiles([path.join(OUT, 'inc_main.F90')], { root: OUT });
  const s = byName(ir, 's');
  eq(s.args.map(formatArg), ['a real', 'b real', 'c integer'], '#include inside an argument list and Fortran include');
  eq(ir.files[0].includes, ['args.inc', 'decls.inc'], 'includes are listed');
  const miss = parse('#include "nowhere.h"\nmodule m\nend module\n', { path: 'm.F90' });
  ok(miss.diagnostics.some((d) => d.code === 'include-missing') && byName(miss, 'm'), 'a missing include is a diagnostic, not a failure');
}

// ---------------------------------------------------------------- statements that are easy to misclassify
{
  const ir = parse([
    'subroutine io(u)',
    '  integer :: u',
    '  end file u',
    '  endfile(u)',
    '10 end do',
    '  type = 1',
    '  end = 2',
    '  if (u > 0) call helper(u)',
    'end subroutine io',
    'block data init',
    '  common /blk/ x, y',
    'end block data init',
    'module e',
    '  enumeration type :: colour',
    '    enumerator :: red, green',
    '  end enumeration type colour',
    'end module e',
  ].join('\n'));
  const io = byName(ir, 'io');
  ok(io && io.lineEnd === 9, '`end file` and labelled `end do` do not close a unit');
  eq(io.calls?.map((c) => c.name), ['helper'], 'a call inside a logical IF');
  const paths = parse([
    'subroutine drive(x, locals)',
    '  call x%c%go(1)',
    '  call locals(1)%go()',
    '  call locals(f(2))%stack(3)%push(4)',
    '  call co_sum(t)',
    'end subroutine',
  ].join('\n'));
  const drive = byName(paths, 'drive');
  eq(drive.calls.map((c) => c.name), ['x%c%go', 'locals%go', 'locals%stack%push', 'co_sum'],
    'a call through components, subscripted or not, names the whole path');
  eq(drive.refs, ['f'], 'a function reference in a subscript of the path');
  ok(drive.hpc?.coarray, 'a coarray collective');
  ok(byName(ir, 'init', 'blockdata')?.lineEnd === 12, 'end block data');
  eq(byName(ir, 'init', 'blockdata').commons, [{ name: 'blk', members: ['x', 'y'], line: 11 }], 'common blocks');
  eq(byName(ir, 'colour', 'enum')?.enumerators.map((x) => x.name), ['red', 'green'], 'F2023 enumeration type');
  ok(byName(ir, 'e', 'module').lineEnd === 17, 'end enumeration type closes only the enum');

  const fixed = parse([
    '      SUBROUTINE OLD( N, X, Y )',
    '      IMPLICITNONE',
    '      INTEGER N',
    '      DOUBLEPRECISION X( * ),',
    '     $                 Y( N )',
    '      CHARACTER*(*) MSG',
    '      DATA MSG /5HHI!BY/',
    '      CALL DSCAL( N, 2.0D0, X, 1 )',
    '   10 CONTINUE',
    '      ENDSUBROUTINE',
  ].join('\n'), { path: 'old.f' });
  const old = byName(fixed, 'old');
  eq(old.args.map(formatArg), ['N INTEGER', 'X DOUBLEPRECISION dims(*)', 'Y DOUBLEPRECISION dims(N)'], 'fixed form without blanks, names as spelled');
  eq(old.args.map((a) => a.type.base), ['integer', 'double precision', 'double precision'], 'run-together type names are normalised');
  eq(old.calls.map((c) => c.name), ['DSCAL'], 'a call after a Hollerith constant');
  ok(old.lineEnd === 10, 'ENDSUBROUTINE');
  eq(fixed.diagnostics, [], 'no diagnostics');

  const impl = parse('subroutine f77(i, x)\n  implicit double precision (a-h, o-z)\nend\n');
  eq(byName(impl, 'f77').args.map((a) => `${a.name}:${a.type.base}${a.type.implicit ? '*' : ''}`), ['i:integer*', 'x:double precision*'], 'implicit typing');
}

// ---------------------------------------------------------------- function references and calls through paths
{
  const refs = (name, lines, opts) => byName(parse(lines.join('\n'), opts), name).refs;
  eq(refs('nest', [
    'subroutine nest(y)',
    '  real :: y',
    '  y = f(g(y))',
    '  if (is_ok(y)) y = 0',
    '  do while (more(y))',
    '    y = sqrt(h(y))',
    '  end do',
    '  y = max(p(y), q(y))',
    'end subroutine',
  ]), ['f', 'g', 'h', 'is_ok', 'max', 'more', 'p', 'q', 'sqrt'],
  'a reference inside another\'s parentheses, and right after `if (` and `while (`');
  eq(refs('bound', [
    'subroutine bound(c, json, x, h)',
    '  type(circle) :: c',
    '  a = 2.0 * c%area()',
    '  if (json%failed()) return',
    '  b = x(1)[2]%shape%perimeter(3) + x%r(1)%count(g(1))',
    '  w = h%f(2.0)',
    'end subroutine',
  ]), ['c%area', 'g', 'h%f', 'json%failed', 'x%r%count', 'x%shape%perimeter'],
  'a path through components to a function is kept as calls name it, without subscripts or image selectors');
  eq(refs('sections', [
    'subroutine sections(c, k)',
    '  y = arr(1:k) + c%name(2:3) // c%tags(k)(1:1)',
    '  z = q(1)[2] + c%v(1)[3] + m(1)%w',
    'end subroutine',
  ]), undefined, 'sections, substrings, coarray elements and components are no function references');
  eq(refs('types', [
    'subroutine types(n, obj)',
    '  integer :: n',
    '  character(:), allocatable :: c',
    '  integer(int64), allocatable :: k(:)',
    '  class(base(:)), allocatable :: obj',
    '  allocate(character(len=n) :: c)',
    '  allocate(integer(int64) :: k(f(n)))',
    '  allocate(shape_t(n) :: obj)',
    '  c = [character(len=3) :: "a", g(1)]',
    '  x = [real(dp) :: 1, 2]',
    '  do concurrent (integer(int8) :: i = 1:n)',
    '  end do',
    'end subroutine',
  ]), ['f', 'g'], 'a type before `::` in ALLOCATE, an array constructor or DO CONCURRENT is no function reference');
  eq(refs('blocks', [
    'subroutine blocks(n)',
    '  integer :: n',
    '  block',
    '    real, allocatable :: w(:)',
    '    real :: v',
    '    dimension v(n)',
    '    allocate(w(n))',
    '    v(1) = w(1) + f(n)',
    '  end block',
    '  y = g(1)',
    'end subroutine',
  ]), ['f', 'g'], 'arrays a BLOCK construct declares, by a type declaration or by DIMENSION, are no references');
  const img = (call) => byName(parse(`subroutine img(x)\n  ${call}\nend subroutine\n`), 'img');
  const co = img('call x[2]%go()');
  eq([co.calls.map((c) => c.name), !!co.hpc?.coarray], [['x%go'], true],
    'a call through an image selector names the path, and is coarray code');
  eq(img('call x(1)[3]%y%stop()').calls.map((c) => c.name), ['x%y%stop'],
    'so does one through a subscript and a selector');
  eq(refs('stmt', [
    'subroutine stmt(y)',
    '  real :: y, sq, x, cube',
    '  sq(x) = x * x',
    '  cube(x) = sq(x) * x + ext(x)',
    '  y = sq(2.0) + cube(y)',
    '  buf(1) = 0',
    '  late(x) = 1',
    'end subroutine',
  ]), ['buf', 'ext', 'late'],
  'statement functions are no function references, though what they reference is; the executable part ends them');
  eq(refs('work', [
    '      SUBROUTINE WORK(N)',
    '      INTEGER N',
    '      COMMON /BLK/ B(10), C',
    '      DOUBLE PRECISION A, B',
    '      DIMENSION A(10)',
    '      ALLOCATABLE :: W(:)',
    '      B(2) = A(1) + W(1) + F(N)',
    '      END',
  ], { path: 'work.f' }), ['f'], 'arrays dimensioned by COMMON, DIMENSION or ALLOCATABLE, before or after their type');
  eq(refs('names', [
    'subroutine names(k)',
    '  integer :: k',
    '  character(len=8) :: label, title',
    '  character(len=8), external :: tag',
    '  external :: title',
    '  print *, label(k:k), title(k), tag(k)',
    'end subroutine',
  ]), ['tag', 'title'], 'a character function declared EXTERNAL, in a statement or an attribute, is a reference');
}

// ---------------------------------------------------------------- a character length after the name
{
  const lens = byName(parse([
    'subroutine lens(n, a, b, d, e, g, h)',
    '  integer, intent(in) :: n',
    '  character :: a*(*), b*10',
    '  character(len=10) :: d*20',
    '  character :: e*(5), g*(n)',
    '  character*(*) :: h',
    'end subroutine',
  ].join('\n')), 'lens');
  eq(lens.args.slice(1).map((a) => a.type.text), ['character*(*)', 'character*10', 'character(len=20)',
    'character*5', 'character*(n)', 'character*(*)'],
  'an entity\'s length is written as Fortran declares the entity alone: after the type (in brackets unless a '
    + 'number), or in its selector');
  eq(lens.args.slice(1).map((a) => a.type.len), ['*', '10', '20', '5', 'n', '*'], 'and is the length of the type');
  // F77 code may give a length to the type and another to an entity: the entity's is its length
  const f77 = ['SUBROUTINE OLD(J, K, L)', 'CHARACTER*8 J*16, L', 'CHARACTER*(*) K*4', 'END', ''];
  const old = byName(parse(f77.map((l) => (l ? `      ${l}` : l)).join('\n'), { path: 'old.f' }), 'old');
  eq(old.args.map((a) => [a.type.text, a.type.len]),
    [['CHARACTER*16', '16'], ['CHARACTER*4', '4'], ['CHARACTER*8', '8']],
    'an entity\'s length replaces a length written after the type');
  // a selector keeps its kind, and the entity's length goes into it: character(len=10)*20 is no Fortran
  const sel = byName(parse([
    'subroutine sel(n, d, e, f, g, h)',
    "  integer, parameter :: ucs4 = selected_char_kind('ISO_10646')",
    '  integer, intent(in) :: n',
    '  character(kind=ucs4) :: d*20',
    '  character(10, ucs4) :: e*(*)',
    '  character(len=10, kind=ucs4) :: f*(n)',
    '  CHARACTER(LEN=10) :: G*20',
    '  character(kind=ucs4, len=3) :: h',
    'end subroutine',
  ].join('\n')), 'sel');
  eq(sel.args.slice(1).map((a) => [a.type.text, a.type.len, a.type.kind]), [
    ['character(len=20,kind=ucs4)', '20', 'ucs4'], ['character(len=*,kind=ucs4)', '*', 'ucs4'],
    ['character(len=n,kind=ucs4)', 'n', 'ucs4'], ['CHARACTER(LEN=20)', '20', null],
    ['character(kind=ucs4,len=3)', '3', 'ucs4']],
  'a length after the name, in a type with a selector: len= in the selector, with the kind, in the type\'s case');
}

// ---------------------------------------------------------------- calls through a local procedure pointer
{
  // the IR keeps no local declarations, so a call through a procedure pointer the caller declares (in a BLOCK, its
  // own specification part, or its host's) is marked: it calls the project's target, not the routine of that name
  const ir = parse([
    'module ptr_m',
    '  abstract interface',
    '    subroutine gemm_i()',
    '    end subroutine',
    '  end interface',
    'contains',
    '  subroutine p1()',
    '    procedure(gemm_i), pointer :: dgemm',
    '    call dgemm()',
    '  end subroutine',
    '  subroutine p2()',
    '    block',
    '      procedure(gemm_i), pointer :: zgemm',
    '      call zgemm()',
    '    end block',
    '    call zgemm()',
    '  end subroutine',
    '  subroutine p4()',
    '    procedure(gemm_i) :: zgesv',
    '    pointer :: zgesv',
    '    call zgesv()',
    '  end subroutine',
    '  subroutine p5()',
    '    pointer :: dgetrf',
    '    external :: dgetrf',
    '    call dgetrf()',
    '    if (.true.) call dgetrf()',
    '  end subroutine',
    '  subroutine host()',
    '    procedure(gemm_i), pointer :: dgesv',
    '    call inner()',
    '  contains',
    '    subroutine inner()',
    '      call dgesv()',
    '    end subroutine',
    '    subroutine own()',
    '      external :: dgesv',
    '      call dgesv()',
    '    end subroutine',
    '    subroutine dum(dgesv)',
    '      procedure(gemm_i) :: dgesv',
    '      call dgesv()',
    '    end subroutine',
    '  end subroutine',
    '  subroutine p6()',
    '    interface',
    '      subroutine dsyrk()',
    '      end subroutine',
    '    end interface',
    '    pointer :: dsyrk',
    '    call dsyrk()',
    '  end subroutine',
    '  subroutine p7()',
    '    interface',
    '      subroutine dtrsm()',
    '      end subroutine',
    '    end interface',
    '    call dtrsm()',
    '  end subroutine',
    '  subroutine c2(dsysv)',
    '    procedure(gemm_i), pointer :: dsysv',
    '    procedure(gemm_i) :: dposv',
    '    real, pointer :: v(:)',
    '    call dposv()',
    '    call dsysv()',
    '  end subroutine',
    '  subroutine fn(x)',
    '    real :: x',
    '    procedure(real), pointer :: dnrm2',
    '    x = dnrm2(1, x, 1) + snrm2(1, x, 1)',
    '  end subroutine',
    'end module ptr_m',
    'program main',
    '  procedure(), pointer :: dpotrf => null()',
    '  call dpotrf()',
    'end program',
  ].join('\n'), { path: 'ptr.f90' });
  const calls = (name) => byName(ir, name).calls.map((c) => `${c.name}${c.local ? ' local' : ''}`);
  eq(['p1', 'p2', 'p4', 'p5', 'inner', 'own', 'main'].map(calls), [['dgemm local'], ['zgemm local', 'zgemm'],
    ['zgesv local'], ['dgetrf local', 'dgetrf local'], ['dgesv local'], ['dgesv'], ['dpotrf local']],
  'a procedure pointer the caller, a BLOCK of it or its host declares: procedure(…), pointer, or POINTER with '
    + 'procedure(…) or EXTERNAL, in either order; a BLOCK\'s ends with it, and an internal procedure\'s own '
    + 'EXTERNAL wins');
  eq(calls('c2'), ['dposv', 'dsysv'], 'procedure(…) without POINTER is the external routine; a dummy is a dummy');
  eq(['p6', 'p7', 'dum'].map(calls), [['dsyrk local'], ['dtrsm'], ['dgesv']],
    'an interface body that a POINTER statement makes a procedure pointer is one; an interface body alone is the '
      + 'external routine; an internal procedure\'s dummy with the name of its host\'s pointer is a dummy');
  eq(byName(ir, 'fn').refs, ['snrm2'], 'a function pointer the procedure declares is no function reference');
}

// ---------------------------------------------------------------- the reader
{
  const ev = readEvents([
    '!$omp parallel do &',
    '!$omp& private(i)',
    "call s('a&",
    "      &b')",
    'x = 1; y = 2',
  ].map((s, i) => ({ s, f: 0, n: i + 1, c: 0 })), { form: 'free' });
  eq(ev[0].t === 'dir' && ev[0].text, 'parallel do private(i)', 'directive continuation');
  eq(ev[1].text, "call s('ab')", 'a string continued across lines');
  const f = readEvents(['C$OMP PARALLEL DO', 'C$OMP+PRIVATE(I)', '!$    X = OMP_GET_NUM_THREADS()', '      Y = 1'].map((s, i) => ({ s, f: 0, n: i + 1, c: 0 })), { form: 'fixed', omp: true });
  eq(f.map((e) => e.t), ['dir', 'stmt', 'stmt'], 'fixed-form sentinels and !$ lines with _OPENMP');
  eq(f[0].text, 'PARALLEL DO PRIVATE(I)', 'fixed-form directive continuation');
  const off = readEvents(['!$ use omp_lib'].map((s, i) => ({ s, f: 0, n: i + 1, c: 0 })), { form: 'free', omp: false });
  eq(off[0].sentinel, '$', 'a !$ line without _OPENMP is kept as a conditional line');
}

// ---------------------------------------------------------------- directives
{
  const d = (s, t) => { const x = parseDirective(s, t); return `${x.end ? 'end ' : ''}${x.construct}|${x.clauses}`; };
  eq(d('omp', 'parallel do simd collapse(2)'), 'parallel do simd|collapse(2)', 'combined construct');
  eq(d('omp', 'target teams distribute parallel do map(to: a)'), 'target teams distribute parallel do|map(to: a)', 'offload construct');
  eq(d('omp', 'declare_simd(f) uniform(n)'), 'declare simd|(f) uniform(n)', 'underscore spelling');
  eq(d('omp', 'end parallel'), 'end parallel|', 'end directive');
  eq(d('omp', 'atomic update'), 'atomic|update', 'atomic stands alone');
  eq(d('omp', 'target enter data map(to: x)'), 'target enter data|map(to: x)', 'target enter data');
  eq(d('acc', 'parallel loop gang vector'), 'parallel loop|gang vector', 'OpenACC');
  eq(d('acc', 'routine seq'), 'routine|seq', 'acc routine');
}

// ---------------------------------------------------------------- the FORD-style fixture
{
  const file = path.join(HERE, 'fixtures/modern/modern_ford.F90');
  const ir = extractFiles([file], { root: HERE, cpp: { macros: { USE_MPI: 1, _OPENMP: 1 } } });
  const want = JSON.parse(fs.readFileSync(path.join(HERE, 'fixtures/modern/modern_ford.args.json'), 'utf8'));
  let n = 0;
  for (const [id, lines] of Object.entries(want)) {
    eq((ir.entities[id]?.args ?? []).map(formatArg), lines, `arguments of ${id}`);
    n += lines.length;
  }
  ok(n === 41, '41 arguments in the golden file');
  const kinds = {};
  for (const e of ents(ir)) kinds[e.kind] = (kinds[e.kind] ?? 0) + 1;
  eq([kinds.module, kinds.submodule, kinds.program, kinds.procedure, kinds.type, kinds.interface, kinds.enum], [1, 1, 1, 17, 4, 5, 1], 'units, procedures, types, interfaces, enums');
  eq([kinds.component, kinds.binding], [5, 6], 'components and bindings (5 procedure bindings and 1 generic)');
  // doc comments: 13 `!>` blocks and 24 `!!` docs (hand counts in the plan's research)
  const all = [];
  for (const e of ents(ir)) {
    for (const b of e.doc?.blocks ?? []) all.push(b);
    for (const x of [...(e.args ?? []), ...(e.params ?? []), ...(e.result ? [e.result] : [])]) for (const b of x.doc?.blocks ?? []) all.push(b);
  }
  eq(all.filter((b) => b.dir === 'before').length, 13, '13 `!>` blocks attached');
  eq(all.filter((b) => b.dir === 'after').length, 24, '24 `!!` docs attached');
  eq(byName(ir, 'norm2_parallel').result.doc.blocks[0].lines, [' the global 2-norm'], 'a doc on the result variable');
  const dm = byName(ir, 'dense_matvec');
  eq(dm.hpc.directives.map((x) => `${x.end ? 'end ' : ''}${x.construct}`), ['parallel do', 'end parallel do'], 'OpenMP region');
  eq(byName(ir, 'axpy_elem').hpc.directives.map((x) => `${x.family}:${x.construct}`), ['acc:routine', 'omp:declare target'], 'OpenACC and OpenMP offload directives');
  ok(byName(ir, 'rank_sum').hpc.coarray, 'coarray use');
  eq(byName(ir, 'solver_kernels').uses.map((u) => `${u.module}${u.cond ? ` if ${u.cond.join(' && ')}` : ''}`), ['iso_fortran_env', 'iso_c_binding', 'omp_lib if defined(_OPENMP)', 'mpi_f08 if defined(USE_MPI)'], 'use statements with their conditions');
  eq(byName(ir, 'dense_matrix', 'type').finals, ['dense_finalize'], 'finalisers');
  eq(byName(ir, 'banded_matrix', 'type').params.map((p) => `${p.name}:${p.attr}`), ['k:kind', 'kl:len', 'ku:len'], 'type parameters');
  eq(['dense_matrix', 'matrix_order', 'max_order', 'write_matrix'].map((x) => byName(ir, x)?.access), ['public', 'private', 'public', 'private'], 'access');
  eq(ir.diagnostics, [], 'no diagnostics');
  // without USE_MPI, the MPI argument and component disappear
  const plain = extractFiles([file], { root: HERE });
  eq(byName(plain, 'norm2_parallel').args.map((a) => a.name), ['x'], 'cpp evaluated: no comm without USE_MPI');
  const all2 = extractFiles([file], { root: HERE, cpp: { keepAllBranches: true } });
  eq(byName(all2, 'norm2_parallel').args.map((a) => a.name), ['x', 'comm'], 'every branch kept');
}

// ---------------------------------------------------------------- the Doxygen-style fixture
{
  const ir = extractFiles([path.join(HERE, 'fixtures/modern/modern_doxygen.f90')], { root: HERE });
  const blocks = [];
  for (const e of ents(ir)) {
    for (const b of e.doc?.blocks ?? []) blocks.push(b);
    for (const a of e.args ?? []) for (const b of a.doc?.blocks ?? []) blocks.push(b);
  }
  eq(['eigen_wrappers', 'eigh', 'gemm_wrap'].map((x) => byName(ir, x).doc?.blocks[0].dir), ['before', 'before', 'before'], '3 `!>` blocks');
  eq(blocks.filter((b) => b.dir === 'after').length, 6, '6 `!<` docs');
  eq(byName(ir, 'gemm_wrap').calls.map((c) => c.name), ['dgemm'], 'a continued call');
}

// ---------------------------------------------------------------- IDs
{
  fs.writeFileSync(path.join(OUT, 'one.f'), '      SUBROUTINE DUP\n      END\n');
  fs.writeFileSync(path.join(OUT, 'two.f'), '      SUBROUTINE DUP\n      END\n');
  const ir = extractFiles([path.join(OUT, 'one.f'), path.join(OUT, 'two.f')], { root: OUT });
  eq(Object.keys(ir.entities), ['procedure:dup@one.f', 'procedure:dup@two.f'], 'external procedures that clash take their file');
  const br = parse('#ifdef A\nsubroutine s(x)\n#else\nsubroutine s(x, y)\n#endif\nend subroutine\n', { path: 'b.F90', cpp: { keepAllBranches: true } });
  ok(Object.keys(br.entities).length >= 1 && !br.diagnostics.some((d) => d.severity === 'error'), 'two headers in two branches do not abort');
}

// ---------------------------------------------------------------- the other test files
// Each test/*.test.mjs exports a default function that receives { ok, eq, here, out } and may be async.
// `node test/run.mjs react graphs` runs only the test files whose names contain one of the words given.
const only = process.argv.slice(2);
const chosen = (x) => x.endsWith('.test.mjs') && (!only.length || only.some((w) => x.includes(w)));
for (const f of fs.readdirSync(HERE).filter(chosen).sort()) {
  const mod = await import(new URL(f, import.meta.url));
  await mod.default({ ok, eq, here: HERE, out: OUT });
}

console.log(`${checks - failures}/${checks} checks passed`);
if (failures) process.exit(1);
