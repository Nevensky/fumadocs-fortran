// The page model: pages, sidebar, anchors, links, components and their props, for examples/modern.
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { pathToFileURL } from 'node:url';
import { extract, buildPages, writePages, anchorOf, parseSource, generate } from '../src/index.js';
import { libraryOf, load } from '../registry/read.mjs';
import * as library from '../src/emit/library.js';

const FORTRAN_ENV = 'https://gcc.gnu.org/onlinedocs/gfortran/ISO_005fFORTRAN_005fENV.html';
const C_BINDING = 'https://gcc.gnu.org/onlinedocs/gfortran/ISO_005fC_005fBINDING.html';

// the refs of the FortranArg named `name` on a page (the tag is on one line; the object is JSON)
const refsOf = (mdx, name) => {
  const line = mdx.split('\n').find((l) => l.startsWith(`<FortranArg name="${name}" `));
  const m = /\srefs=\{(.*)\}(?: \/)?>$/.exec(line ?? '');
  return m ? JSON.parse(m[1]) : null;
};
// the front matter's lines, and the `fortran.toc` it holds
const frontOf = (mdx) => mdx.slice(4, mdx.indexOf('\n---\n', 4)).split('\n');
const tocOf = (mdx) => Object.fromEntries(frontOf(mdx).map((l) => /^ {4}("[^"]*"): ("[^"]*")$/.exec(l)).filter(Boolean)
  .map((m) => [JSON.parse(m[1]), JSON.parse(m[2])]));
// every line a YAML mapping of double-quoted scalars, as the generator writes it
const FRONT_LINE = new RegExp(`^(?:${[
  '(?:title|description): "(?:[^"\\\\]|\\\\.)*"', 'fortran:', ' {2}kind: "[a-z]+"', ' {2}toc:(?: \\{\\})?', ' {4}"[\\w-]+": "[a-z]+"',
].join('|')})$`);
const headingsOf = (mdx) => [...mdx.matchAll(/^### .* \[#([\w-]+)\]$/gm)].map((m) => m[1]);
// the class of the node labelled `label` in the first ```mermaid block of `mdx` that draws it (fdfFocus aside)
const classOf = (mdx, label) => {
  for (const m of mdx.matchAll(/```mermaid\n([\s\S]*?)\n```/g)) {
    const id = [...m[1].matchAll(/^ {2}(n\d+)[[({]+"([^"]*)"/gm)].find((x) => x[2] === label)?.[1];
    if (!id) continue;
    return [...m[1].matchAll(new RegExp(`^ {2}class ${id} (fdf\\w+)$`, 'gm'))].map((x) => x[1])
      .find((c) => c !== 'fdfFocus' && c !== 'fdfAbstract');
  }
  return undefined;
};
// links to /docs/m pages, Markdown ones, those of hover cards and those of graph nodes, whose page or heading does
// not exist
const LINK = new RegExp(['\\]\\((/docs/m/[\\w-]+)(?:#([\\w-]+))?\\)', '"href":"(/docs/m/[\\w-]+)(?:#([\\w-]+))?"',
  'click n\\d+ href "(/docs/m/[\\w-]+)(?:#([\\w-]+))?"'].join('|'), 'g');
const dangling = (pages) => {
  const anchors = new Map(pages.map((p) => [p.url, new Set([...p.mdx.matchAll(/\[#([\w-]+)\]/g)].map((m) => m[1]))]));
  const out = [];
  for (const p of pages) {
    for (const m of p.mdx.matchAll(LINK)) {
      const [url, id] = m[1] ? [m[1], m[2]] : m[3] ? [m[3], m[4]] : [m[5], m[6]];
      if (!anchors.has(url) || (id && !anchors.get(url).has(id))) out.push(`${p.path} -> ${url}#${id}`);
    }
  }
  return out;
};

export default async function ({ ok, eq, here, out }) {
  const root = path.resolve(here, '..');
  const ir = await extract({ root, sources: ['examples/modern/src'], cpp: { macros: { _OPENMP: 1, USE_MPI: 1 } } });
  const readSource = (file) => fs.readFileSync(path.join(root, file), 'utf8');
  const repo = { url: 'https://github.com/o/r', rev: 'v1' };
  const { pages, metas } = buildPages(ir, { baseUrl: '/docs/m', display: ['public', 'protected', 'private'], repo });
  const page = (p) => pages.find((x) => x.path === p)?.mdx ?? '';
  eq(pages.map((p) => p.path), ['index.mdx', 'eigen_wrappers.mdx', 'solver_kernels.mdx', 'solver_kernels_lapack.mdx', 'demo.mdx', 'gtsv.mdx'], 'one page per unit, and LAPACK-style routines by \\ingroup');
  eq(metas[0].data.pages, ['index', '---Modules---', 'eigen_wrappers', 'solver_kernels', '---Submodules---', 'solver_kernels_lapack', '---Programs---', 'demo', '---Procedures---', 'gtsv'], 'meta.json with separators');
  const sk = page('solver_kernels.mdx');
  ok(sk.startsWith('---\ntitle: "solver_kernels"\ndescription: '), 'front matter');
  ok(/\n## Types\n[\s\S]*\n## Interfaces\n[\s\S]*\n## Procedures\n[\s\S]*\n## Variables\n[\s\S]*\n## Enumerations\n/.test(sk), 'sections in order');
  ok(!/^#### /m.test(sk), 'no sub-headings inside entity sections (fumadocs <include> embeds exactly one entity)');
  for (const id of ['dense_matrix', 'operator-plus', 'assignment', 'solve_dense', 'matvec_iface', 'matrix_free', 'norm2_parallel', 'max_order', 'enum-1']) ok(sk.includes(`[#${id}]`), `anchor #${id}`);
  ok(sk.includes('Start with [`dense_matrix`](/docs/m/solver_kernels#dense_matrix)'), '[[links]] resolve to anchors');
  ok(!/^---[\s\S]*?---[\s\S]*Dense and banded linear-algebra kernels[\s\S]*Dense and banded/.test(sk), 'the summary is not repeated under the description');
  ok(sk.includes('<FortranArg name="comm" type="type(MPI_Comm)" intent="in" cond="USE_MPI"'
    + ' decl="type(MPI_Comm), intent(in) :: comm" refs={'), 'a conditional argument');
  ok(sk.includes('<FortranBadge kind="mpi" label="MPI" conditional="USE_MPI" />'), 'MPI badge, conditional');
  ok(sk.includes('<FortranBadge kind="omp" label="OpenMP parallel region" title="parallel do" />'), 'OpenMP region badge');
  ok(sk.includes('<FortranArg name="total" type="real(dp)" codims="[*]" intent="out"'
    + ' decl="real(dp), intent(out) :: total[*]" refs={'), 'a coarray argument');
  const n2 = ir.entities['module:solver_kernels/procedure:norm2_parallel'];
  ok(sk.includes(`href="https://github.com/o/r/blob/v1/examples/modern/src/modern_ford.F90#L${n2.line}-L${n2.lineEnd}"`), 'source links with lines');
  ok(sk.includes('$$\nP A = L U, \\qquad x = U^{-1} L^{-1} P b.\n$$') && sk.includes('$A x = b$'), 'maths on the page');
  ok(page('solver_kernels_lapack.mdx').includes('Implements `solve_dense_complex`, declared in the interface [`solve_dense`](/docs/m/solver_kernels#solve_dense) of [`solver_kernels`](/docs/m/solver_kernels).'), 'a separate module procedure links its interface');
  ok(page('solver_kernels_lapack.mdx').includes('<FortranArg name="a" type="complex(dp)" dims="(:,:)" intent="inout"'
    + ' decl="complex(dp), intent(inout) :: a(:,:)" refs={'), 'and takes its arguments from it');
  // the intent Doxygen states shows in the row; the declaration stays as the code has it
  ok(page('gtsv.mdx').includes('<FortranArg name="D" type="DOUBLE PRECISION" dims="(*)" intent="inout"'
    + ' decl="DOUBLE PRECISION :: D(*)">'), 'F77 intents from \\param[in,out]');
  eq(anchorOf({ name: 'operator(.cross.)', kind: 'interface', id: 'x' }), 'operator-cross', 'operator slugs');
  ok(sk.includes('pure integer function matrix_order(self) result(n)'), 'a function signature keeps the type written before `function`');
  ok(sk.includes('### RED, GREEN [#enum-1]'), 'an unnamed enum is titled by its enumerators');
  const dense = sk.slice(sk.indexOf('[#dense_matrix]'), sk.indexOf('[#banded_matrix]'));
  const inh = dense.slice(dense.indexOf('<FortranArgs title="Inherited from abstract_matrix" columns="type attrs">'));
  ok(inh.includes('name="n"') && inh.includes('name="order"') && !inh.includes('name="matvec"'), 'inherited members, without the bindings a type overrides');
  ok(inh.includes('<FortranArg name="write_matrix" type="procedure" attrs="private"'
    + ' decl="procedure, private :: write_matrix" />'), 'an inherited private binding says so');
  ok(page('solver_kernels_lapack.mdx').includes('<FortranBadge kind="private" />'), 'a separate module procedure takes the access of its interface body');

  // ---- tables: the columns some row fills, each row's declaration, result rows
  ok(sk.includes('<FortranArgs title="Components" columns="type shape attrs">\n'
    + '<FortranArg name="rgb" type="integer" dims="(3)" attrs="= 0" decl="integer :: rgb(3) = 0">'),
  'columns name only what the rows fill, and a component is declared with its initial value');
  ok(sk.includes('<FortranArg name="info" type="integer" intent="out" optional'
    + ' decl="integer, intent(out), optional :: info">'), 'decl: intent, then optional');
  ok(sk.includes('<FortranArg name="n" type="integer(c_int)" intent="in" value'
    + ' decl="integer(c_int), intent(in), value :: n" refs={'), 'decl: value');
  ok(sk.includes('<FortranArg name="k" type="integer, kind" attrs="default dp" decl="integer, kind :: k = dp">')
    && sk.includes('<FortranArg name="kl" type="integer, len" attrs="default 1" decl="integer, len :: kl = 1">'),
  'a type parameter\'s row reads as its declaration: the type "integer, kind" and one pill, "default dp"');
  {
    const pdt = buildPages(parseSource([
      'module pdt',
      '  use, intrinsic :: iso_fortran_env, only: int64',
      '  type :: box(k, n, m)',
      '    integer, kind :: k = 4',
      '    integer(int64), len :: n',
      '    integer, len :: m = 2',
      '    real(k) :: v(n, m)',
      '  end type',
      'end module pdt',
    ].join('\n'), { root: out, path: 'pdt.f90' })).pages.find((x) => x.path === 'pdt.mdx').mdx;
    const rows = pdt.split('\n').filter((l) => /^<FortranArg name="[knm]" /.test(l))
      .map((l) => l.replace(/ refs=\{.*\}/, ' refs'));
    eq(rows, [
      '<FortranArg name="k" type="integer, kind" attrs="default 4" decl="integer, kind :: k = 4" />',
      '<FortranArg name="n" type="integer(int64), len" decl="integer(int64), len :: n" refs />',
      '<FortranArg name="m" type="integer, len" attrs="default 2" decl="integer, len :: m = 2" />',
    ], 'a kind or len parameter: no pill without a default, and the kind of its type still has its card');
    eq(Object.keys(refsOf(pdt, 'n') ?? {}), ['int64'], 'the card of int64 in integer(int64), len');
    // the components give the word kind or len of each such type its card and the opened row its Type parameter line
    // (where React can be imported: it is not a dependency)
    let react = null;
    try {
      react = [await import('react'), await import('react-dom/server'), await import('../react/index.js')];
    } catch {
      // checked where React can be imported
    }
    if (react) {
      const [R, server, { FortranArg }] = react;
      const render = server.renderToStaticMarkup ?? server.default.renderToStaticMarkup;
      const h = R.createElement ?? R.default.createElement;
      const props = (l) => ({
        ...Object.fromEntries([...l.replace(/ refs=\{.*\}/, '').matchAll(/(\w+)="([^"]*)"/g)].map((m) => [m[1], m[2]])),
        refs: refsOf(pdt, /name="(\w+)"/.exec(l)[1]),
      });
      const html = pdt.split('\n').filter((l) => /^<FortranArg name="[knm]" /.test(l))
        .map((l) => render(h(FortranArg, props(l))));
      const word = /<span class="fdf-type-param" data-term="(\w+)">/;
      eq(html.map((x) => [(x.match(new RegExp(word.source, 'g')) ?? []).length, word.exec(x)?.[1],
        /<dt>Type parameter<\/dt><dd data-term="(\w+)">/.exec(x)?.[1]]),
      [[2, 'kind', 'kind'], [2, 'len', 'len'], [2, 'len', 'len']],
      "each generated type parameter's kind or len has its card, in the cell and the narrow copy, and its Type "
        + 'parameter line');
    }
  }
  {
    // a length after the name is written as Fortran, so that the Length line and the card of * read it
    const lens = buildPages(parseSource([
      'module lens_m',
      'contains',
      '  subroutine lens(n, a, b, d, e, g, j, k)',
      '    integer, intent(in) :: n',
      '    character :: a*(*), b*10',
      '    character(len=10) :: d*20',
      '    character :: e*(5), g*(n)',
      '    character*8 :: j*16',
      '    character*(*) :: k*4',
      '  end subroutine',
      'end module lens_m',
    ].join('\n'), { root: out, path: 'lens.f90' })).pages.find((x) => x.path === 'lens_m.mdx').mdx;
    const typeOf = (name) => new RegExp(`^<FortranArg name="${name}" type="([^"]*)"[^\\n]* decl="([^"]*)"`, 'm')
      .exec(lens)?.slice(1);
    eq(['a', 'b', 'd', 'e', 'g'].map(typeOf), [['character*(*)', 'character*(*) :: a'],
      ['character*10', 'character*10 :: b'], ['character(len=20)', 'character(len=20) :: d'],
      ['character*5', 'character*5 :: e'], ['character*(n)', 'character*(n) :: g']],
    'the type and declaration of each length after a name');
    eq(['j', 'k'].map(typeOf), [['character*16', 'character*16 :: j'], ['character*4', 'character*4 :: k']],
      'a length after the name replaces one written after the type: Fortran, not character*8*16');
    // in a selector, with its kind: the row, a component's and a result's row, and a module variable's fence
    const sel = buildPages(parseSource([
      'module sel_m',
      "  integer, parameter :: ucs4 = selected_char_kind('ISO_10646')",
      "  character(len=10) :: v*20 = 'x'",
      "  character(kind=ucs4), parameter :: w*3 = ucs4_'abc'",
      '  type :: t',
      '    character(len=4) :: c*8',
      '  end type',
      'contains',
      '  function f(e) result(r)',
      '    character(kind=ucs4), intent(in) :: e*(*)',
      '    character(len=2) :: r*5',
      '    r = "x"',
      '  end function',
      'end module sel_m',
    ].join('\n'), { root: out, path: 'sel.f90' }), { display: ['public', 'private'] }).pages
      .find((x) => x.path === 'sel_m.mdx').mdx;
    const declOf = (name) => new RegExp(`^<FortranArg name="${name}" type="([^"]*)"[^\\n]* decl="([^"]*)"`, 'm')
      .exec(sel)?.slice(1);
    eq(['e', 'r', 'c'].map(declOf), [['character(len=*, kind=ucs4)', 'character(len=*, kind=ucs4), intent(in) :: e'],
      ['character(len=5)', 'character(len=5) :: r'], ['character(len=8)', 'character(len=8) :: c']],
    'an argument, a result and a component: the length in the selector, the kind kept');
    ok(sel.includes("```f90\ncharacter(len=20) :: v = 'x'\n```")
      && sel.includes("```f90\ncharacter(len=3, kind=ucs4), parameter :: w = ucs4_'abc'\n```"),
    'a module variable\'s declaration under its heading');
    // an initial value in the old style of F77 and GNU Fortran (character*8 plain /'hi'/) is no Fortran after :: and
    // =, and needs a declaration without ::. So it is written as the source has it where the declaration has only
    // its type, and left out where an attribute needs ::
    const gnu = buildPages(parseSource([
      'module gnu_m',
      "  character*8 plain /'hi'/",
      "  character*8, sep /'x::y'/",
      "  character*4 kept /'ab'/",
      '  save kept',
      '  integer :: modern = 4',
      'end module gnu_m',
    ].join('\n'), { root: out, path: 'gnu.f90' }), { display: ['public', 'private'] }).pages
      .find((x) => x.path === 'gnu_m.mdx').mdx;
    eq([...gnu.matchAll(/^```f90\n([^\n]*)\n```$/gm)].map((m) => m[1]),
      ["character*8 plain /'hi'/", "character*8 sep /'x::y'/", 'character*4, save :: kept', 'integer :: modern = 4'],
      'an old-style initial value: in a declaration without ::, or left out where an attribute needs ::');
    let react = null;
    try {
      react = [await import('react'), await import('react-dom/server'), await import('../react/index.js')];
    } catch {
      // React is not a dependency: the rendering is checked where it can be imported
    }
    if (react) {
      const [R, server, { FortranArg }] = react;
      const render = server.renderToStaticMarkup ?? server.default.renderToStaticMarkup;
      const h = R.createElement ?? R.default.createElement;
      const html = (name) => render(h(FortranArg, { name, type: typeOf(name)[0], decl: typeOf(name)[1] }));
      // the Length line's text, or the term whose meaning style.css writes in for a * or a :
      const length = (name) => {
        const m = /<dt>Length<\/dt><dd([^>]*)>([\s\S]*?)<\/dd>/.exec(html(name));
        return m ? m[2] || /data-term="([^"]*)"/.exec(m[1])?.[1] : undefined;
      };
      const code = (s) => `<span class="fdf-arg-type"><code>${s}</code></span>`;
      eq(['a', 'b', 'd', 'e', 'g'].map(length), ['assumed-length', code('10'), code('20'), code('5'), code('n')],
        'the rendered Length line of each');
      const star = '<span class="fdf-len" data-term="assumed-length"><code>*</code>';
      eq(['a', 'b', 'g'].map((n) => html(n).includes(star)), [true, false, false],
        'the * of an assumed length has its card');
      eq(['j', 'k'].map((n) => [length(n), html(n).includes(star)]), [[code('16'), false], [code('4'), false]],
        'the entity\'s length is the one the Length line reads, and character*(*) :: k*4 has no * card');
    }
  }
  {
    // an HPC badge's title says what its label does not (screen readers read it with the label): an OpenACC routine's
    // constructs, or a lone parallel region's, are in the label already
    const hpc = buildPages(parseSource([
      'module badges_m',
      'contains',
      '  subroutine r_seq(x)',
      '    !$acc routine seq',
      '    real :: x',
      '  end subroutine',
      '  subroutine r_twice(x)',
      '    !$acc routine(r_twice) vector',
      '    !$acc routine seq',
      '    real :: x',
      '  end subroutine',
      '  subroutine r_loop(x)',
      '    !$acc routine vector',
      '    real :: x(:)',
      '    integer :: i',
      '    !$acc loop',
      '    do i = 1, size(x)',
      '      x(i) = 0',
      '    end do',
      '  end subroutine',
      '  subroutine o_par()',
      '    !$omp parallel',
      '    !$omp end parallel',
      '  end subroutine',
      '  subroutine o_do(x)',
      '    real :: x(:)',
      '    integer :: i',
      '    !$omp parallel do',
      '    do i = 1, size(x)',
      '      x(i) = 0',
      '    end do',
      '  end subroutine',
      'end module badges_m',
    ].join('\n'), { root: out, path: 'badges.f90' })).pages.find((x) => x.path === 'badges_m.mdx').mdx;
    const badgeOf = (h, kind) => hpc.slice(hpc.indexOf(`### ${h} [#`)).split('\n### ')[0].split('\n')
      .find((l) => l.startsWith(`<FortranBadge kind="${kind}"`));
    eq([badgeOf('r_seq', 'acc'), badgeOf('r_twice', 'acc'), badgeOf('r_loop', 'acc'), badgeOf('o_par', 'omp'),
      badgeOf('o_do', 'omp')], ['<FortranBadge kind="acc" label="OpenACC routine" />',
      '<FortranBadge kind="acc" label="OpenACC routine" />',
      '<FortranBadge kind="acc" label="OpenACC" title="routine; loop" />',
      '<FortranBadge kind="omp" label="OpenMP parallel region" />',
      '<FortranBadge kind="omp" label="OpenMP parallel region" title="parallel do" />'],
    'no title that repeats its label: OpenACC routine, a lone parallel region; constructs the label does not say');
  }
  const old = buildPages(parseSource('      SUBROUTINE OLD(N, A)\n      DIMENSION A(N)\n      A(1) = N\n      END\n',
    { root: out, path: 'old.f' })).pages.find((x) => x.path === 'old.mdx')?.mdx ?? '';
  ok(old.includes('<FortranArg name="A" type="real (implicit)" dims="(N)" decl="real :: A(N) ! implicitly typed" />'),
    'an implicitly typed argument is declared as Fortran, with a comment');
  // a dummy argument its procedure CALLs is a subroutine: no type, not even the implicit rules' (its attributes stay)
  const drvSrc = ['SUBROUTINE DRV(F, G, N, X)', 'EXTERNAL F', 'INTEGER N', 'CALL F(N, X)', 'CALL G', 'END', '']
    .map((l) => (l ? `      ${l}` : l)).join('\n');
  const drv = buildPages(parseSource(drvSrc, { root: out, path: 'drv.f' })).pages
    .find((x) => x.path === 'drv.mdx')?.mdx ?? '';
  ok(drv.includes('<FortranArg name="F" attrs="external" decl="external :: F" />\n<FortranArg name="G" />\n'
    + '<FortranArg name="N" type="INTEGER" decl="INTEGER :: N" />\n'
    + '<FortranArg name="X" type="real (implicit)" decl="real :: X ! implicitly typed" />'),
  'a dummy subroutine has no implicit type, in its row or its declaration');
  ok(['procedure(matvec_iface), deferred, pass(self) :: matvec', 'procedure :: order => matrix_order',
    'generic :: write(formatted) => write_matrix'].every((d) => sk.includes(`decl="${d}"`)),
  'a type-bound procedure is declared by its binding statement');
  ok(sk.includes('<FortranArgs title="Enumerators" columns="attrs">\n'
    + '<FortranArg name="RED" attrs="= 1" decl="enumerator :: RED = 1" />\n<FortranArg name="GREEN" decl="enumerator :: GREEN" />'),
  'enumerators');
  const norm2 = sk.slice(sk.indexOf('[#norm2_parallel]'), sk.indexOf('[#axpy_elem]'));
  ok(norm2.includes('<FortranArgs columns="type shape intent attrs">'), 'an argument list has no title, and its columns');
  ok(norm2.includes('<FortranArgs title="Result" columns="type intent">\n'
    + '<FortranArg name="nrm" type="real(dp)" result decl="real(dp) :: nrm" refs={'), 'a result row is marked, and fills the intent column');

  // ---- refs: kind names and derived types, as the scope of the declaration sees them
  const dp = { href: FORTRAN_ENV, title: 'dp ⇒ real64', detail: 'Real kind with a storage size of 64 bits: double precision',
    note: 'Renamed in the use statement at examples/modern/src/modern_ford.F90:21' };
  eq(refsOf(norm2, 'x'), { dp }, 'a kind renamed from iso_fortran_env');
  eq(refsOf(sk.slice(sk.indexOf('[#matrix_free]')), 'n'), { c_int: { href: C_BINDING, title: 'c_int',
    detail: 'Integer kind interoperable with C int', note: 'From the use statement at examples/modern/src/modern_ford.F90:22' } },
  'a kind from iso_c_binding, not renamed');
  eq(refsOf(sk, 'self'), { abstract_matrix: { href: '/docs/m/solver_kernels#abstract_matrix',
    title: 'type, abstract :: abstract_matrix', detail: 'An abstract matrix type.' } }, 'a derived type: its heading, its statement, its summary');
  const banded = sk.slice(sk.indexOf('[#banded_matvec]'));
  eq(Object.keys(refsOf(banded, 'self') ?? {}), ['banded_matrix', 'dp'], 'a parameterised type and the kind it is given');
  eq(refsOf(sk, 'ab'), { k: { title: 'integer, kind :: k = dp', detail: 'real kind' } }, 'a component\'s kind may be a kind parameter of its type');
  ok(!/<FortranArg name="h" [^\n]*refs=/.test(buildPages(parseSource('module o\n  use netcdf\ncontains\n'
    + '  subroutine s(h)\n    type(nc_handle) :: h\n  end subroutine\nend module\n', { root: out, path: 'o.f90' }))
    .pages[1].mdx), 'a type from a module outside the project that the registry does not know has no ref');
  eq(refsOf(page('solver_kernels_lapack.mdx'), 'b')?.dp, dp, 'a submodule sees the names its module uses');
  eq(refsOf(page('eigen_wrappers.mdx'), 'w')?.wp?.title, 'wp ⇒ real64', 'each module\'s own renames');
  {
    const src = [
      'module kinds',
      '  use, intrinsic :: iso_fortran_env, only: sp => real32',
      '  implicit none',
      '  integer, parameter :: wp = selected_real_kind(15, 307) !! the working precision',
      '  integer, parameter :: hk = 2',
      '  type :: point',
      '    !! A point in the plane.',
      '    real(kind=wp) :: x = 0',
      '  end type',
      'end module kinds',
      'module geometry',
      '  use kinds, only: wp, point, sp',
      '  use, intrinsic :: iso_fortran_env, i8 => int64',
      '  implicit none',
      '  integer, parameter, private :: hk = 4',
      'contains',
      '  subroutine move(p, dx, s, h, n, m, w, flag)',
      '    type(point), intent(inout) :: p',
      '    real(wp), intent(in) :: dx(:)',
      '    real(sp), intent(in), optional :: s',
      '    integer(hk), intent(in) :: h',
      '    integer(i8), intent(in) :: n',
      '    integer(int64), intent(in) :: m',
      '    integer(int16), intent(in) :: w',
      '    integer(ik), intent(in) :: flag',
      '  end subroutine',
      '  subroutine host(a)',
      '    use, intrinsic :: iso_c_binding, only: c_double',
      '    real(c_double), intent(in) :: a',
      '  end subroutine',
      'end module geometry',
      'program main',
      '  use, intrinsic :: iso_fortran_env',
      'contains',
      '  subroutine step(t)',
      '    real(real64), pointer :: t',
      '  end subroutine',
      'end program main',
    ].join('\n');
    const r = buildPages(parseSource(src, { root: out, path: 'refs.f90' }), { baseUrl: '/docs/m' });
    const geo = r.pages.find((x) => x.path === 'geometry.mdx').mdx;
    eq(refsOf(geo, 'dx'), { wp: { href: '/docs/m/kinds#wp', title: 'integer, parameter :: wp = selected_real_kind(15,307)',
      detail: 'the working precision' } }, 'a kind parameter of the project, used from its module');
    eq(refsOf(geo, 'p'), { point: { href: '/docs/m/kinds#point', title: 'type :: point', detail: 'A point in the plane.' } },
      'a derived type used from its module');
    eq(dangling(r.pages), [], 'hover cards link to headings that exist');
    eq(refsOf(geo, 's')?.sp, { href: FORTRAN_ENV, title: 'sp ⇒ real32', detail: 'Real kind with a storage size of 32 bits: single precision',
      note: 'Renamed in the use statement at refs.f90:2' }, 'a kind renamed in the module it is used from');
    eq(refsOf(geo, 'h'), null, 'a private kind without a heading has no ref, and does not link to a name elsewhere');
    eq(refsOf(geo, 'n')?.i8?.title, 'i8 ⇒ int64', 'a rename without only');
    eq(refsOf(geo, 'm'), null, 'a name renamed away is not visible under its own name');
    eq(refsOf(geo, 'w')?.int16?.note, 'From the use statement at refs.f90:13', 'but the other names of the module are');
    eq(refsOf(geo, 'flag'), null, 'a kind no scope gives has no ref');
    eq(refsOf(geo, 'a')?.c_double?.note, 'From the use statement at refs.f90:28', 'a procedure\'s own use statement');
    const main = r.pages.find((x) => x.path === 'main.mdx').mdx;
    eq(refsOf(main, 't')?.real64?.title, 'real64', 'an internal procedure sees the names of its host');
    eq(refsOf(r.pages.find((x) => x.path === 'kinds.mdx').mdx, 'x')?.wp?.href, '/docs/m/kinds#wp', 'kind= is a kind name too');
  }

  // ---- the HPC registry: MPI's types and OpenMP's kinds in the rows, library routines in "Calls:" lines, the
  // graphs' library classes; the project's own names win, and without a registry the pages are as they were
  {
    const reg = (name) => libraryOf(name);
    const at = (mdx, heading) => mdx.slice(mdx.indexOf(`### ${heading} [#`)).split('\n### ')[0];
    const MPI_COMM = { href: reg('MPI_Comm').link, title: 'MPI_Comm', detail: reg('MPI_Comm').entry.summary,
      note: 'From the use of mpi_f08 at examples/modern/src/modern_ford.F90:27' };
    ok(MPI_COMM.href.startsWith('https://www.mpi-forum.org/docs/mpi-5.0/') && !!MPI_COMM.detail,
      'MPI_Comm\'s page is in the MPI 5.0 standard');
    eq([refsOf(norm2, 'comm'), refsOf(dense, 'comm')], [{ MPI_Comm: MPI_COMM }, { MPI_Comm: MPI_COMM }],
      'an MPI handle type from mpi_f08, in an argument and a component: its line, its page and the module');

    // a library routine's card: its name as the code writes it, the registry's title, summary and page (`hit`, the
    // registry's entry, when the name has two meanings)
    const card = (name, title, { written = name, hit = reg(name), href = hit.link } = {}) => `<FortranRef href="${href}" `
      + `title="${title}" detail="${hit.entry.summary}">\`${written}\`</FortranRef>`;
    ok(page('solver_kernels_lapack.mdx').includes('**Calls:** [`check_length`](/docs/m/solver_kernels#check_length), '
      + `${card('dgesv', 'subroutine dgesv (LAPACK)')}\n`),
    'a LAPACK routine in a Calls line; a project procedure links');
    ok(at(sk, 'norm2_parallel').includes(`**Calls:** ${card('MPI_Allreduce', 'subroutine MPI_Allreduce (MPI)')}`
      + ' when USE_MPI'), 'an MPI routine, under its condition');
    ok(at(sk, 'dense_matvec').includes(`${card('dgemv', 'subroutine dgemv (BLAS)')}`), 'a BLAS routine is BLAS');
    ok(at(sk, 'rank_sum').includes(`**Calls:** ${card('co_sum', 'subroutine co_sum (intrinsic)')}`)
      && reg('co_sum').link.startsWith('https://fortran-lang.org/'),
    'an intrinsic subroutine, with fortran-lang\'s page');
    ok(page('demo.mdx').includes(`${card('blacs_get', 'subroutine blacs_get (BLACS)')}, `
      + `${card('descinit', 'subroutine descinit (ScaLAPACK)')}`), 'BLACS and the ScaLAPACK tools');
    ok(page('gtsv.mdx').includes(`**Calls:** ${card('xerbla', 'subroutine xerbla (BLAS)', { written: 'XERBLA' })}`),
      'a name as F77 code writes it, with the registry\'s spelling in the title');
    ok(reg('dgesv').link.startsWith('https://netlib.org/lapack/explore-html/')
      && reg('MPI_Allreduce').link.startsWith('https://docs.open-mpi.org/en/v5.0.x/'),
    'Netlib for LAPACK, Open MPI 5.0 for MPI');

    const libs = [
      'module comm_m',
      '  use mpi_f08',
      '  implicit none',
      'contains',
      '  subroutine send(c, st, req, a)',
      '    type(MPI_Comm), intent(in) :: c',
      '    type(MPI_Status), intent(out) :: st',
      '    type(mpi_request) :: req',
      '    integer(MPI_ADDRESS_KIND) :: a',
      '  end subroutine',
      'end module comm_m',
      'module renamed_m',
      '  use mpi_f08, only: comm_t => MPI_Comm, allreduce => MPI_Allreduce',
      'contains',
      '  subroutine r(c)',
      '    type(comm_t) :: c',
      '    call allreduce()',
      '  end subroutine',
      'end module renamed_m',
      'module legacy_m',
      '  use mpi',
      'contains',
      '  subroutine l(c)',
      '    type(MPI_Comm) :: c',
      '  end subroutine',
      'end module legacy_m',
      'module wrap_m',
      '  use mpi_f08',
      'end module wrap_m',
      'module via_m',
      '  use wrap_m',
      'contains',
      '  subroutine v(w)',
      '    type(MPI_Win) :: w',
      '  end subroutine',
      'end module via_m',
      'module locks_m',
      '  use omp_lib',
      'contains',
      '  subroutine lk(l, nl, i)',
      '    integer(omp_lock_kind) :: l',
      '    integer(kind=omp_nest_lock_kind) :: nl',
      '    integer(omp_integer_kind) :: i',
      '  end subroutine',
      'end module locks_m',
      'module kinds_m',
      '  use omp_lib_kinds, only: omp_sched_kind',
      'contains',
      '  subroutine sk(s)',
      '    integer(omp_sched_kind) :: s',
      '  end subroutine',
      'end module kinds_m',
      'module wins_m',
      '  use string_lib, only: split',
      '  use, intrinsic :: iso_c_binding, only: c_f_pointer, c_ptr',
      '  implicit none',
      '  private',
      '  public :: api, shadow, zgemm',
      'contains',
      '  subroutine api(p, x, obj)',
      '    type(c_ptr) :: p',
      '    real, pointer :: x(:)',
      '    class(*) :: obj',
      '    call dgemm()',
      '    call zgemm()',
      '    call dgesv()',
      '    call split("a b", x)',
      '    call c_f_pointer(p, x, [2])',
      '    call random_number(x)',
      '    call reshape(x)',
      '    call dlamch("E")',
      '    call omp_set_num_threads(4)',
      '    call acc_init(2)',
      '    call acc_is_present(x)',
      '    call pdgemr2d(1)',
      '    call pdgemm(1)',
      '    call pdgesv(1)',
      '    call obj%dgetrf()',
      '  end subroutine',
      '  subroutine dgemm()',
      '  end subroutine',
      '  subroutine zgemm()',
      '  end subroutine',
      '  subroutine shadow(xerbla)',
      '    external :: xerbla',
      '    call xerbla("shadow", 1)',
      '  end subroutine',
      'end module wins_m',
      'module intr_omp_m',
      '  use, intrinsic :: omp_lib, only: omp_lock_kind, omp_set_num_threads',
      'contains',
      '  subroutine il(l)',
      '    integer(omp_lock_kind) :: l',
      '    call omp_set_num_threads(2)',
      '  end subroutine',
      'end module intr_omp_m',
      'module intr_kinds_m',
      '  use, intrinsic :: omp_lib_kinds',
      'contains',
      '  subroutine ik(l)',
      '    integer(omp_nest_lock_kind) :: l',
      '  end subroutine',
      'end module intr_kinds_m',
      'module cbind_m',
      '  use iso_c_binding, only: c_f_pointer, c_ptr',
      'contains',
      '  subroutine cb(p, x)',
      '    type(c_ptr) :: p',
      '    real, pointer :: x(:)',
      '    call c_f_pointer(p, x, [2])',
      '  end subroutine',
      'end module cbind_m',
      'module reduce_m',
      '  use mpi_f08, reduce_all => MPI_Allreduce',
      'contains',
      '  subroutine ra()',
      '    call reduce_all()',
      '  end subroutine',
      'end module reduce_m',
      'module own_m',
      '  implicit none',
      '  private',
      '  public :: run_own',
      '  interface daxpy',
      '    module procedure my_daxpy',
      '  end interface',
      '  procedure(my_daxpy), pointer :: dscal => null()',
      'contains',
      '  subroutine run_own()',
      '    call daxpy()',
      '    call dscal()',
      '  end subroutine',
      '  subroutine my_daxpy()',
      '  end subroutine',
      'end module own_m',
    ];
    const lib = buildPages(parseSource(libs.join('\n'), { root: out, path: 'libs.f90' }), { baseUrl: '/docs/m' }).pages;
    const lp = (p) => lib.find((x) => x.path === p)?.mdx ?? '';
    const lineOf = (text) => libs.indexOf(text) + 1;
    const comm = lp('comm_m.mdx');
    eq(refsOf(comm, 'c'), { MPI_Comm: { ...MPI_COMM, note: 'From the use of mpi_f08 at libs.f90:2' } },
      'a plain use of mpi_f08 gives its types');
    eq([refsOf(comm, 'st')?.MPI_Status?.title, refsOf(comm, 'req')?.mpi_request?.title,
      refsOf(comm, 'req')?.mpi_request?.detail], ['MPI_Status', 'mpi_request', reg('MPI_Request').entry.summary],
    'MPI_Status, and a handle written in lower case');
    eq(refsOf(comm, 'a'), null, 'a kind of mpi_f08 the registry does not know has no card');
    const ren = refsOf(lp('renamed_m.mdx'), 'c')?.comm_t;
    eq([ren?.title, ren?.note], ['comm_t ⇒ MPI_Comm', 'Renamed in the use of mpi_f08 at libs.f90:13'], 'a rename');
    eq(refsOf(lp('legacy_m.mdx'), 'c'), null, 'use mpi gives no card: its handles are integers');
    eq(refsOf(lp('via_m.mdx'), 'w')?.MPI_Win?.note, 'From the use of mpi_f08 at libs.f90:28',
      'through a project module that uses mpi_f08');
    const locks = lp('locks_m.mdx');
    const lock = reg('omp_lock_kind');
    eq(refsOf(locks, 'l'), { omp_lock_kind: { href: lock.link, title: 'omp_lock_kind', detail: lock.entry.summary,
      note: 'From the use of omp_lib at libs.f90:38' } }, 'an OpenMP kind from omp_lib');
    ok(lock.link.startsWith('https://www.openmp.org/spec-html/'), 'with its section of the OpenMP specification');
    eq([refsOf(locks, 'nl')?.omp_nest_lock_kind?.title, refsOf(locks, 'i')?.omp_integer_kind?.href],
      ['omp_nest_lock_kind', undefined], 'kind= too, and a kind without a page has no link');
    eq(refsOf(lp('kinds_m.mdx'), 's')?.omp_sched_kind?.note, 'From the use of omp_lib_kinds at libs.f90:47',
      'omp_lib_kinds, which omp_lib uses');
    const stub = buildPages(parseSource('module mpi_f08\n  type :: MPI_Comm\n    !! A serial stand-in.\n'
      + '    integer :: MPI_VAL = 0\n  end type\nend module mpi_f08\nmodule user_m\n  use mpi_f08\ncontains\n'
      + '  subroutine u(c)\n    type(MPI_Comm) :: c\n  end subroutine\nend module user_m\n',
    { root: out, path: 'stub.f90' }), { baseUrl: '/docs/m' }).pages.find((x) => x.path === 'user_m.mdx').mdx;
    eq(refsOf(stub, 'c'), { MPI_Comm: { href: '/docs/m/mpi_f08#mpi_comm', title: 'type :: MPI_Comm',
      detail: 'A serial stand-in.' } }, 'a project\'s own mpi_f08 (a serial stub) wins over the registry');
    eq(lp('renamed_m.mdx').split('\n').find((l) => l.startsWith('**Calls:**')),
      `**Calls:** ${card('MPI_Allreduce', 'subroutine MPI_Allreduce (MPI)', { written: 'allreduce' })}`,
      'a routine renamed in a use statement: its own name in the title');
    const api = at(lp('wins_m.mdx'), 'api');
    eq(api.split('\n').find((l) => l.startsWith('**Calls:**')), '**Calls:** `dgemm`, [`zgemm`](/docs/m/wins_m#zgemm), '
      + `${card('dgesv', 'subroutine dgesv (LAPACK)')}, \`split\`, ${card('c_f_pointer',
        'subroutine c_f_pointer (iso_c_binding)')}, ${card('random_number', 'subroutine random_number (intrinsic)')}, `
      + `${card('reshape', 'subroutine reshape (ScaLAPACK)', { hit: libraryOf('reshape', { subroutine: true }) })}, `
      + `\`dlamch\`, ${card('omp_set_num_threads', 'subroutine omp_set_num_threads (OpenMP)')}, `
      + `${card('acc_init', 'subroutine acc_init (OpenACC)')}, \`acc_is_present\`, `
      + `${card('pdgemr2d', 'subroutine pdgemr2d (ScaLAPACK)')}, ${card('pdgemm', 'subroutine pdgemm (PBLAS)')}, `
      + `${card('pdgesv', 'subroutine pdgesv (ScaLAPACK)')}, \`obj%dgetrf\``,
    'the project\'s own routines win, shown or hidden; a module\'s split is not the intrinsic; intrinsic module '
      + 'procedures name their module; a CALL of reshape is ScaLAPACK\'s subroutine, not the intrinsic function; a CALL '
      + 'of a function\'s name (dlamch, OpenACC\'s acc_is_present) is some other subroutine; PBLAS has its own name, '
      + 'REDIST is ScaLAPACK\'s, on its Netlib file page; a type-bound call is no library routine');
    eq([reg('acc_init').entry.kind, reg('acc_is_present').entry.kind], ['subroutine', 'function'],
      'OpenACC\'s routines are subroutines and functions');
    eq([reg('pdgemr2d').entry.links.netlib, reg('pdgemr2d').link], [undefined, reg('pdgemr2d').entry.links.netlibFile],
      'a REDIST routine has only its Netlib file page');
    ok(reg('omp_set_num_threads').link.startsWith('https://www.openmp.org/spec-html/5.2/')
      && reg('acc_init').link.startsWith('https://www.openacc.org/') && reg('acc_init').link.includes('.pdf#page='),
    'OpenMP 5.2\'s specification, and the page of the OpenACC 3.4 specification');
    ok(at(lp('wins_m.mdx'), 'shadow').includes('\n**Calls:** `xerbla`\n'), 'a dummy procedure is no library routine');
    eq([classOf(api, 'dgemm'), classOf(api, 'zgemm'), classOf(api, 'dgesv'), classOf(api, 'reshape'),
      classOf(api, 'random_number')], [undefined, 'fdfProcedure', 'fdfLapack', 'fdfScalapack', undefined],
    'and in the graph the project\'s routines are the project\'s, the hidden one not drawn; a CALL of reshape is '
      + 'ScaLAPACK\'s, an intrinsic subroutine is not drawn');
    const callsIn = (mdx) => mdx.split('\n').find((l) => l.startsWith('**Calls:**'));
    eq([callsIn(lp('cbind_m.mdx')), callsIn(lp('reduce_m.mdx')), callsIn(lp('own_m.mdx'))],
      [`**Calls:** ${card('c_f_pointer', 'subroutine c_f_pointer (iso_c_binding)')}`,
        `**Calls:** ${card('MPI_Allreduce', 'subroutine MPI_Allreduce (MPI)', { written: 'reduce_all' })}`,
        '**Calls:** `daxpy`, `dscal`'],
    'c_f_pointer under a plain use of iso_c_binding; a rename without an only list; the project\'s hidden generic '
      + 'interface and procedure pointer of a BLAS routine\'s name win');
    // use, intrinsic :: omp_lib is how gfortran's OpenMP modules are named too
    const iomp = lp('intr_omp_m.mdx');
    const intrUse = '  use, intrinsic :: omp_lib, only: omp_lock_kind, omp_set_num_threads';
    eq([refsOf(iomp, 'l')?.omp_lock_kind?.note, refsOf(lp('intr_kinds_m.mdx'), 'l')?.omp_nest_lock_kind?.note,
      classOf(at(iomp, 'il'), 'omp_set_num_threads')],
    [`From the use of omp_lib at libs.f90:${lineOf(intrUse)}`,
      `From the use of omp_lib_kinds at libs.f90:${lineOf('  use, intrinsic :: omp_lib_kinds')}`, 'fdfOmp'],
    'an intrinsic use of omp_lib or omp_lib_kinds gives its kinds, and the routine its only list names is drawn');
    {
      // an explicit interface that only describes a library routine is no routine of the project's: hidden (no heading
      // to link to), the routine keeps its card, as the call graph keeps its class; shown, the call links to it
      const described = ['module ifc_m', '  implicit none', '  private', '  public :: run', '  interface',
        '    subroutine dgesv(n, info)', '      integer :: n, info', '    end subroutine', '  end interface',
        'contains', '  subroutine run()', '    call dgesv(1, i)', '  end subroutine', 'end module ifc_m', '']
        .join('\n');
      const ifc = (display) => buildPages(parseSource(described, { root: out, path: 'ifc.f90' }),
        { baseUrl: '/docs/m', display }).pages.find((x) => x.path === 'ifc_m.mdx').mdx;
      const callsOf = (mdx) => mdx.split('\n').find((l) => l.startsWith('**Calls:**'));
      eq([callsOf(ifc(undefined)), callsOf(ifc(['public', 'private'])), classOf(ifc(undefined), 'dgesv')],
        [`**Calls:** ${card('dgesv', 'subroutine dgesv (LAPACK)')}`, '**Calls:** [`dgesv`](/docs/m/ifc_m#dgesv)',
          'fdfLapack'], 'a hidden explicit interface for dgesv: the card and the graph\'s class; shown, a link');
    }
    {
      // a call through a procedure pointer the caller declares (in its specification part, a BLOCK or its host, or
      // the main program's) calls the project's target: no card and no library node. procedure(…) without POINTER is
      // the external routine, and a module's procedure pointer is the project's (it links)
      const ptr = buildPages(parseSource([
        'module ptr_m',
        '  implicit none',
        '  abstract interface',
        '    subroutine gemm_i()',
        '    end subroutine',
        '  end interface',
        '  procedure(gemm_i), pointer :: dposv => null()',
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
        '  end subroutine',
        '  subroutine p3()',
        '    external :: dgetrf',
        '    pointer :: dgetrf',
        '    call dgetrf()',
        '  end subroutine',
        '  subroutine p4()',
        '    procedure(gemm_i), pointer :: dgesv',
        '    call inner()',
        '  contains',
        '    subroutine inner()',
        '      call dgesv()',
        '    end subroutine',
        '  end subroutine',
        '  subroutine c1()',
        '    procedure(gemm_i) :: sgemm',
        '    call sgemm()',
        '  end subroutine',
        '  subroutine c2()',
        '    call dposv()',
        '  end subroutine',
        '  subroutine c3()',
        '    block',
        '      procedure(gemm_i), pointer :: cgemm',
        '      call cgemm()',
        '    end block',
        '    call cgemm()',
        '  end subroutine',
        'end module ptr_m',
        'program ptr_main',
        '  procedure(), pointer :: dpotrf => null()',
        '  call dpotrf()',
        'contains',
        '  subroutine helper()',
        '    call dpotrf()',
        '  end subroutine',
        'end program ptr_main',
      ].join('\n'), { root: out, path: 'ptr.f90' }), { baseUrl: '/docs/m' }).pages;
      const pm = ptr.find((x) => x.path === 'ptr_m.mdx').mdx;
      const pmain = ptr.find((x) => x.path === 'ptr_main.mdx').mdx;
      const callsAt = (mdx) => mdx.split('\n').find((l) => l.startsWith('**Calls:**'));
      eq(['p1', 'p2', 'p3', 'c1', 'c2', 'c3'].map((h) => callsAt(at(pm, h))), ['**Calls:** `dgemm`',
        '**Calls:** `zgemm`', '**Calls:** `dgetrf`', `**Calls:** ${card('sgemm', 'subroutine sgemm (BLAS)')}`,
        '**Calls:** [`dposv`](/docs/m/ptr_m#dposv)', `**Calls:** ${card('cgemm', 'subroutine cgemm (BLAS)')}`],
      'a local procedure pointer, a BLOCK\'s, one declared EXTERNAL and POINTER: plain code; procedure(…) alone '
        + 'keeps its card, a module\'s pointer links, and a call outside the BLOCK names the routine');
      eq([callsAt(pmain), callsAt(at(pmain, 'helper'))], ['**Calls:** `dpotrf`', '**Calls:** `dpotrf`'],
        'the main program\'s pointer, and its internal procedure\'s call of it through host association');
      eq([classOf(at(pm, 'p1'), 'dgemm'), classOf(at(pm, 'p2'), 'zgemm'), classOf(at(pm, 'p3'), 'dgetrf'),
        classOf(at(pm, 'p4'), 'dgesv'), classOf(pmain, 'dpotrf'), classOf(at(pm, 'c1'), 'sgemm'),
        classOf(at(pm, 'c3'), 'cgemm')], [undefined, undefined, undefined, undefined, undefined, 'fdfBlas', 'fdfBlas'],
      'and the graphs draw no library routine for them (p4 through its internal procedure)');
    }

    // MKL's modules link BLAS, LAPACK and ScaLAPACK to oneMKL's pages; what MKL does not document stays on Netlib
    const mkl = buildPages(parseSource('module m\n  use lapack95\ncontains\n  subroutine s()\n    call dgesv()\n'
      + '    call blacs_get()\n  end subroutine\nend module m\n', { root: out, path: 'mkl.f90' })).pages[1].mdx;
    ok(mkl.includes(card('dgesv', 'subroutine dgesv (LAPACK)', { href: reg('dgesv').entry.links.mkl }))
      && reg('dgesv').entry.links.mkl.startsWith('https://www.intel.com/')
      && mkl.includes(card('blacs_get', 'subroutine blacs_get (BLACS)')), 'MKL when the code uses lapack95');
    // each of MKL's modules, in its own build (one use of them links every card of the build to MKL), in any case
    const onMkl = (text, name, title, written = name) => buildPages(parseSource(text, { root: out, path: 'mkl.f90' }))
      .pages.find((x) => x.path === 'm.mdx').mdx
      .includes(card(name, title, { written, href: reg(name).entry.links.mkl }));
    const mklUse = (mod, call) => ['module m', `  use ${mod}`, 'contains', '  subroutine s()', `    call ${call}()`,
      '  end subroutine', 'end module m', ''].join('\n');
    const caps = ['MODULE M', '  USE LAPACK95', 'CONTAINS', '  SUBROUTINE S()', '    CALL DGESV()', '  END SUBROUTINE',
      'END MODULE M', ''].join('\n');
    eq([onMkl(mklUse('blas95', 'dgemm'), 'dgemm', 'subroutine dgemm (BLAS)'),
      onMkl(mklUse('f95_precision', 'dgesv'), 'dgesv', 'subroutine dgesv (LAPACK)'),
      onMkl(mklUse('mkl_service', 'dgesv'), 'dgesv', 'subroutine dgesv (LAPACK)'),
      onMkl(caps, 'dgesv', 'subroutine dgesv (LAPACK)', 'DGESV')],
    [true, true, true, true], 'MKL when the code uses blas95, f95_precision, an mkl_* module, or LAPACK95 in capitals');

    // the graphs' library classes: the registry's by default, a site's classify instead of it
    const sub = page('solver_kernels_lapack.mdx');
    eq([classOf(sub, 'dgesv'), classOf(at(sk, 'dense_matvec'), 'dgemv'), classOf(page('demo.mdx'), 'blacs_get'),
      classOf(page('demo.mdx'), 'descinit'), classOf(at(sk, 'norm2_parallel'), 'MPI_Allreduce')],
    ['fdfLapack', 'fdfBlas', 'fdfScalapack', 'fdfScalapack', 'fdfMpi'], 'the graphs colour LAPACK and ScaLAPACK');
    const site = buildPages(ir, { baseUrl: '/docs/m', display: ['public', 'protected', 'private'],
      graphs: { classify: (n) => (n === 'dgesv' ? 'scalapack' : null) } });
    const sp = (p) => site.pages.find((x) => x.path === p)?.mdx ?? '';
    eq([classOf(sp('solver_kernels_lapack.mdx'), 'dgesv'), classOf(sp('demo.mdx'), 'blacs_get')],
      ['fdfScalapack', 'fdfExternal'], 'graphs.classify replaces the registry\'s');

    // without the registry (a copy of src/ and registry/read.mjs, without the data): no library card, the graphs as
    // before it, and the rest of the page as it is. The copy is in a folder of its own, made with a random name, as
    // other runs of the suite may be making theirs at the same time: in Docker, each container's node has the same
    // process ID.
    const bare = fs.mkdtempSync(path.join(out, 'no-registry-'));
    let none;
    try {
      fs.cpSync(path.join(root, 'src'), path.join(bare, 'src'), { recursive: true });
      fs.mkdirSync(path.join(bare, 'registry'));
      fs.copyFileSync(path.join(root, 'registry/read.mjs'), path.join(bare, 'registry/read.mjs'));
      fs.copyFileSync(path.join(root, 'package.json'), path.join(bare, 'package.json'));
      const { buildPages: bareBuild } = await import(pathToFileURL(path.join(bare, 'src/index.js')).href);
      none = bareBuild(ir, { baseUrl: '/docs/m', display: ['public', 'protected', 'private'], repo }).pages;
    } finally {
      fs.rmSync(bare, { recursive: true, force: true });
    }
    const np = (p) => none.find((x) => x.path === p)?.mdx ?? '';
    ok(none.every((x) => !x.mdx.includes('<FortranRef')), 'no registry: no library card');
    ok(np('solver_kernels_lapack.mdx').includes('(/docs/m/solver_kernels#check_length), `dgesv`\n')
      && !/<FortranArg name="comm" [^\n]*refs=/.test(np('solver_kernels.mdx')), 'the names stay code');
    eq([classOf(np('solver_kernels_lapack.mdx'), 'dgesv'), classOf(np('demo.mdx'), 'descinit'),
      classOf(at(np('solver_kernels.mdx'), 'dense_matvec'), 'dgemv')], ['fdfExternal', 'fdfExternal', 'fdfBlas'],
    'the graphs know BLAS by name only');
    const graphless = (mdx) => mdx.replace(/```mermaid\n[\s\S]*?\n```/g, '');
    const strip = (mdx) => graphless(mdx).replace(/<FortranRef [^>]*>(`[^`]*`)<\/FortranRef>/g, '$1')
      .replace(/ refs=\{\{"MPI_Comm"[^\n]*\}\}\}/g, '');
    eq(pages.map((x) => strip(x.mdx)), none.map((x) => graphless(x.mdx)), 'everything else is the same');

    // hpc.cards: false leaves the names as code, as without the registry, and the graphs as the registry colours them
    const all3 = ['public', 'protected', 'private'];
    const off = buildPages(ir, { baseUrl: '/docs/m', display: all3, repo, hpc: { cards: false } }).pages;
    const graphsOf = (mdx) => [...mdx.matchAll(/```mermaid\n[\s\S]*?\n```/g)].map((m) => m[0]);
    eq(off.map((x) => graphless(x.mdx)), none.map((x) => graphless(x.mdx)),
      'hpc.cards: false: no card in Calls lines, on MPI_Comm or on any library name, as without the registry');
    eq(off.map((x) => graphsOf(x.mdx)), pages.map((x) => graphsOf(x.mdx)), 'and the graphs keep the registry\'s colours');
    eq(buildPages(ir, { baseUrl: '/docs/m', display: all3, repo, hpc: { cards: true } }).pages.map((x) => x.mdx),
      pages.map((x) => x.mdx), 'hpc.cards: true is the default');

    // hpc.links: the page each library's cards link to. Named, the defaults change nothing
    const named = { lapack: 'netlib', scalapack: 'netlib', mpi: 'openmpi', openmp: '5.2', openacc: 'spec',
      intrinsics: 'fortran-lang' };
    eq(buildPages(ir, { baseUrl: '/docs/m', display: all3, repo, hpc: { links: named } }).pages.map((x) => x.mdx),
      pages.map((x) => x.mdx), 'the default providers, named, change no page');
    eq(Object.keys(library.LINK_PROVIDERS ?? {}), Object.keys(named), 'and they are every library\'s');
    const libsIr = parseSource(libs.join('\n'), { root: out, path: 'libs.f90' });
    const linked = (links, file = 'wins_m.mdx', from = libsIr) => buildPages(from, { baseUrl: '/docs/m', hpc: { links } })
      .pages.find((x) => x.path === file).mdx;
    eq(linked({}), lp('wins_m.mdx'), 'no providers: the defaults');
    const hrefIn = (mdx, written) => new RegExp(`<FortranRef href="([^"]*)" title="[^"]*"(?: detail="[^"]*")?>`
      + `\`${written}\`</FortranRef>`).exec(mdx)?.[1];
    const L = (name, provider, hit = reg(name)) => hit.entry.links[provider];
    const toolsReshape = libraryOf('reshape', { subroutine: true });
    // every page asked for below exists, and is not the default's, so that each check shows its provider at work
    const wanted = [L('dgesv', 'mkl'), L('pdgesv', 'mkl'), L('pdgemm', 'mkl'), L('MPI_Allreduce', 'mpich'),
      L('MPI_Allreduce', 'standard-5.0'), L('omp_set_num_threads', 'spec-6.0'), L('omp_set_num_threads', 'spec-6.1'),
      L('omp_set_num_threads', 'libgomp'), L('omp_lock_kind', 'spec-6.0'), L('acc_init', 'libgomp'),
      L('random_number', 'gfortran'), L('c_f_pointer', 'gfortran')];
    ok(wanted.every((h) => typeof h === 'string' && h.startsWith('https://')), 'the providers\' pages are in the registry');
    const wm = linked({ lapack: 'mkl', scalapack: 'mkl' });
    eq([hrefIn(wm, 'dgesv'), hrefIn(wm, 'pdgesv'), hrefIn(wm, 'pdgemm'), hrefIn(wm, 'pdgemr2d'), hrefIn(wm, 'reshape')],
      [L('dgesv', 'mkl'), L('pdgesv', 'mkl'), L('pdgemm', 'mkl'), reg('pdgemr2d').link, toolsReshape.link],
    'lapack and scalapack mkl: oneMKL\'s pages, and Netlib\'s for what MKL lacks (REDIST\'s, the tools\')');
    const wl = linked({ lapack: 'mkl' });
    eq([hrefIn(wl, 'dgesv'), hrefIn(wl, 'pdgesv')], [L('dgesv', 'mkl'), reg('pdgesv').link], 'one library at a time');
    const mklIr = parseSource('module m\n  use lapack95\ncontains\n  subroutine s()\n    call dgesv()\n    call pdgesv()\n'
      + '  end subroutine\nend module m\n', { root: out, path: 'mkl.f90' });
    const onMkl95 = linked({ lapack: 'netlib' }, 'm.mdx', mklIr);
    eq([hrefIn(onMkl95, 'dgesv'), hrefIn(onMkl95, 'pdgesv')], [reg('dgesv').link, L('pdgesv', 'mkl')],
      'lapack netlib wins over MKL\'s modules; scalapack, left to its default, follows them');
    const mpiLinks = (links) => [hrefIn(linked(links, 'renamed_m.mdx'), 'allreduce'),
      refsOf(linked(links, 'comm_m.mdx'), 'c')?.MPI_Comm?.href];
    eq([mpiLinks({ mpi: 'mpich' }), mpiLinks({ mpi: 'standard' })],
      [[L('MPI_Allreduce', 'mpich'), reg('MPI_Comm').link], [L('MPI_Allreduce', 'standard-5.0'), reg('MPI_Comm').link]],
      'mpi mpich and standard; MPI\'s types, which MPICH has no pages for, stay with the standard');
    const ompLinks = (links) => [hrefIn(linked(links), 'omp_set_num_threads'),
      refsOf(linked(links, 'locks_m.mdx'), 'l')?.omp_lock_kind?.href];
    eq([ompLinks({ openmp: '6.0' }), ompLinks({ openmp: '6.1' }), ompLinks({ openmp: 'libgomp' })],
      [[L('omp_set_num_threads', 'spec-6.0'), L('omp_lock_kind', 'spec-6.0')],
        [L('omp_set_num_threads', 'spec-6.1'), L('omp_lock_kind', 'spec-6.1')],
        [L('omp_set_num_threads', 'libgomp'), lock.link]],
      'openmp 6.0, 6.1 and libgomp; a kind, which libgomp has no page for, keeps the specification');
    const accIntr = linked({ openacc: 'libgomp', intrinsics: 'gfortran' });
    eq([hrefIn(accIntr, 'acc_init'), hrefIn(accIntr, 'random_number'), hrefIn(accIntr, 'c_f_pointer')],
      [L('acc_init', 'libgomp'), L('random_number', 'gfortran'), L('c_f_pointer', 'gfortran')],
      'openacc libgomp, and intrinsics gfortran (an intrinsic module\'s procedure too)');
    ok(wanted.every((h, i) => !wanted.slice(0, i).includes(h)) && ![reg('dgesv'), reg('MPI_Allreduce'),
      reg('omp_set_num_threads'), reg('acc_init'), reg('random_number')].some((h) => wanted.includes(h.link)),
    'each provider\'s page differs from the default\'s');
    // the providers are the registry's: its OpenMP versions (5.2, its default, first), and the links each file has
    const omp = load('openmp');
    const ompDefault = omp.links.spec.default;
    eq(library.LINK_PROVIDERS?.openmp, [ompDefault, ...omp.versions.filter((v) => v !== ompDefault).sort(), 'libgomp'],
      'openmp: the registry\'s versions, its default first, and libgomp');
    eq([Object.keys(load('lapack').links), Object.keys(load('scalapack').links), Object.keys(load('mpi').links),
      Object.keys(load('openacc').links), Object.keys(load('intrinsics').links)],
    [['netlib', 'mkl'], ['netlib', 'mkl'], ['openmpi', 'mpich', 'standard'], ['spec', 'libgomp'],
      ['fortran-lang', 'gfortran']], 'and the providers whose links the registry builds');
    const thrown = (hpc) => {
      try {
        buildPages(libsIr, { hpc });
        return null;
      } catch (e) {
        return e.message;
      }
    };
    eq([thrown({ links: { blas: 'mkl' } }), thrown({ links: { mpi: 'intel' } }), thrown({ links: { openmp: 5.2 } }),
      thrown({ links: 'mkl' }), thrown({ cards: 'none' }), thrown({ links: { mpi: undefined }, cards: false })],
    ['hpc.links: unknown library "blas"; the libraries are lapack (BLAS and LAPACK), scalapack (with PBLAS, BLACS, its '
      + 'tools and REDIST), mpi, openmp, openacc and intrinsics', 'hpc.links: mpi takes openmpi, mpich or standard, not '
      + '"intel"', 'hpc.links: openmp takes 5.2, 6.0, 6.1 or libgomp as a string, not the number 5.2',
    'hpc.links takes an object of library → provider, such as { mpi: \'mpich\' }', 'hpc.cards takes true or false, '
      + 'not "none"', null], 'an unknown library or provider throws, saying what there is; undefined is the default');
  }

  // ---- source blocks: an entity's lines, collapsible, under it
  {
    const emb = buildPages(ir, { baseUrl: '/docs/m', display: ['public', 'protected', 'private'], repo, readSource });
    const p = (name) => emb.pages.find((x) => x.path === name)?.mdx ?? '';
    const esk = p('solver_kernels.mdx');
    const file = 'examples/modern/src/modern_ford.F90';
    const lines = readSource(file).split('\n').slice(n2.line - 1, n2.lineEnd).join('\n');
    const range = `line={${n2.line}} lineEnd={${n2.lineEnd}}`;
    ok(esk.includes(`<FortranSource file="${file}" ${range} href="https://github.com/o/r/blob/v1/${file}#L${n2.line}-L${n2.lineEnd}">\n\n`
      + `\`\`\`f90 lineNumbers=${n2.line}\n${lines}\n\`\`\`\n\n</FortranSource>`), 'a procedure\'s lines, numbered from its first');
    ok(esk.includes(`<FortranSource file="${file}" line={3} lineEnd={256} href="https://github.com/o/r/blob/v1/${file}#L3-L256" />`),
      'a unit only links');
    ok(esk.includes('```f90 lineNumbers=36\n  integer, parameter, public :: max_order = 64 !! largest supported order\n```'), 'a variable\'s line');
    ok(p('gtsv.mdx').includes('```f77 lineNumbers=93\n      SUBROUTINE DTRIDS( N, NRHS, DL, D, DU, B, LDB, INFO )\n'), 'fixed form is f77');
    const capped = buildPages(ir, { baseUrl: '/docs/m', readSource, sourceMaxLines: 10 }).pages[2].mdx;
    ok(capped.includes(`${range} />`) && capped.includes('```f90 lineNumbers=42\n'), 'an entity longer than sourceMaxLines only links');
    const tallSrc = `module big\ncontains\n  subroutine tall()\n${'    continue\n'.repeat(450)}`
      + '  end subroutine\nend module big\n';
    const big = parseSource(tallSrc, { root: out, path: 'big.f90' });
    const tall = (max) => buildPages(big, { readSource: () => tallSrc, sourceMaxLines: max }).pages[1].mdx;
    eq([tall(undefined), tall(Infinity)].map((m) => m.includes('lineNumbers=3')), [false, true],
      'sourceMaxLines: 400 by default, and Infinity is no cap');
    const linked = buildPages(ir, { baseUrl: '/docs/m', readSource, source: 'link' }).pages;
    ok(linked.every((x) => !x.mdx.includes('lineNumbers=') && !x.mdx.includes('</FortranSource>')), 'source: link embeds nothing');
    ok(pages.every((x) => !x.mdx.includes('lineNumbers=')), 'without readSource nothing is embedded');
    const odd = 'module odd\ncontains\n  subroutine ticks()\n    print *, "```", "a\u0001b\fc\td"\n  end subroutine\nend module odd\n';
    const oddPage = buildPages(parseSource(odd, { root: out, path: 'odd.f90' }), { readSource: () => odd }).pages[1].mdx;
    ok(oddPage.includes('````f90 lineNumbers=3\n  subroutine ticks()\n    print *, "```", "abc\td"\n  end subroutine\n````'),
      'the fence outgrows the backticks in the code, and control characters other than tab are dropped');
    // the parser ends a line at \n only: a carriage return alone, in a comment above, must not shift the lines
    const cr = ['module crs', '  ! a stray carriage return:\r in a comment', 'contains', '  subroutine after_cr()',
      '  end subroutine after_cr', 'end module crs\r', ''].join('\n');
    const crPage = buildPages(parseSource(cr, { root: out, path: 'cr.f90' }), { readSource: () => cr }).pages[1].mdx;
    ok(crPage.includes('```f90 lineNumbers=4\n  subroutine after_cr()\n  end subroutine after_cr\n```'),
      'a carriage return alone does not shift the lines of a source block');
    // generate reads the files the parser read wherever they lie, any other file (one a #line marker names) only from
    // under the root, and FORD's {!file!} includes only from under the root
    const srcroot = path.join(out, 'srcroot');
    const proj = path.join(srcroot, 'proj');
    fs.rmSync(srcroot, { recursive: true, force: true });
    fs.mkdirSync(proj, { recursive: true });
    const put = (file, text) => fs.writeFileSync(file, text);
    put(path.join(proj, 'inside.f90'), 'subroutine inside()\n  !! {!note.md!} {!../note.md!}\nend subroutine\n');
    put(path.join(proj, 'note.md'), 'Read from the root.');
    put(path.join(srcroot, 'note.md'), 'Read from outside.');
    put(path.join(srcroot, 'outside.f90'), 'subroutine outside()\nend subroutine\n');
    put(path.join(proj, 'marker.F90'), '# 1 "../marked.f90"\nsubroutine marked()\nend subroutine\n'
      + '# 1 "kept.inc"\nsubroutine kept()\nend subroutine\n');
    put(path.join(srcroot, 'marked.f90'), 'subroutine marked()\nend subroutine\n');
    put(path.join(proj, 'kept.inc'), 'subroutine kept()\nend subroutine\n');
    const g = await generate({ root: proj, sources: ['.', '../outside.f90'], out: path.join(srcroot, 'pages') });
    const all = g.pages.map((x) => x.mdx).join('\n');
    ok(['inside', 'outside'].every((s) => all.includes(`\`\`\`f90 lineNumbers=1\nsubroutine ${s}()\n`)),
      'generate embeds the sources it read, inside the root or not');
    ok(all.includes('<FortranSource file="../marked.f90" line={1} lineEnd={2} />')
      && all.includes('```f90 lineNumbers=1\nsubroutine kept()\n'), 'a file a #line marker names, only from under the root');
    ok(all.includes('Read from the root.') && !all.includes('Read from outside.'),
      'FORD includes are read from under the root only');
    // a root of / holds every file (the root and a separator would be //)
    const top = path.join(srcroot, 'top');
    fs.mkdirSync(top, { recursive: true });
    const disk = path.parse(top).root;
    put(path.join(top, 'note.md'), 'Read with a root of /.');
    const note = path.relative(disk, path.join(top, 'note.md')).split(path.sep).join('/');
    put(path.join(top, 'rooted.f90'), `subroutine rooted()\n  !! {!${note}!}\nend subroutine\n`);
    const gt = await generate({ root: disk, sources: [path.join(top, 'rooted.f90')], out: path.join(top, 'pages') });
    ok(gt.pages.some((x) => x.mdx.includes('Read with a root of /.')), 'a root of / reads FORD includes under it');
  }

  // ---- front matter: the page's kind and what each heading is, for the kind letters in the table of contents
  for (const x of pages.filter((q) => q.path !== 'index.mdx')) {
    eq(frontOf(x.mdx).filter((l) => !FRONT_LINE.test(l)), [], `${x.path}: the front matter is plain YAML`);
    eq(Object.keys(tocOf(x.mdx)), headingsOf(x.mdx), `${x.path}: fortran.toc names every heading, in order`);
  }
  ok(sk.includes('\nfortran:\n  kind: "module"\n  toc:\n    "color": "type"\n'), 'fortran.kind and fortran.toc');
  const toc = tocOf(sk);
  eq([toc['operator-plus'], toc['enum-1'], toc.matvec_iface, toc.matrix_free, toc.norm2_parallel, toc.max_order],
    ['interface', 'enum', 'subroutine', 'function', 'function', 'parameter'], 'kind words, by anchors such as operator-plus and enum-1');
  ok(page('gtsv.mdx').includes('\nfortran:\n  kind: "procedures"\n  toc:\n    "dtrids": "subroutine"\n---\n'), 'a page of external procedures');
  ok(page('demo.mdx').includes('\nfortran:\n  kind: "program"\n  toc: {}\n---\n'), 'a page without entries');
  ok(!page('index.mdx').includes('fortran:'), 'the overview has no kind');

  // ---- the command line: --source
  {
    const bin = path.join(root, 'bin/fumadocs-fortran.js');
    const run = (...args) => spawnSync(process.execPath, [bin, ...args], { cwd: root, encoding: 'utf8' });
    ok(run('--help').stdout.includes('--source MODE'), '--source is in the help');
    const bad = run('generate', '--source', 'inline');
    ok(bad.status === 2 && bad.stderr.includes('--source takes embed or link'), '--source is checked');
    const dir = path.join(out, 'cli-pages');
    fs.rmSync(dir, { recursive: true, force: true });
    const cli = (...args) => run('generate', 'examples/modern/src', '-o', path.relative(root, dir), ...args);
    const read = () => fs.readFileSync(path.join(dir, 'solver_kernels.mdx'), 'utf8');
    ok(cli().status === 0 && read().includes('lineNumbers='), 'the command line embeds sources by default');
    ok(cli('--source', 'link').status === 0 && !read().includes('lineNumbers='), 'and only links with --source link');
    ok(run('--help').stdout.includes('--graphs MODE'), '--graphs is in the help');
    const badGraphs = run('generate', '--graphs', 'svg');
    ok(badGraphs.status === 2 && badGraphs.stderr.includes('--graphs takes mermaid or none'), '--graphs is checked');
    ok(read().includes('```mermaid\n'), 'the command line draws graphs by default');
    ok(cli('--graphs', 'none').status === 0 && !read().includes('<FortranGraph'), 'and none with --graphs none');
    // --library-cards and --links: the registry's cards, and the pages they link to, as hpc.cards and hpc.links
    ok(['--library-cards MODE', '--links LIST'].every((x) => run('--help').stdout.includes(x)),
      '--library-cards and --links are in the help');
    const failed = (...args) => {
      const r = run('generate', ...args);
      return r.status === 2 ? r.stderr.trim() : `status ${r.status}`;
    };
    eq([failed('--library-cards', 'off'), failed('--links', 'blas=mkl'), failed('--links', 'mpi=intel'),
      failed('--links', 'mpich'), failed('--links', 'mpi=')], ['fumadocs-fortran: --library-cards takes registry or none',
      'fumadocs-fortran: --links: unknown library "blas"; the libraries are lapack (BLAS and LAPACK), scalapack (with '
        + 'PBLAS, BLACS, its tools and REDIST), mpi, openmp, openacc and intrinsics',
      'fumadocs-fortran: --links: mpi takes openmpi, mpich or standard, not "intel"',
      'fumadocs-fortran: --links takes library=provider pairs, comma-separated, such as mpi=mpich, not mpich',
      'fumadocs-fortran: --links takes library=provider pairs, comma-separated, such as mpi=mpich, not mpi='],
    'unknown modes, libraries and providers fail, saying what there is');
    // a library name is checked as given, whatever it is: __proto__ is no library either (an object's own key)
    const proto = cli('--links', '__proto__=mkl');
    ok(proto.status === 2 && proto.stderr.includes('--links: unknown library "__proto__"'),
      '--links __proto__=mkl fails as any unknown library does');
    // every entity shown, as the Showcase shows them, and the MPI code built
    const wide = (...args) => cli('-D', 'USE_MPI', '--display', 'public,protected,private', ...args);
    const allreduce = libraryOf('MPI_Allreduce').entry.links;
    const hrefs = () => [...read().matchAll(/<FortranRef href="([^"]*)"/g)].map((m) => m[1]);
    ok(wide().status === 0 && hrefs().includes(allreduce.openmpi) && hrefs().includes(libraryOf('dgemv').link),
      'Open MPI\'s and Netlib\'s pages by default');
    ok(wide('--links', 'mpi=mpich', '--links', 'lapack=mkl').status === 0
      && hrefs().includes(allreduce.mpich) && hrefs().includes(libraryOf('dgemv').entry.links.mkl)
      && !hrefs().includes(allreduce.openmpi), '--links chooses them, and may be given more than once');
    const readLapack = () => fs.readFileSync(path.join(dir, 'solver_kernels_lapack.mdx'), 'utf8');
    ok(wide('--library-cards', 'none').status === 0 && !read().includes('<FortranRef')
      && !readLapack().includes('<FortranRef') && !read().includes('"MPI_Comm":')
      && /^ {2}class n\d+ fdfLapack$/m.test(readLapack()),
    '--library-cards none: no cards, and the graphs keep the registry\'s colours');
    // the usual npm-script layout: run from the site's folder on ../src, the sources outside the current folder
    const site = path.join(out, 'site-layout');
    fs.rmSync(site, { recursive: true, force: true });
    fs.mkdirSync(path.join(site, 'src'), { recursive: true });
    fs.mkdirSync(path.join(site, 'docs'), { recursive: true });
    fs.writeFileSync(path.join(site, 'src', 'shapes.f90'),
      'module shapes\ncontains\n  subroutine grow()\n  end subroutine\nend module shapes\n');
    const fromSite = spawnSync(process.execPath, [bin, 'generate', '../src', '-o', 'api'],
      { cwd: path.join(site, 'docs'), encoding: 'utf8' });
    let shapes = '';
    try {
      shapes = fs.readFileSync(path.join(site, 'docs', 'api', 'shapes.mdx'), 'utf8');
    } catch {
      // not written: the check below fails
    }
    ok(fromSite.status === 0 && shapes.includes('<FortranSource file="../src/shapes.f90" line={3} lineEnd={4}>\n\n'
      + '```f90 lineNumbers=3\n  subroutine grow()\n  end subroutine\n```'),
    'generate ../src, run from a site\'s folder, embeds the sources');
    const help = run('--help').stdout.replace(/\s+/g, ' ');
    ok(help.includes('read from the files parsed (those given and the files they include) wherever they lie')
      && help.includes('includes in doc comments are read relative to the current folder, and only from under it'),
    'the help says where the sources and FORD\'s includes are read from');
  }

  // ---- graphs: a card around a ```mermaid block, open for a unit's dependencies and the overview, collapsed for an
  // entity's; graph nodes link to the headings
  {
    const card = (title, collapsed) => `<FortranGraph title="${title}"${collapsed ? ' collapsed' : ''}>\n\n\`\`\`mermaid\nflowchart `;
    const at = (mdx, heading) => mdx.slice(mdx.indexOf(`### ${heading} [#`)).split('\n### ')[0];
    ok(sk.includes(card('Dependencies', false)), 'a unit\'s dependencies, open');
    ok(sk.indexOf(card('Dependencies', false)) < sk.indexOf('\n## Types\n'), 'above the sections');
    ok(at(sk, 'dense_matrix').includes(card('Inheritance', true)), 'a type\'s inheritance, collapsed');
    ok(at(sk, 'solve_dense').includes(card('Call graph', true)), 'a generic\'s calls');
    const helper = at(sk, 'check_length');
    ok(helper.includes(card('Call graph', true)) && helper.indexOf('<FortranGraph') < helper.indexOf('<FortranSource'),
      'a procedure\'s calls, collapsed, above its source');
    ok(helper.includes('click n4 href "/docs/m/solver_kernels_lapack#solve_dense_real"'), 'a caller on another page');
    ok(page('demo.mdx').includes(card('Dependencies', false)) && page('demo.mdx').includes(card('Call graph', true)),
      'a program\'s dependencies and calls');
    ok(page('index.mdx').includes(`## Dependencies\n\n<FortranGraph>\n\n\`\`\`mermaid\nflowchart LR`), 'the overview\'s graph');
    ok(!at(sk, 'max_order').includes('<FortranGraph'), 'none for a variable');
    eq(dangling(pages), [], 'every link, graph nodes\' included, has its heading');
    const none = buildPages(ir, { baseUrl: '/docs/m', graphs: false }).pages;
    ok(none.every((x) => !x.mdx.includes('<FortranGraph') && !x.mdx.includes('```mermaid')), 'graphs: false draws none');
    const shallow = buildPages(ir, { baseUrl: '/docs/m', display: ['public', 'protected', 'private'], graphs: { depth: 1 } });
    ok(!shallow.pages.find((x) => x.path === 'demo.mdx').mdx.includes('"check_length"'), 'graphs.depth is passed on');
    const lib = buildPages(ir, { baseUrl: '/docs/m', graphs: { classify: (n) => (n === 'dgesv' ? 'lapack' : null) } }).pages;
    ok(lib.find((x) => x.path === 'demo.mdx').mdx.includes('class n7 fdfLapack'), 'graphs.classify is passed on');

    // links of nodes without a heading of their own: a generic's interface body goes to the generic, a type-bound
    // generic to its type, an internal procedure to its host
    const src = [
      'module gr',
      '  type :: t',
      '  contains',
      '    procedure :: go => t_go',
      '    generic :: run => go',
      '  end type',
      '  interface norm',
      '    function norm_ext(x) result(r)',
      '      real :: x(:), r',
      '    end function',
      '  end interface',
      'contains',
      '  subroutine t_go(self)',
      '    class(t) :: self',
      '  end subroutine',
      '  subroutine drive(x, v)',
      '    class(t) :: x',
      '    real :: v(:)',
      '    call x%run()',
      '    print *, norm(v)',
      '    call inner()',
      '  contains',
      '    subroutine inner()',
      '    end subroutine',
      '  end subroutine',
      'end module gr',
    ].join('\n');
    const gr = buildPages(parseSource(src, { root: out, path: 'gr.f90' }), { baseUrl: '/docs/m' }).pages
      .find((x) => x.path === 'gr.mdx').mdx;
    const drive = at(gr, 'drive');
    const node = (label) => new RegExp(`\\n {2}(n\\d+)[^\\n]*"${label}"`).exec(drive)?.[1];
    const href = (label) => new RegExp(`click ${node(label)} href "([^"]*)"`).exec(drive)?.[1];
    eq(['run', 't_go', 'norm', 'norm_ext', 'inner'].map(href), ['/docs/m/gr#t', '/docs/m/gr#t_go', '/docs/m/gr#norm',
      '/docs/m/gr#norm', '/docs/m/gr#drive'], 'nodes link to the heading that documents them');

    // a procedure's internal procedures are shown where it is: a hidden one's do not appear in a shown one's graph
    const vault = parseSource([
      'module vault',
      '  implicit none',
      '  private',
      '  public :: api',
      'contains',
      '  subroutine api()',
      '  end subroutine',
      '  subroutine secret()',
      '    call hidden_step()',
      '  contains',
      '    subroutine hidden_step()',
      '      call api()',
      '    end subroutine',
      '  end subroutine',
      'end module vault',
    ].join('\n'), { root: out, path: 'vault.f90' });
    const api = (display) => at(buildPages(vault, { baseUrl: '/docs/m', display }).pages
      .find((x) => x.path === 'vault.mdx').mdx, 'api');
    eq([api(undefined), api(['public', 'private'])].map((s) => s.includes('"hidden_step"')), [false, true],
      'the internal procedures of a hidden procedure are hidden with it');

    // the parent a type's entry links to, and the members it inherits, are those of the type its scope sees, as in its
    // inheritance graph
    const fam = buildPages(parseSource([
      'module first_m',
      '  type :: base',
      '    real :: from_first = 0',
      '  end type',
      'end module first_m',
      'module second_m',
      '  type :: base',
      '    real :: from_second = 0',
      '  end type',
      'end module second_m',
      'module kid_m',
      '  use second_m, only: base',
      '  type, extends(base) :: kid',
      '  end type',
      'end module kid_m',
      'module base_m',
      '  type :: shape',
      '    real :: area = 0',
      '  contains',
      '    procedure :: describe',
      '  end type',
      'contains',
      '  subroutine describe(self)',
      '    class(shape), intent(in) :: self',
      '  end subroutine',
      'end module base_m',
      'module ext_m',
      '  use base_m, only: base_shape => shape',
      '  type, extends(base_shape) :: circle',
      '    real :: r = 1',
      '  end type',
      'end module ext_m',
      'module lib_m',
      '  use outside_lib, only: base',
      '  type, extends(base) :: wrapped',
      '  end type',
      'end module lib_m',
      'program p',
      '  type :: base',
      '    real :: local_c = 0',
      '  end type',
      '  type, extends(base) :: kid2',
      '  end type',
      'end program p',
    ].join('\n'), { root: out, path: 'fam.f90' }), { baseUrl: '/docs/m' }).pages;
    const entry = (file, name) => at(fam.find((x) => x.path === file)?.mdx ?? '', name);
    const kid = entry('kid_m.mdx', 'kid');
    ok(kid.includes('Extends [`base`](/docs/m/second_m#base).') && kid.includes('click n2 href "/docs/m/second_m#base"')
      && kid.includes('<FortranArg name="from_second" ') && !kid.includes('from_first'),
    'a parent named like a type of another module: the one the use statement gives');
    const circle = entry('ext_m.mdx', 'circle');
    ok(circle.includes('Extends [`base_shape`](/docs/m/base_m#shape).')
      && circle.includes('<FortranArgs title="Inherited from shape"')
      && ['area', 'describe'].every((n) => circle.includes(`<FortranArg name="${n}" `)),
    'a parent renamed in the use statement');
    const wrapped = entry('lib_m.mdx', 'wrapped');
    ok(wrapped.includes('Extends `base`.') && !wrapped.includes('Inherited from'),
      'a parent from a module outside the project');
    const kid2 = entry('p.mdx', 'kid2');
    ok(kid2.includes('Extends [`base`](/docs/m/p#base).') && kid2.includes('<FortranArg name="local_c" ')
      && !kid2.includes('from_'), 'a parent declared in the same program');
  }

  // escaping on the page: labels before blocks, prototype names, cards, anchors, descriptions
  {
    const src = [
      'module esc',
      '  !! Bindings to libxc, see https://libxc.gitlab.io for {x}.',
      '  type :: point',
      '  end type',
      '  interface point',
      '    module procedure make_point',
      '  end interface',
      '  interface norm',
      '    function norm_r(x) result(r)',
      '      !! @note Only for real arrays.',
      '      real :: x(:), r',
      '    end function',
      '  end interface',
      'contains',
      '  function make_point() result(p)',
      '    type(point) :: p',
      '  end function',
      '  subroutine register(constructor)',
      '    external :: constructor',
      '  end subroutine',
      'end module esc',
    ].join('\n');
    const r = buildPages(parseSource(src, { root: out, path: 'esc.f90' }), { baseUrl: '/docs/m' });
    const esc = r.pages.find((x) => x.path === 'esc.mdx').mdx;
    ok(esc.includes('**norm_r**\n\n<Callout'), 'a doc that opens with a block goes below its label');
    ok(!esc.includes('native code'), 'an argument named constructor is an argument');
    ok(esc.includes('### point [#point]') && esc.includes('### point [#point-interface]'), 'a generic interface named after a type has an anchor of its own');
    ok(esc.includes('<FortranArgs title="Result of norm_r" columns="type intent">\n<FortranArg name="r" type="real" result decl="real :: r" />'),
      'the result of an interface body is a result row');
    const cufft = buildPages(parseSource('module fft\n  use cufft\nend module\n', { root: out, path: 'fft.f90' }));
    ok(cufft.pages[1].mdx.includes('<FortranBadge kind="cuda" label="CUDA Fortran" />'),
      'a module using an NVIDIA library module (cufft) gets the CUDA badge');
    const bare = buildPages(parseSource('module bare\n  enum, bind(c)\n    enumerator :: a, b\n  end enum\nend module\n', { root: out, path: 'bare.f90' }));
    ok(bare.pages[1].mdx.includes('<FortranArgs title="Enumerators" columns="">\n<FortranArg name="a" decl="enumerator :: a" />'),
      'a table whose rows fill no optional column says so');
    const index = r.pages.find((x) => x.path === 'index.mdx').mdx;
    ok(index.includes('{"Bindings to libxc, see https://libxc.gitlab.io for {x}."}'), 'a card holds its text as a JS string, not Markdown');
    const long = buildPages(parseSource(`module lng\n  !! ${'A'.repeat(299)}\u{1D465} more text\nend module\n`, { root: out, path: 'lng.f90' })).pages.find((x) => x.path === 'lng.mdx').mdx;
    ok(!/\\ud835"/.test(long) && /description: ".*…"/.test(long), 'the description is cut by code points');
  }

  // ---- page slugs: the second unit of a name is name-kind, and the ones after it are numbered from that after an
  // underscore, with no suffix piling up (miniWeather has eight `program miniweather`, one per file). No URL ends in
  // -<number>: fumadocs' search gives a page's records the ids <url>-0, <url>-1, …, so such a page could share its id
  // with another page's record, and the site's build would stop ("A document with id … already exists")
  {
    const numbered = (list) => list.map((p) => p.url).filter((u) => /-\d+$/.test(u));
    const dir = path.join(out, 'eight');
    fs.rmSync(dir, { recursive: true, force: true });
    fs.mkdirSync(dir, { recursive: true });
    for (let i = 1; i <= 8; i++) {
      fs.writeFileSync(path.join(dir, `mw${i}.f90`), `program miniweather\n  call step${i}()\nend program miniweather\n`);
    }
    const eight = buildPages(await extract({ root: dir }), { baseUrl: '/docs/m' });
    const slugs = ['miniweather', 'miniweather-program', ...[2, 3, 4, 5, 6, 7].map((k) => `miniweather-program_${k}`)];
    eq(eight.pages.map((p) => p.path), ['index.mdx', ...slugs.map((s) => `${s}.mdx`)],
      'eight programs of one name: miniweather, miniweather-program, then miniweather-program_2 to _7');
    eq(numbered(eight.pages), [], 'no URL of theirs ends in -<number>, the form of the ids of fumadocs\' search records');
    eq(eight.metas[0].data.pages, ['index', '---Programs---', ...slugs], 'and the sidebar lists them so');
    ok(slugs.every((s, i) => eight.pages.find((p) => p.path === `${s}.mdx`)?.mdx.includes(`\`step${i + 1}\``)),
      'each page is its own program\'s');
    eq(dangling(eight.pages), [], 'and every link lands');
    // a slug that has its kind already is only numbered, and does not take the kind a second time: a unit named index
    // takes its kind first, as index is the folder's own page (module-index), and an unnamed block data is named by
    // its kind (blockdata)
    const idx = path.join(out, 'kind-units');
    fs.rmSync(idx, { recursive: true, force: true });
    for (const d of ['a', 'b', 'c']) {
      fs.mkdirSync(path.join(idx, d), { recursive: true });
      fs.writeFileSync(path.join(idx, d, 'index.f90'), `module index\n  integer :: n_${d}\nend module index\n`);
      fs.writeFileSync(path.join(idx, d, 'bd.f'), `      BLOCK DATA\n      COMMON /C${d}/ X${d}\n      END\n`);
    }
    const kinds = buildPages(await extract({ root: idx }), { baseUrl: '/docs/m' });
    eq(kinds.pages.map((p) => p.path), ['index.mdx', 'module-index.mdx', 'module-index_2.mdx', 'module-index_3.mdx',
      'blockdata.mdx', 'blockdata_2.mdx', 'blockdata_3.mdx'],
    'three modules named index and three unnamed block data: module-index and blockdata, then _2 and _3');
    ok(['a', 'b', 'c'].every((d, i) => kinds.pages[i + 1].mdx.includes(`from ${d}/index.f90.`)
      && kinds.pages[i + 4].mdx.includes(`from ${d}/bd.f.`)) && !dangling(kinds.pages).length,
    'each its own unit\'s, and every link lands');
    // a group of external procedures whose name ends in -<number>, such as a file's, takes its kind (a file fft-2.f90
    // beside a module fft)
    const grp = path.join(out, 'numbered-group');
    fs.rmSync(grp, { recursive: true, force: true });
    fs.mkdirSync(grp, { recursive: true });
    fs.writeFileSync(path.join(grp, 'fft.f90'), 'module fft\n  integer :: n\nend module fft\n');
    fs.writeFileSync(path.join(grp, 'fft-2.f90'), 'subroutine fft2(x)\n  real :: x\nend subroutine fft2\n');
    const twice = buildPages(await extract({ root: grp }), { baseUrl: '/docs/m' });
    eq(twice.pages.map((p) => p.path), ['index.mdx', 'fft.mdx', 'fft-2-procedures.mdx'],
      'a group named fft-2 beside a module fft: fft-2-procedures');
    eq([...numbered(kinds.pages), ...numbered(twice.pages)], [], 'no URL of theirs ends in -<number> either');
  }

  // ---- a module whose name starts with "procedure" is a module, not a module procedure statement; a generic's
  // module procedure statements still name its specifics
  {
    const modIr = parseSource([
      'module procedures_m',
      '  interface solve',
      '    module procedure :: solve_a, solve_b',
      '    module procedure solve_c',
      '  end interface',
      'contains',
      '  subroutine solve_a()',
      '  end subroutine',
      '  subroutine solve_b()',
      '  end subroutine',
      '  subroutine solve_c()',
      '  end subroutine',
      'end module procedures_m',
      'module procedure2',
      '  integer :: n',
      'end module procedure2',
      '',
    ].join('\n'), { root: out, path: 'procedures_m.f90' });
    const units = Object.values(modIr.entities).filter((x) => !x.parent).map((x) => `${x.kind} ${x.name}`);
    eq(units, ['module procedures_m', 'module procedure2'], 'module procedures_m and module procedure2 are modules');
    const solve = Object.values(modIr.entities).find((x) => x.kind === 'interface' && x.name === 'solve');
    eq(solve?.procedures, ['solve_a', 'solve_b', 'solve_c'], 'and the generic in one lists its module procedures');
    eq(buildPages(modIr, { baseUrl: '/docs/m' }).pages.map((p) => p.path),
      ['index.mdx', 'procedure2.mdx', 'procedures_m.mdx'], 'each module has its page');
  }

  // with FORD's default display (public, protected), nothing links to an entity that has no heading
  const pub = buildPages(ir, { baseUrl: '/docs/m' });
  eq(dangling(pub.pages), [], 'no link to a hidden entity');
  // a heading writes a name as the source does: an underscore inside it is no emphasis in Markdown, and left
  // unescaped it keeps the name one word for the site's search (norm2_parallel, not norm2\_parallel)
  eq(pages.flatMap((p) => p.mdx.match(/^#{2,3} .*[A-Za-z0-9]\\_[A-Za-z0-9].*$/gm) ?? []), [],
    'no heading escapes an underscore inside a name');
  ok(page('solver_kernels.mdx').includes('\n### norm2_parallel [#norm2_parallel]\n'), 'such as norm2_parallel');

  // writing: a second run changes nothing, and stale generated files go while hand-written ones stay
  const dir = path.join(out, 'pages');
  fs.rmSync(dir, { recursive: true, force: true });
  const first = writePages({ pages, metas }, dir);
  fs.writeFileSync(path.join(dir, 'guide.mdx'), 'hand-written');
  const again = writePages({ pages, metas }, dir);
  eq([first.changed.length, again.changed.length], [pages.length + metas.length, 0], 'a second run writes nothing');
  const fewer = writePages({ pages: pages.slice(0, 2), metas }, dir);
  ok(fewer.removed.length === pages.length - 2 && fs.existsSync(path.join(dir, 'guide.mdx')), 'stale pages removed, hand-written kept');
}
