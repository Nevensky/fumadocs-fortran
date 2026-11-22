// Checks the Command line page (content/docs/reference/cli.mdx) against the command it describes, bin/fumadocs-fortran.js:
// - the help partial the page includes (snippets/cli/help.txt) is what `fumadocs-fortran --help` prints; `--write`
//   rewrites it from there;
// - each command of the help has a section (## dump, ## generate), and no code on the page names another command;
// - each option of the help has a section of its own, an ### heading that writes the option as the help does, with an
//   explicit id, and the page has no option section the help lacks. The line under the heading names the commands
//   that take the option (and says "repeatable" where the help does), its default and its JavaScript option. The
//   default is the help's own where the help gives one, or what a run shows, for the paths and the title;
// - the values of --math, --source, --graphs and --library-cards the command accepts, the providers of --links
//   (src/emit/library.js), and the extensions a folder is searched for (src/source/form.js);
// - every option a fumadocs-fortran command on the page uses is one the help lists, and each output the page quotes
//   in a text block after such a command is what the command prints, run in a scratch folder whose src/ holds
//   examples/modern/src (times masked);
// - the exit codes and messages: each message bin/ can give (its fail() texts) and each message a set of wrong
//   command lines gives has a row in the messages table, and each row is one of them; the exit codes of those runs
//   are those of the exit code table; the diagnostic line generate writes has the form the page gives;
// - the diagnostic codes src/ writes are those of the diagnostics table, and a code's row gives each message src/
//   writes with it, and no other;
// - the environment variables bin/ and src/ read are those the page names.
//
//   node scripts/check-cli.mjs [--write]
//
// It exits 1 when it finds a problem, printing one line per problem with the page's line. check-api.mjs reads the
// option sections through the functions exported here.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath, pathToFileURL } from 'node:url';

export const site = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
export const repo = path.dirname(site);
export const bin = path.join(repo, 'bin', 'fumadocs-fortran.js');
export const cliPage = path.join(site, 'content', 'docs', 'reference', 'cli.mdx');

// ---------------------------------------------------------------- a page's blocks

/**
 * An inline code span, as CommonMark reads one: a run of backticks, then the text up to the next run of as many, no
 * more and no fewer, so that `` ```mermaid `` and ` ```mermaid ` are one span each; it never crosses a blank line.
 */
export const CODE_SPAN = /(?<!`)(`+)(?!`)((?:(?!\n[ \t]*\n)[\s\S])*?[^`])(?<!`)\1(?!`)/g;

/** The contents of the inline code spans of some Markdown text, in order. */
export function codeSpans(text) {
  const out = [];
  for (const m of String(text).matchAll(CODE_SPAN)) {
    let s = m[2].replace(/\n/g, ' ');
    if (/^ .* $/.test(s)) s = s.slice(1, -1);
    out.push(s);
  }
  return out;
}

/** Markdown links as their text. */
export const linkText = (text) => String(text).replace(/\[((?:[^\]`]|`[^`]*`)*)\]\([^)]*\)/g, '$1');

/** A table row's cells, split at the pipes that are not escaped, with `\|` read as `|`. */
export function cells(row) {
  const inner = row.trim().replace(/^\|/, '').replace(/\|$/, '');
  return inner.split(/(?<!\\)\|/).map((c) => c.trim().replace(/\\\|/g, '|'));
}

/**
 * The blocks of an MDX page, each with its line: headings (with their explicit [#id]), fenced code, tables, JSX and
 * paragraphs. The front matter is skipped.
 */
export function readBlocks(text) {
  const lines = text.split('\n');
  const blocks = [];
  let i = lines[0] === '---' ? lines.indexOf('---', 1) + 1 : 0;
  while (i < lines.length) {
    const t = lines[i].trim();
    if (!t) {
      i++;
      continue;
    }
    // a backtick fence's info string holds no backtick (CommonMark), so ```` ```math ```` in a line is inline code
    const fence = /^(`{3,}|~{3,})(.*)$/.exec(t);
    if (fence && !(fence[1][0] === '`' && fence[2].includes('`'))) {
      const start = i;
      const close = new RegExp(`^${fence[1][0] === '`' ? '`' : '~'}{${fence[1].length},}$`);
      const body = [];
      for (i++; i < lines.length && !close.test(lines[i].trim()); i++) body.push(lines[i]);
      i++;
      const [lang = '', ...meta] = fence[2].trim().split(/\s+/);
      blocks.push({ type: 'code', lang, meta: meta.join(' '), body, line: start + 1 });
      continue;
    }
    const heading = /^(#{1,6})\s+(.*?)(?:\s+\[#([^\]]+)\])?\s*$/.exec(t);
    if (heading) {
      blocks.push({ type: 'heading', depth: heading[1].length, text: heading[2], id: heading[3] ?? null, line: i + 1 });
      i++;
      continue;
    }
    if (t.startsWith('|')) {
      const start = i;
      const rows = [];
      while (i < lines.length && lines[i].trim().startsWith('|')) rows.push(lines[i++]);
      const [head, , ...rest] = rows;
      blocks.push({
        type: 'table', header: cells(head), rows: rest.map((r, k) => ({ cells: cells(r), line: start + 3 + k })),
        text: rest.join('\n'), line: start + 1,
      });
      continue;
    }
    const start = i;
    const para = [];
    const opens = (l) => /^(#{1,6}\s|\|)/.test(l) || (/^(`{3,}|~{3,})/.test(l) && !/^`{3,}.*`/.test(l));
    while (i < lines.length && lines[i].trim() && (i === start || !opens(lines[i].trim()))) para.push(lines[i++]);
    blocks.push({ type: t.startsWith('<') ? 'jsx' : 'para', text: para.join('\n'), line: start + 1 });
  }
  return blocks;
}

/** The sections under the ## and ### headings: each heading with its blocks up to the next such heading. */
export function sections(blocks) {
  const out = [];
  let h2 = null;
  let cur = null;
  for (const b of blocks) {
    if (b.type === 'heading' && b.depth <= 3) {
      if (b.depth === 2) h2 = b;
      cur = { heading: b, h2: b.depth === 3 ? h2 : null, blocks: [] };
      out.push(cur);
    } else if (cur) cur.blocks.push(b);
  }
  return out;
}

/** The inline code of some blocks' text (paragraphs, JSX and tables; not code blocks). */
export const inlineCode = (blocks) => blocks.flatMap((b) => (b.type === 'code' || b.type === 'heading' ? [] : codeSpans(b.text)));

// ---------------------------------------------------------------- the help

/** The help, as the command prints it. */
export function realHelp() {
  const r = spawnSync(process.execPath, [bin, '--help'], { encoding: 'utf8' });
  if (r.status !== 0) throw new Error(`fumadocs-fortran --help exited with ${r.status}: ${r.stderr}`);
  return r.stdout;
}

/**
 * The help's commands and options: each option with its spec as the help writes it (`-o, --out DIR`), its flags, its
 * value's name, its description (the lines under it joined), the default its first line gives, whether it is
 * repeatable, and the commands that take it.
 */
export function parseHelp(help) {
  const lines = help.split('\n');
  const commands = [];
  const options = [];
  let section = null;
  let shared = [];
  let last = null;
  // the column the descriptions start in: the most common end of the gap after a spec
  const starts = lines.map((l) => /^ {2}\S.*?\S {2,}(?=\S)/.exec(l)?.[0].length).filter(Boolean);
  const count = (n) => starts.filter((x) => x === n).length;
  const col = [...starts].sort((a, b) => count(b) - count(a))[0];
  for (const line of lines) {
    if (/^\S.*:$/.test(line)) {
      section = line;
      last = null;
      const m = /^Options for \w+ \(and (.*) as for \w+\):$/.exec(line);
      if (m) shared = m[1].split(/,\s*/).map((s) => s.trim());
      continue;
    }
    if (!line.trim() || /^\S/.test(line)) {
      last = null;
      continue;
    }
    if (section === 'Commands:' && /^ {2}\S/.test(line)) {
      const spec = line.slice(0, col).trim();
      commands.push({ name: spec.split(/\s+/)[0], spec, description: line.slice(col).trim() });
      continue;
    }
    const opt = /^Options for (\w+)/.exec(section ?? '');
    if (!opt) continue;
    const spec = /^ {2}-/.test(line) ? line.slice(0, col).trim() : '';
    const m = /^((?:-\w|--[\w-]+)(?:, (?:-\w|--[\w-]+))*)(?: (\S+))?$/.exec(spec);
    if (m) {
      const first = line.slice(col).trim();
      last = {
        spec, flags: m[1].split(', '), value: m[2] ?? null, description: first,
        default: /\(default ([^):]+)\)/.exec(first)?.[1] ?? /(\S+) \(default\)/.exec(first)?.[1] ?? null,
        repeatable: /\(repeatable\)/.test(first), section: opt[1],
      };
      options.push(last);
    } else if (last) last.description += `\n${line.trim()}`;
  }
  // dump's options are generate's too when generate's header names them; -h and -v are any command's
  for (const o of options) {
    if (o.flags.includes('--help') || o.flags.includes('--version')) o.commands = ['any'];
    else if (o.section === 'dump') o.commands = o.flags.some((f) => shared.includes(f)) ? ['dump', 'generate'] : ['dump'];
    else o.commands = [o.section];
  }
  return { commands, options, shared };
}

// ---------------------------------------------------------------- the page's option sections

/**
 * The option sections of the Command line page: the ### headings that write an option (they start with -) and the
 * Paths heading, each with the line under it split at ' · ': the commands (or "any command", and "repeatable"), the
 * default (`default: …`) and the JavaScript option (`JavaScript: …`, or `JavaScript: none`).
 */
export function pageOptions(text) {
  const out = [];
  for (const s of sections(readBlocks(text))) {
    const h = s.heading;
    if (h.depth !== 3 || !(h.text.startsWith('-') || h.text === 'Paths')) continue;
    const first = s.blocks[0]?.type === 'para' ? s.blocks[0] : null;
    const line = first ? linkText(first.text.replace(/\n/g, ' ')) : '';
    const parts = line.split(' · ');
    const words = codeSpans(parts[0] ?? '');
    const def = /^default:\s*(.*)$/.exec(parts[1] ?? '')?.[1];
    const js = /^JavaScript:\s*(.*)$/.exec(parts[2] ?? '')?.[1];
    out.push({
      heading: h.text, id: h.id, line: h.line, lineAt: first?.line ?? h.line, lineText: line, parts,
      commands: /^any command\b/.test(parts[0] ?? '') ? ['any'] : words.filter((w) => /^[a-z]+$/.test(w)),
      usage: h.text === 'Paths' ? words.find((w) => w.startsWith('[')) ?? null : h.text,
      repeatable: /\brepeatable\b/.test(parts[0] ?? ''),
      default: def === undefined ? undefined : /^`/.test(def.trim()) ? codeSpans(def)[0] : def.trim(),
      javascript: js === undefined ? undefined : js.trim() === 'none' ? [] : codeSpans(js),
      section: s,
    });
  }
  return out;
}

// ---------------------------------------------------------------- messages

/**
 * Whether a message the page gives, with its changing parts in capitals, is one a template of the code writes: the
 * template's fixed parts, those around its ${…}, in order, the first at the start and the last at the end.
 */
export function holds(said, template) {
  const parts = template.split(/\$\{[^}]*\}/);
  if (parts.length === 1) return said === template;
  if (!said.startsWith(parts[0]) || !said.endsWith(parts.at(-1))) return false;
  let from = parts[0].length;
  for (const part of parts.slice(1, -1)) {
    const k = said.indexOf(part, from);
    if (k < 0) return false;
    from = k + part.length;
  }
  return from <= said.length - parts.at(-1).length;
}

// ---------------------------------------------------------------- shell words

/** A shell command's words: blanks split them, quotes keep them together. */
export function shellWords(command) {
  const words = [];
  let cur = null;
  for (let i = 0; i < command.length; i++) {
    const c = command[i];
    if (c === "'" || c === '"') {
      const j = command.indexOf(c, i + 1);
      cur = (cur ?? '') + command.slice(i + 1, j < 0 ? command.length : j);
      i = j < 0 ? command.length : j;
    } else if (/\s/.test(c)) {
      if (cur !== null) words.push(cur);
      cur = null;
    } else cur = (cur ?? '') + c;
  }
  if (cur !== null) words.push(cur);
  return words;
}

/** The arguments of the fumadocs-fortran command a shell line runs, or null when it runs none. */
export function cliArgs(line) {
  const words = shellWords(line.trim());
  const at = words.indexOf('fumadocs-fortran');
  return at < 0 ? null : words.slice(at + 1);
}

// ---------------------------------------------------------------- the check

async function main() {
  const write = process.argv.includes('--write');
  const problems = [];
  const rel = (file) => path.relative(process.cwd(), file);
  const at = (line, msg) => problems.push(`${rel(cliPage)}:${line}: ${msg}`);
  const text = fs.readFileSync(cliPage, 'utf8');
  const blocks = readBlocks(text);
  const secs = sections(blocks);

  // ---- the help partial
  const help = realHelp();
  const parsed = parseHelp(help);
  const include = /<include\b[^>]*>([^<]+)<\/include>/.exec(text);
  if (!include) at(1, 'no help partial included (<include lang="text">…/snippets/cli/help.txt</include>)');
  else {
    const partial = path.resolve(path.dirname(cliPage), include[1].trim());
    let shown = null;
    try {
      shown = fs.readFileSync(partial, 'utf8');
    } catch {
      // written below with --write
    }
    if (write && shown !== help) {
      fs.mkdirSync(path.dirname(partial), { recursive: true });
      fs.writeFileSync(partial, help);
      console.log(`check-cli: wrote ${rel(partial)}`);
      shown = help;
    }
    if (shown === null) problems.push(`${rel(partial)}: missing; node scripts/check-cli.mjs --write writes it`);
    else if (shown !== help) {
      const a = shown.split('\n');
      const b = help.split('\n');
      const k = a.findIndex((l, n) => l !== b[n]);
      problems.push(`${rel(partial)}:${k + 1}: --help prints ${JSON.stringify(b[k] ?? '(no line)')} here, not `
        + `${JSON.stringify(a[k] ?? '(no line)')}; node scripts/check-cli.mjs --write rewrites the partial`);
    }
  }

  // ---- the commands
  const names = parsed.commands.map((c) => c.name);
  for (const c of names) {
    if (!secs.some((s) => s.heading.depth === 2 && s.heading.text === c)) at(1, `the command ${c} has no section (## ${c})`);
  }
  for (const s of secs) {
    if (s.heading.depth === 2 && /^[a-z]+$/.test(s.heading.text) && !names.includes(s.heading.text)) {
      at(s.heading.line, `## ${s.heading.text}: the help has no command ${s.heading.text}`);
    }
  }
  const code = [];
  for (const b of blocks) {
    if (b.type === 'code') b.body.forEach((l, k) => code.push({ text: l, line: b.line + 1 + k }));
    else if (b.type !== 'heading') for (const span of codeSpans(b.text)) code.push({ text: span, line: b.line });
  }
  for (const c of code) {
    // a command as a shell line or a code span writes it: fumadocs-fortran first, or after npx or npm exec's --
    for (const m of c.text.matchAll(/(?:^\s*|\bnpx\s+|\s--\s+)fumadocs-fortran\s+([a-z][\w-]*)/g)) {
      if (!names.includes(m[1])) at(c.line, `fumadocs-fortran ${m[1]}: no such command (the help has ${names.join(' and ')})`);
    }
  }

  // ---- the option sections against the help, and the defaults a run shows
  const page = pageOptions(text);
  const scratch = fs.mkdtempSync(path.join(os.tmpdir(), 'check-cli-'));
  process.on('exit', () => fs.rmSync(scratch, { recursive: true, force: true }));
  const run = (args, cwd = scratch) => spawnSync(process.execPath, [bin, ...args], { cwd, encoding: 'utf8' });
  const tiny = path.join(scratch, 'tiny');
  fs.mkdirSync(tiny);
  fs.writeFileSync(path.join(tiny, 'one.f90'), 'module one\ncontains\n  subroutine s()\n  end subroutine s\nend module one\n');
  const derived = new Map();
  if (/^1 file,/m.test(run(['dump', '--summary'], tiny).stdout)) derived.set('Paths', 'the current folder');
  const gen = run(['generate'], tiny);
  try {
    derived.set('--title TEXT', JSON.parse(fs.readFileSync(path.join(tiny, 'content/docs/api/meta.json'), 'utf8')).title);
  } catch {
    problems.push(`generate without options wrote no content/docs/api/meta.json: ${gen.stderr.split('\n')[0]}`);
  }
  const paths = parsed.commands.map((c) => /\[paths…\]/.exec(c.spec)?.[0]).filter(Boolean);
  for (const o of parsed.options) {
    const found = page.filter((p) => p.heading === o.spec);
    if (!found.length) at(1, `the option ${o.spec} (${o.commands.join(', ')}) has no section: ### ${o.spec} [#id]`);
    else if (found.length > 1) at(found[1].line, `### ${o.spec}: a second section of the option`);
  }
  for (const p of page) {
    const o = parsed.options.find((x) => x.spec === p.heading);
    if (p.heading === 'Paths') {
      if (!paths.includes(p.usage)) at(p.lineAt, `Paths: the line names ${p.usage ?? 'no paths'}, the help ${paths[0]}`);
      if (p.commands.join(' ') !== names.join(' ')) at(p.lineAt, `Paths: the commands ${p.commands.join(', ')}, not ${names.join(', ')}`);
    } else if (!o) {
      at(p.line, `### ${p.heading}: not an option of the help (${parsed.options.map((x) => x.spec).join('; ')})`);
      continue;
    }
    if (!p.id) at(p.line, `### ${p.heading}: no explicit [#id]`);
    if (p.parts.length !== 3 || p.default === undefined || p.javascript === undefined) {
      at(p.lineAt, `### ${p.heading}: the line under the heading reads "COMMANDS · default: VALUE · JavaScript: NAME", `
        + `not ${JSON.stringify(p.lineText.slice(0, 100))}`);
      continue;
    }
    if (o) {
      const want = o.commands.join(' ');
      if (p.commands.join(' ') !== want) at(p.lineAt, `${o.spec}: the commands ${p.commands.join(', ') || '(none)'}, where the help has ${want}`);
      if (o.repeatable && !p.repeatable) at(p.lineAt, `${o.spec}: the help says it is repeatable, the page does not`);
      if (o.default !== null && p.default !== o.default) {
        at(p.lineAt, `${o.spec}: default ${JSON.stringify(p.default)}, where the help has ${JSON.stringify(o.default)}`);
      }
    }
    const d = derived.get(p.heading);
    if (d !== undefined && p.default !== d) at(p.lineAt, `${p.heading}: default ${JSON.stringify(p.default)}, where a run shows ${JSON.stringify(d)}`);
  }

  // ---- the values the command accepts, the --links providers and the extensions
  const source = fs.readFileSync(bin, 'utf8');
  for (const m of source.matchAll(/if \(!\[([^\]]+)\]\.includes\(o\.\w+\)\) fail\('(--[\w-]+) takes/g)) {
    const p = page.find((x) => x.heading.split(' ')[0] === m[2]);
    if (!p) continue;
    const said = new Set(inlineCode(p.section.blocks));
    for (const v of m[1].matchAll(/'([^']+)'/g)) if (!said.has(v[1])) at(p.line, `${m[2]}: the section does not name the value \`${v[1]}\``);
  }
  const { LINK_PROVIDERS } = await import(pathToFileURL(path.join(repo, 'src/emit/library.js')).href);
  const links = page.find((x) => x.heading.startsWith('--links'));
  const providers = links?.section.blocks.find((b) => b.type === 'table' && /^library$/i.test(b.header[0]));
  if (!providers) at(links?.line ?? 1, '--links: no table of the libraries and providers (| Library | Providers | Default |)');
  else {
    const seen = new Map();
    for (const r of providers.rows) seen.set(codeSpans(r.cells[0])[0], r);
    for (const [lib, r] of seen) {
      const want = LINK_PROVIDERS[lib];
      if (!want) {
        at(r.line, `--links: no library ${lib} (the libraries are ${Object.keys(LINK_PROVIDERS).join(', ')})`);
        continue;
      }
      const got = codeSpans(r.cells[1]);
      if (got.join(' ') !== want.join(' ')) at(r.line, `--links: ${lib} takes ${want.join(', ')}, not ${got.join(', ')}`);
      // the first provider is the default; "as `lapack`" names a library with the same providers
      const def = r.cells[2] ?? '';
      const as = /^as `(\w+)`/.exec(def)?.[1];
      if (as ? LINK_PROVIDERS[as]?.join(' ') !== want.join(' ') : !codeSpans(def).includes(want[0])) {
        at(r.line, `--links: ${lib}'s default is ${want[0]}`);
      }
      for (const prov of want) if (!help.includes(prov)) at(r.line, `--links: the help does not name ${lib}'s provider ${prov}`);
    }
    for (const lib of Object.keys(LINK_PROVIDERS)) if (!seen.has(lib)) at(providers.line, `--links: the table lacks ${lib}`);
  }
  const { EXTENSIONS, formFromPath } = await import(pathToFileURL(path.join(repo, 'src/source/form.js')).href);
  const pathsSection = page.find((x) => x.heading === 'Paths');
  const extTable = pathsSection?.section.blocks.find((b) => b.type === 'table' && /^form$/i.test(b.header[0]));
  if (!extTable) at(pathsSection?.line ?? 1, 'Paths: no table of the extensions a folder is searched for (| Form | Extensions |)');
  else {
    const want = new Map();
    for (const e of EXTENSIONS) {
      const form = formFromPath(`x.${e}`) ?? 'text';
      want.set(form, [...(want.get(form) ?? []), `.${e}`]);
    }
    for (const r of extTable.rows) {
      const form = /^(fixed|free)$/.test(r.cells[0]) ? r.cells[0] : 'text';
      const got = codeSpans(r.cells[1]);
      const exp = want.get(form) ?? [];
      if (got.join(' ') !== exp.join(' ')) at(r.line, `Paths: ${r.cells[0]}: ${exp.join(', ')}, not ${got.join(', ')}`);
      want.delete(form);
    }
    for (const [form, exts] of want) at(extTable.line, `Paths: the table lacks the ${form} extensions ${exts.join(', ')}`);
  }

  // ---- the commands the page shows, and the outputs it quotes
  const flags = new Map(parsed.options.flatMap((o) => o.flags.map((f) => [f, o])));
  const example = path.join(scratch, 'example');
  fs.cpSync(path.join(repo, 'examples/modern/src'), path.join(example, 'src'), { recursive: true });
  const mask = (s) => s.replace(/\b\d+ ms\b/g, 'N ms').replace(/[ \t]+$/gm, '').trim();
  let shells = 0;
  let quoted = 0;
  for (let k = 0; k < blocks.length; k++) {
    const b = blocks[k];
    if (b.type !== 'code' || !['bash', 'sh', 'shell'].includes(b.lang)) continue;
    shells++;
    const cmd = b.body.find((l) => l.trim() && !l.trim().startsWith('#'));
    const args = cmd ? cliArgs(cmd) : null;
    if (!args) continue;
    for (let n = 0; n < args.length; n++) {
      const a = args[n];
      if (!a.startsWith('-') || /^-[DI]./.test(a)) continue;
      const o = flags.get(a);
      if (!o) at(b.line + 1, `${a}: not an option of the help`);
      else if (o.value && ++n >= args.length) at(b.line + 1, `${a} needs a value`);
    }
    if (args[0] && !args[0].startsWith('-') && !names.includes(args[0])) at(b.line + 1, `${args[0]}: no such command`);
    // a text block before the next code block quotes what this command prints
    const next = blocks.slice(k + 1).find((x) => x.type === 'code');
    if (next && next.lang === 'text' && !next.meta) {
      quoted++;
      const r = run(args, example);
      const said = mask(next.body.join('\n')).split('\n');
      const got = mask(`${r.stdout}${r.stderr}`).split('\n');
      const n = said.findIndex((l, i) => l !== got[i]);
      if (n >= 0 || said.length !== got.length) {
        const i = n >= 0 ? n : Math.min(said.length, got.length);
        at(next.line + 1 + i, `\`fumadocs-fortran ${args.join(' ')}\` prints ${JSON.stringify(got[i] ?? '(no line)')} here, `
          + `not ${JSON.stringify(said[i] ?? '(no line)')}`);
      }
    }
  }

  // ---- exit codes and messages
  const tableOf = (first) => blocks.find((b) => b.type === 'table' && b.header[0].toLowerCase() === first);
  const exitTable = tableOf('exit code');
  const msgTable = tableOf('message');
  const diagTable = tableOf('code');
  if (!exitTable) at(1, 'no exit code table (| Exit code | When |)');
  if (!msgTable) at(1, 'no messages table (| Message | Cause |)');
  if (!diagTable) at(1, 'no diagnostics table (| Code | Message | What to do |)');
  const PLACEHOLDERS = /\b(NAME|OPTION|ITEM|LIBRARY|PROVIDERS|PROVIDER)\b/g;
  const escape = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const rows = (msgTable?.rows ?? []).map((r) => {
    const said = codeSpans(r.cells[0])[0] ?? '';
    return { said, re: new RegExp(`^${escape(said).replace(PLACEHOLDERS, '(.+?)').replace(/…/g, '.*')}$`), line: r.line, used: false };
  });
  // bin/'s fail() texts: a row gives each
  for (const m of source.matchAll(/\bfail\((['`])((?:(?!\1).)*)\1\)/g)) {
    const row = rows.find((r) => holds(r.said, m[2]));
    if (row) row.used = true;
    else at(msgTable?.line ?? 1, `no row for the message ${JSON.stringify(m[2])} of bin/fumadocs-fortran.js`);
  }
  const exits = new Map();
  const runs = [
    [[], 1], [['--help'], 0], [['--version'], 0], [['frob'], 2], [['dump', '--frob'], 2], [['dump', '-I'], 2],
    [['generate', '--math', 'tex'], 2], [['generate', '--source', 'none'], 2], [['generate', '--graphs', 'dot'], 2],
    [['generate', '--library-cards', 'off'], 2], [['generate', '--links', 'mpi'], 2],
    [['generate', '--links', 'pvm=x'], 2], [['generate', '--links', 'mpi=lam'], 2], [['generate', '--title=X'], 2],
    [['generate', 'tiny/one.f90', '-o', 'tiny/one.f90/out'], 1], [['dump', '--summary', 'tiny'], 0],
  ];
  for (const [args, want] of runs) {
    const r = run(args);
    exits.set(r.status, [...(exits.get(r.status) ?? []), args.join(' ') || '(no arguments)']);
    if (r.status !== want) problems.push(`fumadocs-fortran ${args.join(' ')} exited with ${r.status}, not ${want}`);
    if (r.status !== 2) continue;
    const msg = r.stderr.replace(/^fumadocs-fortran: /, '').trimEnd();
    const row = rows.find((x) => x.re.test(msg));
    if (row) row.used = true;
    else at(msgTable?.line ?? 1, `no row for the message of \`fumadocs-fortran ${args.join(' ')}\`: ${msg}`);
  }
  for (const r of rows) if (!r.used) at(r.line, `${r.said}: a message the command does not give`);
  if (exitTable) {
    const listed = exitTable.rows.map((r) => ({ code: Number(codeSpans(r.cells[0])[0] ?? r.cells[0]), line: r.line }));
    for (const [code, args] of exits) if (!listed.some((x) => x.code === code)) at(exitTable.line, `no row for exit code ${code} (${args.join('; ')})`);
    for (const x of listed) if (!exits.has(x.code)) at(x.line, `exit code ${x.code}: no run gives it`);
  }
  const form = inlineCode(blocks).find((s) => /^FILE:LINE: /.test(s));
  if (!form) at(1, 'the page gives no form of a diagnostic line (`FILE:LINE: …`)');
  else {
    fs.writeFileSync(path.join(scratch, 'open.f90'), 'module open\n');
    const line = run(['generate', 'open.f90', '-o', 'open']).stderr.split('\n')[0];
    const re = new RegExp(`^${escape(form).replace(/\b(FILE|LINE|SEVERITY|MESSAGE|CODE)\b/g, '(.+?)')}$`);
    if (!re.test(line)) at(1, `a diagnostic line reads ${JSON.stringify(line)}, not as ${form}`);
  }

  // ---- the diagnostic codes src/ writes
  const files = (dir, ext) => fs.readdirSync(dir, { withFileTypes: true }).flatMap((e) => {
    const p = path.join(dir, e.name);
    return e.isDirectory() ? files(p, ext) : ext.test(e.name) ? [p] : [];
  });
  const codes = new Set();
  for (const f of files(path.join(repo, 'src'), /\.js$/)) {
    for (const m of fs.readFileSync(f, 'utf8').matchAll(/\bdiag\('([\w-]+)'|\bcode: '([\w-]+)'/g)) codes.add(m[1] ?? m[2]);
  }
  if (diagTable) {
    const listed = diagTable.rows.map((r) => ({ code: codeSpans(r.cells[0])[0], said: codeSpans(r.cells[1] ?? ''), line: r.line }));
    for (const c of codes) if (!listed.some((x) => x.code === c)) at(diagTable.line, `the diagnostic ${c} (src/) has no row`);
    for (const x of listed) if (!codes.has(x.code)) at(x.line, `${x.code}: src/ writes no such diagnostic`);
    // the messages of each code, as src/ writes them: a message of the row holds the fixed parts of each, in order,
    // and each message of the row is one of them
    const messages = new Map();
    for (const f of files(path.join(repo, 'src'), /\.js$/)) {
      const js = fs.readFileSync(f, 'utf8');
      const add = (code, template) => messages.set(code, [...(messages.get(code) ?? []), template]);
      for (const m of js.matchAll(/\bdiag\('([\w-]+)',\s*(['`])((?:(?!\2).)*)\2/g)) add(m[1], m[3]);
      for (const m of js.matchAll(/\bcode: '([\w-]+)'[^\n]*?\bmessage: (['`])((?:(?!\2).)*)\2/g)) add(m[1], m[3]);
    }
    for (const x of listed) {
      for (const t of messages.get(x.code) ?? []) {
        if (!x.said.some((s) => holds(s, t))) at(x.line, `${x.code}: the row does not give the message ${JSON.stringify(t)}`);
      }
      for (const s of x.said) {
        if (!(messages.get(x.code) ?? []).some((t) => holds(s, t))) at(x.line, `${x.code}: src/ writes no message ${JSON.stringify(s)}`);
      }
    }
  }

  // ---- environment variables
  const env = new Set();
  for (const f of [...files(path.join(repo, 'bin'), /\.m?js$/), ...files(path.join(repo, 'src'), /\.m?js$/)]) {
    for (const m of fs.readFileSync(f, 'utf8').matchAll(/process\.env(?:\.(\w+)|\[['"](\w+)['"]\])/g)) env.add(m[1] ?? m[2]);
  }
  const envSection = secs.find((s) => /^environment variables$/i.test(s.heading.text));
  if (!envSection) at(1, 'no Environment variables section');
  else {
    const said = new Set(inlineCode(envSection.blocks));
    for (const v of env) if (!said.has(v)) at(envSection.heading.line, `the command reads ${v}, which the section does not name`);
  }

  for (const p of problems) console.log(p);
  console.log(`check-cli: ${names.length} commands, ${parsed.options.length} options, ${codes.size} diagnostic codes, `
    + `${rows.length} messages, ${shells} shell blocks and ${quoted} quoted outputs in ${rel(cliPage)}; `
    + `${problems.length} problems`);
  process.exitCode = problems.length ? 1 : 0;
}

if (process.argv[1] && import.meta.url === pathToFileURL(fs.realpathSync(process.argv[1])).href) await main();
