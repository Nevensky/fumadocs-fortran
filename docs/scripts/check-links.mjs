// Checks a static export of the site (docs/out) as GitHub Pages serves it, under its base path:
// - every link to the site carries the base path once, a page's link has the trailing slash the export's pages have
//   (so that a link to an anchor of the page being read only scrolls), and its page and anchor exist;
// - every same-page anchor (href="#…") names an element of its page;
// - the page actions: the Markdown URL each docs page gives Copy Markdown and View as Markdown, joined with the base
//   path fumadocs-ui adds to it (import.meta.env.BASE_URL, which the build writes into the client chunk of the page
//   actions), is that page's own Markdown copy, with the base path once;
// - the absolute URLs of the metadata (canonical links, og:url, og:image and twitter:image), of sitemap.xml's <loc>
//   and of the llms files are on the site's origin, and lead to a page or file of the export as its links must. A site
//   with app/sitemap.ts must have exported sitemap.xml;
// - the search index, the JSON of Fumadocs' static search route, is a .json file, such as api/search.json, and a
//   client chunk names its path under the base path, which the search dialog fetches. A server gives a file the type
//   of its extension, and one that compresses by type sends a file without one (api/search, the route's path in
//   Fumadocs' templates) uncompressed: nginx as application/octet-stream, serve with no type. GitHub Pages compresses
//   both, so with CHECK_LINKS_HOST=github-pages an index without an extension is no problem, as for a reader's site
//   with the template's route (Publish on GitHub Pages); its path must still be one a client chunk names.
// The pages' HTML is read (links: hover cards, graph nodes, Markdown links and the rest; and what a page loads: images,
// link elements, scripts), and so are the llms files and Markdown copies (Markdown links, JSX href attributes, graph
// click lines and refs' "href"), outside code samples, code blocks and inline code alike.
//
//   node scripts/check-links.mjs [out folder] [base path] [origin]
//
// The out folder defaults to this site's out/, the base path to NEXT_PUBLIC_BASE_PATH (none when it is unset), and the
// origin to NEXT_PUBLIC_SITE_URL, or http://localhost:3000, as lib/shared.ts has it. As the postbuild script, with no
// arguments, it checks only a static export (DOCS_EXPORT=1) and does nothing otherwise. It exits 1 when it finds a
// problem.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const site = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
if (process.argv.length <= 2 && process.env.DOCS_EXPORT !== '1') {
  console.log('check-links: not a static export (DOCS_EXPORT is not 1), so there are no links to check');
  process.exit(0);
}
const out = path.resolve(process.argv[2] ?? path.join(site, 'out'));
const base = (process.argv[3] ?? process.env.NEXT_PUBLIC_BASE_PATH ?? '').replace(/\/+$/, '');
if (base && !/^\/[^/]/.test(base)) {
  console.error(`check-links: a base path starts with one /, as ${JSON.stringify(base)} does not`);
  process.exit(2);
}
// the site's origin, which its absolute URLs start with (|| and not ??, as an empty value is not a URL)
const origin = (process.argv[4] || process.env.NEXT_PUBLIC_SITE_URL || 'http://localhost:3000').replace(/\/+$/, '');
// a host that compresses a file whatever its extension, as GitHub Pages does
const compressesAll = process.env.CHECK_LINKS_HOST === 'github-pages';
if (!/^https?:\/\/[^/]+$/.test(origin)) {
  console.error(`check-links: an origin is a scheme and a host, such as https://owner.github.io, as ${origin} is not`);
  process.exit(2);
}
if (!fs.existsSync(path.join(out, 'index.html'))) {
  console.error(`check-links: ${out} holds no static export (no index.html)`);
  process.exit(2);
}

// ---- the page actions (fumadocs-ui's MarkdownCopyButton and ViewOptionsPopover), which are rendered in the browser:
// their Markdown URL is a prop in the page's payload, and they prefix it with import.meta.env.BASE_URL, the base path
// with a slash after it. Turbopack writes that object into the client chunk beside the module's own URL, as
//   {get url(){return …("…/fumadocs-ui/dist/layouts/shared/page-actions.js")},
//    env:{…,BASE_URL:"/fumadocs-fortran/",…}}.
// It is also the base path the export was built with: checked with another one, every link would be wrong.
const chunks = path.join(out, '_next', 'static', 'chunks');
const baseUrls = new Map();
// the client chunks' code, which the search index's check reads too
const chunkCode = [];
for (const name of fs.existsSync(chunks) ? fs.readdirSync(chunks).filter((n) => n.endsWith('.js')) : []) {
  const js = fs.readFileSync(path.join(chunks, name), 'utf8');
  chunkCode.push(js);
  for (const m of js.matchAll(/layouts\/shared\/page-actions\.js"[^]{0,200}?\bBASE_URL:"([^"]*)"/g)) {
    if (!baseUrls.has(m[1])) baseUrls.set(m[1], name);
  }
}
if (baseUrls.size === 1) {
  const [[built, chunk]] = [...baseUrls];
  if (built.replace(/\/$/, '') !== base) {
    console.error(`check-links: ${out} was built with the base path ${built.replace(/\/$/, '') || '(none)'} (BASE_URL `
      + `in _next/static/chunks/${chunk}), not ${base || '(none)'}: give it as the second argument, or set `
      + 'NEXT_PUBLIC_BASE_PATH as for the build');
    process.exit(2);
  }
}

const files = [];
const walk = (dir) => {
  for (const d of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, d.name);
    if (d.isDirectory()) {
      if (d.name !== '_next') walk(p);
    } else files.push(p);
  }
};
walk(out);

const idsMemo = new Map();
const idsOf = (file) => {
  if (!idsMemo.has(file)) {
    const html = fs.readFileSync(file, 'utf8');
    idsMemo.set(file, new Set([...html.matchAll(/\sid="([^"]*)"/g)].map((m) => decode(m[1]))));
  }
  return idsMemo.get(file);
};

const problems = new Map();
const problem = (kind, where, href) => {
  const k = `${kind}: ${href}`;
  if (!problems.has(k)) problems.set(k, new Set());
  problems.get(k).add(path.relative(out, where));
};
let checked = 0;
let anchors = 0;
let samples = 0;
let absolute = 0;

const decode = (s) => s.replace(/&amp;/g, '&').replace(/&quot;/g, '"').replace(/&#x27;|&#39;/g, "'");
const fragment = (s) => {
  try {
    return decodeURIComponent(s);
  } catch {
    return s;
  }
};

/**
 * An absolute URL the site gives of itself (a canonical link, Open Graph's, the sitemap's, llms.txt's): on its origin,
 * and then, without it, a link to the site like any other. A page's own links with a scheme lead off the site, such as
 * http://localhost:3000 for a reader's dev server.
 */
function checkAbsolute(url, where, kind) {
  absolute++;
  if (!(url === origin || url.startsWith(`${origin}/`))) {
    problem(`${kind} on another origin than ${origin} (built with another NEXT_PUBLIC_SITE_URL?)`, where, url);
    return false;
  }
  return check(url.slice(origin.length) || '/', where, kind);
}

/**
 * One link to the site: the base path once, a trailing slash on pages, and the page and anchor exist. Returns false
 * when it found a problem.
 */
function check(href, where, kind) {
  if (!href.startsWith('/') || href.startsWith('//')) return true;
  checked++;
  const fail = (what) => {
    problem(`${kind} ${what}`, where, href);
    return false;
  };
  if (base && !(href === base || href.startsWith(`${base}/`))) return fail('without the base path');
  const cut = href.search(/[?#]/);
  const pathname = cut < 0 ? href : href.slice(0, cut);
  const hash = cut >= 0 && href[cut] === '#' ? fragment(href.slice(cut + 1)) : '';
  const rel = pathname.slice(base.length) || '/';
  if (base && (rel === base || rel.startsWith(`${base}/`)) && !fs.existsSync(path.join(out, base.slice(1)))) {
    return fail('with the base path twice');
  }
  const isFile = /\.[^/]+$/.test(rel);
  let ok = true;
  if (!isFile && !rel.endsWith('/')) ok = fail('to a page without its trailing slash');
  const target = isFile ? path.join(out, rel) : path.join(out, rel, 'index.html');
  if (!fs.existsSync(target)) return fail('to nothing');
  if (hash && !isFile && !idsOf(target).has(hash)) return fail('to a missing anchor');
  return ok;
}

for (const f of files) {
  if (f.endsWith('.html')) {
    const html = fs.readFileSync(f, 'utf8');
    for (const [tag] of html.matchAll(/<a\b[^>]*>/g)) {
      const raw = /\shref="([^"]*)"/.exec(tag)?.[1];
      if (raw === undefined) continue;
      const href = decode(raw);
      // a same-page anchor: the table of contents, a heading's own link, the skip link, footnotes
      if (href.startsWith('#')) {
        if (href.length > 1) {
          anchors++;
          if (!idsOf(f).has(fragment(href.slice(1)))) problem('same-page anchor to a missing id', f, href);
        }
        continue;
      }
      const cls = /\sclass="([^"]*)"/.exec(tag)?.[1] ?? '';
      // Pele writes a node's link as <a href="…" rel="noopener">, with no class
      const kind = cls.includes('fdf-ref-name') ? 'hover-card link'
        : cls.includes('fdf-source') ? 'source link'
          : /\srel="noopener"/.test(tag) && !cls ? 'graph-node link' : 'link';
      check(href, f, kind);
    }
    // what the page loads: images, link elements (stylesheets, icons, preloads, a canonical URL) and scripts
    for (const [tag, name] of html.matchAll(/<(img|link|script|source)\b[^>]*>/g)) {
      const raw = /\s(?:src|href)="([^"]*)"/.exec(tag)?.[1];
      if (raw === undefined) continue;
      const rel = /\srel="([^"]*)"/.exec(tag)?.[1] ?? '';
      const what = name === 'link' ? `<link rel="${rel}">` : `<${name}>`;
      if (name === 'link' && rel === 'canonical') checkAbsolute(decode(raw), f, what);
      else check(decode(raw), f, what);
    }
    // the page's own URL and image in its Open Graph and Twitter tags
    for (const [tag] of html.matchAll(/<meta\b[^>]*>/g)) {
      const key = /\s(?:property|name)="(og:url|og:image|twitter:image)"/.exec(tag)?.[1];
      const content = /\scontent="([^"]*)"/.exec(tag)?.[1];
      if (key && content !== undefined) checkAbsolute(decode(content), f, `<meta ${key}>`);
    }
  } else if (/sitemap\.xml$/.test(f)) {
    for (const m of fs.readFileSync(f, 'utf8').matchAll(/<loc>([^<]*)<\/loc>/g)) {
      checkAbsolute(decode(m[1].trim()), f, 'sitemap <loc>');
    }
  } else if (/llms[^/]*\.txt$|content\.md$|[\\/]llms\.mdx[\\/].*\.md$/.test(f)) {
    // code samples (a fenced block other than a graph's ```mermaid, and anything inside a sample) are left as written
    const lines = fs.readFileSync(f, 'utf8').split('\n');
    let fence = '', graph = false;
    const live = lines.filter((line) => {
      const m = /^\s*(`{3,}|~{3,})\s*(\S*)/.exec(line);
      if (fence) {
        if (m && m[1][0] === fence[0] && m[1].length >= fence.length && !m[2]) { fence = ''; return false; }
        if (!graph) samples++;
        return graph;
      }
      if (m && !(m[1][0] === '`' && line.slice(line.indexOf(m[1]) + m[1].length).includes('`'))) {
        fence = m[1];
        graph = m[2].toLowerCase() === 'mermaid';
        return false;
      }
      return true;
    });
    // inline code is a sample too
    const text = live.map((line) => line.replace(/(?<!`)(`+)(?!`)(.*?[^`])\1(?!`)/g, (m) => ' '.repeat(m.length)))
      .join('\n');
    const kinds = [
      [/\]\((\/[^\s)]*)/g, 'Markdown link'],
      [new RegExp(`\\]\\((${origin.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}(?:\\/[^\\s)]*)?)\\)`, 'g'), 'absolute Markdown link'],
      [/\bhref="(\/[^"]*)"/g, 'JSX href'],
      [/\bclick\s+\S+\s+href\s+"(\/[^"]*)"/g, 'graph click line'],
      [/"href":\s*"(\/[^"]*)"/g, 'refs href'],
      [/\bhref:\s*'(\/[^']*)'/g, 'refs href'],
    ];
    for (const [re, kind] of kinds) {
      for (const m of text.matchAll(re)) {
        if (kind.startsWith('absolute')) checkAbsolute(m[1], f, `${kind} (llms)`);
        else check(m[1], f, `${kind} (llms)`);
      }
    }
  }
}
// the sitemap a site with app/sitemap.ts writes (the out folder's parent is the site)
if (fs.existsSync(path.join(path.dirname(out), 'app', 'sitemap.ts')) && !fs.existsSync(path.join(out, 'sitemap.xml'))) {
  problem('sitemap: the site has app/sitemap.ts, and the export has no sitemap.xml', path.join(out, 'sitemap.xml'),
    path.join(path.dirname(out), 'app', 'sitemap.ts'));
}

// ---- the search index: a file with no extension or a .json one whose text starts as the JSON of Fumadocs' static
// search route (staticGET) does, {"type":"advanced" (or "simple", or "i18n" for one index a language)
const INDEX_START = /^\{"type":"(?:advanced|simple|i18n)"/;
const startOf = (file) => {
  const fd = fs.openSync(file, 'r');
  try {
    const buf = Buffer.alloc(32);
    return buf.toString('utf8', 0, fs.readSync(fd, buf, 0, buf.length, 0));
  } finally {
    fs.closeSync(fd);
  }
};
let indexes = 0;
for (const f of files) {
  const ext = path.extname(f);
  if ((ext && ext !== '.json') || !INDEX_START.test(startOf(f))) continue;
  indexes++;
  const rel = path.relative(out, f).split(path.sep).join('/');
  if (!ext && !compressesAll) {
    problem('search index without an extension, which a server that compresses by type sends uncompressed (name its '
      + 'route search.json, and the search dialog\'s from)', f, `${base}/${rel}`);
  } else if (![`"${base}/${rel}"`, `\`${base}/${rel}\``, `}/${rel}\``]
    .some((s) => chunkCode.some((js) => js.includes(s)))) {
    // the dialog's from, as the build writes it: "/base/api/search.json", with the base path the export was built
    // with, or `${…}/api/search.json` when the base path comes from another module
    problem('search index whose path under the base path no client chunk names (the search dialog\'s from fetches '
      + 'another)', f, `${base}/${rel}`);
  }
}

const actions = path.join(out, 'docs');
let withActions = 0;
if (!baseUrls.size) {
  problem('page actions: no client chunk holds the BASE_URL of fumadocs-ui\'s page actions (built without Turbopack, '
    + 'or fumadocs-ui changed?)', chunks, '_next/static/chunks/*.js');
} else if (baseUrls.size > 1) {
  problem('page actions: the client chunks disagree on the BASE_URL', chunks, [...baseUrls.keys()].join(' '));
} else {
  // the page actions add the base path checked (the build's: the check before the walk found the two equal)
  const pages = files.filter((x) => x.endsWith('.html') && x.startsWith(actions + path.sep));
  if (!pages.length) problem('page actions: the export has no docs pages', out, 'docs/');
  for (const f of pages) {
    const html = fs.readFileSync(f, 'utf8');
    // the props as the payload's JSON has them, inside a script's string: \"markdownUrl\":\"/…/content.md\"
    const found = html.matchAll(/\\?"markdownUrl\\?":\\?"([^"\\]*)(\\?")?/g);
    const urls = new Set([...found].map((m) => (m[2] ? m[1] : null)));
    if (!urls.size) {
      problem('page actions: a docs page without them (no markdownUrl in its payload)', f, path.relative(out, f));
      continue;
    }
    withActions++;
    // the page's own Markdown copy: docs/a/b/index.html is llms.mdx/docs/a/b/content.md, or llms.mdx/docs/a/b.md in
    // the static template of create-fumadocs-app, whose sites the Publish on GitHub Pages guide checks with this
    const dir = path.relative(out, path.dirname(f)).split(path.sep).join('/');
    const own = [`${base}/llms.mdx/${dir}/content.md`, `${base}/llms.mdx/${dir}.md`];
    for (const url of urls) {
      if (url === null) {
        problem('page actions: a Markdown URL this check cannot read (an escape in it)', f, path.relative(out, f));
        continue;
      }
      // as fumadocs-ui's withBasePath: a URL with a scheme, or one starting with //, is left as it is
      const href = /^\w+:/.test(url) || url.startsWith('//') ? url : base + url;
      if (check(href, f, 'page actions\' Markdown URL') && !own.includes(href.split(/[?#]/)[0])) {
        problem(`page actions' Markdown URL to another page's copy (${own.join(' or ')} expected)`, f, href);
      }
    }
  }
}

let n = 0;
for (const [k, where] of [...problems].sort()) {
  n++;
  const list = [...where].slice(0, 3).join(', ') + (where.size > 3 ? `, +${where.size - 3}` : '');
  if (n <= 400) console.log(`${k}  [${list}]`);
}
console.log(`check-links: ${checked} links and assets on the site (${absolute} of them absolute URLs on ${origin}) and `
  + `${anchors} same-page anchors checked in ${files.length} files under ${base || '/'} (${samples} lines of code `
  + `samples in the llms files left out), page actions on ${withActions} pages, ${indexes} search `
  + `${indexes === 1 ? 'index' : 'indexes'}; ${problems.size} distinct problems`);
process.exit(problems.size ? 1 : 0);
