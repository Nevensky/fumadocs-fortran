// The page model: pages, sidebar, anchors, links, components and their props, for examples/modern.
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { extract, buildPages, writePages, anchorOf, parseSource, generate } from '../src/index.js';

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
    + ' decl="type(MPI_Comm), intent(in) :: comm">'), 'a conditional argument');
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
  ok(sk.includes('<FortranArg name="k" type="integer" attrs="kind, default dp" decl="integer, kind :: k = dp">'),
    'a type parameter is declared as written');
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
  ok(!/<FortranArg name="comm" [^\n]*refs=/.test(sk), 'a type from a module outside the project has no ref');
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
    ok(at(sk, 'dense\\_matrix').includes(card('Inheritance', true)), 'a type\'s inheritance, collapsed');
    ok(at(sk, 'solve\\_dense').includes(card('Call graph', true)), 'a generic\'s calls');
    const helper = at(sk, 'check\\_length');
    ok(helper.includes(card('Call graph', true)) && helper.indexOf('<FortranGraph') < helper.indexOf('<FortranSource'),
      'a procedure\'s calls, collapsed, above its source');
    ok(helper.includes('click n4 href "/docs/m/solver_kernels_lapack#solve_dense_real"'), 'a caller on another page');
    ok(page('demo.mdx').includes(card('Dependencies', false)) && page('demo.mdx').includes(card('Call graph', true)),
      'a program\'s dependencies and calls');
    ok(page('index.mdx').includes(`## Dependencies\n\n<FortranGraph>\n\n\`\`\`mermaid\nflowchart LR`), 'the overview\'s graph');
    ok(!at(sk, 'max\\_order').includes('<FortranGraph'), 'none for a variable');
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
    ok(esc.includes('**norm\\_r**\n\n<Callout'), 'a doc that opens with a block goes below its label');
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

  // with FORD's default display (public, protected), nothing links to an entity that has no heading
  const pub = buildPages(ir, { baseUrl: '/docs/m' });
  eq(dangling(pub.pages), [], 'no link to a hidden entity');

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
