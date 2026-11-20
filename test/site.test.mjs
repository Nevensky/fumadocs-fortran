// The docs site: what its pages say about the package against the package and the generated pages, then its own code
// (docs/lib/shared.ts, docs/components/mdx): the links next/link never sees, those of hover cards, source headers,
// graph nodes and the llms files, get what it gives the others, the base path the site is served under and, in the
// static export, a page's trailing slash, so that a link to an anchor of the page being read only scrolls. The site's
// modules are bundled with esbuild, with one React; that part needs the site's node_modules (scripts/docs.sh keeps
// them in a Docker volume) and is skipped without them.
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import { pathToFileURL } from 'node:url';

export default async function ({ ok, eq, here, out }) {
  const repo = path.join(here, '..');
  const docs = path.join(repo, 'docs');
  const read = (p) => fs.readFileSync(path.join(repo, p), 'utf8');

  // ---- the Components page
  const comp = read('docs/content/docs/reference/components.mdx');
  const section = (heading) => {
    const i = comp.indexOf(`\n${heading}\n`);
    const ends = ['\n## ', '\n### '].map((h) => comp.indexOf(h, i + 1)).filter((j) => j > i);
    return i < 0 ? '' : comp.slice(i, Math.min(...ends, comp.length));
  };
  const refSection = section('## FortranRef');
  ok(refSection && !refSection.includes('<Tabs') && (refSection.match(/\{<><FortranRef /g) ?? []).length === 2,
    'the live FortranRef examples stand outside Tabs, whose box clips a card, as expressions, which search leaves out');
  const snippet = /```tsx title="components\/mdx\/mermaid.tsx"\n([\s\S]*?)\n```/.exec(comp)?.[1] ?? '';
  ok(/\bcatch\b/.test(snippet) && /<CodeBlock\b/.test(snippet),
    'the Mermaid snippet shows a diagram Pele cannot parse as its code');
  const shownCss = /```css title="app\/global.css"\n(\.pele[^\n]*\{[\s\S]*?\n\})\n```/.exec(comp)?.[1];
  ok(!!shownCss && read('docs/app/global.css').includes(shownCss), "the Pele block the page shows is the site's own");
  ok(!/title: \{\s*type: 'string',\s*required: true/.test(section('### Props of FortranGraph')),
    "FortranGraph's title is optional");
  // a link without the base path leaves the site; one without the slash reloads the page it is on
  const based = section('### A site served under a base path');
  ok(/off the site/.test(based) && /redirect/.test(based),
    'the base path section says what a link lacking the base path does, and what one lacking the slash does');
  // the Styling table against style.css: a kind's variable is said to colour graph nodes when, and only when, it does
  const css = fs.readFileSync(path.join(repo, 'style.css'), 'utf8');
  const nodeRule = /\.pele \.pele-node\.fdf\w+ \{ --fdf-c: var\((--fdf-[\w-]+)\); \}/g;
  const nodeVars = new Set([...css.matchAll(nodeRule)].map((m) => m[1]));
  const rows = [...comp.matchAll(/^\| (`--fdf-[^|]*) \| ([^|]*) \|$/gm)]
    .map((m) => ({ vars: [...m[1].matchAll(/`(--fdf-[\w-]+)`/g)].map((v) => v[1]), graphs: /\bgraph/.test(m[2]) }));
  const said = new Set(rows.filter((r) => r.graphs).flatMap((r) => r.vars));
  eq([...nodeVars].filter((v) => !said.has(v)), [], 'the Styling table names every variable that colours graph nodes');
  eq([...said].filter((v) => v.startsWith('--fdf-k-') && !nodeVars.has(v)), [],
    'the Styling table says no kind variable colours graph nodes that does not');

  // ---- the home page's sample, against the generated entry of the same procedure
  const home = read('docs/app/(home)/page.tsx');
  const sk = read('docs/content/docs/showcase/modern/solver_kernels.mdx');
  const at0 = sk.indexOf('### norm2\\_parallel');
  const generated = at0 < 0 ? '' : sk.slice(at0, sk.indexOf('\n### ', at0 + 1));
  ok(generated.includes('<FortranArgs'), 'the Showcase has the entry of norm2_parallel');
  eq([...generated.matchAll(/columns="[^"]*"|decl="[^"]*"/g)].map((m) => m[0]).filter((a) => !home.includes(a)), [],
    "the home page's sample has the generated columns and declarations");
  ok(/name="nrm"[^>]*\sresult\s/.test(home), "the sample's result row is a result");
  ok(/refs=\{dp\}/.test(home) && home.includes("title: 'dp ⇒ real64'"), "the sample's dp has its hover card");
  const calls = '<FortranGraph title="Call graph" collapsed>';
  ok(generated.includes(calls) && home.includes(calls), 'the sample has the call graph, collapsed, as the generated entry');
  ok(/<FortranSource[^>]*>\s*\{code\}\s*<\/FortranSource>/.test(home),
    'the sample has a source block that opens to the code');
  const intro = read('docs/content/docs/index.mdx');
  ok(['hover card', 'graphs', 'block that opens', 'table of contents'].every((w) => intro.includes(w)),
    "the Introduction's list of what a page holds names the rows' cards, the graphs, the source and the kind letters");

  const need = createRequire(path.join(docs, 'package.json'));
  let esbuild;
  try {
    esbuild = need('esbuild');
    for (const p of ['react', 'react-dom/server', 'pele/package.json']) need.resolve(p);
  } catch {
    console.log("site checks skipped: the docs site's node_modules are not installed");
    return;
  }

  // the modules under test, as the site imports them; React and react-dom from the site, once
  const dir = path.join(out, 'site-check');
  fs.mkdirSync(dir, { recursive: true });
  const entry = path.join(dir, 'entry.tsx');
  const at = (p) => JSON.stringify(path.join(docs, p));
  fs.writeFileSync(entry, [
    "import { createElement as h } from 'react';",
    "import { renderToStaticMarkup } from 'react-dom/server';",
    `import { siteHref, siteLinks } from ${at('lib/shared.ts')};`,
    `import { fortranMdxComponents } from ${at('components/mdx/fortran.tsx')};`,
    `import { Mermaid } from ${at('components/mdx/mermaid.tsx')};`,
    'export { siteHref, siteLinks };',
    'const all = { ...fortranMdxComponents, Mermaid };',
    'export const html = (name, props, ...children) => renderToStaticMarkup(h(all[name], props, ...children));',
  ].join('\n'));
  const site = {
    name: 'site',
    setup(b) {
      // the package from this repository, whatever docs/node_modules links to
      b.onResolve({ filter: /^fumadocs-fortran\/react$/ }, () => ({ path: path.join(repo, 'react/index.js') }));
      b.onResolve({ filter: /^react(-dom)?(\/.*)?$/ }, (a) => ({ path: need.resolve(a.path) }));
      // Next's own stand-in, which a bundle outside Next lacks
      b.onResolve({ filter: /^server-only$/ }, () => ({ path: 'server-only', namespace: 'empty' }));
      b.onLoad({ filter: /.*/, namespace: 'empty' }, () => ({ contents: '' }));
    },
  };
  const bundle = path.join(dir, 'site.mjs');
  await esbuild.build({
    entryPoints: [entry], outfile: bundle, bundle: true, format: 'esm', platform: 'node', jsx: 'automatic',
    logLevel: 'silent', plugins: [site],
    // CommonJS inside an ES module bundle: React's require() calls need one
    banner: { js: "import { createRequire as __cr } from 'node:module'; const require = __cr(import.meta.url);" },
  });
  // shared.ts reads the environment as it loads: one copy of the bundle per environment
  const load = async (env, tag) => {
    const keep = { ...process.env };
    Object.assign(process.env, env);
    for (const [k, v] of Object.entries(env)) if (v === undefined) delete process.env[k];
    try {
      return await import(`${pathToFileURL(bundle).href}?${tag}`);
    } finally {
      for (const k of Object.keys(env)) {
        if (keep[k] === undefined) delete process.env[k];
        else process.env[k] = keep[k];
      }
    }
  };
  const ex = await load({ DOCS_EXPORT: '1', NEXT_PUBLIC_BASE_PATH: '/fdf' }, 'export');
  const dev = await load({ DOCS_EXPORT: undefined, NEXT_PUBLIC_BASE_PATH: undefined }, 'dev');

  // ---- siteHref
  eq(['/docs/m#a', '/docs/m', '/docs/m/', '/docs/m?x=1#a', '/', '/og/docs/image.png', '/llms.mdx/docs/content.md']
    .map((x) => ex.siteHref(x)), ['/fdf/docs/m/#a', '/fdf/docs/m/', '/fdf/docs/m/', '/fdf/docs/m/?x=1#a', '/fdf/',
    '/fdf/og/docs/image.png', '/fdf/llms.mdx/docs/content.md'],
  "siteHref: the base path, and in the export a page's trailing slash before its # or ?, as next/link writes them");
  const others = ['https://gcc.gnu.org/x.html#y', '//host/docs/m', '#a', 'docs/m', '', undefined];
  eq(others.map((x) => ex.siteHref(x)), others, 'siteHref: other links stay as they are');
  eq(dev.siteHref('/docs/m#a'), '/docs/m#a', 'siteHref: the dev server has neither base path nor trailing slash');

  // ---- the components' links
  const hrefs = (s) => [...s.matchAll(/<a\b[^>]*?\shref="([^"]*)"/g)].map((m) => m[1].replace(/&amp;/g, '&'));
  const DP = { href: '/docs/m#dp', title: 'integer, parameter :: dp = kind(1d0)' };
  const GCC = { href: 'https://gcc.gnu.org/onlinedocs/gfortran/ISO_005fFORTRAN_005fENV.html', title: 'real64' };
  eq(hrefs(ex.html('FortranArg', { name: 'x', type: 'real(dp)', refs: { dp: DP } })),
    ['/fdf/docs/m/#dp', '/fdf/docs/m/#dp'],
    'a hover card in a row (the cell and its narrow copy) links to the page with its trailing slash');
  eq(hrefs(ex.html('FortranArg', { name: 'x', type: 'real(dp)', refs: JSON.stringify({ dp: DP }) })),
    ['/fdf/docs/m/#dp', '/fdf/docs/m/#dp'], 'refs given as JSON text get the same links');
  eq(hrefs(ex.html('FortranArg', { name: 'x', type: 'real(rk)', refs: { rk: GCC } })), [GCC.href, GCC.href],
    'a hover card that links off the site keeps its link');
  ok(!ex.html('FortranArg', { name: 'x', type: 'real(dp)', refs: '{not json' }).includes('fdf-ref'),
    'refs that are not JSON give no hover cards, as without the site');
  eq(hrefs(ex.html('FortranRef', { href: '/docs/m#solve', title: 'subroutine solve' }, 'solve')),
    ['/fdf/docs/m/#solve'], 'FortranRef in a page links with the trailing slash');
  eq(hrefs(ex.html('FortranSource', { file: 'a.f90', line: 3, href: '/src/a.f90#L3' })), ['/fdf/src/a.f90#L3'],
    'a source link to a file on the site gets the base path and no slash');
  eq(hrefs(dev.html('FortranArg', { name: 'x', type: 'real(dp)', refs: { dp: DP } })), ['/docs/m#dp', '/docs/m#dp'],
    'on the dev server a hover card links as generated');
  const chart = ['flowchart LR', '  n1("solve")', '  n2("helper")', '  n1 --> n2', '  click n1 href "/docs/m#solve"',
    '  click n2 href "/docs/other"'].join('\n');
  const graph = hrefs(ex.html('Mermaid', { chart }));
  ok(graph.length >= 2 && graph.every((x) => x === '/fdf/docs/m/#solve' || x === '/fdf/docs/other/'),
    `a graph node links to the page with its trailing slash: ${JSON.stringify(graph)}`);
  ok(ex.html('Mermaid', { chart: 'sequenceDiagram\n  A->>B: hello\n  B-->>' }).includes('sequenceDiagram'),
    'a diagram Pele cannot draw is shown as its code');

  // ---- the llms files and the Markdown copies
  const md = [
    'See [`solve`](/docs/m#solve) and [Pele](https://github.com/obsidianmd/pele).',
    '<Card title="Showcase" href="/docs/showcase/modern">',
    '  click n1 href "/docs/m#solve"',
    '<FortranArg name="x" refs={{"dp":{"href":"/docs/m#dp","title":"t"}}} />',
    "refs={{ dp: { href: '/docs/m#dp', title: 't' } }}",
    '<FortranSource file="a.f90" line={3} href="https://github.com/o/r/blob/main/a.f90#L3" />',
    '<TypeTable type={{"href":{"type":"string"}}} />',
  ].join('\n');
  eq(ex.siteLinks(md).split('\n'), [
    'See [`solve`](/fdf/docs/m/#solve) and [Pele](https://github.com/obsidianmd/pele).',
    '<Card title="Showcase" href="/fdf/docs/showcase/modern/">',
    '  click n1 href "/fdf/docs/m/#solve"',
    '<FortranArg name="x" refs={{"dp":{"href":"/fdf/docs/m/#dp","title":"t"}}} />',
    "refs={{ dp: { href: '/fdf/docs/m/#dp', title: 't' } }}",
    '<FortranSource file="a.f90" line={3} href="https://github.com/o/r/blob/main/a.f90#L3" />',
    '<TypeTable type={{"href":{"type":"string"}}} />',
  ], 'siteLinks: Markdown links, href attributes, graph click lines and refs get the base path and the slash');
  eq(dev.siteLinks(md), md, 'siteLinks: on the dev server the Markdown is left as it is');

  // Code blocks are samples (the Components page shows the MDX the generator writes): their links stay as written. A
  // graph's own ```mermaid block, at any indentation, is the graph, whose click lines link; one inside a sample is not.
  const samples = [
    'See [`solve`](/docs/m#solve).',
    '```mdx',
    '<FortranRef href="/docs/m#solve" title="t">solve</FortranRef> and [x](/docs/x)',
    '```',
    '````mdx',
    '<FortranGraph title="Call graph" collapsed>',
    '```mermaid',
    '  click n2 href "/docs/m#dense"',
    '```',
    '</FortranGraph>',
    '````',
    '<FortranGraph title="Call graph">',
    '',
    '```mermaid',
    '  click n1 href "/docs/m#solve"',
    '```',
    '',
    '</FortranGraph>',
    '- a row\'s doc with its own diagram:',
    '',
    '  ~~~mermaid',
    '  click n3 href "/docs/other"',
    '  ~~~',
    'Inline ```code``` is no fence: [y](/docs/y).',
    '<Card title="Showcase" href="/docs/showcase/modern">',
  ];
  // the two lines whose links are a sample's
  const keep = new Set([2, 7]);
  const want = samples.map((l, i) => (keep.has(i) ? l : l
    .replace('(/docs/m#solve)', '(/fdf/docs/m/#solve)').replace('"/docs/m#solve"', '"/fdf/docs/m/#solve"')
    .replace('"/docs/other"', '"/fdf/docs/other/"').replace('(/docs/y)', '(/fdf/docs/y/)')
    .replace('"/docs/showcase/modern"', '"/fdf/docs/showcase/modern/"')));
  eq(ex.siteLinks(samples.join('\n')).split('\n'), want,
    "siteLinks: code samples keep their links, and the graphs' own mermaid blocks and the text around them do not");
}
