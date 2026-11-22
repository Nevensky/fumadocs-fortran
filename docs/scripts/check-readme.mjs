// Checks the README and the contributor guide (docs/CONTRIBUTING.md), which are read on GitHub, on npm (the README
// ships in the package) and on this site (the Contributing page includes the guide):
// - their prose keeps to 120 characters a line, as test/site.test.mjs has it for the pages: outside code blocks, JSX
//   lines and Markdown tables; and each shell block holds one command, without a $ prompt;
// - their links are absolute, as only those work in all three places: a link to this site names one of its pages,
//   with the trailing slash the static export's pages have, and an anchor of that page; a link to a file or folder of
//   the repository names one that exists, and a link to an issue form one of .github/ISSUE_TEMPLATE; a same-page
//   anchor names a heading of the file;
// - the README's install line is Get started's, and the README carries Get started's status sentence (its Callout
//   titled Pre-release, or else its first) and the site's (statusSentence in docs/lib/shared.ts), so that a reader
//   gets the same install and the same status on GitHub and on the site;
// - the guide's map of the code to its pages (the section "The code and its pages") names every top folder of the
//   package (package.json's files).
//
//   node docs/scripts/check-readme.mjs
//
// It needs no packages. It exits 1 when it finds a problem, and prints one line for each.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');

/** The README and the guide, as the repository has them. */
export const FILES = ['README.md', 'docs/CONTRIBUTING.md'];
/** The page whose install line and status sentence the README repeats. */
export const GET_STARTED = 'docs/content/docs/get-started.mdx';
/** The heading of the guide's map of the code to its pages. */
export const MAP_HEADING = 'The code and its pages';
/** The site's module that holds its status sentence. */
const SHARED = 'docs/lib/shared.ts';
const CONTENT = 'docs/content/docs';
const SHELL = new Set(['bash', 'sh', 'shell', 'console', 'zsh']);
// a command that installs the package: npm install github:…/fumadocs-fortran, npm install fumadocs-fortran@0.1.0, …
const INSTALL = /^(?:npm|pnpm|yarn|bun)\s+(?:install|i|add)\b.*\bfumadocs-fortran\b/;

/** The lines of a Markdown file, each with whether it lies in a code block and, if so, the block's language. */
function scan(text) {
  const out = [];
  let fence = '';
  let lang = '';
  for (const line of text.split('\n')) {
    const t = line.trim();
    const open = /^(`{3,}|~{3,})\s*([\w-]*)/.exec(t);
    if (fence) {
      // the block ends at a run of its fence's character, at least as long, with nothing after it
      if (open && open[1][0] === fence[0] && open[1].length >= fence.length && t === open[1]) {
        out.push({ line, fence: 'close', lang });
        fence = '';
      } else out.push({ line, fence: 'in', lang });
      continue;
    }
    if (open) {
      fence = open[1];
      lang = open[2].toLowerCase();
      out.push({ line, fence: 'open', lang });
    } else out.push({ line, fence: '', lang: '' });
  }
  return out;
}

/** Text as a heading's id is made from it: inline code, emphasis and links reduced to their words. */
function plain(s) {
  return s
    .replace(/!?\[([^\]]*)\]\([^)]*\)/g, '$1')
    .replace(/`([^`]*)`/g, '$1')
    .replace(/(\*\*|__|\*|_)(?=\S)([^*_]*?\S)\1/g, '$2')
    .replace(/<[^>]+>/g, '')
    .trim();
}

/** github-slugger's slug (Fumadocs' and GitHub's heading ids), with its -1, -2 for repeats. */
function slugger() {
  const seen = new Map();
  return (text) => {
    let slug = text.toLowerCase().replace(/[^\p{L}\p{M}\p{N}\p{Pc}\- ]/gu, '').replace(/ /g, '-');
    const n = seen.get(slug);
    seen.set(slug, (n ?? -1) + 1);
    if (n !== undefined) slug = `${slug}-${n + 1}`;
    return slug;
  };
}

/** The ids of a Markdown or MDX file's headings (an explicit [#id] first) and id attributes, with its includes'. */
function idsOf(file, seen = new Set()) {
  const ids = new Set();
  if (seen.has(file) || !fs.existsSync(file)) return ids;
  seen.add(file);
  const slug = slugger();
  for (const { line, fence } of scan(fs.readFileSync(file, 'utf8'))) {
    if (fence) continue;
    const h = /^#{1,6}\s+(.*?)\s*$/.exec(line);
    if (h) {
      const custom = /\s*\[#([^\]\s]+)\]$/.exec(h[1]);
      ids.add(custom ? (slug(custom[1]), custom[1]) : slug(plain(h[1])));
    }
    for (const m of line.matchAll(/\bid="([^"]+)"/g)) ids.add(m[1]);
    // <include>file.md</include>, as Fumadocs embeds it (a #section of it is not followed)
    for (const m of line.matchAll(/<include[^>]*>([^<#]+)(?:#[^<]*)?<\/include>/g)) {
      for (const id of idsOf(path.resolve(path.dirname(file), m[1].trim()), seen)) ids.add(id);
    }
  }
  return ids;
}

/** The content file of a page of this site, from its path under the docs route (get-started/, reference/cli/). */
function pageFile(root, slugs) {
  const base = path.join(root, CONTENT, ...slugs);
  for (const f of [`${base}.mdx`, `${base}.md`, path.join(base, 'index.mdx'), path.join(base, 'index.md')]) {
    if (fs.existsSync(f)) return f;
  }
  return null;
}

/**
 * The links of a file's prose, outside code blocks and inline code, each with its line: [text](url) and ![alt](url),
 * whose text may run over lines, <https://…> and [label]: url.
 */
function linksOf(lines) {
  // the prose with every code block blanked and each inline code span spaced out, so that offsets keep their lines
  const text = lines.map(({ line, fence }) => (fence ? '' : line)).join('\n')
    .replace(/`[^`\n]*(?:\n(?!\s*\n)[^`\n]*)*`/g, (m) => m.replace(/[^\n]/g, ' '));
  const lineOf = (offset) => text.slice(0, offset).split('\n').length;
  const out = [];
  const add = (m, i) => out.push({ href: m[i], line: lineOf(m.index + m[0].indexOf(m[i])) });
  for (const m of text.matchAll(/!?\[[^\]]*\]\(\s*<?([^)\s>]+)>?(?:\s+"[^"]*")?\s*\)/g)) add(m, 1);
  for (const m of text.matchAll(/<((?:https?|mailto):[^>\s]+)>/g)) add(m, 1);
  for (const m of text.matchAll(/^ {0,3}\[[^\]\n]+\]:[ \t]*<?(\S+?)>?(?:[ \t]+.*)?$/gm)) add(m, 1);
  return out;
}

/** A URL's part decoded, or as it is when it does not decode. */
function decode(s) {
  try {
    return decodeURIComponent(s);
  } catch {
    return s;
  }
}

/** The repository's address on GitHub and the site's, from package.json. */
function addresses(root) {
  const pkg = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8'));
  const repoUrl = (typeof pkg.repository === 'string' ? pkg.repository : pkg.repository?.url ?? '')
    .replace(/^git\+/, '').replace(/\.git$/, '');
  const site = String(pkg.homepage ?? '').replace(/\/?$/, '/');
  const folders = (pkg.files ?? []).filter((f) => {
    try {
      return fs.statSync(path.join(root, f)).isDirectory();
    } catch {
      return false;
    }
  });
  return { repoUrl, site, folders };
}

/** Checks one link of `file`; returns a problem, or ''. */
function checkLink(root, file, href, { repoUrl, site }, ownIds) {
  if (href.startsWith('#')) return ownIds.has(decode(href.slice(1))) ? '' : `${href} names no heading of this file`;
  if (!/^(?:https?:\/\/|mailto:)/i.test(href)) {
    return `${href} is not absolute: on GitHub, on npm and on the site, a link works only as a full address`;
  }
  if (site && href.startsWith(site)) {
    const rest = href.slice(site.length);
    const cut = rest.search(/[?#]/);
    const pathname = cut < 0 ? rest : rest.slice(0, cut);
    const anchor = cut >= 0 && rest[cut] === '#' ? decode(rest.slice(cut + 1)) : '';
    // a file the site serves (llms.txt, an image) has no slash, and is not one of the pages checked here
    if (/\.[^/]+$/.test(pathname)) return '';
    if (pathname && !pathname.endsWith('/')) {
      return `${href} lacks the trailing slash of the site's pages (${site}${pathname}/), so GitHub Pages redirects it`;
    }
    if (!pathname) return anchor ? `${href}: the home page's anchors are not checked; link to a docs page` : '';
    const [route, ...slugs] = pathname.replace(/\/$/, '').split('/');
    const target = route === 'docs' ? pageFile(root, slugs) : null;
    if (!target) {
      const page = [CONTENT, ...slugs].join('/');
      return `${href} names no page of the site (no ${slugs.length ? `${page}.mdx or ` : ''}${page}/index.mdx)`;
    }
    if (anchor && !idsOf(target).has(anchor)) {
      return `${href}: ${path.relative(root, target)} has no heading or id #${anchor}`;
    }
    return '';
  }
  if (repoUrl && href.startsWith(`${repoUrl}/`)) {
    const rest = href.slice(repoUrl.length + 1);
    const tree = /^(blob|tree)\/([^/]+)\/([^?#]+)/.exec(rest);
    if (tree) {
      const p = path.join(root, decode(tree[3]).replace(/\/$/, ''));
      let st = null;
      try {
        st = fs.statSync(p);
      } catch {
        // missing
      }
      if (!st) return `${href} names ${tree[3]}, which the repository does not have`;
      if (tree[1] === 'blob' && st.isDirectory()) return `${href}: ${tree[3]} is a folder; GitHub links one with tree/`;
      if (tree[1] === 'tree' && !st.isDirectory()) return `${href}: ${tree[3]} is a file; GitHub links one with blob/`;
      return '';
    }
    const form = /^issues\/new\?(?:.*&)?template=([^&#]+)/.exec(rest);
    if (form && !fs.existsSync(path.join(root, '.github', 'ISSUE_TEMPLATE', decode(form[1])))) {
      return `${href} names the issue form ${form[1]}, which .github/ISSUE_TEMPLATE does not have`;
    }
  }
  return '';
}

/** The text of a page's status Callout (titled Pre-release, or else its first Callout), as plain words. */
function statusCallout(text) {
  const all = [...text.matchAll(/<Callout\b([^>]*)>([\s\S]*?)<\/Callout>/g)];
  const m = all.find((c) => /\btitle=["']Pre-release["']/.test(c[1])) ?? all[0];
  return m ? words(m[2]) : '';
}

/** The site's status sentence, `statusSentence` in docs/lib/shared.ts, if it has one. */
function statusConstant(root) {
  const file = path.join(root, SHARED);
  if (!fs.existsSync(file)) return '';
  const m = /export const statusSentence\s*=\s*(['"`])((?:\\.|(?!\1)[^\\])*)\1/.exec(fs.readFileSync(file, 'utf8'));
  return m ? words(m[2].replace(/\\(.)/g, '$1')) : '';
}

/** Markdown as its words: emphasis, inline code and links reduced to their text, white space collapsed. */
function words(s) {
  return plain(s.replace(/\s+/g, ' '))
    .replace(/\*\*|__/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

/** The commands of a file's shell blocks that install the package, each with its line. */
function installLines(rel, text) {
  const out = [];
  scan(text).forEach(({ line, fence, lang }, i) => {
    if (fence !== 'in' || !SHELL.has(lang) || !INSTALL.test(line.trim())) return;
    out.push({ at: `${rel}:${i + 1}`, cmd: line.trim() });
  });
  return out;
}

/** Every check, for the repository at `root`; returns the problems found, each with its file and line. */
export function checkReadme(root = ROOT) {
  const problems = [];
  const where = addresses(root);
  const texts = {};
  for (const rel of FILES) {
    const file = path.join(root, rel);
    if (!fs.existsSync(file)) {
      problems.push(`${rel}: missing`);
      continue;
    }
    const text = fs.readFileSync(file, 'utf8');
    texts[rel] = text;
    const own = idsOf(file);
    const lines = scan(text);
    for (const { href, line } of linksOf(lines)) {
      const problem = checkLink(root, file, href, where, own);
      if (problem) problems.push(`${rel}:${line}: ${problem}`);
    }
    // the shell block open: its first line and the commands in it so far
    let shell = null;
    lines.forEach(({ line, fence, lang }, i) => {
      const at = `${rel}:${i + 1}`;
      const t = line.trim();
      if (fence === 'open') {
        shell = SHELL.has(lang) ? { at, commands: 0, continued: false } : null;
        return;
      }
      if (fence === 'close') {
        if (shell?.commands > 1) {
          problems.push(`${shell.at}: a shell block with ${shell.commands} commands: one a block`);
        }
        shell = null;
        return;
      }
      if (fence === 'in') {
        if (!shell) return;
        if (/^\$\s/.test(t)) problems.push(`${at}: a $ prompt in a shell block`);
        // a line that is no comment and does not carry on the one before it (a \ at its end) is a command
        if (t && !t.startsWith('#') && !shell.continued) shell.commands++;
        shell.continued = t.endsWith('\\');
        return;
      }
      if (!/^[<{|]/.test(t) && line.length > 120) problems.push(`${at}: ${line.length} characters, past 120`);
    });
  }

  // ---- the README against Get started: the install line and the status sentence
  const gsFile = path.join(root, GET_STARTED);
  const readme = texts['README.md'];
  if (!fs.existsSync(gsFile)) problems.push(`${GET_STARTED}: missing, so the README's install line cannot be compared`);
  else if (readme !== undefined) {
    const gs = fs.readFileSync(gsFile, 'utf8');
    const mine = installLines('README.md', readme);
    const theirs = installLines(GET_STARTED, gs);
    if (mine.length !== 1) problems.push(`README.md: ${mine.length} install lines in its shell blocks, not one`);
    if (theirs.length !== 1) {
      problems.push(`${GET_STARTED}: ${theirs.length} install lines in its shell blocks, not one`);
    }
    if (mine.length === 1 && theirs.length === 1 && mine[0].cmd !== theirs[0].cmd) {
      problems.push(`${mine[0].at}: the install line differs from Get started's (${theirs[0].at}): ${mine[0].cmd} `
        + `against ${theirs[0].cmd}`);
    }
    const status = statusCallout(gs);
    if (!status) problems.push(`${GET_STARTED}: no Callout, so no status sentence to compare the README's with`);
    else if (!words(readme).includes(status)) {
      problems.push(`README.md: Get started's status sentence is not in it: ${status}`);
    }
    // the site's own copy, which its home page and footer show
    const constant = statusConstant(root);
    if (constant && constant !== status && !words(readme).includes(constant)) {
      problems.push(`README.md: the status sentence of ${SHARED} (statusSentence) is not in it: ${constant}`);
    }
  }

  // ---- the guide's map of the code to its pages names every top folder of the package
  const guide = texts['docs/CONTRIBUTING.md'];
  if (guide !== undefined) {
    const start = guide.indexOf(`\n## ${MAP_HEADING}\n`);
    const end = start < 0 ? -1 : guide.indexOf('\n## ', start + 1);
    const map = start < 0 ? '' : guide.slice(start, end < 0 ? guide.length : end);
    if (!map) problems.push(`docs/CONTRIBUTING.md: no section "## ${MAP_HEADING}"`);
    else {
      const named = new Set([...map.matchAll(/`([^`/]+)\//g)].map((m) => m[1]));
      for (const folder of where.folders) {
        if (!named.has(folder)) {
          problems.push(`docs/CONTRIBUTING.md: the map (## ${MAP_HEADING}) does not name ${folder}/, a top folder `
            + 'of the package');
        }
      }
    }
  }
  return problems;
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  const problems = checkReadme();
  for (const p of problems) console.log(p);
  console.log(`check-readme: ${FILES.join(' and ')} against ${GET_STARTED}; ${problems.length} problems`);
  process.exit(problems.length ? 1 : 0);
}
