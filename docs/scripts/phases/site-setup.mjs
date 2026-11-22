// Set up your site (guides/site-setup.mdx) on the site Get started made: the guide's commands and files in its order,
// a build whose reference has maths, graphs, kind letters and directive lines, and each row of its Check the result
// table, the piece taken out again with the error or symptom the row names, before the rest of the guide (large
// references, the template tidied) and a last build.
import fs from 'node:fs';
import path from 'node:path';

// a hand-written page with a command of katexMacros, for the row of the macros
const MATHS_PAGE = 'docs/content/docs/check-maths.mdx';
const MATHS = '---\ntitle: Maths check\n---\n\nA norm, $\\norm{x}$, set with the package\'s macros.\n';

/** The exported CSS, all of it. */
function css(site) {
  const out = [];
  const walk = (d) => {
    for (const e of fs.existsSync(d) ? fs.readdirSync(d, { withFileTypes: true }) : []) {
      const p = path.join(d, e.name);
      if (e.isDirectory()) walk(p);
      else if (e.name.endsWith('.css')) out.push(fs.readFileSync(p, 'utf8'));
    }
  };
  walk(path.join(site, 'out', '_next'));
  return out.join('\n');
}

/** The markers summed over the exported reference pages, and the maths page's KaTeX errors. */
function measure(ctx) {
  const sum = {};
  for (const { url } of ctx.refPages()) {
    const html = ctx.outHtml(url) ?? '';
    for (const m of ['katex', 'katexError', 'peleSvg', 'mermaidCode', 'tocLetters', 'directive', 'args', 'badge']) {
      sum[m] = (sum[m] ?? 0) + ctx.count(html, m);
    }
  }
  const maths = ctx.outHtml('/docs/check-maths') ?? '';
  const sheet = css(ctx.site);
  return {
    ...sum,
    mathsPage: maths.length > 0,
    mathsKatex: ctx.count(maths, 'katex'),
    // KaTeX sets a command it lacks in its error colour, #cc0000, or the whole formula as an error
    mathsErrors: ctx.count(maths, 'katexError') + ctx.count(maths, '#cc0000'),
    katexCss: /\.katex[\s{,.:]/.test(sheet),
    fdfCss: /\.fdf-args[\s{,.:]/.test(sheet),
  };
}

const replace = (from, to) => (text) => {
  if (!text.includes(from)) throw new Error(`the file has no "${from}" to seed`);
  return text.replace(from, to);
};

export default {
  name: 'site-setup',
  async run(ctx) {
    const page = ctx.page('guides/site-setup.mdx');
    ctx.write(MATHS_PAGE, MATHS);
    try {
      const generated = '7 files (6 changed, 0 removed) from 3 sources';
      const r = await ctx.follow(page, {
        sections: ['install', 'packages', 'components', 'graphs', 'stylesheets', 'mdx-options', 'kind-letters',
          'generate'],
        expect: [['npm exec --prefix docs -- fumadocs-fortran generate', generated]],
      });
      if (!r.ok) return;

      // the reference with every piece
      const all = measure(ctx);
      ctx.note(`  with every piece: ${JSON.stringify(all)}`);
      for (const { url } of ctx.refPages()) {
        const html = ctx.outHtml(url);
        if (html === null) ctx.fail(`out: no page for ${url}`);
        else ctx.note(`  ${ctx.checkPage('out', url, 200, html)}`);
      }
      ctx.expect(all.katex > 0 && all.katexError === 0, `maths: ${all.katex} formulas set, ${all.katexError} errors`);
      ctx.expect(all.mathsPage && all.mathsKatex > 0 && all.mathsErrors === 0,
        `the maths page: \\norm{x} not set with the macros (${all.mathsKatex} formulas, ${all.mathsErrors} errors)`);
      ctx.expect(all.peleSvg > 0 && all.mermaidCode === 0, `graphs: ${all.peleSvg} drawn, ${all.mermaidCode} as code`);
      ctx.expect(all.tocLetters > 0, 'no kind letters in the tables of contents');
      ctx.expect(all.directive > 0, 'no directive line marked in the source blocks');
      ctx.expect(all.katexCss && all.fdfCss, `the stylesheets: KaTeX's ${all.katexCss}, the package's ${all.fdfCss}`);

      // each row of Check the result: the piece taken out, and what the row says follows; the build errors one at a
      // time, the symptoms in one build
      const table = page.text.slice(page.text.indexOf('## Check the result'));
      const errors = [
        ['remark-math in `remarkPlugins`', 'docs/lib/source.ts', replace('[remarkMath, remarkMdxMermaid]', '[remarkMdxMermaid]'),
          /Could not parse expression with acorn/, 'Could not parse expression with acorn'],
        ['`Mermaid` in the components', 'docs/components/mdx.tsx', replace('    Mermaid,\n', ''),
          /Expected component `Mermaid` to be defined/, 'Expected component Mermaid to be defined'],
        ['`fortranComponents`', 'docs/components/mdx.tsx', replace('    ...fortranComponents,\n', ''),
          /Expected component `Fortran\w+` to be defined/, 'Expected component FortranBadge to be defined'],
        ['the `fortran` field of the schema', 'docs/lib/source.ts', (t) => t.replace(
          /    schema: pageSchema\.extend\(\{\n[^\n]*\n    \}\),\n/, '    schema: pageSchema,\n'),
        /Property 'fortran' does not exist/, "Property 'fortran' does not exist"],
      ];
      const row = (piece, quoted) => ctx.expect(table.includes(`| ${piece} |`) && table.includes(quoted),
        `the table has no row for ${piece} with "${quoted}"`);
      for (const [piece, file, edit, message, quoted] of errors) {
        row(piece, quoted);
        const undo = ctx.seed(file, edit);
        // a build as the first one after the change: TypeScript's cache of the builds before can miss a type error
        fs.rmSync(path.join(ctx.site, '.next', 'cache', '.tsbuildinfo'), { force: true });
        const b = ctx.build({ allowFail: true, label: `without ${piece}` });
        undo();
        const stops = b.code !== 0 && message.test(b.out);
        ctx.expect(stops, `without ${piece}, the build ${b.code === 0 ? 'passed' : 'failed'} without "${quoted}"`);
        if (stops) ctx.note(`  without ${piece}: the build stops with "${message.exec(b.out)[0]}"`);
      }
      const symptoms = [
        ['`katexMacros`', 'docs/lib/source.ts', replace('[[rehypeKatex, { macros: { ...katexMacros } }], ...defaults]',
          '[rehypeKatex, ...defaults]'), (m) => m.mathsErrors > 0, 'the commands in red'],
        ['`katex/dist/katex.css`', 'docs/app/layout.tsx', replace("import 'katex/dist/katex.css';\n", ''),
          (m) => !m.katexCss, 'each formula twice, unstyled'],
        ['`remarkMdxMermaid`', 'docs/lib/source.ts', replace('[remarkMath, remarkMdxMermaid]', '[remarkMath]'),
          (m) => m.mermaidCode > 0 && m.peleSvg === 0, 'graphs as Mermaid code'],
        ['`fumadocs-fortran/style.css`', 'docs/app/layout.tsx', replace("import 'fumadocs-fortran/style.css';\n", ''),
          (m) => !m.fdfCss, 'tables without their layout'],
        ['`fortranRehypeCode`', 'docs/lib/source.ts',
          replace('      rehypeCodeOptions: fortranRehypeCode(rehypeCodeDefaultOptions),\n', ''),
          (m) => m.directive === 0, 'directives in the colour of comments'],
        ['`fortranToc`', 'docs/app/docs/[[...slug]]/page.tsx',
          replace('toc={fortranToc(page.data.toc, page.data.fortran?.toc)}', 'toc={page.data.toc}'),
          (m) => m.tocLetters === 0, 'no letters'],
      ];
      const undos = symptoms.map(([, file, edit]) => ctx.seed(file, edit));
      const b = ctx.build({ allowFail: true, label: 'without the symptoms\' pieces' });
      // the last seed first, as each restores the file it found, with the seeds before it in
      for (const undo of undos.reverse()) undo();
      if (ctx.expect(b.code === 0, 'the build without the symptoms\' pieces failed')) {
        const m = measure(ctx);
        ctx.note(`  without them: ${JSON.stringify(m)}`);
        for (const [piece, , , shows, quoted] of symptoms) {
          row(piece, quoted);
          ctx.expect(shows(m), `without ${piece}, the page does not show "${quoted}"`);
        }
      }

      // the rest of the guide, then the site built again
      const rest = await ctx.follow(page, { sections: ['large', 'tidy'] });
      if (!rest.ok) return;
      ctx.expect(!ctx.exists('docs/content/docs/test.mdx'), 'test.mdx is still there');
      const last = ctx.build({ label: 'the site set up' });
      if (last.code === 0) {
        const m = measure(ctx);
        ctx.expect(m.katex > 0 && m.peleSvg > 0 && m.tocLetters > 0 && m.directive > 0 && m.katexCss && m.fdfCss,
          `the last build lost a piece: ${JSON.stringify(m)}`);
        const html = ctx.outHtml('/docs/api') ?? '';
        ctx.expect(html.includes('My Fortran code'), "the site's name, appName, is not in the navigation bar");
      }
    } finally {
      fs.rmSync(path.join(ctx.project, MATHS_PAGE), { force: true });
    }
  },
};
