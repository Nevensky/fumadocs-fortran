// Checks the documentation's pages against the code they describe and against the house rules, before a build (the
// site's prebuild) and in npm test (test/site.test.mjs). Some have checks of their own, which the prebuild runs beside
// this one: Command line (check-cli.mjs), JavaScript API (check-api.mjs), the examples of Doc comments
// (gen-examples.mjs --check), and the README and the contributor guide (check-readme.mjs). This one checks:
// - Components (reference/components.mdx) against types/react.d.ts and style.css: each component's "Props of" table
//   holds the props its interface declares and no other, with required: true on those that are not optional, and the
//   default a prop's doc comment gives as a value; each kind of FortranBadgeKind is drawn live and named in the kind
//   prop; Styling names every --fdf-* custom property the stylesheet sets, and none it lacks;
// - Doc comments (reference/doc-comments.mdx) against src/docs/index.js: each keyword of its lists (FORD_META, DOXY
//   and ENV, then MIDLINE, DROPPED, FORD's environments and the commands renderDoxygen and INLINE_RE read) is a word
//   of the page's code, and so are \f$ and \f[;
// - Generate the reference (guides/generate.mdx) against src/source/reader.js: What is read names the sentinels of
//   SENTINEL, FIXED_SENTINEL, VENDOR and FIXED_VENDOR, and no other directive;
// - the versions: the sentences that give this site's own Fumadocs and Next.js versions say docs/package.json's, the
//   one that gives the grammars' tested versions says those of ci.yml's Shiki job, and every create-fumadocs-app
//   version is the one Get started runs;
// - the status: statusSentence of docs/lib/shared.ts, word for word, in the Pre-release callouts of the Introduction
//   and Get started (check-readme.mjs holds the README to it); the root meta.json's description is appDescription;
// - Get started's steps end, by their cd commands, in the top folder they start in, where the guides' commands run;
// - every hand-written page: a title without code font; a description of at most 107 characters, quoted when it holds
//   ': '; no heading of depth 1, as the title is the page's h1 (lib/source.ts drops those of the files a page
//   includes); no code font in a heading; a step heading (## 1. Create the site) with its explicit [#id], which
//   remarkSteps needs; shell blocks of one command each, with no $ prompt; and, on the pages, the README and the
//   contributor guide, no fumadocs-fortran command that the help lacks, such as init, check or doctor;
// - the meta files: each entry names a page or a folder, each separator has a page under it, and each page and folder
//   is listed (or taken by "..."), so that none goes missing from the sidebar;
// - the table of contents' column: the docs pages' component (app/docs/[[...slug]]/page.tsx) renders, before
//   DocsPage, a hidden element with the class that gives fumadocs-ui's layout its TOC column, on the pages where
//   DocsPage shows a TOC (those that are not full), so that a long page has the column from its first paint rather
//   than from its TOC, which comes after the article; the class is fumadocs-ui's own, when the site's packages are
//   installed.
// The 120-character rule for prose lines is test/site.test.mjs's.
//
//   node docs/scripts/check-docs.mjs [repository root]
//
// It needs no packages: fumadocs-ui's table of contents is read as a file, and only when the site has it installed. It
// exits 1 when it finds a problem, printing one line per problem with its file and line.
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { createRequire } from 'node:module';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { docDefault, parseDts } from './check-api.mjs';
import { CODE_SPAN, codeSpans, parseHelp } from './check-cli.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const CONTENT = 'docs/content/docs';
const SHARED = 'docs/lib/shared.ts';
const SHELL = new Set(['bash', 'sh', 'shell', 'console', 'zsh']);
/** The files the README rules of check-readme.mjs cover, whose commands this checks too. */
const MARKDOWN = ['README.md', 'docs/CONTRIBUTING.md'];
/** The docs pages' component, whose DocsPage shows the table of contents. */
const DOCS_PAGE = 'docs/app/docs/[[...slug]]/page.tsx';
/**
 * A class that sets the docs layout's TOC column, xl:layout:[--fd-toc-width:268px]: fumadocs-ui's layout variant
 * (#nd-docs-layout:has(> &), from its css/lib/base.css) with its breakpoint and the column's width.
 */
const TOC_COLUMN = /(?<![\w:-])(?:[\w-]+:)*layout:\[--fd-toc-width:[^\]\s"'`]+\]/;

/**
 * fumadocs-ui's table of contents for the docs layout, as the site resolves it from docs/: the file, its version and
 * the column classes of #nd-toc and #nd-toc-placeholder (null for an element it lacks, '' for one without the class),
 * or null when the site's packages are not installed.
 */
function fumadocsToc(root) {
  let file;
  try {
    file = createRequire(path.join(root, 'docs', 'package.json')).resolve('fumadocs-ui/layouts/docs/page/slots/toc');
  } catch {
    return null;
  }
  const text = fs.readFileSync(file, 'utf8');
  let version = null;
  try {
    const dir = file.slice(0, file.lastIndexOf(`${path.sep}dist${path.sep}`));
    version = JSON.parse(fs.readFileSync(path.join(dir, 'package.json'), 'utf8')).version ?? null;
  } catch {
    // the version only names it in the messages
  }
  const columnOf = (id) => {
    const at = text.search(new RegExp(`\\bid:\\s*"${id}"`));
    if (at < 0) return null;
    const cls = /className:\s*(?:cn\(\s*)?"([^"]*)"/.exec(text.slice(at, at + 2000));
    return cls ? (TOC_COLUMN.exec(cls[1])?.[0] ?? '') : '';
  };
  return { file, version, toc: columnOf('nd-toc'), placeholder: columnOf('nd-toc-placeholder') };
}

/** Whether a page under content/docs is generated: lib/source.ts's isGenerated (the Showcase's reference and sources). */
const generated = (rel) => rel.startsWith('showcase/modern/') || rel === 'showcase/sources.mdx';

/**
 * The lines of a Markdown or MDX text, each with whether it lies in a code block: fence is 'open', 'in' or 'close' for
 * a block's lines, '' outside, 'front' in the front matter; lang is the block's language.
 */
function scan(text) {
  const out = [];
  const lines = text.split('\n');
  let i = 0;
  if (lines[0] === '---') {
    const end = lines.indexOf('---', 1);
    for (; i <= end; i++) out.push({ line: lines[i], n: i + 1, fence: 'front', lang: '' });
  }
  let fence = '';
  let lang = '';
  for (; i < lines.length; i++) {
    const line = lines[i];
    const t = line.trim();
    const open = /^(`{3,}|~{3,})(.*)$/.exec(t);
    if (fence) {
      if (open && open[1][0] === fence[0] && open[1].length >= fence.length && !open[2].trim()) {
        out.push({ line, n: i + 1, fence: 'close', lang });
        fence = '';
      } else out.push({ line, n: i + 1, fence: 'in', lang });
      continue;
    }
    // a backtick fence's info string holds no backtick (CommonMark): ```` ```mermaid ```` in a line is inline code
    if (open && !(open[1][0] === '`' && open[2].includes('`'))) {
      fence = open[1];
      lang = open[2].trim().split(/\s+/)[0].toLowerCase();
      out.push({ line, n: i + 1, fence: 'open', lang });
    } else out.push({ line, n: i + 1, fence: '', lang: '' });
  }
  return out;
}

/** Markdown as its words: links, inline code and emphasis reduced to their text, white space collapsed. */
function words(s) {
  return String(s)
    .replace(/!?\[([^\]]*)\]\([^)]*\)/g, '$1')
    .replace(/`([^`]*)`/g, '$1')
    .replace(/\*\*|__/g, '')
    .replace(/(^|\s)[*_](?=\S)([^*_]*?\S)[*_](?=\s|[.,;:!?)]|$)/g, '$1$2')
    .replace(/\s+/g, ' ')
    .trim();
}

/** A string constant of a module, `export const name = '…'`, with its escapes read, or null. */
function constant(text, name) {
  const m = new RegExp(`export const ${name}\\s*=\\s*(['"\`])((?:\\\\.|(?!\\1)[^\\\\])*)\\1`).exec(text ?? '');
  return m ? m[2].replace(/\\(.)/g, '$1') : null;
}

/** The text of the Callout titled `title` (or null), as plain words. */
function callout(text, title) {
  const all = [...String(text).matchAll(/<Callout\b([^>]*)>([\s\S]*?)<\/Callout>/g)];
  const m = all.find((c) => new RegExp(`\\btitle=(["'])${title}\\1`).test(c[1]));
  return m ? words(m[2]) : null;
}

/** The line of an offset in a text. */
const lineAt = (text, offset) => text.slice(0, offset).split('\n').length;

/** The pages (.mdx and .md) under a folder, as paths from it, sorted. */
function pagesUnder(dir, rel = '') {
  const out = [];
  let entries;
  try {
    entries = fs.readdirSync(path.join(dir, rel), { withFileTypes: true });
  } catch {
    return out;
  }
  for (const d of entries.sort((a, b) => a.name.localeCompare(b.name))) {
    const p = rel ? `${rel}/${d.name}` : d.name;
    if (d.isDirectory()) out.push(...pagesUnder(dir, p));
    else if (/\.mdx?$/.test(d.name)) out.push(p);
  }
  return out;
}

/** The alternatives of the first group of a regex constant in a source file: `const NAME = /^!\$(a|b)…/`. */
function alternatives(source, name) {
  const m = new RegExp(`const ${name} = /([^\\n]*)/[a-z]*;`).exec(source);
  const group = m && /\(([a-z|]+)\)/.exec(m[1]);
  return group ? group[1].split('|') : null;
}

/** The section of a page under a heading of the given text (without its [#id]), up to the next heading as deep. */
function sectionOf(text, heading) {
  const lines = text.split('\n');
  const at = lines.findIndex((l) => /^#{1,6}\s/.test(l) && l.replace(/\s*\[#[^\]]+\]\s*$/, '').replace(/^#+\s+/, '')
    === heading);
  if (at < 0) return null;
  const depth = /^#+/.exec(lines[at])[0].length;
  let end = at + 1;
  while (end < lines.length && !(new RegExp(`^#{1,${depth}}\\s`).test(lines[end]))) end++;
  return { text: lines.slice(at, end).join('\n'), line: at + 1 };
}

/**
 * The props of a TypeTable: the keys of its type={{ … }} object, each with its line, whether its own object says
 * required: true, and its default when that is a string. Strings are passed over whole, so a description may hold
 * anything.
 */
function typeTableProps(src, firstLine) {
  const at = src.search(/\btype=\{\{/);
  if (at < 0) return null;
  const props = new Map();
  const re = /'(?:\\.|[^'\\])*'|"(?:\\.|[^"\\])*"|`(?:\\.|[^`\\])*`|([A-Za-z_$][\w$]*)\s*:|[{}]/g;
  re.lastIndex = src.indexOf('{', at) + 1;
  let depth = 0;
  let current = null;
  for (let m = re.exec(src); m; m = re.exec(src)) {
    if (m[0] === '{') depth++;
    else if (m[0] === '}') {
      depth--;
      if (depth === 0) break;
      if (depth === 1) current = null;
    } else if (m[1] && depth === 1) {
      current = m[1];
      props.set(current, { required: false, line: firstLine + lineAt(src, m.index) - 1 });
    } else if (m[1] === 'required' && depth === 2 && current) {
      props.get(current).required = /^\s*true\b/.test(src.slice(re.lastIndex));
    } else if (m[1] === 'default' && depth === 2 && current) {
      const s = /^\s*(['"`])((?:\\.|(?!\1)[^\\])*)\1/.exec(src.slice(re.lastIndex));
      if (s) props.get(current).default = s[2].replace(/\\(.)/g, '$1');
    }
  }
  return props;
}

/** A value as code, without the quotes of a string. */
const bare = (s) => String(s).trim().replace(/^(['"])(.*)\1$/, '$2');

/** How many folders below the one it starts in a page's shell blocks leave the reader, by their cd commands. */
function cdDepth(text) {
  let depth = 0;
  for (const { line, fence, lang } of scan(text)) {
    const m = fence === 'in' && SHELL.has(lang) ? /^\s*cd\s+(\S+)\s*$/.exec(line) : null;
    if (!m) continue;
    for (const part of m[1].split('/').filter((p) => p && p !== '.')) depth += part === '..' ? -1 : 1;
  }
  return depth;
}

/** The package/version pairs of a sentence: `fumadocs-core` and `fumadocs-ui` 16.19.4 gives both 16.19.4. */
function versionsIn(sentence) {
  const out = new Map();
  let pending = [];
  const re = /`?(fumadocs-core|fumadocs-ui|fumadocs-mdx|create-fumadocs-app|Next\.js|Shiki)`?|\b(\d+\.\d+\.\d+)\b/g;
  for (const m of sentence.matchAll(re)) {
    if (m[1]) pending.push(m[1]);
    else {
      for (const p of pending) out.set(p, m[2]);
      pending = [];
    }
  }
  return out;
}

/** A dependency's exact version as package.json gives it: ^1.2.3, 1.2.3 and npm:@scope/name@1.2.3 give 1.2.3. */
const pinOf = (spec) => /(\d+\.\d+\.\d+)\s*$/.exec(String(spec ?? ''))?.[1] ?? null;

// The sentences that give versions, each found by the words it starts with (white space collapsed), read up to its
// end, and compared with docs/package.json (site) or ci.yml's Shiki job (ci).
const PINNED = [
  { file: `${CONTENT}/guides/site-setup.mdx`, starts: 'This documentation site runs on', against: 'site' },
  { file: `${CONTENT}/reference/highlighting.mdx`, starts: 'It is tested with Shiki', until: 'the versions CI', against: 'ci' },
  { file: `${CONTENT}/reference/highlighting.mdx`, starts: 'this site builds with it on', against: 'site' },
  { file: 'docs/CONTRIBUTING.md', starts: 'as `docs/package.json` pins it', against: 'site' },
];

/** Every check, for the repository at `root`; returns the problems found, each with its file and line. */
export function checkDocs(root = ROOT) {
  const problems = [];
  // what was checked, for the summary line
  const counts = { pages: 0, meta: 0, props: 0, kinds: 0, properties: 0, keywords: 0, sentinels: 0, versions: 0,
    tocColumn: null };
  const say = (where, message) => problems.push(`${where}: ${message}`);
  const read = (rel) => {
    try {
      return fs.readFileSync(path.join(root, rel), 'utf8');
    } catch {
      return null;
    }
  };
  const need = (rel) => {
    const text = read(rel);
    if (text === null) say(rel, 'missing');
    return text;
  };
  const content = path.join(root, CONTENT);
  const pages = pagesUnder(content);
  const own = pages.filter((p) => !generated(p));
  const texts = new Map(pages.map((p) => [p, read(`${CONTENT}/${p}`) ?? '']));

  // ---------------------------------------------------------------- every hand-written page
  let help = null;
  const r = spawnSync(process.execPath, [path.join(root, 'bin', 'fumadocs-fortran.js'), '--help'], { encoding: 'utf8' });
  if (r.status === 0) help = parseHelp(r.stdout);
  else say('bin/fumadocs-fortran.js', `--help exited with ${r.status}, so the commands on the pages are not checked`);
  const commandNames = new Set(help?.commands.map((c) => c.name) ?? []);
  // `fumadocs-fortran X` as a command runs it: at the start of a line or code span, after npx (--yes), after npm exec's
  // --, after && or a quote; `node bin/fumadocs-fortran.js X` too. Not in prose (`Generated by fumadocs-fortran from`).
  const RUNS = new RegExp('(?:^|\\s--\\s|&&\\s*|[;|("\'`]\\s*|\\bnpx\\s+(?:--yes\\s+)?|\\bnode\\s+)'
    + '(?:fumadocs-fortran|bin/fumadocs-fortran\\.js)\\s+([a-z][\\w-]*)', 'g');
  const commands = (rel, text) => {
    if (!help) return;
    const check = (code, n) => {
      for (const m of code.matchAll(RUNS)) {
        if (!commandNames.has(m[1])) {
          say(`${rel}:${n}`, `fumadocs-fortran ${m[1]}: the help has no such command (it has ${[...commandNames].join(' and ')})`);
        }
      }
    };
    const lines = scan(text);
    for (const { line, n, fence, lang } of lines) {
      if (fence === 'in' && SHELL.has(lang)) check(line.trim(), n);
    }
    // the inline code of the prose, each span with its line
    const prose = lines.map(({ line, fence }) => (fence ? '' : line)).join('\n');
    for (const m of prose.matchAll(CODE_SPAN)) check(m[2].replace(/\n/g, ' ').trim(), lineAt(prose, m.index));
  };

  for (const p of own) {
    const rel = `${CONTENT}/${p}`;
    const text = texts.get(p);
    const lines = scan(text);
    counts.pages++;
    // the front matter
    const front = lines.filter((l) => l.fence === 'front').slice(1, -1);
    if (!front.length) say(rel, 'no front matter: a page needs a title');
    let title = false;
    front.forEach(({ line, n }, k) => {
      const m = /^(title|description):[ \t]*(.*)$/.exec(line);
      if (!m) return;
      const [, key, raw] = m;
      let value = raw;
      for (let j = k + 1; j < front.length && /^\s+\S/.test(front[j].line); j++) value += ` ${front[j].line.trim()}`;
      const quoted = /^(['"]).*\1$/.test(value.trim());
      const plain = quoted ? value.trim().slice(1, -1).replace(/\\(["\\])/g, '$1').replace(/''/g, "'") : value.trim();
      if (key === 'title') {
        title = !!plain;
        if (plain.includes('`')) say(`${rel}:${n}`, 'code font in the title');
        return;
      }
      if (/^[>|]/.test(raw.trim())) say(`${rel}:${n}`, 'a description as a block scalar: write it on one line');
      if (plain.length > 107) say(`${rel}:${n}`, `a description of ${plain.length} characters, past 107`);
      if (!quoted && plain.includes(': ')) say(`${rel}:${n}`, "a description that holds ': ' unquoted, which YAML misreads");
    });
    if (front.length && !title) say(rel, 'no title in the front matter');
    // headings and shell blocks
    let shell = null;
    for (const { line, n, fence, lang } of lines) {
      const t = line.trim();
      if (fence === 'open') {
        shell = SHELL.has(lang) ? { n, commands: 0, continued: false } : null;
        continue;
      }
      if (fence === 'close') {
        if (shell && shell.commands > 1) say(`${rel}:${shell.n}`, `a shell block with ${shell.commands} commands: one a block`);
        shell = null;
        continue;
      }
      if (fence === 'in') {
        if (!shell) continue;
        if (/^\$\s/.test(t)) say(`${rel}:${n}`, 'a $ prompt in a shell block: write the command alone');
        if (t && !t.startsWith('#') && !shell.continued) shell.commands++;
        shell.continued = t.endsWith('\\');
        continue;
      }
      if (fence) continue;
      const h = /^ {0,3}(#{1,6})\s+(.*?)\s*$/.exec(line);
      if (!h) continue;
      const [, hashes, body] = h;
      const id = /\s*\[#([^\]\s]+)\]$/.exec(body);
      const label = id ? body.slice(0, id.index) : body;
      if (hashes.length === 1) {
        say(`${rel}:${n}`, 'a heading of depth 1: the title is the page\'s h1, and lib/source.ts drops the others');
      }
      if (label.includes('`')) say(`${rel}:${n}`, 'code font in a heading');
      if (/^\d+\.\s/.test(label) && !id) {
        say(`${rel}:${n}`, 'a step heading without its [#id]: remarkSteps runs after the ids are made, so it would get '
          + 'one with its number in it');
      }
    }
    commands(rel, text);
  }
  for (const rel of MARKDOWN) {
    const text = read(rel);
    if (text !== null) commands(rel, text);
  }

  // ---------------------------------------------------------------- the meta files
  for (const metaRel of fs.existsSync(content) ? metaFiles(content) : []) {
    const rel = `${CONTENT}/${metaRel}`;
    const dir = path.dirname(path.join(content, metaRel));
    counts.meta++;
    let meta;
    try {
      meta = JSON.parse(read(rel));
    } catch (e) {
      say(rel, `not JSON: ${e.message}`);
      continue;
    }
    const entries = Array.isArray(meta.pages) ? meta.pages : null;
    const names = fs.readdirSync(dir, { withFileTypes: true })
      .filter((d) => (d.isDirectory() ? !d.name.startsWith('.') : /\.mdx?$/.test(d.name)))
      .map((d) => (d.isDirectory() ? d.name : d.name.replace(/\.mdx?$/, '')));
    if (!entries) continue;
    const listed = new Set();
    let rest = false;
    // the separator open, and whether a page came under it
    let separator = null;
    const close = () => {
      if (separator && !separator.pages) say(rel, `the separator ${separator.name} has no page under it`);
    };
    for (const e of entries) {
      if (typeof e !== 'string') continue;
      if (/^---.*---$/.test(e)) {
        close();
        separator = { name: e, pages: 0 };
        continue;
      }
      if (/^(?:external:)?\[.*\]\(.*\)$/.test(e)) {
        if (separator) separator.pages++;
        continue;
      }
      if (e === '...' || e === 'z...a') {
        rest = true;
        if (separator) separator.pages++;
        continue;
      }
      const exclude = e.startsWith('!');
      const extract = e.startsWith('...');
      const name = e.replace(/^!|^\.\.\./, '');
      const isDir = fs.existsSync(path.join(dir, name)) && fs.statSync(path.join(dir, name)).isDirectory();
      const isPage = fs.existsSync(path.join(dir, `${name}.mdx`)) || fs.existsSync(path.join(dir, `${name}.md`));
      if (extract ? !isDir : !(isDir || isPage)) {
        say(rel, `${JSON.stringify(e)} names no ${extract ? 'folder' : 'page or folder'} of ${path.relative(root, dir)}`);
        continue;
      }
      listed.add(name);
      if (!exclude && separator) separator.pages++;
    }
    close();
    if (!rest) {
      for (const name of names) {
        if (name !== 'index' && !listed.has(name)) {
          say(rel, `${name} is in ${path.relative(root, dir)} and not in its pages, so it is missing from the sidebar`);
        }
      }
    }
  }

  // ---------------------------------------------------------------- the status and the site's description
  const shared = need(SHARED);
  const status = constant(shared, 'statusSentence');
  if (shared !== null && !status) say(SHARED, 'no statusSentence constant');
  for (const p of ['index.mdx', 'get-started.mdx']) {
    const said = callout(texts.get(p), 'Pre-release');
    if (said === null) say(`${CONTENT}/${p}`, 'no Callout titled Pre-release, which carries the status sentence');
    else if (status && !said.includes(words(status))) {
      say(`${CONTENT}/${p}`, `its Pre-release callout lacks the status sentence of ${SHARED}: ${status}`);
    }
  }
  const description = constant(shared, 'appDescription');
  try {
    const rootMeta = JSON.parse(read(`${CONTENT}/meta.json`));
    if (description && rootMeta.description !== description) {
      say(`${CONTENT}/meta.json`, `its description, which llms.txt gives, differs from appDescription in ${SHARED}`);
    }
  } catch {
    // reported with the meta files
  }

  // ---------------------------------------------------------------- where Get started leaves the reader
  // the guides' commands run in the top folder, where Get started starts, so its steps end there too
  const left = cdDepth(texts.get('get-started.mdx') ?? '');
  if (left !== 0) {
    say(`${CONTENT}/get-started.mdx`, `its steps end ${Math.abs(left)} folder${Math.abs(left) === 1 ? '' : 's'} `
      + `${left > 0 ? 'below' : 'above'} the top folder, where the guides' commands run: end them with a cd back to it`);
  }

  // ---------------------------------------------------------------- the versions
  const docsPkg = JSON.parse(need('docs/package.json') ?? '{}');
  const site = {
    'fumadocs-core': pinOf(docsPkg.dependencies?.['fumadocs-core']),
    'fumadocs-ui': pinOf(docsPkg.dependencies?.['fumadocs-ui']),
    'fumadocs-mdx': pinOf(docsPkg.dependencies?.['fumadocs-mdx']),
    'Next.js': pinOf(docsPkg.dependencies?.next),
  };
  const ciText = need('.github/workflows/ci.yml') ?? '';
  const shikiJob = /^ {2}shiki:\n([\s\S]*?)(?=^ {2}\w|$(?![\s\S]))/m.exec(ciText)?.[1] ?? '';
  const ci = {
    Shiki: /\bshiki@(\d+\.\d+\.\d+)/.exec(shikiJob)?.[1] ?? null,
    'fumadocs-core': /\bfumadocs-core@(\d+\.\d+\.\d+)/.exec(shikiJob)?.[1] ?? null,
  };
  for (const { file, starts, until, against } of PINNED) {
    const text = read(file) ?? '';
    // the sentence's start, at any line break
    const found = new RegExp(starts.split(' ').map((w) => w.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('\\s+'))
      .exec(text);
    if (!found) {
      say(file, `no sentence starting "${starts}", whose versions this checks: change PINNED in check-docs.mjs with it`);
      continue;
    }
    const where = `${file}:${lineAt(text, found.index)}`;
    const tail = text.slice(found.index).replace(/\s+/g, ' ');
    // a sentence ends at a full stop before a space: a version's dots come before digits
    const end = until ? tail.indexOf(until) : tail.search(/\.(?=\s|$)/);
    const versions = versionsIn(end < 0 ? tail : tail.slice(0, end));
    const want = against === 'site' ? site : ci;
    if (![...versions.keys()].some((pkg) => pkg in want)) say(where, `"${starts} …" gives no version`);
    for (const [pkg, v] of versions) {
      if (pkg in want) counts.versions++;
      if (pkg in want && want[pkg] !== v) {
        say(where, `"${starts} …" gives ${pkg} ${v}, where `
          + `${against === 'site' ? 'docs/package.json pins' : "ci.yml's Shiki job installs"} ${want[pkg] ?? 'none'}`);
      }
    }
  }
  const scaffold = /create-fumadocs-app@(\d+\.\d+\.\d+)/.exec(texts.get('get-started.mdx') ?? '')?.[1];
  if (!scaffold) say(`${CONTENT}/get-started.mdx`, 'no create-fumadocs-app@VERSION command');
  for (const p of own) {
    const text = texts.get(p);
    for (const m of text.matchAll(/create-fumadocs-app`?(?:@|\s+)(\d+\.\d+\.\d+)/g)) {
      if (scaffold && m[1] !== scaffold) {
        say(`${CONTENT}/${p}:${lineAt(text, m.index)}`, `create-fumadocs-app ${m[1]}, where Get started runs ${scaffold}`);
      }
    }
  }

  // ---------------------------------------------------------------- the table of contents' column
  // fumadocs-ui gives the docs layout its TOC column (from xl) by a class of the TOC, which a :has() rule on the
  // layout keys on, and DocsPage renders the TOC after the article: a long page's comes hundreds of KB into its HTML,
  // and a paint before it lays the article out without the column, then moves it. The page gives the same class to a
  // hidden element before DocsPage, on the pages where DocsPage shows a TOC. The page is read without its comments,
  // each blanked to spaces with its line breaks kept, so that an offset keeps its line and an element or a prop
  // commented out does not count; strings are kept as they are.
  const pageText = need(DOCS_PAGE);
  const pageTsx = pageText === null ? null : pageText.replace(
    /("(?:[^"\\\n]|\\.)*"|'(?:[^'\\\n]|\\.)*'|`(?:[^`\\]|\\.)*`)|\/\*[^]*?\*\/|\/\/[^\n]*/g,
    (m, string) => string ?? m.replace(/[^\n]/g, ' '));
  const docsPage = pageTsx === null ? null : /<DocsPage\b/.exec(pageTsx);
  if (pageTsx !== null && !docsPage) {
    say(DOCS_PAGE, 'no <DocsPage>, whose table of contents this checks: change check-docs.mjs');
  }
  if (docsPage) {
    const at = (offset) => `${DOCS_PAGE}:${lineAt(pageTsx, offset)}`;
    const element = [...pageTsx.matchAll(/<([A-Za-z][\w.]*)\b([^<>]*?)\/>/g)].find((m) => TOC_COLUMN.test(m[2]));
    // DocsPage shows its TOC unless the page is full: its full prop, the first after <DocsPage
    const full = /\bfull=\{\s*([\w.?]+)\s*\}/.exec(pageTsx.slice(docsPage.index))?.[1] ?? null;
    if (!element) {
      say(at(docsPage.index), 'no hidden element with the class of the TOC column (xl:layout:[--fd-toc-width:268px], '
        + 'as fumadocs-ui\'s TOC has it) before DocsPage: a long page is laid out without the column until its TOC, '
        + 'after the article, arrives, and then shifts');
    } else {
      const where = at(element.index);
      const attrs = element[2];
      const cls = TOC_COLUMN.exec(attrs)[0];
      const classes = /\bclassName="([^"]*)"/.exec(attrs)?.[1].split(/\s+/) ?? [];
      const hidden = classes.includes('hidden')
        || /(?:^|\s)hidden(?=\s|$|=\{true\})/.test(attrs.replace(/\bclassName="[^"]*"/, ''));
      // {!condition && <div … />}
      const guard = /\{\s*!\s*([\w.?]+)\s*&&\s*$/.exec(pageTsx.slice(0, element.index))?.[1] ?? null;
      if (element.index > docsPage.index) {
        say(where, 'the TOC column\'s element comes after <DocsPage>: it gives the column before the article only as '
          + 'a child of the layout ahead of DocsPage');
      }
      if (!hidden) say(where, 'the TOC column\'s element is not hidden, so it takes a cell of the layout\'s grid');
      if (full && guard !== full) {
        say(where, `the TOC column's element shows ${guard ? `on !${guard}` : 'on every page'}, and DocsPage shows `
          + `its TOC on !${full} (full={${full}}): give it {!${full} && …}, or a full page gets an empty column`);
      } else if (!full && guard) {
        say(where, `the TOC column's element shows on !${guard}, and DocsPage gets no full, so it shows its TOC on `
          + 'every page: drop the condition');
      }
      if (/\btableOfContent=/.test(pageTsx)) {
        say(at(docsPage.index), 'DocsPage gets tableOfContent, which can turn its TOC off, and the TOC column\'s '
          + 'element follows full alone: give it the same condition, and change check-docs.mjs with it');
      }
      const ui = fumadocsToc(root);
      if (ui) {
        const uiRel = path.relative(root, ui.file);
        const named = `fumadocs-ui ${ui.version ?? ''}`.trim();
        counts.tocColumn = `${named}'s class`;
        if (ui.toc === null) say(uiRel, `no #nd-toc in ${named}'s table of contents: change check-docs.mjs`);
        else if (!ui.toc) {
          say(uiRel, `${named}'s TOC (#nd-toc) has no layout:[--fd-toc-width:…] class, so its column comes another `
            + `way: see whether ${DOCS_PAGE}'s element is needed, and change check-docs.mjs`);
        } else if (cls !== ui.toc) {
          say(where, `the TOC column's element has ${cls}, and ${named}'s TOC ${ui.toc}: give it the TOC's class`);
        }
        if (ui.toc && ui.placeholder !== null && ui.placeholder !== ui.toc) {
          say(uiRel, `${named}'s #nd-toc-placeholder, on a page without headings, has `
            + `${ui.placeholder || 'no column class'}, and its #nd-toc ${ui.toc}: a page without headings is laid out `
            + 'otherwise, so the element\'s condition needs its headings too');
        }
      } else counts.tocColumn = 'not compared (fumadocs-ui not installed)';
    }
  }

  // ---------------------------------------------------------------- Components
  const compRel = `${CONTENT}/reference/components.mdx`;
  const comp = texts.get('reference/components.mdx') ?? need(compRel) ?? '';
  const react = fs.existsSync(path.join(root, 'types/react.d.ts')) ? parseDts(path.join(root, 'types/react.d.ts')) : null;
  if (!react) say('types/react.d.ts', 'missing');
  const css = need('style.css') ?? '';
  // the page outside its code blocks: what it draws
  const live = scan(comp).map(({ line, fence }) => (fence ? '' : line)).join('\n');
  if (react) {
    for (const d of react.decls.values()) {
      if (d.kind !== 'function') continue;
      const props = /^function\s+(\w+)\s*\(\s*props\s*:\s*(\w+)\s*\)/.exec(d.text);
      if (!props) continue;
      const [, component, iface] = props;
      const declared = react.decls.get(iface);
      if (declared?.kind !== 'interface') continue;
      const section = sectionOf(comp, `Props of ${component}`);
      if (!section) {
        say(compRel, `no ### Props of ${component} section, for the props of ${iface} (types/react.d.ts)`);
        continue;
      }
      const tableAt = section.text.indexOf('<TypeTable');
      const tableEnd = section.text.indexOf('\n/>', tableAt);
      const table = tableAt < 0 ? null
        : typeTableProps(section.text.slice(tableAt, tableEnd < 0 ? undefined : tableEnd + 3),
          section.line + lineAt(section.text, tableAt) - 1);
      if (!table) {
        say(`${compRel}:${section.line}`, `Props of ${component} has no TypeTable`);
        continue;
      }
      for (const m of declared.members) {
        counts.props++;
        const row = table.get(m.name);
        if (!row) say(`${compRel}:${section.line}`, `Props of ${component} lacks ${m.name}, which ${iface} declares`);
        else if (row.required === m.optional) {
          say(`${compRel}:${row.line}`, `${component}'s ${m.name} is ${m.optional ? 'optional' : 'required'} in ${iface}, `
            + `and the table ${row.required ? 'says required: true' : 'lacks required: true'}`);
        }
        // the default its doc comment gives as a value, as JavaScript API's own tables of these props had it
        const lit = row ? docDefault(m.doc ?? '') : null;
        if (lit !== null && bare(row.default ?? '') !== bare(lit)) {
          say(`${compRel}:${row.line}`, `${component}'s ${m.name} defaults to ${lit} (${iface} in types/react.d.ts), `
            + `and the table gives ${row.default === undefined ? 'no default' : row.default}`);
        }
      }
      for (const [name, row] of table) {
        if (!declared.members.some((m) => m.name === name)) {
          say(`${compRel}:${row.line}`, `Props of ${component} has ${name}, which ${iface} (types/react.d.ts) lacks`);
        }
      }
    }
    const kindType = react.decls.get('FortranBadgeKind');
    const kinds = kindType ? [...kindType.text.matchAll(/'([\w-]+)'/g)].map((m) => m[1]) : [];
    if (!kinds.length) say('types/react.d.ts', 'no FortranBadgeKind union, whose kinds Components draws');
    const kindProp = sectionOf(comp, 'Props of FortranBadge')?.text ?? '';
    const kindDoc = /\bkind:\s*\{[\s\S]*?description:\s*((?:'(?:\\.|[^'\\])*'|"(?:\\.|[^"\\])*"))/.exec(kindProp)?.[1] ?? '';
    for (const k of kinds) {
      counts.kinds++;
      if (!new RegExp(`<FortranBadge\\b[^>]*\\skind="${k}"`).test(live)) {
        say(compRel, `the badge kind ${k} (FortranBadgeKind) is not drawn live on the page`);
      }
      if (!new RegExp(`(^|[^\\w-])${k}([^\\w-]|$)`).test(kindDoc)) {
        say(compRel, `the kind prop of FortranBadge does not name the kind ${k}`);
      }
    }
  }
  const styling = sectionOf(comp, 'Styling');
  if (!styling) say(compRel, 'no ## Styling section, which names the stylesheet\'s custom properties');
  else {
    const set = new Set([...css.matchAll(/(--fdf-[\w-]+)\s*:/g)].map((m) => m[1]));
    const used = new Set([...css.matchAll(/--fdf-[\w-]+/g)].map((m) => m[0]));
    const named = new Map();
    const stylingText = styling.text;
    for (const m of stylingText.matchAll(/`(--fdf-[\w-]+)`/g)) {
      if (!named.has(m[1])) named.set(m[1], styling.line + lineAt(stylingText, m.index) - 1);
    }
    for (const v of set) {
      counts.properties++;
      if (!named.has(v)) say(`${compRel}:${styling.line}`, `Styling does not name ${v}, which style.css sets`);
    }
    for (const [v, n] of named) {
      if (!used.has(v)) say(`${compRel}:${n}`, `Styling names ${v}, which style.css neither sets nor uses`);
    }
  }

  // ---------------------------------------------------------------- Doc comments
  const dcRel = `${CONTENT}/reference/doc-comments.mdx`;
  const dc = texts.get('reference/doc-comments.mdx') ?? need(dcRel) ?? '';
  const engine = need('src/docs/index.js') ?? '';
  // the page's code: its inline code and the lines of its code blocks
  const dcLines = scan(dc);
  const spans = [...codeSpans(dcLines.map(({ line, fence }) => (fence ? '' : line)).join('\n')),
    ...dcLines.filter((l) => l.fence === 'in').map((l) => l.line)];
  const spanWords = new Set();
  for (const s of spans) for (const w of s.matchAll(/[A-Za-z_][A-Za-z_0-9]*/g)) spanWords.add(w[0].toLowerCase());
  // a regex alternation's words: returns? gives return and returns
  const expand = (alt) => alt.split('|').flatMap((w) => {
    const t = w.replace(/\\s\+\\S\+|\\s\+\(\?:.*$|\\b.*$|\\s.*$/g, '').replace(/[()^$\\]/g, '');
    if (!/^[a-z_]+s?\??$/i.test(t)) return [];
    return t.endsWith('?') ? [t.slice(0, -2), t.slice(0, -1)] : [t];
  });
  const keywords = new Map();
  const add = (list, from) => {
    for (const w of list) if (!keywords.has(w)) keywords.set(w, from);
  };
  const grab = (re, what) => {
    const m = re.exec(engine);
    if (!m) say('src/docs/index.js', `${what} not found, so Doc comments is not checked against it: change check-docs.mjs`);
    return m?.[1] ?? '';
  };
  add([...grab(/const FORD_META = new Set\(\[([\s\S]*?)\]\)/, 'FORD_META').matchAll(/'([^']+)'/g)].map((m) => m[1]),
    'FORD_META');
  for (const g of grab(/const DOXY = \/(.*)\/m;/, 'DOXY').matchAll(/\(([a-z|?]+)\)/g)) add(expand(g[1]), 'DOXY');
  add([...grab(/const ENV = \{(.*)\};/, 'ENV').matchAll(/(\w+): \[/g)].map((m) => m[1]), 'ENV');
  for (const [why, re] of [
    ['MIDLINE', grab(/const MIDLINE = \/(.*)\/;/, 'MIDLINE')],
    ['DROPPED', grab(/const DROPPED = \/(.*)\/;/, 'DROPPED')],
    ["FORD's environments", grab(/\/\^@\((note[^)]*)\)/, "FORD's environments")],
  ]) {
    for (const g of re.matchAll(/\(([a-z|?]+)\)/g)) add(expand(g[1]), why);
    add([...re.matchAll(/(?<!\\)\b[a-z]{2,}\b/g)].map((m) => m[0]), why);
  }
  const doxygen = engine.slice(engine.indexOf('function renderDoxygen'), engine.indexOf('/** Author, date and version'));
  if (!engine.includes('function renderDoxygen')) say('src/docs/index.js', 'renderDoxygen not found: change check-docs.mjs');
  for (const m of doxygen.matchAll(/\[@\\\\\]\(([a-z|?]+)\)/g)) add(expand(m[1]), 'renderDoxygen');
  for (const m of doxygen.matchAll(/\[@\\\\\]([a-z]+)(\??)/g)) add(m[2] ? [m[1].slice(0, -1), m[1]] : [m[1]], 'renderDoxygen');
  const inline = engine.slice(engine.indexOf('const INLINE_RE'), engine.indexOf("].join('|'), 'g');"));
  if (!engine.includes('const INLINE_RE')) say('src/docs/index.js', 'INLINE_RE not found: change check-docs.mjs');
  for (const m of inline.matchAll(/\(\?<\w+>([a-z|]+)\)/g)) add(expand(m[1]), 'INLINE_RE');
  for (const m of inline.matchAll(/\[@\\\\\]([a-z]+)\\\\s/g)) add([m[1]], 'INLINE_RE');
  for (const [w, why] of keywords) {
    counts.keywords++;
    if (!spanWords.has(w.toLowerCase())) say(dcRel, `${w} (${why} in src/docs/index.js) is not in the page's code`);
  }
  for (const s of ['\\f$', '\\f[']) {
    if (!spans.some((t) => t.includes(s))) say(dcRel, `${s}, Doxygen's maths, is not in the page's code`);
  }

  // ---------------------------------------------------------------- Generate's What is read
  const genRel = `${CONTENT}/guides/generate.mdx`;
  const gen = texts.get('guides/generate.mdx') ?? need(genRel) ?? '';
  const reader = need('src/source/reader.js') ?? '';
  const whatIsRead = sectionOf(gen, 'What is read');
  const lists = {
    free: alternatives(reader, 'SENTINEL'), fixed: alternatives(reader, 'FIXED_SENTINEL'),
    vendor: alternatives(reader, 'VENDOR'), fixedVendor: alternatives(reader, 'FIXED_VENDOR'),
  };
  if (!whatIsRead) say(genRel, 'no ## What is read section, which lists the directives read');
  else if (!Object.values(lists).every(Boolean)) {
    say('src/source/reader.js', 'SENTINEL, FIXED_SENTINEL, VENDOR or FIXED_VENDOR not found: change check-docs.mjs');
  } else {
    const named = new Set(codeSpans(whatIsRead.text));
    // fixed form: c$omp, *$omp and !$omp written out, then "the same with acc and cuf", which names their words
    const want = [
      ...lists.free.map((w) => `!$${w}`),
      ...lists.fixed.flatMap((w) => (w === 'omp' ? ['c$omp', '*$omp', '!$omp'] : [w])),
      ...lists.vendor.map((w) => `!${w}$`),
      ...lists.fixedVendor.map((w) => `${w}$`),
    ];
    for (const w of want) {
      counts.sentinels++;
      if (!named.has(w)) say(`${genRel}:${whatIsRead.line}`, `What is read lacks ${w}, which src/source/reader.js reads`);
    }
    // besides the sentinels: OpenMP's conditional lines, the continuation marks and the flags that make !$ lines code
    const known = new Set([...want, '!$', 'c$', '*$', '&', '0', 'c', 'C', '*', '!', '-D _OPENMP', '--all-branches',
      '!$cuf kernel do']);
    for (const s of named) {
      if (!known.has(s)) say(`${genRel}:${whatIsRead.line}`, `What is read names ${s}, which src/source/reader.js does not read`);
    }
  }
  return Object.assign(problems, { counts });
}

/** The meta.json files under the content folder, as paths from it. */
function metaFiles(dir, rel = '') {
  const out = [];
  for (const d of fs.readdirSync(path.join(dir, rel), { withFileTypes: true })) {
    const p = rel ? `${rel}/${d.name}` : d.name;
    if (d.isDirectory()) out.push(...metaFiles(dir, p));
    else if (d.name === 'meta.json') out.push(p);
  }
  return out.sort();
}

if (process.argv[1] && import.meta.url === pathToFileURL(fs.realpathSync(process.argv[1])).href) {
  const root = path.resolve(process.argv[2] ?? ROOT);
  const problems = checkDocs(root);
  for (const p of problems) console.log(p);
  const c = problems.counts;
  console.log(`check-docs: ${c.pages} hand-written pages and ${c.meta} meta files; Components: ${c.props} props, `
    + `${c.kinds} badge kinds, ${c.properties} custom properties; Doc comments: ${c.keywords} keywords; What is read: `
    + `${c.sentinels} sentinels; ${c.versions} versions; TOC column: ${c.tocColumn ?? 'none'}; ${problems.length} `
    + 'problems');
  process.exit(problems.length ? 1 : 0);
}
