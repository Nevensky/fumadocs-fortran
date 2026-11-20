// The page model: pages, sidebar, anchors, links, components and their props, for examples/modern.
import fs from 'node:fs';
import path from 'node:path';
import { extract, buildPages, writePages, anchorOf, parseSource } from '../src/index.js';

export default async function ({ ok, eq, here, out }) {
  const root = path.resolve(here, '..');
  const ir = await extract({ root, sources: ['examples/modern/src'], cpp: { macros: { _OPENMP: 1, USE_MPI: 1 } } });
  const { pages, metas } = buildPages(ir, { baseUrl: '/docs/m', display: ['public', 'protected', 'private'], repo: { url: 'https://github.com/o/r', rev: 'v1' } });
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
  ok(sk.includes('<FortranArg name="comm" type="type(MPI_Comm)" intent="in" cond="USE_MPI">'), 'a conditional argument');
  ok(sk.includes('<FortranBadge kind="mpi" label="MPI" conditional="USE_MPI" />'), 'MPI badge, conditional');
  ok(sk.includes('<FortranBadge kind="omp" label="OpenMP parallel region" title="parallel do" />'), 'OpenMP region badge');
  ok(sk.includes('<FortranArg name="total" type="real(dp)" codims="[*]" intent="out" />'), 'a coarray argument');
  const n2 = ir.entities['module:solver_kernels/procedure:norm2_parallel'];
  ok(sk.includes(`href="https://github.com/o/r/blob/v1/examples/modern/src/modern_ford.F90#L${n2.line}-L${n2.lineEnd}"`), 'source links with lines');
  ok(sk.includes('$$\nP A = L U, \\qquad x = U^{-1} L^{-1} P b.\n$$') && sk.includes('$A x = b$'), 'maths on the page');
  ok(page('solver_kernels_lapack.mdx').includes('Implements `solve_dense_complex`, declared in the interface [`solve_dense`](/docs/m/solver_kernels#solve_dense) of [`solver_kernels`](/docs/m/solver_kernels).'), 'a separate module procedure links its interface');
  ok(page('solver_kernels_lapack.mdx').includes('<FortranArg name="a" type="complex(dp)" dims="(:,:)" intent="inout" />'), 'and takes its arguments from it');
  ok(page('gtsv.mdx').includes('<FortranArg name="D" type="DOUBLE PRECISION" dims="(*)" intent="inout">'), 'F77 intents from \\param[in,out]');
  eq(anchorOf({ name: 'operator(.cross.)', kind: 'interface', id: 'x' }), 'operator-cross', 'operator slugs');
  ok(sk.includes('pure integer function matrix_order(self) result(n)'), 'a function signature keeps the type written before `function`');
  ok(sk.includes('### RED, GREEN [#enum-1]'), 'an unnamed enum is titled by its enumerators');
  const dense = sk.slice(sk.indexOf('[#dense_matrix]'), sk.indexOf('[#banded_matrix]'));
  const inh = dense.slice(dense.indexOf('<FortranArgs title="Inherited from abstract_matrix">'));
  ok(inh.includes('name="n"') && inh.includes('name="order"') && !inh.includes('name="matvec"'), 'inherited members, without the bindings a type overrides');
  ok(inh.includes('<FortranArg name="write_matrix" type="procedure" attrs="private" />'), 'an inherited private binding says so');
  ok(page('solver_kernels_lapack.mdx').includes('<FortranBadge kind="private" />'), 'a separate module procedure takes the access of its interface body');

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
    const index = r.pages.find((x) => x.path === 'index.mdx').mdx;
    ok(index.includes('{"Bindings to libxc, see https://libxc.gitlab.io for {x}."}'), 'a card holds its text as a JS string, not Markdown');
    const long = buildPages(parseSource(`module lng\n  !! ${'A'.repeat(299)}\u{1D465} more text\nend module\n`, { root: out, path: 'lng.f90' })).pages.find((x) => x.path === 'lng.mdx').mdx;
    ok(!/\\ud835"/.test(long) && /description: ".*…"/.test(long), 'the description is cut by code points');
  }

  // with FORD's default display (public, protected), nothing links to an entity that has no heading
  const pub = buildPages(ir, { baseUrl: '/docs/m' });
  const anchors = new Map(pub.pages.map((p) => [p.url, new Set([...p.mdx.matchAll(/\[#([\w-]+)\]/g)].map((m) => m[1]))]));
  const dangling = [];
  for (const p of pub.pages) for (const m of p.mdx.matchAll(/\]\((\/docs\/m\/[\w-]+)(?:#([\w-]+))?\)/g)) {
    if (!anchors.has(m[1]) || (m[2] && !anchors.get(m[1]).has(m[2]))) dangling.push(`${p.path} -> ${m[1]}#${m[2]}`);
  }
  eq(dangling, [], 'no link to a hidden entity');

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
