// The Fumadocs integration: withFortran and fortranPageSchema (fumadocs-fortran/mdx), fortranPlugin
// (fumadocs-fortran/source), the Mermaid component (fumadocs-fortran/mermaid) and createFortranComponents
// (fumadocs-fortran/react). The options and the schema are checked against stand-ins for fumadocs-core's plugins,
// everywhere; the plugin and the components where React can be imported, the Mermaid component where Pele can too, and
// withFortran with fumadocs-core itself, through fumadocs-mdx's applyMdxPreset and MDX, where those can be imported,
// as in the docs site's node_modules. What cannot run is skipped with one line.
import { composeMdx, wrapSchema } from '../fumadocs/compose.js';
import { katexMacros } from '../src/docs/math.js';

const optional = async (spec) => {
  try {
    return await import(spec);
  } catch {
    return null;
  }
};

export default async function ({ ok, eq }) {
  // ---------------------------------------------------------------- withFortran, against stand-ins
  const rehypeCode = function rehypeCode() {};
  const rehypeToc = function rehypeToc() {};
  const rehypeHeading = function rehypeHeading() {};
  const remarkGfm = function remarkGfm() {};
  const remarkStructure = function remarkStructure() {};
  const remarkMdxMermaid = function remarkMdxMermaid() {};
  const remarkMath = function remarkMath() {};
  const rehypeKatex = function rehypeKatex() {};
  const mine = function mine() {};
  const notation = { name: 'fumadocs-notation' };
  const plugins = {
    rehypeCode, remarkMdxMermaid, remarkStructure,
    rehypeCodeDefaultOptions: { themes: { light: 'a', dark: 'b' }, defaultLanguage: 'plaintext', transformers: [notation] },
    remarkStructureDefaultOptions: { filterElement: (node) => /^(File|TypeTable|Callout|Card)$/.test(node.name ?? '') },
  };
  const compose = (options) => composeMdx(options, plugins);
  // the lists applyMdxPreset hands a function form: fumadocs' own plugins
  const remarkDefaults = () => [remarkGfm, [remarkStructure, { exportAs: 'structuredData' }]];
  const rehypeDefaults = () => [[rehypeCode, {}], rehypeToc, rehypeHeading];

  {
    const o = compose();
    eq(Object.keys(o).sort(), ['rehypeCodeOptions', 'remarkStructureOptions'], 'withFortran() sets the code blocks and the search records only');
    const code = o.rehypeCodeOptions;
    eq(code.themes, { light: 'a', dark: 'b' }, "the code blocks keep fumadocs' themes");
    eq(code.defaultLanguage, 'plaintext', "and fumadocs' other defaults");
    eq(code.transformers.map((t) => t.name), ['fumadocs-notation', 'fumadocs-fortran:notation', 'fumadocs-fortran:directives'],
      "fumadocs' transformers, then the two Fortran ones");
    ok(code.langs.some((l) => l.name === 'fortran') && code.langs.some((l) => l.name === 'fortran-fixed'), 'the Fortran grammars are loaded');
    const keep = o.remarkStructureOptions.filterElement;
    eq(['FortranArg', 'FortranRef', 'FortranBadge', 'Callout', 'Card', 'Accordion', 'Fortran', 'fortranish'].map((name) => keep({ name })),
      [false, false, false, true, true, false, false, false], "search keeps fumadocs' default tags, and gives the components' text");
  }
  {
    const o = compose({ rehypeCodeOptions: { themes: { light: 'x', dark: 'y' } }, remarkStructureOptions: { filterElement: (n) => /^[A-Z]/.test(n.name), exportAs: 'sd' } });
    eq(o.rehypeCodeOptions.themes, { light: 'x', dark: 'y' }, "the site's own code options win");
    eq(o.rehypeCodeOptions.transformers.length, 3, "and keep fumadocs' transformers, as rehypeCode would");
    eq(['FortranArg', 'Accordion', 'tabs'].map((name) => o.remarkStructureOptions.filterElement({ name })), [false, true, false],
      "the site's own filter, without the Fortran components");
    eq(o.remarkStructureOptions.exportAs, 'sd', "the site's other structure options stay");
  }
  {
    // the grammars' own options, such as fixed form's 132 columns
    const wide = compose({ grammars: { fixedLineLength: 132, fypp: false } });
    ok(!('grammars' in wide), 'grammars is not passed on');
    const fixed = wide.rehypeCodeOptions.langs.find((l) => l.name === 'fortran-fixed');
    ok(JSON.stringify(fixed).includes('132') && !wide.rehypeCodeOptions.langs.some((l) => l.name === 'fortran-fypp'),
      'grammars: the fixed-form grammar ends at column 132, and fypp is left out');
    const o = compose({ rehypeCodeOptions: false, remarkStructureOptions: false, valueToExport: ['x'] });
    eq([o.rehypeCodeOptions, o.remarkStructureOptions, o.valueToExport], [false, false, ['x']], 'false stays false, other options pass through');
    const noDefault = composeMdx({}, { ...plugins, remarkStructureDefaultOptions: undefined });
    eq(['Card', 'Accordion', 'FortranRef'].map((name) => noDefault.remarkStructureOptions.filterElement({ name })), [true, false, false],
      "without fumadocs' default filter, the same default");
  }
  // maths and graphs
  {
    const o = compose({ math: { remarkMath, rehypeKatex }, graphs: true });
    eq(o.remarkPlugins, [remarkMath, remarkMdxMermaid], 'maths and graphs: remark-math and remarkMdxMermaid');
    ok(!('math' in o) && !('graphs' in o), 'math and graphs are not passed on');
    const list = o.rehypePlugins(rehypeDefaults());
    eq(list.map((e) => (Array.isArray(e) ? e[0] : e)), [rehypeKatex, rehypeCode, rehypeToc, rehypeHeading], 'KaTeX before the code blocks');
    const macros = list[0][1].macros;
    ok(Object.keys(katexMacros).every((k) => macros[k] === katexMacros[k]), 'with katexMacros');
    ok(macros !== katexMacros, 'a copy of katexMacros, which KaTeX adds the \\gdef of a page to');
    const own = compose({ math: { remarkMath, rehypeKatex: [rehypeKatex, { strict: false, macros: { '\\norm': 'mine' } }] } });
    const k = own.rehypePlugins(rehypeDefaults())[0][1];
    eq([k.strict, k.macros['\\norm'], k.macros['\\abs'] === katexMacros['\\abs']], [false, 'mine', true],
      "rehype-katex's own options, and its macros over katexMacros");
    eq(compose({ graphs: true }).remarkPlugins, [remarkMdxMermaid], 'graphs alone');
    eq(compose({ graphs: false }).remarkPlugins, undefined, 'graphs: false adds nothing');
  }
  {
    // the site's own lists: after them, without what they have already
    const o = compose({ math: { remarkMath, rehypeKatex }, graphs: true, remarkPlugins: [mine, remarkMath], rehypePlugins: [mine] });
    eq(o.remarkPlugins, [mine, remarkMath, remarkMdxMermaid], "the site's remark list first, nothing twice");
    eq(o.rehypePlugins(rehypeDefaults()).map((e) => (Array.isArray(e) ? e[0] : e)), [rehypeKatex, rehypeCode, mine, rehypeToc, rehypeHeading],
      "the site's rehype list where applyMdxPreset puts it, after rehypeCode");
    // a rehype-katex of the site's own list moves before rehypeCode, its options over math's, katexMacros under its own
    const has = compose({ math: { remarkMath, rehypeKatex }, rehypePlugins: [mine, [rehypeKatex, { strict: false, macros: { '\\norm': 'mine' } }]] });
    const moved = has.rehypePlugins(rehypeDefaults());
    eq(moved.map((e) => (Array.isArray(e) ? e[0] : e)), [rehypeKatex, rehypeCode, mine, rehypeToc, rehypeHeading],
      "the site's own rehype-katex moves before rehypeCode, and the rest of its list stays after it");
    eq([moved[0][1].strict, moved[0][1].macros['\\norm'], moved[0][1].macros['\\abs'] === katexMacros['\\abs']], [false, 'mine', true],
      'with its own options, and katexMacros under its macros');
    // function forms: the plugins go into the list they are given
    const fn = compose({ graphs: true, math: { remarkMath, rehypeKatex }, remarkPlugins: (v) => [...v, mine], rehypePlugins: (v) => [mine, ...v] });
    eq(fn.remarkPlugins(remarkDefaults()).map((e) => (Array.isArray(e) ? e[0] : e)), [remarkGfm, remarkMath, remarkMdxMermaid, remarkStructure, mine],
      "a remark function gets the list with the plugins before remarkStructure");
    eq(fn.rehypePlugins(rehypeDefaults()).map((e) => (Array.isArray(e) ? e[0] : e)), [mine, rehypeKatex, rehypeCode, rehypeToc, rehypeHeading],
      'a rehype function gets the list with KaTeX first');
    const minimal = compose({ preset: 'minimal', math: { remarkMath, rehypeKatex }, rehypePlugins: [mine] });
    eq([minimal.remarkPlugins, minimal.rehypePlugins.map((e) => (Array.isArray(e) ? e[0] : e)), 'rehypeCodeOptions' in minimal],
      [[remarkMath], [rehypeKatex, mine], false], "preset 'minimal': lists, and no fumadocs options");
  }
  {
    const throws = (f) => {
      try {
        f();
        return '';
      } catch (e) {
        return e.message;
      }
    };
    ok(/remark-math and rehype-katex/.test(throws(() => compose({ math: { remarkMath } }))), 'math without rehype-katex says what it needs');
    ok(/options must be an object/.test(throws(() => compose('yes'))), 'options that are not an object');
    ok(/remarkPlugins must be a list or a function/.test(throws(() => compose({ graphs: true, remarkPlugins: 'x' }))), 'a remarkPlugins that is neither');
    ok(/with preset 'minimal', remarkPlugins must be a list/.test(throws(() => compose({ preset: 'minimal', graphs: true, remarkPlugins: (v) => v }))),
      "preset 'minimal' with a remark function, which MDX cannot take");
  }

  // ---------------------------------------------------------------- fortranPageSchema
  {
    // a stand-in for Zod's pageSchema: title is required, and fields it does not know are dropped
    const issue = (message, path) => ({ issues: [{ message, path }] });
    const check = (v) => (typeof v?.title === 'string' ? { value: { title: v.title } } : issue('Required', ['title']));
    const base = { '~standard': { version: 1, vendor: 'stand-in', validate: check } };
    const async = { '~standard': { version: 1, vendor: 'stand-in', validate: async (v) => check(v) } };
    const schema = wrapSchema(base);
    eq([schema['~standard'].version, schema['~standard'].vendor], [1, 'fumadocs-fortran'], 'a Standard Schema of its own');
    const fortran = { kind: 'module', toc: { solve: 'subroutine', dense_matrix: 'type' } };
    eq(schema['~standard'].validate({ title: 'm', fortran, other: 1 }), { value: { title: 'm', fortran } }, 'keeps fortran, drops what the base drops');
    eq(schema['~standard'].validate({ title: 'Intro' }), { value: { title: 'Intro' } }, 'a page without fortran is the base\'s');
    eq(await wrapSchema(async)['~standard'].validate({ title: 'm', fortran }), { value: { title: 'm', fortran } }, 'an async base');
    eq(schema['~standard'].validate({ title: 'm', fortran: { toc: [] } }), issue('Expected an object of anchors and kinds', ['fortran', 'toc']), 'a toc that is no object');
    eq(schema['~standard'].validate({ title: 'm', fortran: { kind: 3 } }), issue('Expected a string', ['fortran', 'kind']), 'a kind that is no string');
    eq(schema['~standard'].validate({ title: 'm', fortran: { toc: { a: 1 } } }), issue('Expected a string', ['fortran', 'toc', 'a']), 'a kind in toc that is no string');
    eq(schema['~standard'].validate({ fortran: 'x' }).issues.map((i) => i.path.join('.')), ['title', 'fortran'], "the base's issues and the field's");
    const fn = wrapSchema((context) => (context.ok ? base : null));
    ok(typeof fn === 'function' && fn({ ok: true })['~standard'].vendor === 'fumadocs-fortran', "a function of fumadocs-mdx's context gives one");
    let msg = '';
    try {
      wrapSchema({});
    } catch (e) {
      msg = e.message;
    }
    ok(/pageSchema from fumadocs-core\/source\/schema/.test(msg), 'no schema: it says what to give');
  }

  // ---------------------------------------------------------------- fortranPlugin and the components (React)
  const React = await optional('react');
  const server = await optional('react-dom/server');
  if (!React || !server) {
    console.log('fortranPlugin and component checks skipped: react and react-dom are not installed');
    return;
  }
  const { renderToStaticMarkup } = server;
  const { fortranPlugin } = await import('../fumadocs/source.js');
  const html = (node) => renderToStaticMarkup(React.createElement(React.Fragment, null, node));
  {
    const plugin = fortranPlugin();
    eq([plugin.name, plugin.enforce, typeof plugin.transformStorage, typeof plugin.transformPageTree.file],
      ['fumadocs-fortran', 'pre', 'function', 'function'], 'a loader plugin that runs first');
    eq([fortranPlugin({ toc: false }).transformStorage, fortranPlugin({ sidebar: false }).transformPageTree], [undefined, undefined],
      'toc: false and sidebar: false leave their parts out');

    // the page data as fumadocs-mdx gives it: toc a getter that runs the page when first read
    let reads = 0;
    const lazyToc = (items) => {
      const data = { title: 'solver_kernels', fortran: { kind: 'module', toc: { solve: 'subroutine', 'operator-plus': 'interface' } } };
      Object.defineProperty(data, 'toc', {
        enumerable: true, configurable: true, get() {
          reads++;
          return items;
        },
      });
      return data;
    };
    const items = [{ title: 'solve', url: '#solve', depth: 3 }, { title: 'operator(+)', url: '#operator-plus', depth: 3 }, { title: 'Types', url: '#types', depth: 2 }];
    const page = lazyToc(items);
    const intro = { title: 'Intro', toc: items };
    let loads = 0;
    const asyncPage = {
      title: 'gtsv',
      fortran: { kind: 'procedures', toc: { solve: 'subroutine' } },
      load() {
        loads++;
        return Promise.resolve(lazyToc(items));
      },
    };
    const files = new Map([['api/solver_kernels.mdx', { format: 'page', data: page }], ['index.mdx', { format: 'page', data: intro }],
      ['api/gtsv.mdx', { format: 'page', data: asyncPage }], ['api/meta.json', { format: 'meta', data: { pages: [] } }]]);
    const storage = { getFiles: () => [...files.keys()], read: (p) => files.get(p) };
    plugin.transformStorage({ storage });
    eq(reads, 0, 'the table of contents is not read when the loader is made');
    const toc = page.toc;
    eq([reads, page.toc === toc], [1, true], 'it is read once, when first asked for, and kept');
    eq(toc.map((i) => html(i.title)), [
      '<span class="fdf-toc"><span class="fdf-toc-kind fdf-toc-subroutine" aria-hidden="true">s</span> <span class="fdf-toc-name">solve</span></span>',
      '<span class="fdf-toc"><span class="fdf-toc-kind fdf-toc-interface" aria-hidden="true">i</span> <span class="fdf-toc-name">operator(+)</span></span>',
      'Types'], 'the entries get their letters, a heading without a kind none');
    ok(intro.toc === items, 'a page without fortran keeps its table of contents');
    fortranPlugin().transformStorage({ storage });
    eq(page.toc.map((i) => html(i.title).split('fdf-toc-kind').length - 1), [1, 1, 0], 'a second loader adds no second letter');
    const [a, b] = await Promise.all([asyncPage.load(), asyncPage.load()]);
    eq([loads, a === b, html(a.toc[0].title).includes('fdf-toc-subroutine')], [1, true, true], "an async page's load() gives the letters, and loads once");

    // the sidebar
    const file = plugin.transformPageTree.file;
    const ctx = { storage };
    const node = (name, icon) => ({ type: 'page', name, url: `/docs/${name}`, ...(icon === undefined ? {} : { icon }) });
    eq(html(file.call(ctx, node('solver_kernels'), 'api/solver_kernels.mdx').icon),
      '<span class="fdf-nav-kind fdf-nav-module" aria-hidden="true">mod</span>', 'a module page: mod in the place of its icon');
    eq(html(file.call(ctx, node('gtsv'), 'api/gtsv.mdx').icon),
      '<span class="fdf-nav-kind fdf-nav-procedures" aria-hidden="true">proc</span>', 'a page of procedures: proc');
    eq(file.call(ctx, node('solver_kernels', 'Box'), 'api/solver_kernels.mdx').icon, 'Box', 'a page with an icon keeps it');
    eq('icon' in file.call(ctx, node('intro'), 'index.mdx'), false, 'a page without fortran gets none');
    eq('icon' in file.call(ctx, node('x')), false, 'a node without a file gets none');
  }

  // createFortranComponents: the links to the site's pages through href
  {
    const { createFortranComponents, fortranComponents } = await import('../react/index.js');
    const plain = createFortranComponents();
    ok(Object.keys(plain).join() === Object.keys(fortranComponents).join() && plain.FortranRef === fortranComponents.FortranRef,
      'without href, the components as they are');
    const c = createFortranComponents({ href: (link) => `/base${link}/` });
    const h = React.createElement;
    const ref = html(h(c.FortranRef, { href: '/docs/api/m#t', title: 'type t' }, 't'));
    ok(ref.includes('href="/base/docs/api/m#t/"'), `FortranRef's link to the site: ${ref}`);
    ok(html(h(c.FortranRef, { href: 'https://www.netlib.org/lapack/', title: 'x' }, 'x')).includes('href="https://www.netlib.org/lapack/"'),
      'a link elsewhere stays');
    ok(html(h(c.FortranRef, { href: '//cdn.example/x', title: 'x' }, 'x')).includes('href="//cdn.example/x"'), 'so does //');
    ok(html(h(c.FortranSource, { file: 'src/m.f90', href: '/src/m.f90' })).includes('href="/base/src/m.f90/"'), "FortranSource's link");
    for (const refs of [{ t: { href: '/docs/api/m#t', title: 'type t' } }, JSON.stringify({ t: { href: '/docs/api/m#t', title: 'type t' } })]) {
      const row = html(h(c.FortranArg, { name: 'x', type: 'type(t)', refs }));
      ok(row.includes('href="/base/docs/api/m#t/"'), `FortranArg's refs, ${typeof refs === 'string' ? 'as JSON text' : 'as an object'}`);
    }
    ok(html(h(c.FortranArg, { name: 'x', type: 'type(t)', refs: 'not json' })).includes('fdf-arg'), 'refs that are not JSON are left to FortranArg');
  }

  // ---------------------------------------------------------------- the Mermaid component (React and Pele)
  if (!(await optional('pele'))) {
    console.log('Mermaid checks skipped: pele is not installed');
  } else {
    const { Mermaid } = await import('../react/mermaid.js');
    const h = React.createElement;
    const chart = 'graph LR\n  a["solver_kernels"] --> b["solver_kernels_lapack"]\n  click a href "/docs/api/solver_kernels"\n  click b href "https://example.org/x"';
    const one = html(h(Mermaid, { chart }));
    ok(/^<div class="fdf-mermaid not-prose"><svg[^>]*class="pele/.test(one), 'one diagram, as SVG, in a block that is not prose');
    ok(one.includes('href="/docs/api/solver_kernels"'), 'its links as Pele writes them');
    const moved = html(h(Mermaid, { chart, href: (link) => `/base${link}/` }));
    ok(moved.includes('href="/base/docs/api/solver_kernels/"') && moved.includes('href="https://example.org/x"'),
      'href rewrites the links to the site, and only those');
    const wide = 'graph LR\n' + Array.from({ length: 9 }, (_, i) => `  n${i}["node number ${i}"] --> n${i + 1}["node number ${i + 1}"]`).join('\n');
    const two = html(h(Mermaid, { chart: wide, narrow: 320 }));
    ok(/^<div class="fdf-mermaid fdf-mermaid-two not-prose"><div class="fdf-mermaid-wide"><svg[\s\S]*<div class="fdf-mermaid-narrow"><svg/.test(two),
      'narrow: a second layout for a narrow column');
    ok((two.match(/<svg/g) ?? []).length === 2, 'two diagrams, no more');
    const bad = html(h(Mermaid, { chart: 'this is <not> a diagram' }));
    eq(bad, '<figure class="fdf-mermaid-code not-prose"><figcaption>Mermaid</figcaption><pre><code>this is &lt;not&gt; a diagram</code></pre></figure>',
      'a diagram Pele cannot draw: its code');
  }

  // ---------------------------------------------------------------- withFortran with fumadocs-core, through MDX
  const real = await optional('../fumadocs/mdx.js');
  const preset = await optional('fumadocs-mdx/config');
  const mdx = await optional('@mdx-js/mdx');
  const math = await optional('remark-math');
  const katex = await optional('rehype-katex');
  if (!real || !preset || !mdx || !math || !katex) {
    console.log('withFortran checks with fumadocs-core skipped: fumadocs-core, fumadocs-mdx, @mdx-js/mdx, remark-math or rehype-katex is not installed');
    return;
  }
  {
    const options = real.withFortran({ math: { remarkMath: math.default, rehypeKatex: katex.default }, graphs: true });
    const processor = await preset.applyMdxPreset(options)('runtime');
    const source = [
      '## Solve [#solve]', '',
      'The norm $\\norm{x}$ and', '', '$$', 'x^2', '$$', '',
      '```fortran', '!$omp parallel do', 'do i = 1, n', 'end do', '```', '',
      '```mermaid', 'graph LR', '  a --> b', '```', '',
      '<FortranRef href="/docs/api/m#t" title="type t">t</FortranRef>',
    ].join('\n');
    const file = await mdx.compile(source, processor);
    const js = String(file);
    ok(js.includes('Mermaid') && js.includes('chart'), 'graphs: the ```mermaid block is a Mermaid element');
    ok(js.includes('katex') && !js.includes('katex-error'), 'maths: set by KaTeX, with the macros (\\norm)');
    ok(js.includes('fdf-directive'), 'Fortran code: the directive line is marked');
    ok(!js.includes('language-math'), 'the maths block is not highlighted as code');
    const structured = file.data.structuredData ?? null;
    const text = JSON.stringify(structured ?? {});
    ok(structured !== null && !/<FortranRef/.test(text), `search: the FortranRef gives its text, not its tag: ${text.slice(0, 200)}`);
  }
}
