// Publish on GitHub Pages (guides/github-pages.mdx) on the site Set up your site made: the guide's files, then its
// workflow's build job run here as GitHub would run it for https://owner.github.io/my-docs/ (its run steps, with
// configure-pages' outputs and GitHub's variables given), and the export checked with docs/scripts/check-links.mjs
// under /my-docs: every link, asset, same-page anchor and the page actions' Markdown URL. Then what else the guide
// says: row cards, source links, Open Graph images, the Open in GitHub links, the search index, the old pages in
// public/, the development server under the base path (its links on it, and 404 off it) and the generated folder out
// of Git; and the three GitHub Pages entries of Troubleshooting, each seeded, with the problem check-links reports.
import fs from 'node:fs';
import path from 'node:path';
import { spawn } from 'node:child_process';

const BASE = '/my-docs';
const ORIGIN = 'https://owner.github.io';
const SHA = '0123456789abcdef0123456789abcdef01234567';
const GITHUB = { GITHUB_SERVER_URL: 'https://github.com', GITHUB_REPOSITORY: 'owner/my-docs', GITHUB_SHA: SHA };
const CARDS = 'docs/content/docs/check-cards.mdx';
const CARDS_PAGE = `---
title: Cards check
---

<FortranArgs title="Arguments" columns="type intent">
<FortranArg name="m" type="type(dense_matrix)" intent="inout" decl="type(dense_matrix), intent(inout) :: m" refs={{"dense_matrix":{"href":"/docs/api/solver_kernels#dense_matrix","title":"type dense_matrix"}}} />
</FortranArgs>

**Calls:** <FortranRef href="/docs/api/solver_kernels#dense_matrix" title="type dense_matrix">\`dense_matrix\`</FortranRef>
`;

/** The jobs of the guide's workflow and their steps, read by indentation (the guide's own layout). */
function parseWorkflow(text) {
  const jobs = {};
  let inJobs = false;
  let job = null;
  let step = null;
  let sub = null;
  const unquote = (v) => v.replace(/^(['"])(.*)\1$/, '$2');
  for (const raw of text.split('\n')) {
    const t = raw.trim();
    if (!t || t.startsWith('#')) continue;
    const indent = raw.length - raw.trimStart().length;
    const kv = /^([\w-]+):\s*(.*)$/.exec(t.replace(/^- /, ''));
    if (indent === 0) {
      inJobs = t === 'jobs:';
    } else if (!inJobs) {
      continue;
    } else if (indent === 2) {
      job = { steps: [], keys: {} };
      jobs[t.replace(/:$/, '')] = job;
      step = null;
    } else if (indent === 4 && kv) {
      job.keys[kv[1]] = unquote(kv[2]);
      step = null;
    } else if (indent === 6 && t.startsWith('- ') && kv) {
      step = { with: {}, env: {}, [kv[1]]: unquote(kv[2]) };
      job.steps.push(step);
      sub = null;
    } else if (indent === 8 && step && kv) {
      if (kv[2] === '') sub = kv[1];
      else step[kv[1]] = unquote(kv[2]);
    } else if (indent === 10 && step && sub && kv) {
      step[sub][kv[1]] = unquote(kv[2]);
    }
  }
  return jobs;
}

/** configure-pages' outputs, as GitHub gives them to a project site. */
const expressions = (s) => s
  .replace(/\$\{\{\s*steps\.pages\.outputs\.base_path\s*\}\}/g, BASE)
  .replace(/\$\{\{\s*steps\.pages\.outputs\.origin\s*\}\}/g, ORIGIN);

/**
 * The development server of Look at it under the base path, started as the page writes the command (with BASE for
 * REPOSITORY) in the top folder: the reference's pages fetched under BASE, with the links of their HTML outside its
 * scripts, and a page without the base path, which must answer 404. The server is stopped, and its output logged.
 */
async function preview(ctx, cmd) {
  const child = spawn('sh', ['-c', cmd], { cwd: ctx.project, env: ctx.env, detached: true });
  let text = '';
  child.stdout.on('data', (d) => (text += d));
  child.stderr.on('data', (d) => (text += d));
  const get = async (u) => {
    try {
      const r = await fetch(`http://localhost:3000${u}`);
      return { status: r.status, html: await r.text() };
    } catch {
      return { status: 0, html: '' };
    }
  };
  const out = { ready: false, pages: [], outside: null };
  try {
    for (let i = 0; i < 240 && !out.ready; i++) {
      out.ready = (await get(`${BASE}/docs/api/`)).status === 200;
      if (!out.ready) await new Promise((ok) => setTimeout(ok, 500));
    }
    if (out.ready) {
      for (const { url } of ctx.refPages()) {
        const r = await get(`${BASE}${url}/`);
        const hrefs = [...r.html.replace(/<script\b[\s\S]*?<\/script>/g, '').matchAll(/\bhref="(\/(?!\/)[^"]*)"/g)]
          .map((m) => m[1]);
        out.pages.push({ url, status: r.status, links: hrefs.length, off: hrefs.filter((h) => !h.startsWith(`${BASE}/`)) });
      }
      out.outside = (await get('/docs/api/')).status;
    }
  } finally {
    for (const [sig, wait] of [['SIGINT', 1500], ['SIGKILL', 300]]) {
      try {
        process.kill(-child.pid, sig);
      } catch {
        // gone
      }
      await new Promise((ok) => setTimeout(ok, wait));
    }
    fs.writeFileSync(path.join(ctx.logDir, 'preview-dev-server.log'), `$ ${cmd}\n${text}`);
  }
  return out;
}

function checkLinks(ctx, label) {
  const script = path.join(ctx.repo, 'docs', 'scripts', 'check-links.mjs');
  // the origin the workflow builds with, so that the absolute URLs of the metadata (og:image) are checked too
  return ctx.run(`node "${script}" "${path.join(ctx.site, 'out')}" ${BASE} ${ORIGIN}`, { label, allowFail: true });
}

export default {
  name: 'github-pages',
  async run(ctx) {
    const page = ctx.page('guides/github-pages.mdx');
    // pages of an old site, which the guide keeps under their addresses by copying them into docs/public/
    ctx.write('docs/public/module/old_module.html', '<!doctype html><title>old_module</title><p>FORD\'s page.</p>\n');
    // the cards the generator writes for an argument of a type of the project, which the example's public
    // procedures have none of: a card of a row, and one of a Calls line, linking to dense_matrix's entry
    ctx.write(CARDS, CARDS_PAGE);

    const r = await ctx.follow(page, { sections: ['base-path', 'links', 'graphs', 'search', 'address', 'workflow'] });
    if (!r.ok) return;

    // ---- the workflow, its build job run here
    const jobs = parseWorkflow(ctx.read('.github/workflows/docs.yml'));
    const build = jobs.build?.steps ?? [];
    const uses = build.map((s) => s.uses?.split('@')[0] ?? 'run');
    const at = (name) => uses.indexOf(name);
    const buildStep = build.find((s) => /^npm run build\b/.test(s.run ?? ''));
    ctx.expect(at('actions/checkout') === 0 && at('actions/setup-node') > 0, `the build job starts ${uses.join(', ')}`);
    ctx.expect(build[at('actions/setup-node')]?.with['node-version'] === '24', 'the workflow sets up Node.js 24');
    ctx.expect(at('actions/configure-pages') > 0 && build[at('actions/configure-pages')].id === 'pages'
      && build.indexOf(buildStep) > at('actions/configure-pages'), 'configure-pages, id pages, comes before the build');
    ctx.expect(buildStep?.env.NEXT_PUBLIC_BASE_PATH?.includes('steps.pages.outputs.base_path')
      && buildStep?.env.NEXT_PUBLIC_SITE_URL?.includes('steps.pages.outputs.origin'),
    'the build takes configure-pages\' outputs');
    ctx.expect(build.at(-1)?.uses?.startsWith('actions/upload-pages-artifact') && build.at(-1).with.path === 'docs/out',
      'the last step uploads docs/out');
    ctx.expect(jobs.deploy?.keys.needs === 'build' && jobs.deploy?.steps[0]?.uses?.startsWith('actions/deploy-pages'),
      'the deploy job needs build and deploys');
    const reference = JSON.parse(ctx.read('docs/package.json')).scripts?.reference;
    if (!ctx.expect(reference, 'docs/package.json has no reference script: Generate the reference adds it '
      + '(phases/generate.mjs)')) return;
    ctx.note(`  the reference script: ${reference}`);
    for (const s of build.filter((x) => x.run)) {
      const cmd = expressions(s.run);
      const env = { ...GITHUB, ...Object.fromEntries(Object.entries(s.env).map(([k, v]) => [k, expressions(v)])) };
      const cwd = path.join(ctx.project, s['working-directory'] ?? '.');
      const res = ctx.run(cmd, { cwd, env, label: `workflow: ${s.run}` });
      if (res.code !== 0) return;
      if (/^npm run build\b/.test(s.run)) {
        ctx.expect(!res.out.includes('metadataBase'), 'the build still warns that metadataBase is not set');
      }
    }

    // ---- the export under /my-docs
    const links = checkLinks(ctx, 'check-links');
    ctx.expect(links.code === 0 && /; 0 distinct problems/.test(links.out), `check-links under ${BASE}: `
      + `${(/check-links: [^\n]*/.exec(links.out) ?? ['no summary'])[0]}`);
    let sources = 0;
    for (const { url } of ctx.refPages()) {
      sources += (ctx.outHtml(url) ?? '').split(`https://github.com/owner/my-docs/blob/${SHA}/src/`).length - 1;
    }
    const cards = [...(ctx.outHtml('/docs/check-cards') ?? '').matchAll(/<a\b[^>]*class="fdf-ref-name[^"]*"[^>]*>/g)]
      .filter((m) => m[0].includes(`href="${BASE}/docs/api/solver_kernels/#dense_matrix"`)).length;
    ctx.note(`  hover cards linking to the reference under ${BASE}: ${cards}; source links at the commit: ${sources}`);
    // the row's card shows its link twice, in the row and in its opened declaration, and the Calls line's once
    ctx.expect(cards >= 2, `${cards} links of the page's hover cards go to the reference under ${BASE}/docs/api/`);
    ctx.expect(sources > 0, 'no source header links to src/ at the commit');
    const overview = ctx.outHtml('/docs/api') ?? '';
    ctx.expect(overview.includes(`content="${ORIGIN}${BASE}/og/docs/api/image.png"`),
      'the overview\'s Open Graph image is not at the site\'s address under the base path');
    ctx.expect((ctx.outHtml('/docs') ?? '').includes('/blob/main/docs/content/docs/index.mdx'),
      'the first page\'s Open in GitHub link lacks docs/');
    ctx.expect(!/\/blob\/main\/(docs\/)?content\/docs\/api\//.test(ctx.outHtml('/docs/api/demo') ?? ''),
      'a generated page has an Open in GitHub link');
    ctx.expect(ctx.exists('docs/out/api/search'), 'no search index at out/api/search');
    const chunks = path.join(ctx.site, 'out', '_next', 'static', 'chunks');
    // the search dialog's chunk, with the index's path under the base path, as the build writes it
    const searchFrom = fs.readdirSync(chunks).some((f) => f.endsWith('.js')
      && fs.readFileSync(path.join(chunks, f), 'utf8').includes(`"${BASE}/api/search"`));
    ctx.expect(searchFrom, `no client chunk fetches "${BASE}/api/search"`);
    ctx.expect(ctx.exists('docs/out/module/old_module.html'), 'an old page in docs/public/ is not in the export');
    fs.rmSync(path.join(ctx.site, 'public', 'module'), { recursive: true, force: true });

    // ---- Look at it under the base path: the development server as the page starts it
    const block = page.blocks.find((b) => b.lang === 'bash' && b.sections.includes('preview'));
    const shown = block ? ctx.commands(block.body)[0] : '';
    if (ctx.expect(/^NEXT_PUBLIC_BASE_PATH=\/REPOSITORY npm run --prefix docs dev$/.test(shown),
      `${page.rel}: Look at it under the base path does not start the development server with the base path`)) {
      const seen = await preview(ctx, shown.replace('/REPOSITORY', BASE));
      ctx.note(`  ${shown.replace('/REPOSITORY', BASE)}: ${seen.ready ? 'served' : 'did NOT serve'} ${BASE}/docs/api/; `
        + `${seen.pages.map((p) => `${p.url} ${p.status}, ${p.links} links, ${p.off.length} off the base path`).join('; ')}`
        + `; /docs/api/ ${seen.outside}`);
      ctx.expect(seen.ready && seen.pages.length && seen.pages.every((p) => p.status === 200 && p.links && !p.off.length),
        `the development server under ${BASE}: a reference page did not answer 200, or links off the base path `
        + `(${seen.pages.flatMap((p) => p.off).slice(0, 3).join(', ')})`);
      ctx.expect(seen.outside === 404, `the development server under ${BASE} answered ${seen.outside} to /docs/api/, `
        + 'where the page says a link that leaves the base path answers 404');
    }

    // ---- the generated folder out of Git
    const git = (cmd, o = {}) => ctx.run(`git -c user.name=test -c user.email=test@example.invalid ${cmd}`, o);
    git('init -q');
    ctx.expect(git('check-ignore -q docs/content/docs/api/index.mdx', { allowFail: true }).code === 0,
      'docs/.gitignore does not leave out the generated folder');
    ctx.expect(git('check-ignore -q docs/content/docs/index.mdx', { allowFail: true }).code !== 0,
      'docs/.gitignore leaves out the hand-written pages');
    fs.rmSync(path.join(ctx.project, '.git'), { recursive: true, force: true });

    // ---- Troubleshooting's GitHub Pages entries, seeded together: each is its own problem in check-links
    const seeded = [
      ['docs/components/mdx.tsx', (t) => t.replace("import { fortranMdxComponents } from '@/components/mdx/fortran';",
        "import { fortranComponents } from 'fumadocs-fortran/react';").replace('...fortranMdxComponents,',
        '...fortranComponents,'), /hover-card link without the base path/, 'links that leave the site'],
      ['docs/lib/shared.ts', (t) => t.replace(/const slash = [^\n]*;/, "const slash = '';"),
        /to a page without its trailing slash/, 'a page that reloads'],
      ['docs/app/docs/[[...slug]]/page.tsx', (t) => t.replace('const markdownUrl = `/llms.mdx',
        'const markdownUrl = `${process.env.NEXT_PUBLIC_BASE_PATH}/llms.mdx'),
      /page actions' Markdown URL with the base path twice/, 'Copy Markdown with the name twice'],
    ];
    for (const [file, edit] of seeded) ctx.seed(file, edit);
    const env = { NEXT_PUBLIC_BASE_PATH: BASE, NEXT_PUBLIC_SITE_URL: ORIGIN };
    const b = ctx.build({ env, label: 'seeded with the GitHub Pages entries', allowFail: true });
    if (ctx.expect(b.code === 0, 'the seeded build failed')) {
      const seededLinks = checkLinks(ctx, 'check-links, seeded');
      for (const [, , problem, entry] of seeded) {
        ctx.expect(problem.test(seededLinks.out), `seeded for "${entry}", check-links does not report ${problem}`);
      }
    }
    fs.rmSync(path.join(ctx.project, CARDS), { force: true });
  },
};
