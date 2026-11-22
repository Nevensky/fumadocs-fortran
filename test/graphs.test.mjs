// The graphs: name resolution for calls (use, only, renames, host association, generics, type-bound procedures),
// intrinsic and library calls, conditions, caps, escaping, inheritance, submodules, the overview and null results;
// and every graph of examples/modern and the fixtures is well-formed Mermaid.
import path from 'node:path';
import { extract, extractFiles, parseSource } from '../src/index.js';
import { buildGraphs, mermaidLabel } from '../src/emit/graphs.js';
import { INTRINSIC_PROCEDURES, INTRINSIC_SUBROUTINES } from '../src/emit/fortran-names.js';
import { classifyLibrary, libraryLookup } from '../src/emit/library.js';
import { load } from '../registry/read.mjs';

const DECODE = { quot: '"', lt: '<', gt: '>', amp: '&', 35: '#' };
const decode = (s) => s.replace(/#(quot|lt|gt|amp|35);/g, (m, k) => DECODE[k]);
const PAIRS = { '[': ']', '[[': ']]', '([': '])', '(': ')', '{{': '}}' };
const NODE = /^ {2}(n\d+)(\[\[|\(\[|\{\{|\[|\()"([^"]*)"(\]\]|\]\)|\}\}|\]|\))$/;
const EDGE = /^ {2}(n\d+) (-->|-\.->|-- "([^"]*)" -->|-\. "submodule of" \.->) (n\d+)$/;

/** A graph by its labels: nodes { label, shape, classes, url } in ID order, and edges such as `a --> b`. */
function read(src) {
  const nodes = new Map();
  const edges = [];
  for (const l of src.split('\n')) {
    let m;
    if ((m = NODE.exec(l))) nodes.set(m[1], { label: decode(m[3]), shape: m[2], classes: [], url: null });
    else if ((m = /^ {2}class (n\d+) (\w+)$/.exec(l))) nodes.get(m[1]).classes.push(m[2]);
    else if ((m = /^ {2}click (n\d+) href "([^"]*)"$/.exec(l))) nodes.get(m[1]).url = m[2];
  }
  for (const l of src.split('\n')) {
    const m = EDGE.exec(l);
    if (m) edges.push(`${nodes.get(m[1]).label} ${decode(m[2])} ${nodes.get(m[4]).label}`);
  }
  const list = [...nodes.values()];
  return { nodes: list, edges, labels: list.map((n) => n.label), node: (label) => list.find((n) => n.label === label) };
}

/**
 * What is wrong with a graph as Mermaid: a line of a form buildGraphs does not write, a node named but not declared
 * or declared twice, IDs out of order, a class used but not defined (or defined but not used), markup characters in a
 * label, quotes or brackets that do not balance.
 */
function problems(src) {
  const out = [];
  const lines = src.split('\n');
  if (!/^flowchart (LR|BT)$/.test(lines[0])) out.push(`header ${lines[0]}`);
  const nodes = [];
  const defined = new Set(), used = new Set(), named = [];
  const badText = (t) => /[<>&"]/.test(t) || /#(?!(quot|lt|gt|amp|35);)/.test(t);
  for (const l of lines.slice(1)) {
    let m;
    if ((m = /^ {2}classDef (fdf[A-Za-z]+) ([a-z-]+:[^,]+(?:,[a-z-]+:[^,]+)*)$/.exec(l))) defined.add(m[1]);
    else if ((m = NODE.exec(l))) {
      if (PAIRS[m[2]] !== m[4]) out.push(`brackets ${l}`);
      if (nodes.includes(m[1])) out.push(`declared twice ${m[1]}`);
      nodes.push(m[1]);
      if (badText(m[3])) out.push(`label ${l}`);
    } else if ((m = EDGE.exec(l))) {
      named.push(m[1], m[4]);
      if (m[3] !== undefined && badText(m[3])) out.push(`edge label ${l}`);
    } else if ((m = /^ {2}class (n\d+) (fdf[A-Za-z]+)$/.exec(l))) {
      named.push(m[1]);
      used.add(m[2]);
    } else if ((m = /^ {2}click (n\d+) href "([^"]*)"$/.exec(l))) named.push(m[1]);
    else out.push(`line ${l}`);
  }
  if (nodes.some((n, i) => n !== `n${i + 1}`)) out.push('IDs out of order');
  for (const n of named) if (!nodes.includes(n)) out.push(`undeclared ${n}`);
  for (const c of used) if (!defined.has(c)) out.push(`undefined class ${c}`);
  for (const c of defined) if (!used.has(c)) out.push(`unused class ${c}`);
  if ((src.match(/"/g) ?? []).length % 2) out.push('quotes do not pair');
  const bare = src.replace(/"[^"\n]*"/g, '""');
  for (const [a, b] of [['[', ']'], ['(', ')'], ['{', '}']]) {
    if (bare.split(a).length !== bare.split(b).length) out.push(`${a}${b} do not balance`);
  }
  return out;
}

export default async function ({ ok, eq, here, out }) {
  const src = (lines, opts = {}) => parseSource(lines.join('\n'), { root: out, path: 'graphs.f90', ...opts });
  const find = (ir, name, kind) => Object.values(ir.entities)
    .find((e) => e.name.toLowerCase() === name && (!kind || e.kind === kind));
  const url = (e) => `/api#${e.name.toLowerCase()}`;
  const sorted = (a) => [...a].sort();
  const classed = (g) => g.nodes.map((n) => `${n.label} ${n.classes.join(' ')}`);

  // ---- use statements: only lists, renames, and a plain use that sees public names only
  {
    const ir = src([
      'module lib_a',
      '  implicit none',
      '  private',
      '  public :: run, step, util',
      'contains',
      '  subroutine run()',
      '  end subroutine',
      '  subroutine step()',
      '  end subroutine',
      '  subroutine util()',
      '  end subroutine',
      '  subroutine secret()',
      '  end subroutine',
      'end module lib_a',
      'module lib_b',
      '  use lib_a, only: go => run',
      'contains',
      '  subroutine driver()',
      '    call go()',
      '    call step()',
      '  end subroutine',
      'end module lib_b',
      'module lib_c',
      '  use lib_a, walk => step',
      'contains',
      '  subroutine user()',
      '    call walk()',
      '    call step()',
      '    call util()',
      '    call secret()',
      '  end subroutine',
      'end module lib_c',
      'module lib_d',
      '  use lib_c',
      'end module lib_d',
      'program main_d',
      '  use lib_d',
      '  call util()',
      'end program main_d',
    ]);
    const g = buildGraphs(ir, { url });
    const s = g.calls(find(ir, 'driver'));
    ok(s.startsWith('flowchart LR\n'), 'a call graph runs left to right');
    const d = read(s);
    eq(d.edges, ['driver --> run', 'driver --> step'], 'a name renamed in an only list is the module\'s procedure');
    eq([d.node('run').classes, d.node('run').url], [['fdfProcedure'], '/api#run'],
      'a project callee is a procedure, linked');
    eq([d.node('step').classes, d.node('step').url], [['fdfExternal'], null],
      'a name the only list leaves out is not the module\'s');
    eq(classed(read(g.calls(find(ir, 'user')))),
      ['user fdfProcedure fdfFocus', 'step fdfProcedure', 'step fdfExternal', 'util fdfProcedure',
        'secret fdfExternal'],
      'a renamed name resolves and its old name does not; a plain use sees only public names');
    eq(read(g.calls(find(ir, 'util'))).edges, ['user --> util', 'main_d --> util'],
      'callers, to the left, including a program that sees the name through two modules');
    eq(read(g.calls(find(ir, 'run'))).edges, ['driver --> run'], 'a caller that knows the procedure by another name');
    ok(g.calls(find(ir, 'run')) === g.calls(find(ir, 'run').id), 'a graph is asked for by entity or by ID');
  }

  // ---- host association: internal procedures, the host's dummies, the module's procedures
  {
    const ir = src([
      'module host_m',
      'contains',
      '  subroutine outer(cb)',
      '    external :: cb',
      '    call inner_a()',
      '    call cb()',
      '  contains',
      '    subroutine inner_a()',
      '      call inner_b()',
      '      call cb()',
      '      call top()',
      '    end subroutine',
      '    subroutine inner_b()',
      '    end subroutine',
      '  end subroutine',
      '  subroutine top()',
      '    call inner_b()',
      '  end subroutine',
      '  subroutine apply(task)',
      '    interface',
      '      subroutine task()',
      '      end subroutine',
      '    end interface',
      '    call task()',
      '  end subroutine',
      'end module host_m',
      'subroutine task()',
      'end subroutine',
    ]);
    const g = buildGraphs(ir);
    const o = read(g.calls(find(ir, 'outer')));
    eq(o.edges, ['outer --> inner_a', 'inner_a --> inner_b', 'inner_a --> top'],
      'an internal procedure, its sibling, the module\'s procedure by host association; no dummy procedure');
    eq(o.nodes.map((n) => n.classes[0]), ['fdfProcedure', 'fdfProcedure', 'fdfProcedure', 'fdfProcedure'],
      'all four are project procedures');
    const t = read(g.calls(find(ir, 'top')));
    eq(t.edges, ['top --> inner_b', 'inner_a --> top'], 'an internal procedure as a caller');
    eq(t.node('inner_b').classes, ['fdfExternal'],
      'another procedure\'s internal procedure is out of scope: an external call of that name');
    eq(g.calls(find(ir, 'apply')), null,
      'a dummy procedure with an interface body is not the external procedure of its name');
  }

  // ---- generic interfaces, their specifics, and separate module procedures
  {
    const ir = src([
      'module gen_m',
      '  implicit none',
      '  interface solve',
      '    module procedure solve_r, solve_c',
      '  end interface',
      '  interface norm',
      '    module function norm_r(x) result(n)',
      '      real, intent(in) :: x(:)',
      '      real :: n',
      '    end function',
      '  end interface',
      'contains',
      '  subroutine solve_r(x)',
      '    real :: x',
      '    call factor()',
      '  end subroutine',
      '  subroutine solve_c(x)',
      '    complex :: x',
      '  end subroutine',
      '  subroutine factor()',
      '  end subroutine',
      '  subroutine client(v)',
      '    real :: v(3)',
      '    call solve(v(1))',
      '    print *, norm(v)',
      '  end subroutine',
      'end module gen_m',
      'submodule (gen_m) gen_impl',
      'contains',
      '  module procedure norm_r',
      '    n = sqrt(sum(x**2))',
      '  end procedure',
      'end submodule gen_impl',
    ]);
    // the implementation has no heading of its own here: it links to its interface body
    const g = buildGraphs(ir, {
      url: (e) => (e.scope === 'separate' ? null : `/api#${e.scope ?? e.kind}-${e.name.toLowerCase()}`),
    });
    const c = read(g.calls(find(ir, 'client')));
    eq(c.edges, ['client --> solve', 'client --> norm', 'solve -.-> solve_r', 'solve -.-> solve_c', 'norm -.-> norm_r',
      'solve_r --> factor'], 'a generic interface with dotted edges to its specifics, whose callees follow');
    eq([c.node('solve').shape, c.node('solve').classes], ['{{', ['fdfGeneric']], 'a generic is a hexagon');
    const impl = Object.values(ir.entities).find((e) => e.name === 'norm_r' && e.scope === 'separate');
    eq(c.node('norm_r').url, '/api#interface-norm_r',
      'a separate module procedure stands for its interface body and links to it');
    eq(g.calls(impl), g.calls(find(ir, 'norm_r')), 'an interface body\'s graph is its implementation\'s');
    eq(read(g.calls(find(ir, 'solve_r'))).edges, ['solve_r --> factor', 'solve -.-> solve_r', 'client --> solve'],
      'a caller of the generic is a caller of its specifics, through the generic');
    eq(read(g.calls(find(ir, 'solve', 'interface'))).edges,
      ['solve -.-> solve_r', 'solve -.-> solve_c', 'solve_r --> factor', 'client --> solve'],
      'the graph of a generic interface');
  }

  // ---- one interface, two implementations (a build picks one, as stdlib does for error stop)
  {
    const ir = src([
      'module errs',
      '  interface',
      '    module subroutine fail(msg)',
      '      character(*), intent(in) :: msg',
      '    end subroutine',
      '  end interface',
      'contains',
      '  subroutine check(good)',
      '    logical :: good',
      '    if (.not. good) call fail("no")',
      '  end subroutine',
      'end module errs',
      'submodule (errs) errs_f08',
      'contains',
      '  module procedure fail',
      '    error stop msg',
      '  end procedure',
      'end submodule errs_f08',
      'submodule (errs) errs_f18',
      'contains',
      '  module subroutine fail(msg)',
      '    use iso_fortran_env, only: error_unit',
      '    character(*), intent(in) :: msg',
      '    call abort_all(msg)',
      '  end subroutine',
      'end submodule errs_f18',
    ]);
    const g = buildGraphs(ir);
    const [f08, f18] = Object.values(ir.entities).filter((e) => e.name === 'fail' && e.scope === 'separate');
    eq(read(g.calls(f08)).edges, ['check --> fail'],
      'the callers of an interface are the callers of each implementation');
    eq(read(g.calls(f18)).edges, ['fail --> abort_all', 'check --> fail'],
      'and each implementation shows what it calls');
    eq(read(g.dependencies(f18)).edges, ['fail --> iso_fortran_env'], 'what a separate module procedure uses');
  }

  // ---- one external name defined twice (LAPACK's SRC/VARIANTS): the definition nearest the caller
  {
    const files = {
      'lib/variants/cr/getrf.f': ['      SUBROUTINE GETRF()', '      CALL GETF2()', '      END'],
      'lib/variants/cr/crdrv.f': ['      SUBROUTINE CRDRV()', '      CALL GETRF()', '      END'],
      'lib/getrf.f': ['      SUBROUTINE GETRF()', '      CALL GETRF2()', '      END'],
      'lib/getrf2.f': ['      SUBROUTINE GETRF2()', '      END'],
      'lib/getf2.f': ['      SUBROUTINE GETF2()', '      END'],
      'lib/gesv.f': ['      SUBROUTINE GESV()', '      CALL GETRF()', '      END'],
      'lib/iface.f90': ['module lapack_iface', '  interface', '    subroutine getrf()', '    end subroutine',
        '  end interface', 'contains', '  subroutine solve()', '    call getrf()', '  end subroutine', 'end module'],
    };
    const ir = extractFiles(Object.keys(files), { root: out },
      (abs) => files[path.relative(out, abs).split(path.sep).join('/')].join('\n'));
    const g = buildGraphs(ir, { url: (e) => e.file });
    const urls = (e) => read(g.calls(e)).nodes.map((n) => `${n.label} ${n.url}`);
    eq(urls(find(ir, 'gesv')), ['GESV lib/gesv.f', 'GETRF lib/getrf.f', 'GETRF2 lib/getrf2.f'],
      'a call goes to the definition beside the caller, not to the first one found');
    eq(urls(find(ir, 'crdrv')), ['CRDRV lib/variants/cr/crdrv.f', 'GETRF lib/variants/cr/getrf.f', 'GETF2 lib/getf2.f'],
      'and a variant\'s caller to the variant');
    eq(urls(find(ir, 'solve')).slice(0, 2), ['solve lib/iface.f90', 'GETRF lib/getrf.f'],
      'an interface body stands for the nearest definition too');
    const reference = Object.values(ir.entities).find((e) => e.file === 'lib/getrf.f');
    eq(sorted(read(g.calls(reference)).edges), ['GESV --> GETRF', 'GETRF --> GETRF2', 'solve --> GETRF'],
      'so the reference definition keeps its callers');
  }

  // ---- type-bound calls through the declared type of a dummy argument
  {
    const ir = src([
      'module shapes',
      '  implicit none',
      '  type, abstract :: shape_t',
      '  contains',
      '    procedure(update_iface), deferred :: update',
      '    procedure :: describe => shape_describe',
      '    procedure :: scale',
      '    generic :: show => describe',
      '  end type',
      '  type, extends(shape_t) :: circle_t',
      '    real :: r = 1',
      '  contains',
      '    procedure :: update => circle_update',
      '  end type',
      '  type :: engine_t',
      '  contains',
      '    procedure :: start => engine_start',
      '  end type',
      '  type :: car_t',
      '    type(engine_t) :: e',
      '  end type',
      '  abstract interface',
      '    subroutine update_iface(s)',
      '      import :: shape_t',
      '      class(shape_t), intent(inout) :: s',
      '    end subroutine',
      '  end interface',
      'contains',
      '  subroutine shape_describe(s)',
      '    class(shape_t), intent(in) :: s',
      '  end subroutine',
      '  subroutine scale(s)',
      '    class(shape_t), intent(inout) :: s',
      '  end subroutine',
      '  subroutine circle_update(s)',
      '    class(circle_t), intent(inout) :: s',
      '  end subroutine',
      '  subroutine engine_start(e)',
      '    class(engine_t), intent(inout) :: e',
      '  end subroutine',
      '  subroutine via_dummy(s)',
      '    class(shape_t), intent(inout) :: s',
      '    call s%describe()',
      '    call s%scale()',
      '    call s%update()',
      '  end subroutine',
      '  subroutine via_parent(c)',
      '    type(circle_t), intent(inout) :: c',
      '    call c%describe()',
      '    call c%update()',
      '  end subroutine',
      '  subroutine via_component(car)',
      '    type(car_t), intent(inout) :: car',
      '    call car%e%start()',
      '  end subroutine',
      '  subroutine via_generic(s)',
      '    class(shape_t), intent(inout) :: s',
      '    call s%show()',
      '  end subroutine',
      '  subroutine via_local()',
      '    type(circle_t) :: x',
      '    call x%describe()',
      '  end subroutine',
      'end module shapes',
    ]);
    const g = buildGraphs(ir);
    const callees = (name, kind) => read(g.calls(find(ir, name, kind))).edges;
    eq(callees('via_dummy'), ['via_dummy --> shape_describe', 'via_dummy --> scale'],
      'a binding\'s implementation, with and without =>; a deferred binding is dropped');
    eq(callees('via_parent'), ['via_parent --> shape_describe', 'via_parent --> circle_update'],
      'an inherited binding, and an overriding one');
    eq(callees('via_component'), ['via_component --> engine_start'], 'through a component\'s declared type');
    eq(callees('via_generic'), ['via_generic --> show', 'show -.-> shape_describe'],
      'a generic binding over its specific bindings');
    eq(g.calls(find(ir, 'via_local')), null, 'a local variable\'s type is unknown: the call is dropped');
    eq(sorted(callees('shape_describe')),
      ['show -.-> shape_describe', 'via_dummy --> shape_describe', 'via_generic --> show',
        'via_parent --> shape_describe'],
      'callers through bindings and a generic binding');
    eq(callees('scale', 'procedure'), ['via_dummy --> scale'],
      'a binding to a procedure named like an intrinsic is the project\'s');
  }

  // ---- type-bound function references: through a dummy, an inherited binding, a function result and a component
  {
    const ir = src([
      'module shapes2',
      '  implicit none',
      '  type :: circle',
      '    real :: r = 1',
      '    real, allocatable :: radii(:)',
      '    procedure(area_iface), pointer, nopass :: hook => null()',
      '  contains',
      '    procedure :: area => circle_area',
      '    procedure :: grow => circle_grow',
      '  end type',
      '  type, extends(circle) :: ring',
      '  end type',
      '  type :: holder',
      '    type(circle) :: c',
      '  end type',
      '  abstract interface',
      '    real function area_iface()',
      '    end function',
      '  end interface',
      'contains',
      '  real function circle_area(self)',
      '    class(circle), intent(in) :: self',
      '    circle_area = 3.14 * self%r**2',
      '  end function',
      '  subroutine circle_grow(self)',
      '    class(circle), intent(inout) :: self',
      '    self%r = 2 * self%r',
      '  end subroutine',
      '  real function report(c)',
      '    type(circle), intent(in) :: c',
      '    report = 2.0 * c%area()',
      '    if (c%area() > 1.0) report = 0',
      '  end function',
      '  real function inherited(x)',
      '    type(ring), intent(in) :: x',
      '    inherited = x%area()',
      '  end function',
      '  function make() result(h)',
      '    type(holder) :: h',
      '    real :: a',
      '    a = h%c%area() + 1.0',
      '  end function',
      '  subroutine on_images(x)',
      '    type(circle), intent(inout) :: x[*]',
      '    call x[2]%grow()',
      '  end subroutine',
      '  subroutine not_bindings(c)',
      '    type(circle), intent(inout) :: c',
      '    type(circle) :: loc',
      '    real :: v',
      '    v = c%radii(1) + c%hook() + loc%area()',
      '  end subroutine',
      'end module shapes2',
    ]);
    const g = buildGraphs(ir);
    const edges = (name) => read(g.calls(find(ir, name)) ?? '').edges;
    eq(['report', 'inherited', 'make'].map(edges),
      [['report --> circle_area'], ['inherited --> circle_area'], ['make --> circle_area']],
      'a type-bound function referenced through a dummy, an inherited binding, and a function result\'s component');
    eq(edges('on_images'), ['on_images --> circle_grow'], 'a call through an image selector');
    eq(g.calls(find(ir, 'not_bindings')), null,
      'an array component, a procedure pointer component and a local variable draw nothing');
    eq(edges('circle_area'), ['report --> circle_area', 'inherited --> circle_area', 'make --> circle_area'],
      'and a type-bound function has its callers');
  }

  // ---- function references inside another's parentheses, and right after `if (` and `while (`
  {
    const ir = src([
      'module funcs',
      'contains',
      '  real function f(x)',
      '    real :: x',
      '    f = x',
      '  end function',
      '  real function g(x)',
      '    real :: x',
      '    g = x',
      '  end function',
      '  logical function is_ok(x)',
      '    real :: x',
      '    is_ok = x > 0',
      '  end function',
      '  subroutine nested(y)',
      '    real :: y',
      '    y = f(g(y))',
      '  end subroutine',
      '  subroutine guarded(y)',
      '    real :: y',
      '    if (is_ok(y)) y = sqrt(f(y))',
      '    do while (is_ok(y))',
      '      y = max(f(y), g(y)) - 1',
      '    end do',
      '  end subroutine',
      'end module funcs',
    ]);
    const g = buildGraphs(ir);
    const edges = (name) => read(g.calls(find(ir, name)) ?? '').edges;
    eq(edges('nested'), ['nested --> f', 'nested --> g'], 'f(g(x)) calls both');
    eq(edges('guarded'), ['guarded --> f', 'guarded --> g', 'guarded --> is_ok'],
      'references after if ( and while (, and in the arguments of an intrinsic');
    eq(edges('is_ok'), ['guarded --> is_ok'], 'so a function tested in a condition has callers');
  }

  // ---- a function reference is drawn as the source writes it, as a call is: fixed form in capitals stays in
  // capitals, and a name written two ways is one node, labelled as first written
  {
    const ir = src([
      '      SUBROUTINE DGETRF2( M, N, A, LDA, IPIV, INFO )',
      '      CHARACTER TRANS',
      '      INTEGER M, N, LDA, INFO, I, IPIV( * )',
      '      DOUBLE PRECISION SFMIN, A( LDA, * )',
      "      SFMIN = DLAMCH( 'S' )",
      "      SFMIN = Dlamch( 'E' ) + dlamch( 'P' )",
      "      IF( LSAME( TRANS, 'N' ) .AND. DISNAN( SFMIN ) ) INFO = 1",
      '      CALL DSCAL( M, 1.0D0 / DNRM2( M, A, 1 ), A, 1 )',
      '      I = IDAMAX( M, A( 1, 1 ), 1 )',
      '      END',
    ], { path: 'dgetrf2.f' });
    const g = read(buildGraphs(ir, { classify: classifyLibrary }).calls(find(ir, 'dgetrf2')));
    eq(classed(g), ['DGETRF2 fdfProcedure fdfFocus', 'DSCAL fdfBlas', 'DISNAN fdfLapack', 'DLAMCH fdfLapack',
      'DNRM2 fdfBlas', 'IDAMAX fdfBlas', 'LSAME fdfBlas'],
    'function references in capitals, after a string (LSAME\'s \'N\') and in a CALL\'s arguments; DLAMCH, written '
      + 'three ways, is one node');
  }

  // ---- a generic is one with the generics of its name its scope declares or uses (norm_b's norm extends norm_a's)
  {
    const ir = src([
      'module norm_a',
      '  interface norm',
      '    module procedure norm_real',
      '  end interface',
      'contains',
      '  real function norm_real(x)',
      '    real :: x(:)',
      '    norm_real = 0',
      '  end function',
      'end module norm_a',
      'module norm_b',
      '  use norm_a',
      '  interface norm',
      '    module procedure norm_int',
      '  end interface',
      'contains',
      '  real function norm_int(x)',
      '    integer :: x(:)',
      '    norm_int = 0',
      '  end function',
      'end module norm_b',
      'program client',
      '  use norm_b',
      '  real :: v(3) = 1',
      '  print *, norm(v)',
      'end program client',
      'program both',
      '  use norm_a',
      '  use norm_b',
      '  integer :: k(3) = 1',
      '  print *, norm(k)',
      'end program both',
      'module twice',
      '  interface assign_to',
      '    module procedure assign_a',
      '  end interface',
      '  interface assign_to',
      '    module procedure assign_b',
      '  end interface',
      'contains',
      '  subroutine assign_a(x)',
      '    real :: x',
      '  end subroutine',
      '  subroutine assign_b(x)',
      '    integer :: x',
      '  end subroutine',
      '  subroutine user(x)',
      '    real :: x',
      '    call assign_to(x)',
      '  end subroutine',
      'end module twice',
    ]);
    const g = buildGraphs(ir);
    const edges = (name) => read(g.calls(find(ir, name)) ?? '').edges;
    eq(edges('client'), ['client --> norm', 'norm -.-> norm_int', 'norm -.-> norm_real'],
      'a generic has the specifics of the used module\'s generic it extends');
    eq(edges('norm_real'), ['norm -.-> norm_real', 'client --> norm', 'both --> norm'],
      'so their callers reach them through it');
    eq(edges('both'), ['both --> norm', 'norm -.-> norm_int', 'norm -.-> norm_real'],
      'a scope that uses both modules calls the generic that holds the other');
    eq(edges('user'), ['user --> assign_to', 'assign_to -.-> assign_a', 'assign_to -.-> assign_b'],
      'two interface blocks of one name in one module are one generic');
  }

  // ---- what only looks like a function reference: a statement function, an array dimensioned in COMMON
  {
    const ir = src([
      '      SUBROUTINE STMT(Y)',
      '      REAL Y, SQ, X',
      '      SQ(X) = X * X',
      '      Y = SQ(2.0)',
      '      END',
      '      SUBROUTINE WORK(N)',
      '      INTEGER N',
      '      COMMON /BLK/ B(10)',
      '      DOUBLE PRECISION A, B',
      '      A = B(2)',
      '      END',
      '      REAL FUNCTION SQ(X)',
      '      REAL X',
      '      SQ = X',
      '      END',
      '      DOUBLE PRECISION FUNCTION B(X)',
      '      DOUBLE PRECISION X',
      '      B = X',
      '      END',
    ], { path: 'stmt.f' });
    const g = buildGraphs(ir);
    eq([g.calls(find(ir, 'stmt')), g.calls(find(ir, 'work'))], [null, null],
      'neither is a call to the external procedure of that name');
  }

  // ---- CUDA routines by name, gfortran's extensions as intrinsics, and a cap below 2
  {
    const ir = src([
      'module gpu',
      '  use cudafor',
      '  use cufft',
      'contains',
      '  subroutine run(a, n)',
      '    real(8), device :: a(:)',
      '    integer :: n, istat, plan',
      '    istat = cudaDeviceSynchronize()',
      '    call cublasDgemm("N", "N", n, n, n, 1d0, a, n, a, n, 0d0, a, n)',
      '    istat = CUFFTEXECZ2Z(plan, a, a, -1)',
      '    call curandGenerateUniform(n, a, n)',
      '    call dgetrf(n, n, a, n, n, istat)',
      '  end subroutine',
      '  subroutine sys(t)',
      '    real :: t',
      '    character(64) :: d',
      '    call chdir("/tmp")',
      '    call fseek(10, 0, 0)',
      '    call srand(7)',
      '    d = ctime(time())',
      '    t = second()',
      '    call report_time(t)',
      '  end subroutine',
      'end module gpu',
      'real function second()',
      '  second = 0',
      'end function',
    ]);
    const g = buildGraphs(ir);
    const run = read(g.calls(find(ir, 'run')) ?? '');
    eq(classed(run), ['run fdfProcedure fdfFocus', 'cublasDgemm fdfCuda', 'curandGenerateUniform fdfCuda',
      'dgetrf fdfExternal', 'cudaDeviceSynchronize fdfCuda', 'CUFFTEXECZ2Z fdfCuda'],
    'CUDA routines by prefix, in any case, called or referenced, with no only list; LAPACK is left to classify');
    eq(classed(read(g.dependencies(find(ir, 'gpu')) ?? '')), ['gpu fdfModule fdfFocus', 'cudafor fdfCuda', 'cufft fdfCuda'],
      "the modules of the CUDA libraries, not only cudafor's, are CUDA in a dependency graph");
    eq(read(g.calls(find(ir, 'sys')) ?? '').edges, ['sys --> report_time', 'sys --> second'],
      'gfortran\'s extensions are intrinsics, unless the project defines one');
    const capped = (max, name) => read(buildGraphs(ir, { maxNodes: max }).calls(find(ir, name)) ?? '').labels;
    eq(capped(1, 'second'), ['second', 'sys'], 'maxNodes below 2 counts as 2: a subject and one caller are both drawn');
    eq(capped(0, 'run'), ['run', `… ${run.nodes.length - 1} more`], 'and a longer graph is the subject and … N more');
  }

  // ---- intrinsics, library classes, the site's classify(), and conditions
  {
    const ir = src([
      'subroutine hpc_calls(x, n)',
      '  use mpi',
      '  implicit none',
      '  integer :: n, ierr, i',
      '  real(8) :: x(n), t, s',
      '  call random_number(x)',
      '  call cpu_time(t)',
      '  s = sqrt(sum(x)) + dble(size(x))',
      '  call MPI_Allreduce(s, t, 1, MPI_DOUBLE_PRECISION, MPI_SUM, MPI_COMM_WORLD, ierr)',
      '  call omp_set_num_threads(4)',
      '  call acc_init(2)',
      '  call co_sum(s)',
      '  call dgemm("N", "N", n, n, n, 1d0, x, n, x, n, 0d0, x, n)',
      '  call ZGEMM("N", "N", n, n, n, 1d0, x, n, x, n, 0d0, x, n)',
      '  i = idamax(n, x, 1)',
      '  call dgesv(n, 1, x, n, i, x, n, ierr)',
      '  call pdgesv(n)',
      '  call foo_lib(x)',
      '  t = mystery(x)',
      '#ifdef USE_MPI',
      '  call MPI_Barrier(MPI_COMM_WORLD, ierr)',
      '#endif',
      '#if NPROC > 1 && defined(HALO)',
      '  call exchange(x)',
      '#endif',
      '#ifdef A',
      '  call twice()',
      '#endif',
      '  call twice()',
      'end subroutine',
    ], { path: 'hpc.F90', cpp: { macros: { USE_MPI: 1, NPROC: 4, HALO: 1, A: 1 } } });
    const classify = (n) => ({ dgesv: 'fdfLapack', pdgesv: 'ScaLAPACK' })[n] ?? null;
    const s = buildGraphs(ir, { classify }).calls(find(ir, 'hpc_calls'));
    const h = read(s);
    eq(classed(h), [
      'hpc_calls fdfProcedure fdfFocus', 'MPI_Allreduce fdfMpi', 'omp_set_num_threads fdfOmp', 'acc_init fdfAcc',
      'co_sum fdfCoarray', 'dgemm fdfBlas', 'ZGEMM fdfBlas', 'dgesv fdfLapack', 'pdgesv fdfScalapack',
      'foo_lib fdfExternal', 'MPI_Barrier fdfMpi', 'exchange fdfExternal', 'twice fdfExternal', 'idamax fdfBlas',
    ], 'intrinsics dropped, unknown references dropped, library calls classed (a BLAS function reference too)');
    ok(h.edges.includes('hpc_calls -- "USE_MPI" --> MPI_Barrier') && h.edges.includes('hpc_calls --> MPI_Allreduce'),
      'a call under a condition is labelled');
    ok(s.includes('-- "NPROC #gt; 1 #amp;#amp; defined(HALO)" -->'), 'a condition is escaped in its label');
    ok(h.edges.includes('hpc_calls --> twice'), 'a callee called both with and without a condition is not labelled');
    eq(read(buildGraphs(ir).calls(find(ir, 'hpc_calls'))).node('dgesv').classes, ['fdfExternal'],
      'without classify, LAPACK is an external library');
    eq(read(buildGraphs(ir, { classify: () => 'fdfFocus' }).calls(find(ir, 'hpc_calls'))).node('foo_lib').classes,
      ['fdfExternal'], 'classify can only give a library class');

    // the registry's classify, which the page writer gives buildGraphs: the same classes as the site's above, and an
    // intrinsic (co_sum) is left to the graphs, which draw it as a coarray call
    const registry = read(buildGraphs(ir, { classify: classifyLibrary }).calls(find(ir, 'hpc_calls')));
    eq(classed(registry), classed(h), 'the registry classes LAPACK and ScaLAPACK, and leaves intrinsics to the graphs');
  }

  // ---- a CALL names a subroutine: a name only an intrinsic function has is some other routine, drawn, and the
  // registry's classify gives it the subroutine of that name it knows (ScaLAPACK's reshape, in TOOLS/reshape.c);
  // intrinsic subroutines (gfortran's too) and references of intrinsics are not drawn
  {
    const ir = src([
      'subroutine redist(a, b, n, s)',
      '  integer :: n',
      '  real :: a(n), b(n)',
      '  character(8) :: s',
      '  call RESHAPE(a, n, b)',
      '  call random_number(a)',
      '  call system_clock(n)',
      '  call getarg(1, s)',
      '  call exit(1)',
      '  call c_f_pointer(a, b)',
      '  call ieee_set_rounding_mode(n)',
      '  b = reshape(a, [n]) + sum(a)',
      'end subroutine',
    ]);
    const g = (opts) => classed(read(buildGraphs(ir, opts).calls(find(ir, 'redist')) ?? ''));
    eq([g({}), g({ classify: classifyLibrary })], [['redist fdfProcedure fdfFocus', 'RESHAPE fdfExternal'],
      ['redist fdfProcedure fdfFocus', 'RESHAPE fdfScalapack']],
    'a CALL of an intrinsic function\'s name is an outside routine, and with the registry\'s classify ScaLAPACK\'s');
    // a name an only list gives from a module outside the project: a CALL of reshape is the subroutine, and a
    // function reference of it, which may as well be an array, is drawn only when classify() knows a function of the
    // name: here the intrinsic's, which is not drawn
    const used = src([
      'module rs',
      '  use mylib, only: reshape',
      'contains',
      '  subroutine called(a, b)',
      '    real :: a(4), b(2, 2)',
      '    call reshape(a, 4, b)',
      '  end subroutine',
      '  subroutine referenced(a, b)',
      '    real :: a(4), b(2, 2)',
      '    b = reshape(a, [2, 2])',
      '  end subroutine',
      'end module rs',
    ]);
    const u = (name) => classed(read(buildGraphs(used, { classify: classifyLibrary }).calls(find(used, name)) ?? ''));
    eq([u('called'), u('referenced')], [['called fdfProcedure fdfFocus', 'reshape fdfScalapack'], []],
      'through an only list: a CALL of reshape is ScaLAPACK\'s, a function reference of it no node');
    eq([classifyLibrary('reshape'), classifyLibrary('RESHAPE', { subroutine: true }), classifyLibrary('dlamch'),
      classifyLibrary('dlamch', { subroutine: true })], [null, 'scalapack', 'lapack', 'lapack'],
    'the registry\'s classify: reshape is the intrinsic function, unless a subroutine is asked for; a name of one '
      + 'library is that library\'s either way');
    // the intrinsic subroutines are intrinsic procedures, and the registry's are all among them (its functions none)
    const reg = load('intrinsics').entries;
    eq([[...INTRINSIC_SUBROUTINES].filter((n) => !INTRINSIC_PROCEDURES.has(n)),
      Object.keys(reg).filter((n) => (reg[n].k === 's') !== INTRINSIC_SUBROUTINES.has(n) && !n.startsWith('co_'))],
    [[], []], 'the intrinsic subroutines: a part of the intrinsic procedures, and the registry\'s subroutines');
  }

  // ---- use, intrinsic :: omp_lib (gfortran keeps its OpenMP and OpenACC modules with the intrinsic ones)
  {
    const ir = src([
      'module dev',
      '  use, intrinsic :: omp_lib, only: omp_set_num_threads',
      '  use, intrinsic :: openacc, only: acc_init',
      '  use, intrinsic :: iso_c_binding, only: c_f_pointer',
      '  use, intrinsic :: vendor_mod, only: vendor_go',
      'contains',
      '  subroutine go(p)',
      '    integer :: p',
      '    call omp_set_num_threads(p)',
      '    call acc_init(p)',
      '    call c_f_pointer(p)',
      '    call vendor_go(p)',
      '  end subroutine',
      'end module dev',
    ]);
    eq(classed(read(buildGraphs(ir).calls(find(ir, 'go')) ?? '')),
      ['go fdfProcedure fdfFocus', 'omp_set_num_threads fdfOmp', 'acc_init fdfAcc'],
      'an intrinsic use of an HPC module names its routines; the standard\'s and unknown intrinsic modules\' are not '
        + 'drawn');
  }

  // ---- the registry's classes of library routines: BLAS first, then LAPACK, ScaLAPACK, MPI, OpenMP and OpenACC
  {
    const names = ['dgemm', 'DGEMV', 'saxpby', 'lsame', 'dgesv', 'zheevd', 'dlamch', 'pdgesv', 'pdgemm', 'blacs_get',
      'descinit', 'MPI_Allreduce', 'omp_get_max_threads', 'acc_init', 'co_sum', 'sqrt', 'MPI_Comm', 'omp_lock_kind',
      'omp_sched_static', 'foo_lib', 'constructor'];
    eq(names.map((n) => classifyLibrary(n)), ['blas', 'blas', 'blas', 'blas', 'lapack', 'lapack', 'lapack', 'scalapack',
      'scalapack', 'scalapack', 'scalapack', 'mpi', 'openmp', 'openacc', null, null, null, null, null, null, null],
    'routines by library (PBLAS, BLACS and the tools are ScaLAPACK); intrinsics, types, kinds and constants have none');
    const asLapack = () => ({ lib: 'lapack', library: 'lapack', section: 'entries', name: 'x', entry: {} });
    eq([classifyLibrary('dgemm', { find: asLapack }),
      classifyLibrary('dfoo', { find: () => ({ ...asLapack(), library: 'blas' }) })],
      ['blas', 'blas'], 'BLAS before LAPACK: a BLAS name, and the registry\'s BLAS mark');
    let asked = 0;
    const broken = libraryLookup(() => {
      asked++;
      throw new Error('ENOENT: registry/lapack.json');
    });
    eq([...names.slice(0, 5), 'MPI_Allreduce'].map((n) => classifyLibrary(n, { find: broken })),
      ['blas', 'blas', 'blas', 'blas', null, null], 'a registry that cannot be read: BLAS by name, as without it');
    eq(asked, 1, 'and it is asked once');
  }

  // ---- what a use statement names in a module outside the project
  {
    const ir = src([
      'module par',
      '  use mpi_f08, only: allreduce => MPI_Allreduce',
      '  use cudafor, only: cudaMemcpy',
      '  use, intrinsic :: iso_c_binding, only: c_f_pointer',
      '  use netcdf, only: nf90_open, nf90_close',
      '  use ions_base, only: tau',
      'contains',
      '  subroutine go(p)',
      '    integer :: st, p',
      '    real :: x',
      '    call allreduce(p)',
      '    call cudaMemcpy(p)',
      '    call c_f_pointer(p)',
      '    call nf90_close(p)',
      '    st = nf90_open(p)',
      '    x = tau(1, p)',
      '  end subroutine',
      'end module par',
    ]);
    eq(classed(read(buildGraphs(ir).calls(find(ir, 'go')))),
      ['go fdfProcedure fdfFocus', 'MPI_Allreduce fdfMpi', 'cudaMemcpy fdfCuda', 'nf90_close fdfExternal'],
      'a library routine by its own name and its module\'s family; intrinsic module procedures dropped');
    const known = buildGraphs(ir, { classify: (n) => (n.startsWith('nf90_') ? 'external' : null) });
    eq(read(known.calls(find(ir, 'go'))).labels.includes('nf90_open'), true,
      'a reference named in an only list (an array as often as a function) is drawn only when classify() knows it');
  }

  // ---- caps: breadth first, and one "… N more" node
  {
    const lines = ['module wide', 'contains', '  subroutine hub()', '    call near1()'];
    for (let i = 1; i <= 30; i++) lines.push(`    call ext${String(i).padStart(2, '0')}()`);
    lines.push('  end subroutine', '  subroutine near1()');
    for (let i = 1; i <= 20; i++) lines.push(`    call deep${String(i).padStart(2, '0')}()`);
    lines.push('  end subroutine', 'end module wide');
    const ir = src(lines);
    const s = buildGraphs(ir, { maxNodes: 10 }).calls(find(ir, 'hub'));
    const r = read(s);
    eq(r.labels, ['hub', 'near1', 'ext01', 'ext02', 'ext03', 'ext04', 'ext05', 'ext06', 'ext07', '… 43 more'],
      'maxNodes nodes, the nearest first, then … N more for the rest');
    eq([r.node('… 43 more').classes, r.node('… 43 more').shape], [['fdfExternal'], '('],
      'the … more node is an external one');
    ok(r.edges.includes('hub --> … 43 more') && r.edges.includes('near1 --> … 43 more'),
      'what led to the dropped nodes leads to … more');
    eq(problems(s), [], 'a capped graph is well formed');
    eq(read(buildGraphs(ir).calls(find(ir, 'hub'))).nodes.length, 40, 'by default at most 40 nodes');
    eq(read(buildGraphs(ir).calls(find(ir, 'near1'))).nodes.length, 22, 'under the cap, no … more node');
    eq(read(buildGraphs(ir, { depth: 1 }).calls(find(ir, 'hub'))).labels.filter((l) => l.startsWith('deep')), [],
      'depth 1: direct callees only');
  }

  // ---- caps: the routines from outside the project go first, however many callers they have, the farthest first,
  // and then the farthest of the rest; "… N more" counts all of them
  {
    const ir = src([
      'module capm',
      'contains',
      '  subroutine hub()',
      '    real :: x',
      '    call ext1()',
      '    call ext2()',
      '    call ext3()',
      '    call mid()',
      '    call shared()',
      "    x = dlamch('e')",
      '  end subroutine',
      '  subroutine mid()',
      '    call deep1()',
      '    call deep2()',
      '    call shared()',
      '    call ext4()',
      '  end subroutine',
      '  subroutine deep1()',
      '  end subroutine',
      '  subroutine deep2()',
      '  end subroutine',
      'end module capm',
    ]);
    const capped = (maxNodes) => buildGraphs(ir, { maxNodes, classify: classifyLibrary }).calls(find(ir, 'hub'));
    eq(read(capped(Infinity)).labels, ['hub', 'ext1', 'ext2', 'ext3', 'mid', 'shared', 'dlamch', 'deep1', 'deep2',
      'ext4'], 'uncapped: ten nodes, breadth first');
    const r8 = read(capped(8));
    eq(r8.labels, ['hub', 'ext1', 'ext2', 'ext3', 'mid', 'deep1', 'deep2', '… 3 more'],
      'over the cap, the farthest outside routines go (ext4, dlamch, and shared with its two callers), no project one');
    eq(sorted(r8.edges), sorted(['hub --> ext1', 'hub --> ext2', 'hub --> ext3', 'hub --> mid', 'mid --> deep1',
      'mid --> deep2', 'hub --> … 3 more', 'mid --> … 3 more']),
    'and what led to them leads to … 3 more');
    eq(read(capped(4)).labels, ['hub', 'mid', 'deep1', '… 7 more'],
      'with too few outside routines, all of them go, then the farthest of the project\'s own');
    eq([problems(capped(8)), problems(capped(4))], [[], []], 'both are well formed');
  }

  // ---- escaping: operators and assignment in labels, and every character Mermaid reads as markup
  {
    const ir = src([
      'module ops',
      '  interface operator(<)',
      '    module procedure less',
      '  end interface',
      '  interface operator(>=)',
      '    module procedure at_least',
      '  end interface',
      '  interface assignment(=)',
      '    module procedure assign',
      '  end interface',
      'contains',
      '  logical function less(a, b)',
      '    integer, intent(in) :: a, b',
      '    less = a < b',
      '  end function',
      '  logical function at_least(a, b)',
      '    integer, intent(in) :: a, b',
      '    at_least = a >= b',
      '  end function',
      '  subroutine assign(a, b)',
      '    integer, intent(out) :: a',
      '    real, intent(in) :: b',
      '    a = int(b)',
      '  end subroutine',
      'end module ops',
    ]);
    const g = buildGraphs(ir);
    const lt = g.calls(find(ir, 'operator(<)'));
    ok(lt.includes('n1{{"operator(#lt;)"}}') && read(lt).edges[0] === 'operator(<) -.-> less',
      'operator(<) is escaped');
    ok(g.calls(find(ir, 'operator(>=)')).includes('{{"operator(#gt;=)"}}'), 'operator(>=) is escaped');
    ok(g.calls(find(ir, 'assignment(=)')).includes('n1{{"assignment(=)"}}'), 'assignment(=) needs no escape');
    eq(mermaidLabel('a"b<c>d&e#f'), '"a#quot;b#lt;c#gt;d#amp;e#35;f"',
      'quotes, angle brackets, ampersands and hashes as entity codes');
    const quoted = buildGraphs(ir, { url: () => '/a"b' }).calls(find(ir, 'operator(<)'));
    ok(quoted.includes('click n1 href "/a%22b"'), 'a quote in a URL is percent-encoded');
    for (const s of [lt, quoted]) eq(problems(s), [], 'an escaped graph is well formed');
  }

  // ---- inheritance, both ways, across a renaming use
  {
    const ir = src([
      'module zoo',
      '  type, abstract :: animal',
      '  end type',
      '  type, extends(animal) :: mammal',
      '  end type',
      '  type, extends(mammal) :: dog',
      '  end type',
      '  type, extends(mammal) :: cat',
      '  end type',
      '  type, extends(dog) :: puppy',
      '  end type',
      '  type :: rock',
      '  end type',
      'end module zoo',
      'module farm',
      '  use zoo, only: beast => mammal',
      '  type, extends(beast) :: cow',
      '  end type',
      '  type, extends(lib_base) :: alien',
      '  end type',
      'end module farm',
    ]);
    const g = buildGraphs(ir, { url });
    const s = g.inheritance(find(ir, 'mammal'));
    ok(s.startsWith('flowchart BT\n'), 'inheritance is drawn bottom to top');
    const m = read(s);
    eq(sorted(m.edges), ['cat --> mammal', 'cow --> mammal', 'dog --> mammal', 'mammal --> animal', 'puppy --> dog'],
      'the parent up to the root, and every type that extends it, directly, indirectly, or under another name');
    eq([m.node('mammal').classes, m.node('animal').classes, m.node('dog').classes],
      [['fdfType', 'fdfFocus'], ['fdfType', 'fdfAbstract'], ['fdfType']],
      'an abstract type is fdfAbstract as well as fdfType');
    eq(read(g.inheritance(find(ir, 'puppy'))).edges, ['puppy --> dog', 'dog --> mammal', 'mammal --> animal'],
      'up the chain to the root');
    eq(read(g.inheritance(find(ir, 'alien'))).nodes.map((n) => `${n.label} ${n.classes[0]} ${n.url}`),
      ['alien fdfType /api#alien', 'lib_base fdfExternal null'], 'a parent outside the project');
    eq(g.inheritance(find(ir, 'rock')), null, 'a type with no parent and no extensions: null');
    const noDog = buildGraphs(ir, { shown: (e) => e.name !== 'dog' });
    eq(read(noDog.inheritance(find(ir, 'mammal'))).labels.includes('puppy'), false,
      'a hidden type hides what extends it');
    eq(read(noDog.inheritance(find(ir, 'puppy')) ?? '').edges, ['puppy --> dog', 'dog --> mammal', 'mammal --> animal'],
      'but a hidden parent is drawn, and the chain above it: the type\'s page names it (stdlib\'s hashmap_type)');
  }

  // ---- dependencies: uses, users, submodules; and the overview
  {
    const ir = src([
      'module core',
      '  use iso_c_binding',
      '  use mpi_f08',
      '  use netcdf',
      'contains',
      '  subroutine work()',
      '    use omp_lib',
      '  end subroutine',
      'end module core',
      'submodule (core) core_a',
      'end submodule core_a',
      'submodule (core:core_a) core_b',
      'end submodule core_b',
      'module mid',
      '  use core',
      'end module mid',
      'module comm',
      '  use mpi',
      'end module comm',
      'program app',
      '  use mid',
      'end program app',
    ]);
    const g = buildGraphs(ir, { url });
    const d = read(g.dependencies(find(ir, 'core')));
    eq(d.edges, ['core_a -. "submodule of" .-> core', 'core_b -. "submodule of" .-> core_a', 'core --> iso_c_binding',
      'core --> mpi_f08', 'core --> netcdf', 'core --> omp_lib', 'mid --> core'],
    'submodules, the uses of the module and of its procedures, and its users');
    eq(d.nodes.map((n) => `${n.label} ${n.shape} ${n.classes.join(' ')}`), [
      'core [ fdfModule fdfFocus', 'core_a [[ fdfSubmodule', 'iso_c_binding ( fdfIntrinsic', 'mpi_f08 ( fdfMpi',
      'netcdf ( fdfExternal', 'omp_lib ( fdfOmp', 'mid [ fdfModule', 'core_b [[ fdfSubmodule',
    ], 'shapes and classes of units and of outside modules, numbered breadth first (core_b is two steps away)');
    eq(read(g.dependencies(find(ir, 'core_b'))).edges,
      ['core_b -. "submodule of" .-> core_a', 'core_a -. "submodule of" .-> core'],
      'a submodule\'s parents up to its module');
    const app = read(g.dependencies(find(ir, 'app')));
    eq([app.edges, app.node('app').shape], [['app --> mid', 'mid --> core'], '(['],
      'uses followed through project modules to depth 2');
    eq(read(buildGraphs(ir, { depth: 3 }).dependencies(find(ir, 'app'))).labels.length, 7, 'and further with depth 3');
    const o = g.overview();
    const v = read(o);
    eq(v.nodes.map((n) => `${n.label} ${n.classes[0]}`), ['comm fdfModule', 'core fdfModule', 'mid fdfModule',
      'core_a fdfSubmodule', 'core_b fdfSubmodule', 'app fdfProgram', 'mpi, mpi_f08 fdfMpi', 'omp_lib fdfOmp'],
    'the overview: modules, submodules and programs, one node per HPC library, no intrinsic or other modules');
    eq(sorted(v.edges), ['app --> mid', 'comm --> mpi, mpi_f08', 'core --> mpi, mpi_f08', 'core --> omp_lib',
      'core_a -. "submodule of" .-> core', 'core_b -. "submodule of" .-> core_a', 'mid --> core'],
    'use and submodule edges in the overview');
    ok(!o.includes('fdfFocus'), 'the overview has no subject');
    eq(buildGraphs(ir, { maxNodes: 5 }).overview(), null, 'an overview of more units than maxNodes: null');
  }

  // ---- the access filter, and null results
  {
    const ir = src([
      'module lone',
      '  private',
      '  public :: api, quiet',
      '  type :: alone_t',
      '  end type',
      'contains',
      '  subroutine api()',
      '    call helper()',
      '  end subroutine',
      '  subroutine helper()',
      '  end subroutine',
      '  subroutine quiet(x)',
      '    real :: x',
      '    x = sqrt(abs(x))',
      '    call random_number(x)',
      '  end subroutine',
      'end module lone',
    ]);
    const g = buildGraphs(ir);
    eq(read(g.calls(find(ir, 'api'))).edges, ['api --> helper'], 'every entity by default');
    eq(buildGraphs(ir, { shown: (e) => e.access !== 'private' }).calls(find(ir, 'api')), null,
      'a hidden callee is not drawn');
    eq(g.dependencies(find(ir, 'lone')), null, 'a module that uses nothing and that nothing uses: null');
    eq(g.calls(find(ir, 'quiet')), null, 'a procedure that calls only intrinsics: null');
    eq(g.inheritance(find(ir, 'alone_t')), null, 'a type alone: null');
    eq([g.calls(find(ir, 'lone')), g.inheritance(find(ir, 'api')), g.calls('no/such:id')], [null, null, null],
      'the wrong kind of entity, or none: null');
    eq(g.overview(), null, 'an overview without edges: null');
  }

  // ---- the access filter and what a shown generic or binding reaches: the page names it, however private
  {
    const ir = src([
      'module facade',
      '  implicit none',
      '  private',
      '  public :: solve, engine_t, run',
      '  interface solve',
      '    module procedure solve_r',
      '  end interface',
      '  type :: engine_t',
      '  contains',
      '    procedure, public :: start => engine_start',
      '    procedure, private :: halt => engine_halt',
      '    generic, public :: go => start',
      '  end type',
      'contains',
      '  subroutine solve_r(x)',
      '    real :: x',
      '    call helper()',
      '  end subroutine',
      '  subroutine helper()',
      '  end subroutine',
      '  subroutine engine_start(e)',
      '    class(engine_t), intent(inout) :: e',
      '  end subroutine',
      '  subroutine engine_halt(e)',
      '    class(engine_t), intent(inout) :: e',
      '  end subroutine',
      '  subroutine run(e, x)',
      '    class(engine_t), intent(inout) :: e',
      '    real :: x',
      '    call solve(x)',
      '    call e%start()',
      '    call e%halt()',
      '    call e%go()',
      '    call helper()',
      '  end subroutine',
      'end module facade',
    ]);
    const g = buildGraphs(ir, { shown: (e) => e.access !== 'private' });
    eq(read(g.calls(find(ir, 'run'))).edges,
      ['run --> solve', 'run --> engine_start', 'run --> go', 'solve -.-> solve_r', 'go -.-> engine_start'],
      'a public generic\'s private specific, and a public binding\'s private implementation, are drawn; a private '
      + 'binding and a private helper called by name are not');
    eq(read(g.calls(find(ir, 'solve', 'interface'))).edges, ['solve -.-> solve_r', 'run --> solve'],
      'a public generic with only private specifics still has its graph');
  }

  // ---- every graph of examples/modern, and of the fixtures, is well formed
  {
    const root = path.resolve(here, '..');
    const ir = await extract({ root, sources: ['examples/modern/src'], cpp: { macros: { _OPENMP: 1, USE_MPI: 1 } } });
    const g = buildGraphs(ir, { url: (e) => `/docs/m#${e.name.toLowerCase()}` });
    const graphs = [];
    for (const e of Object.values(ir.entities)) {
      for (const m of ['dependencies', 'inheritance', 'calls']) {
        const s = g[m](e);
        if (s) graphs.push([`${m}(${e.id})`, s]);
      }
    }
    graphs.push(['overview()', g.overview()]);
    eq(graphs.flatMap(([what, s]) => problems(s).map((p) => `${what}: ${p}`)), [],
      'every graph of examples/modern is well formed');
    eq(graphs.length, 24, '24 graphs for examples/modern');
    const one = (what) => read(graphs.find(([w]) => w === what)?.[1] ?? '');
    eq(one('calls(module:solver_kernels/procedure:norm2_parallel)').edges,
      ['norm2_parallel -- "USE_MPI" --> MPI_Allreduce'], 'MPI under its guard');
    eq(classed(one('calls(module:solver_kernels/procedure:dense_matvec)')),
      ['dense_matvec fdfProcedure fdfFocus', 'check_length fdfProcedure', 'dgemv fdfBlas'],
      'a module procedure, and BLAS; dot_product is intrinsic');
    eq(one('calls(module:solver_kernels/procedure:rank_sum)').node('co_sum').classes, ['fdfCoarray'],
      'a coarray collective');
    eq(one('calls(module:solver_kernels/interface:solve_dense)').edges, ['solve_dense -.-> solve_dense_real',
      'solve_dense -.-> solve_dense_complex', 'solve_dense_real --> check_length', 'solve_dense_real --> dgesv',
      'solve_dense_complex --> zgesv', 'demo --> solve_dense'],
    'the generic, its specifics in the submodule, what they call, and the program that calls it');
    eq(one('calls(module:solver_kernels/procedure:check_length)').edges, ['dense_matvec --> check_length',
      'banded_matvec --> check_length', 'solve_dense_real --> check_length'],
    'a private helper\'s callers, one of them in the submodule, which sees it by host association');
    eq(one('dependencies(module:solver_kernels)').edges, ['solver_kernels_lapack -. "submodule of" .-> solver_kernels',
      'solver_kernels --> iso_fortran_env', 'solver_kernels --> iso_c_binding',
      'solver_kernels -- "_OPENMP" --> omp_lib', 'solver_kernels -- "USE_MPI" --> mpi_f08', 'demo --> solver_kernels'],
    'the dependencies of solver_kernels');
    eq(sorted(one('inheritance(module:solver_kernels/type:abstract_matrix)').edges),
      ['banded_matrix --> abstract_matrix', 'dense_matrix --> abstract_matrix'], 'the matrix types');
    eq(one('overview()').labels,
      ['eigen_wrappers', 'solver_kernels', 'solver_kernels_lapack', 'demo', 'mpi_f08', 'omp_lib'],
      'the overview of examples/modern');
    // the page's own filter: public and protected, a separate module procedure with its interface body's access
    const bodyOf = (e) => Object.values(ir.entities)
      .find((b) => b.scope === 'interface' && b.separate && b.name.toLowerCase() === e.name.toLowerCase());
    const pageShown = (e) => (e.access ?? (e.scope === 'separate' ? bodyOf(e)?.access : undefined)) !== 'private';
    const solve = Object.values(ir.entities).find((e) => e.kind === 'interface' && e.name === 'solve_dense');
    eq(read(buildGraphs(ir, { shown: pageShown }).calls(solve) ?? '').edges,
      one(`calls(${solve.id})`).edges.filter((x) => !x.endsWith('check_length')),
      'under the page\'s access filter, the public generic solve_dense keeps its private specifics, not a private callee');

    const fixtures = extractFiles(
      ['fixtures/modern/modern_ford.F90', 'fixtures/modern/modern_doxygen.f90', 'fixtures/nasty/nasty.F90'],
      { root: here, cpp: { keepAllBranches: true } },
    );
    const f = buildGraphs(fixtures, { url: (e) => `/f#${e.id}`, maxNodes: 6, depth: 3 });
    const bad = [];
    let n = 0;
    for (const e of Object.values(fixtures.entities)) {
      for (const m of ['dependencies', 'inheritance', 'calls']) {
        const s = f[m](e);
        if (!s) continue;
        n++;
        for (const p of problems(s)) bad.push(`${m}(${e.id}): ${p}`);
      }
    }
    const ov = f.overview();
    if (ov) for (const p of problems(ov)) bad.push(`overview: ${p}`);
    eq(bad, [], 'every graph of the fixtures is well formed, capped at 6 nodes');
    ok(n > 20, 'the fixtures have graphs');
  }
}
