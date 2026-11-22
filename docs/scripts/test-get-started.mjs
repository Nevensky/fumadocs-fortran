#!/usr/bin/env node
// The tutorial is the test. This follows docs/content/docs/get-started.mdx as a reader would, in a new folder whose
// src/ is a copy of examples/modern/src, and then the guides' phases (docs/scripts/phases/*.mjs) on the site it made.
// The page's GitHub install line installs a tarball packed from this repository instead (npm pack), unless --github.
//
//   node docs/scripts/test-get-started.mjs [options]
//
//   --work DIR       the folder to work in, absent or empty (default: a new one in the system's temporary folder)
//   --tarball FILE   the packed package to install in place of the GitHub line (default: npm pack of this repository)
//   --github         run the page's GitHub install line as it is written (the repository must be public)
//   --scaffold VER   run create-fumadocs-app@VER in place of the page's version, such as latest (the weekly run)
//   --page FILE      the Get started page to follow (default: docs/content/docs/get-started.mdx)
//   --phases LIST    the phases to run after Get started: all (default), none, or names, comma-separated
//   --keep-going     run the later phases when one fails
//   --keep           keep the work folder when every check passes (it is always kept when one fails)
//
// It needs Node.js and npm (the versions a site needs, see the page), Git, network access to the npm registry, and
// port 3000 free. It exits 0 when every check passes, 1 when one fails, 2 when it cannot run. The work folder holds
// pkg/ (the tarball), project/ (the reader's folder: src/ and the site in docs/) and logs/, whose report.txt lists
// every block, command and check.
//
// Get started fails on:
// - a command that exits non-zero, a bash block of more than one command, a cd to a folder that does not exist;
// - drift: a titled file block whose lines, without those marked [!code ++], differ from the file already there
//   (the template's), or a diff block whose context lines are not in the file;
// - a server that never listens; a reference page (the overview and each page of the generated meta.json) that is
//   not 200, holds "Expected component", lacks "API reference" in its sidebar, or (but for the overview) lacks badges
//   and source blocks; no argument table on any page; the same checks on the pages of the static export;
// - a quoted output the run does not print: each ```text block against the output of the bash block before it, and
//   each EXPECT entry below, which the page must also quote; times (12 ms, 3.4 s) are masked on both sides.
//
// Phases. Each file in docs/scripts/phases/ exports a default { name, run(ctx) }: an async run that checks one
// guide against the site Get started made. They run in the order of PHASE_ORDER, then any others by name; a phase
// that fails stops the ones after it, unless --keep-going. A phase leaves the site working (the files its guide
// writes stay; ctx.seed edits are undone when it ends). What run(ctx) gets:
//   ctx.repo, ctx.project, ctx.site   this repository; the reader's folder (src/, docs/); the site (project/docs)
//   ctx.tarball                       the packed package's path, or null with --github
//   ctx.logDir, ctx.logs              the phase's own log folder; the run's, which holds every phase's
//   ctx.scratch(name)                 a new empty folder of the work folder, outside the project
//   ctx.page(rel)                     a page of docs/content/docs, parsed: { file, text, prose, blocks, headings };
//                                     a block is { lang, meta, title, body, line, sections } (sections: the ids
//                                     of the headings it is under, explicit [#id] or the heading's slug)
//   ctx.follow(page, { sections, cwd, expect })
//                                     follows the page's blocks as Get started's are followed (bash run, cd
//                                     followed, the install line swapped, titled blocks written into the project,
//                                     text blocks checked), all of them or those under the given heading ids; the
//                                     commands start in cwd (default ctx.project); expect: [[command start,
//                                     output it must hold]], which the page must quote too. Resolves to { ok, cwd }
//   ctx.run(command, { cwd, env, timeout, allowFail, label })
//                                     runs a shell command (cwd default ctx.project), logged; resolves to
//                                     { code, out, secs }; a non-zero exit is a problem unless allowFail
//   ctx.build({ env, allowFail, label })   npm run build in the site
//   ctx.seed(rel, edit)               edits a file of the project (edit: text => text) until the phase ends, or
//                                     until the function it returns is called; returns that function
//   ctx.write(rel, text), ctx.read(rel), ctx.exists(rel)   files of the project
//   ctx.refPages(dir)                 the reference pages in the order of dir's meta.json (default
//                                     docs/content/docs/api): [{ slug, url }], the overview first
//   ctx.outHtml(url, { out })         an exported page's HTML (url such as /docs/api/demo; out default
//                                     <site>/out), or null
//   ctx.count(html, mark)             how often one of MARKS (below), or a string or RegExp, occurs in html
//   ctx.checkPage(where, url, status, html)   the reference-page checks above
//   ctx.quotes(page, text)            whether the page's prose or blocks hold text (times masked)
//   ctx.commands(body)                a bash block's commands (comments and blank lines left out)
//   ctx.expect(ok, message), ctx.fail(message), ctx.note(message)
//   ctx.has(command)                  whether a command is on PATH (docker, for the Docker phase)
//   ctx.env                           the environment the steps run with
import fs from 'node:fs';
import net from 'node:net';
import os from 'node:os';
import path from 'node:path';
import { spawn, spawnSync } from 'node:child_process';
import { fileURLToPath, pathToFileURL } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const repo = path.resolve(here, '..', '..');
const contentDir = path.join(repo, 'docs', 'content', 'docs');
const PHASE_ORDER = ['site-setup', 'generate', 'github-pages', 'troubleshooting'];
const INSTALL = 'github:Nevensky/fumadocs-fortran';
const SCAFFOLD = /create-fumadocs-app@[\w.-]+/;
const PORT = 3000;

// ---- options
const opt = { phases: 'all' };
{
  const argv = process.argv.slice(2);
  const usage = (msg) => {
    console.error(`test-get-started: ${msg}; see the comment at the top of docs/scripts/test-get-started.mjs`);
    process.exit(2);
  };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    const val = () => (i + 1 < argv.length ? argv[++i] : usage(`${a} needs a value`));
    if (a === '--work') opt.work = path.resolve(val());
    else if (a === '--tarball') opt.tarball = path.resolve(val());
    else if (a === '--github') opt.github = true;
    else if (a === '--scaffold') opt.scaffold = val();
    else if (a === '--page') opt.page = path.resolve(val());
    else if (a === '--phases') opt.phases = val();
    else if (a === '--keep-going') opt.keepGoing = true;
    else if (a === '--keep') opt.keep = true;
    else usage(`unknown option ${a}`);
  }
  if (opt.github && opt.tarball) usage('--github and --tarball exclude each other');
}

const stop = (msg) => {
  console.error(`test-get-started: ${msg}`);
  process.exit(2);
};
const work = opt.work ?? fs.mkdtempSync(path.join(os.tmpdir(), 'fdf-get-started-'));
if (fs.existsSync(work) && fs.readdirSync(work).length) stop(`${work} is not empty`);
const project = path.join(work, 'project');
const site = path.join(project, 'docs');
const logs = path.join(work, 'logs');
fs.mkdirSync(logs, { recursive: true });
const env = { ...process.env, NEXT_TELEMETRY_DISABLED: '1' };

// ---- the report
const report = [];
const problems = [];
let phaseName = 'get-started';
const note = (s) => {
  report.push(s);
  console.log(s);
};
const fail = (s) => {
  problems.push(`${phaseName}: ${s}`);
  note(`FAIL: ${s}`);
};
const mask = (s) => String(s).replace(/\b\d+(\.\d+)? ?ms\b/g, 'N ms').replace(/\b\d+\.\d+ ?s\b/g, 'N s');
let logN = 0;
const logFile = (dir, label) => {
  const name = label.replace(/[^\w.-]+/g, '-').slice(0, 40);
  return path.join(dir, `${String(++logN).padStart(3, '0')}-${name}.log`);
};

// ---- commands
function run(cmd, { cwd = project, env: extra = {}, timeout = 900_000, label = 'run', dir = logs } = {}) {
  const t0 = Date.now();
  const r = spawnSync('sh', ['-c', cmd], {
    cwd, encoding: 'utf8', timeout, env: { ...env, ...extra }, maxBuffer: 256 << 20,
  });
  const secs = ((Date.now() - t0) / 1000).toFixed(1);
  const out = `${r.stdout ?? ''}${r.stderr ? `\n[stderr]\n${r.stderr}` : ''}`;
  const code = r.status ?? (r.signal ? `signal ${r.signal}` : `error ${r.error?.code ?? ''}`);
  const shownEnv = Object.entries(extra).map(([k, v]) => `${k}=${v} `).join('');
  const where = path.relative(work, cwd) || '.';
  fs.writeFileSync(logFile(dir, label), `$ ${shownEnv}${cmd}\n(in ${where})\n${out}\nexit ${code}, ${secs} s\n`);
  return { code, secs, out };
}
const has = (cmd) => spawnSync('sh', ['-c', `command -v ${cmd}`], { encoding: 'utf8' }).status === 0;

/** The commands of a bash block: its lines that are not empty or comments, a line ending in \ joined to the next. */
function commands(body) {
  const out = [];
  let cur = '';
  for (const raw of body.split('\n')) {
    const t = raw.trim();
    if (!cur && (!t || t.startsWith('#'))) continue;
    cur += cur ? ` ${t}` : t;
    if (cur.endsWith('\\')) cur = cur.slice(0, -1).trimEnd();
    else {
      out.push(cur);
      cur = '';
    }
  }
  if (cur) out.push(cur);
  return out;
}

// ---- pages
const slug = (s) => s.toLowerCase().replace(/[^\p{L}\p{N}\s_-]/gu, '').trim().replace(/\s/g, '-');
const FENCE = /^(\s*)(`{3,}|~{3,})([\w-]*)(.*)$/;

/** A page's blocks with the headings they are under, its headings, and its prose (the text outside code blocks). */
function parsePage(file) {
  const text = fs.readFileSync(file, 'utf8');
  const lines = text.split('\n');
  const blocks = [];
  const headings = [];
  const stack = [];
  const prose = [];
  let i = 0;
  if (lines[0] === '---') i = lines.indexOf('---', 1) + 1;
  for (; i < lines.length; i++) {
    const line = lines[i];
    const open = FENCE.exec(line);
    if (open) {
      const [, indent, fence, lang, rest] = open;
      const body = [];
      let j = i + 1;
      for (; j < lines.length; j++) {
        const t = lines[j].trim();
        if (t[0] === fence[0] && /^(`+|~+)$/.test(t) && t.length >= fence.length) break;
        body.push(lines[j].startsWith(indent) ? lines[j].slice(indent.length) : lines[j]);
      }
      const meta = rest.trim();
      blocks.push({
        lang: lang.toLowerCase(), meta, title: /title="([^"]*)"/.exec(meta)?.[1] ?? null, body: body.join('\n'),
        line: i + 1, sections: stack.map((s) => s.id),
      });
      i = j;
      continue;
    }
    prose.push(line);
    const h = /^(#{1,6})\s+(.+?)\s*$/.exec(line);
    if (h) {
      const depth = h[1].length;
      const idm = /\s*\[#([^\]]+)\]$/.exec(h[2]);
      const title = idm ? h[2].slice(0, idm.index) : h[2];
      const id = idm ? idm[1] : slug(title.replace(/`/g, ''));
      while (stack.length && stack[stack.length - 1].depth >= depth) stack.pop();
      stack.push({ depth, id });
      headings.push({ depth, id, title, line: i + 1 });
    }
  }
  return { file, rel: path.relative(repo, file), text, prose: prose.join('\n'), blocks, headings };
}
const quotes = (page, s) => mask(page.text).includes(mask(s));

// ---- file blocks
// a fumadocs code notation, as Shiki reads it: at the end of a line, the line's; alone on a line, the next line's
const NOTATION = /(?:\/\/|#|\/\*|\{\/\*|<!--)\s*\[!code (\+\+|--|highlight|hl)\]\s*(?:\*\/\}|\*\/|-->)?\s*$/;
const FILE_LANGS = new Set(['tsx', 'ts', 'jsx', 'js', 'mjs', 'cjs', 'json', 'css', 'yaml', 'yml', 'toml', 'diff']);

/** A file block's lines with their marks: ++ added, -- removed, highlight changed (from the line there). */
function markedLines(body) {
  const out = [];
  let pending = null;
  for (const raw of body.split('\n')) {
    const m = NOTATION.exec(raw);
    if (m && !raw.slice(0, m.index).trim()) {
      pending = m[1];
      continue;
    }
    const mark = m ? m[1] : pending;
    pending = null;
    out.push({ text: m ? raw.slice(0, m.index).trimEnd() : raw, mark: mark === 'hl' ? 'highlight' : mark });
  }
  return out;
}

/**
 * Writes a titled block into the project. A file block is the whole file: without its lines marked ++, and with its
 * highlighted lines as changed ones, it must be the file there (the template's, or the one an earlier step wrote);
 * a block with no marks is a new file. A diff block (```diff title="…") changes part of a file: its hunks, between
 * lines that start with @@, are context (a space), removed (-) and added (+) lines, and each hunk's context and
 * removed lines must follow one another in the file. Returns a problem, or null.
 */
function writeBlock(block, root = project) {
  const file = path.join(root, block.title);
  const rel = path.relative(work, file);
  const old = fs.existsSync(file) ? fs.readFileSync(file, 'utf8').replace(/\n$/, '') : null;
  const save = (lines, how) => {
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, `${lines.join('\n')}\n`);
    note(`  wrote ${block.title} (${how})`);
    return null;
  };
  if (block.lang === 'diff') {
    if (old === null) return `${block.title}: the diff is for a file that is not there`;
    const hunks = [[]];
    for (const raw of block.body.split('\n')) {
      if (raw.startsWith('@@')) hunks.push([]);
      else if (raw === '') hunks[hunks.length - 1].push({ sign: ' ', text: '' });
      else if ('+- '.includes(raw[0])) hunks[hunks.length - 1].push({ sign: raw[0], text: raw.slice(1) });
      else return `${block.title}: "${raw}" is no diff line (a space, + or - first)`;
    }
    const have = old.split('\n');
    const result = [];
    let pos = 0;
    for (const [n, hunk] of hunks.filter((h) => h.length).entries()) {
      const want = hunk.filter((l) => l.sign !== '+').map((l) => l.text);
      let at = -1;
      for (let k = pos; k + want.length <= have.length && at < 0; k++) {
        if (want.every((t, j) => have[k + j] === t)) at = k;
      }
      if (at < 0) {
        fs.writeFileSync(path.join(logs, `drift-${block.title.replace(/\W+/g, '-')}.txt`), old);
        const missing = want.find((t) => !have.includes(t)) ?? want[0];
        return `${block.title}: hunk ${n + 1} of the diff is not in the file (drift), such as "${missing}"`;
      }
      result.push(...have.slice(pos, at));
      for (const l of hunk) if (l.sign !== '-') result.push(l.text);
      pos = at + want.length;
    }
    result.push(...have.slice(pos));
    return save(result, 'changed by its diff');
  }
  const lines = markedLines(block.body);
  const after = lines.filter((l) => l.mark !== '--').map((l) => l.text);
  if (!lines.some((l) => l.mark)) return save(after, old === null ? 'a new file' : 'replaced: the block has no marks');
  if (old === null) return `${block.title}: the page marks the lines to add, but the file is not there`;
  const before = lines.filter((l) => l.mark !== '++');
  const have = old.split('\n');
  let drift = before.length === have.length ? ''
    : `${before.length} lines without the added ones, ${have.length} there`;
  for (let k = 0; !drift && k < before.length; k++) {
    if (before[k].mark !== 'highlight' && before[k].text !== have[k]) drift = `line ${k + 1} is "${have[k]}" there`;
  }
  if (drift) {
    fs.writeFileSync(path.join(logs, `drift-${block.title.replace(/\W+/g, '-')}.txt`), old);
    return `${block.title} without its marked lines differs from the file there (drift): ${drift}`;
  }
  return save(after, 'its marked lines added');
}

// ---- servers and pages
const portFree = (port) => new Promise((ok) => {
  const s = net.connect(port, '127.0.0.1');
  s.on('connect', () => {
    s.destroy();
    ok(false);
  });
  s.on('error', () => ok(true));
});

/** The reference pages, the overview first, in the order of the folder's meta.json. */
function refPages(dir = path.join(site, 'content', 'docs', 'api'), base = '/docs/api') {
  const file = path.join(dir, 'meta.json');
  if (!fs.existsSync(file)) return [];
  const meta = JSON.parse(fs.readFileSync(file, 'utf8'));
  const slugs = (meta.pages ?? []).filter((p) => p !== 'index' && !/^---.*---$/.test(p) && !p.startsWith('...'));
  return [{ slug: null, url: base }, ...slugs.map((s) => ({ slug: s, url: `${base}/${s}` }))];
}

// the generated pages' markup (the trial's markers), for ctx.count
const MARKS = {
  args: /class="fdf-args[ "]/g, argRows: /class="fdf-arg-row[ "]/g, badges: /class="fdf-badges[ "]/g,
  badge: /class="fdf-badge[ "]/g, refCard: /class="fdf-ref-card[ "]/g, source: /class="fdf-source[ "]/g,
  graph: /class="fdf-graph"/g, peleSvg: /<svg[^>]*class="pele/g, mermaidCode: /fdf-graph-body not-prose"><figure/g,
  katex: /class="katex"/g, katexError: /class="katex-error"/g, tocLetters: /class="fdf-toc-kind/g,
  directive: /fdf-directive/g, expected: /Expected component/g, apiReference: /API reference/g,
};
const count = (html, mark) => {
  const re = MARKS[mark] ?? (mark instanceof RegExp ? new RegExp(mark.source, 'g') : null);
  if (re) return (html.match(re) ?? []).length;
  return html.split(String(mark)).length - 1;
};

const argTables = {};
function checkPage(where, url, status, html) {
  const c = (m) => count(html, m);
  if (status !== 200) fail(`${where} ${url} answered ${status}`);
  if (c('expected')) fail(`${where} ${url} has "Expected component"`);
  if (!c('apiReference')) fail(`${where} ${url} has no "API reference" in its sidebar`);
  if (!/\/docs\/api$/.test(url) && !(c('badge') && c('source'))) fail(`${where} ${url} lacks badges or source blocks`);
  argTables[where] = (argTables[where] ?? 0) + c('args');
  return `${where} ${url}: ${status}, ${html.length} bytes, fdf-args ${c('args')}, fdf-badge ${c('badge')}, `
    + `fdf-source ${c('source')}, "API reference" ${c('apiReference')}, "Expected component" ${c('expected')}`;
}

/** An exported page: out/docs/api/demo.html, or out/docs/api/demo/index.html with trailingSlash. */
function outHtml(url, { out = path.join(site, 'out') } = {}) {
  const rel = url.replace(/^\/+|\/+$/g, '');
  for (const f of [path.join(out, `${rel}.html`), path.join(out, rel, 'index.html')]) {
    if (fs.existsSync(f)) return fs.readFileSync(f, 'utf8');
  }
  return null;
}

/** Starts a server (npm run dev, npm start), waits for it, fetches the reference pages, and stops it. */
async function serve(cmd, cwd, dir = logs) {
  const t0 = Date.now();
  const child = spawn('sh', ['-c', cmd], { cwd, env, detached: true });
  let text = '';
  child.stdout.on('data', (d) => (text += d));
  child.stderr.on('data', (d) => (text += d));
  let ready = false;
  for (let i = 0; i < 240 && !ready; i++) {
    try {
      ready = !!(await fetch(`http://localhost:${PORT}/`)).status;
    } catch {
      await new Promise((ok) => setTimeout(ok, 500));
    }
  }
  const lines = [`${cmd}: ${ready ? 'listening' : 'NOT listening'} after ${((Date.now() - t0) / 1000).toFixed(1)} s`];
  if (ready) {
    for (const { url } of refPages()) {
      try {
        const r = await fetch(`http://localhost:${PORT}${url}`);
        lines.push(`  ${checkPage('GET', url, r.status, await r.text())}`);
      } catch (e) {
        fail(`GET ${url}: ${e.message}`);
      }
    }
  }
  for (const [sig, wait] of [['SIGINT', 1500], ['SIGKILL', 300]]) {
    try {
      process.kill(-child.pid, sig);
    } catch {
      // gone
    }
    await new Promise((ok) => setTimeout(ok, wait));
  }
  fs.writeFileSync(logFile(dir, cmd), `${lines.join('\n')}\n--- output\n${text}`);
  return { ready, lines, text };
}

// ---- following a page
const SERVERS = new Set(['npm run dev', 'npm start']);
let tarball = null;
const swapInstall = (cmd) => {
  let c = cmd;
  if (opt.scaffold) c = c.replace(SCAFFOLD, `create-fumadocs-app@${opt.scaffold}`);
  if (tarball && c.startsWith('npm install ') && c.split(/\s+/).includes(INSTALL)) {
    c = c.split(/\s+/).map((w) => (w === INSTALL ? tarball : w)).join(' ');
  }
  return c;
};

async function follow(page, { sections = null, cwd = project, expect = [], dir = logs } = {}) {
  for (const [, want] of expect) if (!quotes(page, want)) fail(`${page.rel} does not quote "${want}"`);
  let last = null;
  let n = 0;
  for (const b of page.blocks) {
    if (sections && !b.sections.some((s) => sections.includes(s))) continue;
    n++;
    const at = `${page.rel}:${b.line}`;
    if (b.lang === 'bash' || b.lang === 'sh') {
      const cmds = commands(b.body);
      if (cmds.length !== 1) {
        fail(`${at}: ${cmds.length} commands in one bash block`);
        return { ok: false, cwd };
      }
      const shown = cmds[0];
      if (/^cd\s/.test(shown)) {
        const to = path.resolve(cwd, shown.slice(3).trim());
        note(`${at}: ${shown} -> ${path.relative(work, to)}${fs.existsSync(to) ? '' : ' (MISSING)'}`);
        if (!fs.existsSync(to)) {
          fail(`${at}: cd to a folder that does not exist`);
          return { ok: false, cwd };
        }
        cwd = to;
        last = null;
        continue;
      }
      if (SERVERS.has(shown)) {
        const r = await serve(shown, cwd, dir);
        note(`${at}: ${r.lines.join('\n')}`);
        if (!r.ready) {
          fail(`${at}: ${shown} never listened`);
          return { ok: false, cwd };
        }
        last = { cmd: shown, out: r.text };
      } else {
        const cmd = swapInstall(shown);
        const r = run(cmd, { cwd, label: shown, dir });
        note(`${at}: ${cmd} (in ${path.relative(work, cwd)}): exit ${r.code}, ${r.secs} s`);
        if (r.code !== 0) {
          fail(`${at}: "${cmd}" exited ${r.code}`);
          return { ok: false, cwd };
        }
        last = { cmd: shown, out: r.out };
      }
      for (const [start, want] of expect) {
        if (!shown.startsWith(start)) continue;
        if (mask(last.out).includes(mask(want))) note(`  output holds "${want}"`);
        else fail(`${at}: the output of "${shown}" does not hold "${want}"`);
      }
    } else if (b.lang === 'text') {
      if (!last) {
        fail(`${at}: a text block with no command before it`);
        continue;
      }
      for (const want of b.body.split('\n').map((l) => l.trim()).filter(Boolean)) {
        if (mask(last.out).includes(mask(want))) note(`${at}: "${want}" is in the output, times masked`);
        else fail(`${at}: "${want}" is not in the output of "${last.cmd}"`);
      }
    } else if (b.title && FILE_LANGS.has(b.lang)) {
      note(`${at}: ${b.title}`);
      const problem = writeBlock(b);
      if (problem) fail(`${at}: ${problem}`);
    }
  }
  if (!n) fail(`${page.rel}: no block under ${sections?.join(', ') ?? 'any heading'}`);
  return { ok: true, cwd };
}

// ---- Get started
async function getStarted() {
  const page = parsePage(opt.page ?? path.join(contentDir, 'get-started.mdx'));
  const install = page.blocks.filter((b) => b.lang === 'bash' && commands(b.body).some((c) => c.includes(INSTALL)));
  if (install.length !== 1) fail(`${page.rel} has ${install.length} bash blocks with ${INSTALL}, not one`);
  const version = opt.github
    ? JSON.parse(fs.readFileSync(path.join(repo, 'package.json'), 'utf8')).version
    : JSON.parse(spawnSync('tar', ['-xOzf', tarball, 'package/package.json'], { encoding: 'utf8' }).stdout).version;
  // quoted outputs: the start of the command, and what its output must hold (also quoted on the page)
  const EXPECT = [
    ['npx --yes create-fumadocs-app', 'Done'],
    ['npx fumadocs-fortran --version', version],
    ['npm exec --prefix docs -- fumadocs-fortran generate', '7 files (7 changed, 0 removed) from 3 sources in 70 ms'],
    ['npm run dev', `http://localhost:${PORT}`],
    ['npm run dev', 'metadataBase'],
    ['npm run build', 'metadataBase'],
    ['npm start', `http://localhost:${PORT}`],
  ];
  const r = await follow(page, { expect: EXPECT });
  if (!r.ok) return false;
  const out = path.join(site, 'out');
  if (!fs.existsSync(out)) {
    fail('no docs/out after the build');
    return false;
  }
  for (const { url } of refPages()) {
    const html = outHtml(url);
    if (html === null) fail(`out: no page for ${url}`);
    else note(checkPage('out', url, 200, html));
  }
  for (const where of ['GET', 'out']) if (!argTables[where]) fail(`${where}: no argument table on any reference page`);
  note(`argument tables: ${JSON.stringify(argTables)}`);
  return problems.length === 0;
}

// ---- phases
async function loadPhases() {
  const dir = path.join(here, 'phases');
  const files = fs.existsSync(dir) ? fs.readdirSync(dir).filter((f) => f.endsWith('.mjs')).sort() : [];
  const phases = [];
  for (const f of files) {
    const mod = (await import(pathToFileURL(path.join(dir, f)).href)).default;
    if (!mod?.name || typeof mod.run !== 'function') stop(`phases/${f} exports no { name, run(ctx) }`);
    phases.push(mod);
  }
  const rank = (p) => (PHASE_ORDER.includes(p.name) ? PHASE_ORDER.indexOf(p.name) : PHASE_ORDER.length);
  phases.sort((a, b) => rank(a) - rank(b) || a.name.localeCompare(b.name));
  if (opt.phases === 'none') return [];
  if (opt.phases === 'all') return phases;
  const want = opt.phases.split(',').map((s) => s.trim()).filter(Boolean);
  for (const w of want) if (!phases.some((p) => p.name === w)) stop(`no phase named ${w} in docs/scripts/phases`);
  return phases.filter((p) => want.includes(p.name));
}

async function runPhase(phase) {
  phaseName = phase.name;
  const dir = path.join(logs, phase.name);
  fs.mkdirSync(dir, { recursive: true });
  const before = problems.length;
  const seeds = [];
  const abs = (rel) => path.join(project, rel);
  const ctx = {
    repo, project, site, tarball, logDir: dir, logs, env, MARKS, commands,
    scratch: (name) => {
      const d = path.join(work, 'scratch', `${phase.name}-${name}`);
      fs.rmSync(d, { recursive: true, force: true });
      fs.mkdirSync(d, { recursive: true });
      return d;
    },
    page: (rel) => parsePage(path.join(contentDir, rel)),
    follow: (page, o = {}) => follow(page, { ...o, dir }),
    run: (cmd, o = {}) => {
      const r = run(cmd, { label: o.label ?? cmd, ...o, dir });
      note(`  ${o.label ? `${o.label}: ` : ''}${cmd}: exit ${r.code}, ${r.secs} s`);
      if (r.code !== 0 && !o.allowFail) fail(`"${cmd}" exited ${r.code}`);
      return r;
    },
    build: (o = {}) => ctx.run('npm run build', { cwd: site, label: o.label ?? 'build', ...o }),
    seed: (rel, edit) => {
      const old = fs.readFileSync(abs(rel), 'utf8');
      const next = edit(old);
      if (next === old) fail(`seeding ${rel} changed nothing`);
      fs.writeFileSync(abs(rel), next);
      let undone = false;
      const undo = () => {
        if (!undone) fs.writeFileSync(abs(rel), old);
        undone = true;
      };
      seeds.push(undo);
      return undo;
    },
    write: (rel, text) => {
      fs.mkdirSync(path.dirname(abs(rel)), { recursive: true });
      fs.writeFileSync(abs(rel), text);
    },
    read: (rel) => fs.readFileSync(abs(rel), 'utf8'),
    exists: (rel) => fs.existsSync(abs(rel)),
    refPages: (d, base) => refPages(d ? path.resolve(project, d) : undefined, base),
    outHtml, count, checkPage, quotes, has,
    expect: (ok, msg) => {
      if (!ok) fail(msg);
      return !!ok;
    },
    fail, note,
  };
  note(`--- phase ${phase.name}`);
  try {
    await phase.run(ctx);
  } catch (e) {
    fail(`the phase stopped: ${e.stack ?? e}`);
  } finally {
    for (const undo of seeds.reverse()) undo();
  }
  const ok = problems.length === before;
  note(`--- phase ${phase.name}: ${ok ? 'passed' : `failed (${problems.length - before} problems)`}`);
  return ok;
}

// ---- main
const t0 = Date.now();
if (!(await portFree(PORT))) stop(`port ${PORT} is in use: the page's servers need it`);
for (const cmd of ['git', 'npm', 'tar']) if (!has(cmd)) stop(`${cmd} is not on PATH`);
note(`node ${process.version}, npm ${run('npm --version', { cwd: repo, label: 'npm-version' }).out.trim()}, `
  + `${run('git --version', { cwd: repo, label: 'git-version' }).out.trim()}; work folder ${work}`);
if (!opt.github) {
  if (opt.tarball) tarball = opt.tarball;
  else {
    const dest = path.join(work, 'pkg');
    fs.mkdirSync(dest);
    const r = run(`npm pack --json --pack-destination "${dest}"`, { cwd: repo, label: 'npm-pack' });
    if (r.code !== 0) stop(`npm pack failed: see its log in ${logs}`);
    tarball = path.join(dest, JSON.parse(r.out.split('\n[stderr]\n')[0])[0].filename);
  }
  if (!fs.existsSync(tarball)) stop(`no tarball at ${tarball}`);
  note(`the GitHub install line installs ${tarball}`);
}
fs.cpSync(path.join(repo, 'examples', 'modern', 'src'), path.join(project, 'src'), { recursive: true });

const phases = await loadPhases();
let ok = await getStarted();
note(`--- Get started: ${ok ? 'passed' : 'failed'}`);
for (const phase of phases) {
  if (!ok && !opt.keepGoing) {
    note(`--- phase ${phase.name}: not run, as an earlier part failed`);
    continue;
  }
  ok = (await runPhase(phase)) && ok;
}
phaseName = 'result';
const mins = ((Date.now() - t0) / 60000).toFixed(1);
note(problems.length ? `RESULT: failed, ${problems.length} problems (${mins} min):\n  ${problems.join('\n  ')}`
  : `RESULT: every block ran and every check passed (${mins} min)`);
fs.writeFileSync(path.join(logs, 'report.txt'), `${report.join('\n')}\n`);
if (problems.length || opt.keep) console.log(`the work folder is kept: ${work}`);
else fs.rmSync(work, { recursive: true, force: true });
process.exit(problems.length ? 1 : 0);
