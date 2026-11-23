// Large references (guides/large-references.mdx) on the site Set up your site left: first the search route renamed with
// the types of Get started's development server left in .next/dev, a build that stops with the error the page quotes;
// then the guide, and a build whose search index is out/api/search.json alone, with a client chunk that fetches
// /api/search.json, which npm start sends as application/json, gzipped, and whose pages hold the hidden element that
// gives the table of contents its column, ahead of the article. The phase then gives the site back the template's
// search route and dialog, as the GitHub Pages guide starts from them; the sidebar's prefetch and the column stay.
import fs from 'node:fs';
import http from 'node:http';
import path from 'node:path';
import { spawn } from 'node:child_process';

// the class that gives the docs layout its table of contents' column, which the guide puts on a hidden element
const TOC_COLUMN = 'xl:layout:[--fd-toc-width:268px]';

/**
 * A file of the export as the site's npm start serves it (serve, as Get started's step 7 runs it, on port 3000), asked
 * for with Accept-Encoding: gzip, as a browser asks: its status, Content-Type, Content-Encoding and the bytes sent.
 * serve gives a file the type of its extension and compresses by type, as nginx does: a file without an extension
 * goes with no type, uncompressed. The server is stopped, and its output logged.
 */
async function served(ctx, url) {
  const child = spawn('sh', ['-c', 'npm start'], { cwd: ctx.site, env: ctx.env, detached: true });
  let text = '';
  child.stdout.on('data', (d) => (text += d));
  child.stderr.on('data', (d) => (text += d));
  const get = (u) => new Promise((ok) => {
    const req = http.get({ host: 'localhost', port: 3000, path: u, headers: { 'accept-encoding': 'gzip' } }, (res) => {
      let bytes = 0;
      res.on('data', (d) => (bytes += d.length));
      res.on('end', () => ok({ status: res.statusCode, type: res.headers['content-type'] ?? '',
        encoding: res.headers['content-encoding'] ?? '', bytes }));
    });
    req.on('error', () => ok({ status: 0, type: '', encoding: '', bytes: 0 }));
  });
  try {
    for (let i = 0; i < 120; i++) {
      if ((await get('/')).status === 200) return await get(url);
      await new Promise((ok) => setTimeout(ok, 500));
    }
    return { status: 0, type: '', encoding: '', bytes: 0 };
  } finally {
    for (const [sig, wait] of [['SIGINT', 1500], ['SIGKILL', 300]]) {
      try {
        process.kill(-child.pid, sig);
      } catch {
        // gone
      }
      await new Promise((ok) => setTimeout(ok, wait));
    }
    fs.writeFileSync(path.join(ctx.logDir, 'npm-start.log'), `$ npm start (in docs)\n${text}`);
  }
}

export default {
  name: 'large-references',
  async run(ctx) {
    const page = ctx.page('guides/large-references.mdx');
    const routes = path.join(ctx.site, 'app', 'api');
    const dialog = 'docs/components/search.tsx';
    const template = { dialog: ctx.read(dialog) };
    const templateRoute = fs.existsSync(path.join(routes, 'search'));
    if (!ctx.expect(templateRoute, "the site's search route is not the template's")) return;

    // the search route renamed, with the types that Get started's development server wrote in .next/dev left: the
    // build stops with the message the page quotes, and the folder takes its name back for the guide's steps
    const typesError = "Cannot find module '../../../app/api/search/route.js'";
    fs.renameSync(path.join(routes, 'search'), path.join(routes, 'search.json'));
    const stale = ctx.build({ allowFail: true, label: 'the search route renamed, the dev types left' });
    fs.renameSync(path.join(routes, 'search.json'), path.join(routes, 'search'));
    ctx.expect(page.text.includes(typesError) && stale.code !== 0 && stale.out.includes(typesError),
      `the search route renamed with .next/dev left: the build ${stale.code === 0 ? 'passed' : 'failed'} without `
      + `"${typesError}", which the page quotes`);

    try {
      // the guide, which ends with a build
      const r = await ctx.follow(page, { sections: ['search', 'prefetch', 'toc-column', 'check'] });
      if (!r.ok) return;
      ctx.expect(ctx.exists('docs/app/api/search.json/route.ts') && !ctx.exists('docs/app/api/search'),
        'the search route is not docs/app/api/search.json/route.ts alone');
      ctx.expect(ctx.read('docs/app/docs/layout.tsx').includes('sidebar={{ prefetch: false }}'),
        "the docs layout's sidebar still prefetches");

      // the search index under its name, with no extension-less copy, and the dialog's chunk that fetches it
      const index = path.join(ctx.site, 'out', 'api', 'search.json');
      ctx.expect(fs.existsSync(index) && !ctx.exists('docs/out/api/search'),
        'the export\'s search index is not out/api/search.json alone');
      const chunks = path.join(ctx.site, 'out', '_next', 'static', 'chunks');
      const fetched = fs.existsSync(chunks) && fs.readdirSync(chunks).some((f) => f.endsWith('.js')
        && fs.readFileSync(path.join(chunks, f), 'utf8').includes('"/api/search.json"'));
      ctx.expect(fetched, 'no client chunk fetches "/api/search.json"');
      // and as a server that compresses by type sends it: npm start (serve)
      const sent = await served(ctx, '/api/search.json');
      const size = fs.existsSync(index) ? fs.statSync(index).size : 0;
      const said = `${sent.status}, ${sent.type || 'no Content-Type'}, ${sent.encoding || 'no Content-Encoding'}, `
        + `${sent.bytes} bytes sent for a file of ${size}`;
      ctx.note(`  npm start, /api/search.json: ${said}`);
      ctx.expect(sent.status === 200 && /^application\/json\b/.test(sent.type) && sent.encoding === 'gzip'
        && sent.bytes < size, `npm start does not send /api/search.json as application/json, gzipped: ${said}`);

      // the table of contents' column from the first paint: a hidden element ahead of the article, with the class
      // that the page's table of contents carries (#nd-toc, or #nd-toc-placeholder on a page without headings), so
      // that a fumadocs-ui whose table of contents takes another class fails here
      const html = ctx.outHtml('/docs/api') ?? '';
      const column = html.indexOf(`<div hidden="" class="${TOC_COLUMN}"></div>`);
      ctx.expect(column >= 0 && column < html.indexOf('id="nd-page"'), 'no hidden element with the class of the '
        + `table of contents, ${TOC_COLUMN}, ahead of the article of /docs/api`);
      const toc = /<div [^>]*\bid="nd-toc(?:-placeholder)?"[^>]*>/.exec(html)?.[0] ?? '';
      ctx.expect(toc.split(/["\s]/).includes(TOC_COLUMN),
        `the table of contents of /docs/api lacks ${TOC_COLUMN}, the class the guide gives: ${toc}`);
    } finally {
      // the template's search route and dialog again, for the GitHub Pages guide, and no development types that name
      // the guide's
      if (fs.existsSync(path.join(routes, 'search.json'))) {
        fs.renameSync(path.join(routes, 'search.json'), path.join(routes, 'search'));
      }
      ctx.write(dialog, template.dialog);
      fs.rmSync(path.join(ctx.site, '.next', 'dev'), { recursive: true, force: true });
      // and no export with the guide's index in it, which the next build would otherwise find beside its own
      fs.rmSync(path.join(ctx.site, 'out'), { recursive: true, force: true });
    }
  },
};
