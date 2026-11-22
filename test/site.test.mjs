// The docs site: the checks its build runs first (docs/package.json's check script), what its pages say about the
// package against the package, its stylesheet and the generated pages, and the width of the docs' prose, then its own
// code (docs/lib/shared.ts, docs/components/mdx): the links next/link
// never sees, those of hover cards, source headers, graph nodes and the llms files, get what it gives the others,
// the base path the site is served under and, in the static export, a page's trailing slash, so that a link to an
// anchor of the page being read only scrolls; the search index's route, api/search.json, and the path the search
// dialog fetches it from; and the search records of its pages. The site's modules are bundled with esbuild, with one
// React; that part needs the site's node_modules (scripts/docs.sh keeps them in a Docker volume) and is skipped without
// them.
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { createRequire } from 'node:module';
import { pathToFileURL } from 'node:url';

export default async function ({ ok, eq, here, out }) {
  const repo = path.join(here, '..');
  const docs = path.join(repo, 'docs');
  const read = (p) => fs.readFileSync(path.join(repo, p), 'utf8');

  // ---- the docs checks, which need no packages: the site's build runs them as its prebuild (npm run check), and so
  // does this test, with node: check-docs (the pages against the code and the house rules), gen-examples --check (Doc
  // comments' examples), check-cli (Command line), check-api (JavaScript API) and check-readme (the README and the
  // contributor guide)
  const checks = (JSON.parse(read('docs/package.json')).scripts?.check ?? '').split('&&')
    .map((c) => c.trim().split(/\s+/));
  eq(checks.map(([node, script]) => `${node} ${script}`), ['check-docs', 'gen-examples', 'check-cli', 'check-api',
    'check-readme'].map((n) => `node scripts/${n}.mjs`), "the site's check script runs the five docs checks");
  for (const [, script, ...args] of checks) {
    const r = spawnSync(process.execPath, [script, ...args], { cwd: docs, encoding: 'utf8' });
    const said = `${r.stdout}${r.stderr}`.trim().split('\n');
    ok(r.status === 0, `docs/${[script, ...args].join(' ')} passes: ${said.slice(-15).join('\n')}`);
  }

  // a section of a page: its heading's line (an explicit [#id] after it is left out of the match) and what follows,
  // up to the next heading as deep or deeper
  const sectionOf = (text, heading) => {
    const lines = text.split('\n');
    const at = lines.findIndex((l) => l.replace(/\s*\[#[^\]]+\]\s*$/, '') === heading);
    if (at < 0) return '';
    const depth = /^#+/.exec(heading)[0].length;
    const end = lines.findIndex((l, i) => i > at && new RegExp(`^#{1,${depth}}\\s`).test(l));
    return lines.slice(at, end < 0 ? lines.length : end).join('\n');
  };

  // ---- the Components page
  const comp = read('docs/content/docs/reference/components.mdx');
  const section = (heading) => {
    const i = comp.indexOf(`\n${heading}\n`);
    const ends = ['\n## ', '\n### '].map((h) => comp.indexOf(h, i + 1)).filter((j) => j > i);
    return i < 0 ? '' : comp.slice(i, Math.min(...ends, comp.length));
  };
  // what the page draws: its text without the code blocks, whose MDX is only shown
  const unfenced = (s) => s.replace(/^(`{3,})[^\n]*\n[\s\S]*?\n\1[ \t]*$/gm, '');
  const refSection = section('## FortranRef');
  // every FortranRef of the section outside its code blocks is in an expression: the three examples, the last a
  // sentence that starts with text
  const live = unfenced(refSection);
  const refsIn = (s) => (s.match(/<FortranRef\b/g) ?? []).length;
  const examples = [...live.matchAll(/\{<>([\s\S]*?)<\/>\}/g)].map((m) => m[1]).filter(refsIn);
  ok(refSection && !refSection.includes('<Tabs') && examples.length === 3
    && examples.reduce((n, e) => n + refsIn(e), 0) === refsIn(live),
  'the live FortranRef examples stand outside Tabs, whose box clips a card, as expressions, which search leaves out');
  // the Mermaid component that Set up your site gives a site, in full
  const setUp = sectionOf(read('docs/content/docs/guides/site-setup.mdx'), '## Draw the graphs');
  const snippet = /```tsx title="(?:docs\/)?components\/mdx\/mermaid\.tsx"\n([\s\S]*?)\n```/.exec(setUp)?.[1] ?? '';
  ok(/\bcatch\b/.test(snippet) && /<CodeBlock\b/.test(snippet),
    'the Mermaid component of Set up your site shows a diagram Pele cannot parse as its code');
  const shownCss = /```css title="app\/global.css"\n(\.pele[^\n]*\{[\s\S]*?\n\})\n```/.exec(comp)?.[1];
  ok(!!shownCss && read('docs/app/global.css').includes(shownCss), "the Pele block the page shows is the site's own");
  ok(!/title: \{\s*type: 'string',\s*required: true/.test(section('### Props of FortranGraph')),
    "FortranGraph's title is optional");
  // a link without the base path leaves the site; one without the slash reloads the page it is on
  const publish = read('docs/content/docs/guides/github-pages.mdx');
  const based = sectionOf(publish, "## Keep the reference's links on the site");
  ok(/off the site/.test(based) && /redirect/.test(based),
    "Publish on GitHub Pages' section on the components' links says what a link lacking the base path does, and what "
    + 'one lacking the slash does');
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

  // ---- the Meanings section against style.css: the terms it lists, the rule it shows, and what it quotes
  const meanings = section('## Meanings');
  // the terms of the stylesheet's meanings, :where([data-term='…'], …) { --fdf-mean: … }
  const meaningRule = /:where\(((?:\[data-term='[^']+'\](?:\[data-arg\])?(?:,\s*)?)+)\)\s*\{\s*--fdf-mean:/g;
  const terms = new Set([...css.matchAll(meaningRule)]
    .flatMap((m) => [...m[1].matchAll(/\[data-term='([^']+)'\]/g)].map((t) => t[1])));
  const listed = new Set([...meanings.matchAll(/`([a-z][\w-]*)`/g)].map((m) => m[1]));
  const unlisted = [...terms].filter((t) => !listed.has(t));
  ok(terms.size > 0 && !unlisted.length,
    `the Meanings section names every term style.css has a meaning for: ${unlisted}`);
  const hdf5 = /```css title="app\/global.css"\n(\[data-term='hdf5'\] \{[\s\S]*?\n\})\n```/.exec(comp)?.[1];
  ok(!!hdf5 && read('docs/app/global.css').includes(hdf5) && /<FortranBadge kind="hdf5"/.test(unfenced(comp)),
    "the HDF5 meaning the page shows is the site's own, for a badge the page draws");
  // a quote follows its pill, with no other code between them: the stylesheet's own words, its strings run together
  const flat = meanings.replace(/\s+/g, ' ');
  const quote = (pill) => new RegExp(`\`${pill.replace(/[()*]/g, '\\$&')}\`[^\`"]*"([^"]*)"`).exec(flat)?.[1]
    .replace(/\\(.)/g, '$1');
  const meaning = (term) => {
    const m = new RegExp(`:where\\(\\[data-term='${term}'\\]\\) \\{\\s*--fdf-mean: ((?:"[^"]*"\\s*)+);`).exec(css);
    return m && [...m[1].matchAll(/"([^"]*)"/g)].map((s) => s[1]).join('');
  };
  const quoted = [quote('allocatable'), quote('character(*)')];
  const meant = [meaning('allocatable'), meaning('assumed-length')];
  ok(meant.every(Boolean) && quoted.every((q, i) => q === meant[i]),
    `the Meanings section quotes style.css's meanings of allocatable and of the * of character(*): ${quoted}`);
  const preview = /<Tab value="Preview">\s*<FortranArgs>([\s\S]*?)<\/FortranArgs>/
    .exec(section('## FortranArgs and FortranArg'))?.[1] ?? '';
  ok(/attrs="[^"]*\ballocatable\b/.test(preview) && preview.includes('dims="(lda,*)"')
    && preview.includes('type="character(*)"'),
  'the FortranArg preview has the allocatable, (lda,*) and character(*) whose meanings the Meanings section quotes');
  // its type parameters' rows, drawn and shown as MDX, as the generator writes them: the type with kind or len, and a
  // default as the one attribute
  const paramRow = new RegExp('<FortranArg name="(\\w+)" type="([^"]*)"(?: attrs="([^"]*)")? '
    + 'decl="integer, (kind|len) :: (\\w+)(?: = (\\w+))?"(?: /)?>', 'g');
  const params = [...comp.matchAll(paramRow)];
  ok(params.some((m) => m[4] === 'kind' && m[6]) && params.every((m) => m[1] === m[5] && m[2] === `integer, ${m[4]}`
    && (m[3] ?? '') === (m[6] ? `default ${m[6]}` : '')),
  "the Components page shows its type parameters' rows as the generator writes them");

  // ---- the home page's sample, against the generated entry of the same procedure
  const home = read('docs/app/(home)/page.tsx');
  const sk = read('docs/content/docs/showcase/modern/solver_kernels.mdx');
  const at0 = sk.indexOf('### norm2_parallel');
  const generated = at0 < 0 ? '' : sk.slice(at0, sk.indexOf('\n### ', at0 + 1));
  ok(generated.includes('<FortranArgs'), 'the Showcase has the entry of norm2_parallel');
  eq([...generated.matchAll(/columns="[^"]*"|decl="[^"]*"/g)].map((m) => m[0]).filter((a) => !home.includes(a)), [],
    "the home page's sample has the generated columns and declarations");
  ok(/name="nrm"[^>]*\sresult\s/.test(home), "the sample's result row is a result");
  ok(/refs=\{dp\}/.test(home) && home.includes("title: 'dp ⇒ real64'"), "the sample's dp has its hover card");
  // its cards are the generated ones: those of the rows, MPI_Comm's from the registry among them, each row's in the
  // object its refs name, whose notes the sample writes with the line it reads from the file, and that of the Calls
  // line
  const file = /^const FILE = '([^']+)';$/m.exec(home)?.[1] ?? '';
  const noted = (r, text) => {
    const at = r.note ? r.note.lastIndexOf(` ${file}:`) : -1;
    return !r.note || (!!file && at > 0 && /^\d+$/.test(r.note.slice(at + file.length + 2))
      && text.includes(`\`${r.note.slice(0, at)} \${FILE}:`));
  };
  const cards = [...generated.matchAll(/<FortranArg name="(\w+)"[^>]* refs=\{(\{.*?\})\}(?: \/)?>/g)]
    .flatMap((m) => Object.entries(JSON.parse(m[2])).map(([n, r]) => [m[1], n, r]));
  const uncarded = cards.filter(([row, n, r]) => {
    const v = new RegExp(`name="${row}"[^>]*\\srefs=\\{(\\w+)\\}`).exec(home)?.[1];
    const text = v && new RegExp(`\\n  const ${v}: Record<string, FortranRefTarget> = \\{(\\n[\\s\\S]*?)\\n  \\};`)
      .exec(home)?.[1];
    return !text?.includes(`\n    ${n}: {`) || !noted(r, text)
      || !['href', 'title', 'detail'].every((k) => text.includes(`${k}: '${r[k]}'`));
  }).map(([row, n]) => `${row}: ${n}`);
  ok(cards.some(([, n]) => n === 'MPI_Comm') && !uncarded.length,
    `the home page's sample has the cards of the generated rows, MPI_Comm's among them: ${uncarded}`);
  const call = /\*\*Calls:\*\* <FortranRef href="([^"]+)" title="([^"]+)" detail="([^"]+)">/.exec(generated);
  ok(!!call && [`href="${call[1]}"`, `title="${call[2]}"`, `detail="${call[3]}"`].every((a) => home.includes(a)),
    "the home page's Calls line has the generated library card of MPI_Allreduce");
  const calls = '<FortranGraph title="Call graph" collapsed>';
  ok(generated.includes(calls) && home.includes(calls), 'the sample has the call graph, collapsed, as the generated entry');
  ok(/<FortranSource[^>]*>\s*\{code\}\s*<\/FortranSource>/.test(home),
    'the sample has a source block that opens to the code');
  const intro = read('docs/content/docs/index.mdx');
  ok(['hover card', 'graphs', 'block that opens', 'table of contents'].every((w) => intro.includes(w)),
    "the Introduction's list of what a page holds names the rows' cards, the graphs, the source and the kind letters");

  // ---- the prose of the docs keeps to 120 characters a line: the hand-written pages (the Showcase's reference and its
  // sources page are generated, its index is not), the READMEs, the contributor guide and CHANGELOG, outside code
  // blocks, JSX lines, Markdown tables and TypeTable props, whose descriptions are a string each. PLAN.md is left out:
  // some of its lines, older than this check, are longer.
  const longLines = (name) => {
    const out = [];
    let fence = '';
    let props = false;
    read(name).split('\n').forEach((line, i) => {
      const t = line.trim();
      const open = /^(`{3,}|~{3,})/.exec(t)?.[1];
      if (fence) {
        if (open && open[0] === fence[0] && open.length >= fence.length && t === open) fence = '';
        return;
      }
      if (open) {
        fence = open;
        return;
      }
      if (/^<TypeTable\b/.test(t)) props = true;
      if (props) {
        if (t === '/>') props = false;
        return;
      }
      if (!/^[<{|]/.test(t) && line.length > 120) out.push(`${name}:${i + 1} (${line.length})`);
    });
    return out;
  };
  // the generated pages, as docs/lib/source.ts's isGenerated has them
  const generatedPage = (p) => p.startsWith('docs/content/docs/showcase/modern/')
    || p === 'docs/content/docs/showcase/sources.mdx';
  const mdx = (dir) => fs.readdirSync(path.join(repo, dir), { withFileTypes: true }).flatMap((d) => {
    const p = `${dir}/${d.name}`;
    if (d.isDirectory()) return mdx(p);
    return p.endsWith('.mdx') && !generatedPage(p) ? [p] : [];
  });
  const prose = [...mdx('docs/content/docs'), 'README.md', 'CHANGELOG.md', 'docs/README.md', 'docs/CONTRIBUTING.md'];
  const long = prose.flatMap(longLines);
  ok(['reference/components.mdx', 'showcase/index.mdx'].every((p) => prose.includes(`docs/content/docs/${p}`))
    && !prose.some(generatedPage) && !long.length, `the prose of the docs keeps to 120 characters a line: ${long}`);

  // ---- the search index, which the search dialog fetches whole on its first search: exported as api/search.json,
  // which a server that compresses by type (nginx, serve) sends as application/json, compressed, where api/search, the
  // name in Fumadocs' templates, has no extension and goes uncompressed; and fetched by the dialog under the base path
  const routes = fs.readdirSync(path.join(docs, 'app', 'api'), { recursive: true })
    .map((p) => p.split(path.sep).join('/')).filter((p) => /(^|\/)route\.[jt]sx?$/.test(p)).sort();
  eq(routes, ['search.json/route.ts'], "the site's routes under app/api: the search index's alone, named search.json");
  ok(read('docs/components/search.tsx').includes('staticClient({ from: `${basePath}/api/search.json` })'),
    'the search dialog fetches the index from ${basePath}/api/search.json');

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
  // the shape's words the Meanings section quotes are the components' own
  const lda = /data-term="shape" data-arg="([^"]*)"/
    .exec(ex.html('FortranArg', { name: 'a', type: 'real(dp)', dims: '(lda,*)' }))?.[1];
  ok(!!lda && quote('(lda,*)') === lda, `the Meanings section quotes the components' words for (lda,*): ${lda}`);

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
    'A sample in inline code, `[z](/docs/z)`, keeps its link, and [y](/docs/y) does not.',
  ];
  // the two lines whose links are a sample's (the last line's inline code is one too: its replace finds nothing)
  const keep = new Set([2, 7]);
  const want = samples.map((l, i) => (keep.has(i) ? l : l
    .replace('(/docs/m#solve)', '(/fdf/docs/m/#solve)').replace('"/docs/m#solve"', '"/fdf/docs/m/#solve"')
    .replace('"/docs/other"', '"/fdf/docs/other/"').replace('(/docs/y)', '(/fdf/docs/y/)')
    .replace('"/docs/showcase/modern"', '"/fdf/docs/showcase/modern/"')));
  eq(ex.siteLinks(samples.join('\n')).split('\n'), want,
    "siteLinks: code samples keep their links, and the graphs' own mermaid blocks and the text around them do not");

  // ---- the search records of the pages, compiled with the site's MDX options and read as the static index
  // (app/api/search.json/route.ts) reads them. fumadocs keeps a component's element in the records as an HTML tag with
  // its attributes; the site keeps the text of the Fortran components alone (an argument's docs, the names on a Calls
  // line), so that search shows no markup and the index is smaller. The records are otherwise fumadocs' own.
  const { loadSite } = await import(pathToFileURL(path.join(repo, 'scripts/search/records.mjs')).href);
  const search = await loadSite({ docs, out: path.join(dir, 'records') });
  // a page with Markdown images: fumadocs leaves them out of its records, as the site's build does with this
  // paragraph, and the records are read although the images are not where the build would find them
  let pictured;
  try {
    pictured = (await search.records('## Figures\n\nA graph ![graph](/graph.png) and the same ![graph](./graph.png).\n',
      'site')).contents.map((r) => r.content);
  } catch (e) {
    pictured = String(e.message).slice(0, 120);
  }
  eq(pictured, ['A graph  and the same .'], 'the search records of a page with Markdown images, without the images');
  const pagesIn = (d) => fs.readdirSync(path.join(repo, d), { withFileTypes: true })
    .flatMap((e) => (e.isDirectory() ? pagesIn(`${d}/${e.name}`) : e.name.endsWith('.mdx') ? [`${d}/${e.name}`] : []));
  // a Fortran component's tag as fumadocs writes it into a record (its text attributes, in quotes with " escaped), or
  // a code span, whose text is the page's own, such as the Components page's `<FortranArg>`
  const tagOrCode = /(?<!`)(`+)(?!`)[\s\S]*?(?<!`)\1(?!`)|<\/?Fortran[A-Z]\w*(?:\s+[\w-]+(?:="[^"]*")?)*\s*\/?>/g;
  const cutTags = (s) => s.replace(tagOrCode, (m, code) => (code ? m : ''));
  const tags = (sd) => [...sd.headings, ...sd.contents].filter((r) => cutTags(r.content) !== r.content);
  const norm = (rs, cut) => rs.map((r) => ({ ...r, content: (cut ? cutTags(r.content) : r.content)
    .replace(/\s+/g, ' ').trim() })).filter((r) => r.content);
  const tagged = [];
  const changed = [];
  let fumadocsTags = 0;
  let solver;
  for (const page of pagesIn('docs/content/docs')) {
    const text = read(page);
    const own = await search.records(text, 'site');
    const defaults = await search.records(text, 'defaults');
    if (page.endsWith('/solver_kernels.mdx')) solver = own;
    tagged.push(...tags(own).map((r) => `${page}: ${r.content.slice(0, 80)}`));
    fumadocsTags += tags(defaults).length;
    // fumadocs' records with the Fortran tags taken out, and those it leaves empty dropped
    const same = ['headings', 'contents'].every((k) => JSON.stringify(norm(own[k], false))
      === JSON.stringify(norm(defaults[k], true)));
    if (!same) changed.push(page);
  }
  ok(fumadocsTags > 0 && !tagged.length,
    `the search records hold no tag of a Fortran component, which fumadocs' own options keep: ${tagged.slice(0, 3)}`);
  eq(changed, [], "the search records are fumadocs' own, less the Fortran components' tags");
  // norm2_parallel's entry (generated, above): its heading, its Calls line with the name and without the card, and its
  // arguments' docs
  const callsLine = /^\*\*Calls:\*\* .*$/m.exec(generated)?.[0] ?? '';
  const callsText = callsLine.replace(/<FortranRef\b(?:\s+\w+(?:="[^"]*")?)*\s*>([\s\S]*?)<\/FortranRef>/g, '$1');
  const argDocs = [...generated.matchAll(/^<FortranArg\b[^\n]*[^/]>\n\n([\s\S]*?)\n\n<\/FortranArg>$/gm)]
    .map((m) => m[1]);
  const under = solver?.contents.filter((r) => r.heading === 'norm2_parallel').map((r) => r.content) ?? [];
  ok(!!solver?.headings.some((h) => h.id === 'norm2_parallel') && callsLine.includes('<FortranRef')
    && under.includes(callsText) && callsText.includes('`MPI_Allreduce`') && argDocs.length > 0
    && argDocs.every((d) => under.includes(d)),
  "norm2_parallel's records keep its heading, the MPI_Allreduce of its Calls line without the card, and its arguments'"
    + ` docs: ${JSON.stringify(under)}`);
}
