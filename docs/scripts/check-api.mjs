// Checks the JavaScript API page (content/docs/reference/javascript.mdx) against the package's entry points and the
// types they declare (types/*.d.ts):
// - each entry's exports are the names its .d.ts declares (the modules' own exports; ./react is read from its source,
//   since it needs React), and each export has a section of its own: an ### heading of its name, whose ts block
//   imports it from that entry and declares it as the .d.ts does;
// - each option of generate() (ExtractOptions, PageOptions and out) has a section under "Reading options" or "Page
//   options", whose line gives its type as the .d.ts does, its default (the value the .d.ts gives, where it gives one)
//   and its flags; the flags are those whose sections on the Command line page name it, or one of its members, as
//   their JavaScript option, and the options the Command line page lists as JavaScript only are those with no flag;
// - each other interface and type the .d.ts files export is on the page: as a table headed by its name, a row a
//   member with its type (options), or declared in a ts block (results, the model and the components' props, whose
//   defaults and meanings are Components' own), member for member;
// - a member of an option object written out in a function's parameters is named in that function's section.
//
//   node scripts/check-api.mjs
//
// It exits 1 when it finds a problem, printing one line per problem with the page's line.
import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { cliPage, codeSpans, linkText, pageOptions, readBlocks, repo, sections, site, inlineCode } from './check-cli.mjs';

export const apiPage = path.join(site, 'content', 'docs', 'reference', 'javascript.mdx');

// ---------------------------------------------------------------- the declarations

/** The text with its comments blanked out (positions kept), and the doc comments with where they end. */
function uncomment(text) {
  let code = '';
  const docs = [];
  for (let i = 0; i < text.length;) {
    if (text.startsWith('/*', i)) {
      const end = text.indexOf('*/', i + 2) + 2;
      if (text.startsWith('/**', i)) docs.push({ end, text: text.slice(i + 3, end - 2).replace(/^\s*\* ?/gm, '').trim() });
      code += text.slice(i, end).replace(/[^\n]/g, ' ');
      i = end;
    } else if (text.startsWith('//', i)) {
      const end = text.indexOf('\n', i);
      const stop = end < 0 ? text.length : end;
      code += ' '.repeat(stop - i);
      i = stop;
    } else if (text[i] === "'" || text[i] === '"') {
      const j = text.indexOf(text[i], i + 1);
      code += text.slice(i, j + 1);
      i = j + 1;
    } else code += text[i++];
  }
  return { code, docs };
}

/** Where the bracket opened at `from` closes, (), [], {} and <> (not the > of =>) counted. */
function closing(code, from) {
  let depth = 0;
  for (let i = from; i < code.length; i++) {
    const c = code[i];
    if (c === "'" || c === '"') i = code.indexOf(c, i + 1);
    else if ('([{<'.includes(c)) depth++;
    else if (')]}'.includes(c) || (c === '>' && code[i - 1] !== '=')) {
      if (--depth === 0) return i;
    }
  }
  return -1;
}

/** Splits at a separator outside brackets and strings. */
export function splitTop(code, sep) {
  const out = [];
  let depth = 0;
  let last = 0;
  for (let i = 0; i < code.length; i++) {
    const c = code[i];
    if (c === "'" || c === '"') i = code.indexOf(c, i + 1);
    else if ('([{<'.includes(c)) depth++;
    else if (')]}'.includes(c) || (c === '>' && code[i - 1] !== '=')) depth--;
    else if (c === sep && depth === 0) {
      out.push(code.slice(last, i));
      last = i + 1;
    }
  }
  out.push(code.slice(last));
  return out.map((s) => s.trim()).filter(Boolean);
}

/** Where a declaration that starts at `from` ends: its ; outside brackets. */
function statementEnd(code, from) {
  let depth = 0;
  for (let i = from; i < code.length; i++) {
    const c = code[i];
    if (c === "'" || c === '"') i = code.indexOf(c, i + 1);
    else if ('([{'.includes(c)) depth++;
    else if (')]}'.includes(c)) depth--;
    else if (c === ';' && depth === 0) return i;
  }
  return code.length;
}

/** A type written without its blanks, so that two ways of laying it out compare equal. */
export const tight = (t) => String(t).replace(/\s+/g, '').replace(/;(?=[}\]])/g, '').replace(/,(?=[)\]}>])/g, '')
  .replace(/^\|/, '').replace(/;$/, '');

/**
 * The declarations of a .d.ts file: interfaces (with their members), functions, consts and type aliases (with their
 * text as written, `export` and `declare` taken off), and re-exports.
 */
export function parseDts(file) {
  const text = fs.readFileSync(file, 'utf8');
  const { code, docs } = uncomment(text);
  const decls = new Map();
  const exported = new Set();
  const reexports = [];
  for (const m of code.matchAll(/(^|\n)[ \t]*(export\s+)?(?:declare\s+)?(interface|function|const|type)\s+(\w+)/g)) {
    const kind = m[3];
    const name = m[4];
    const start = m.index + m[1].length;
    if (m[2]) exported.add(name);
    if (kind === 'interface') {
      const open = code.indexOf('{', start);
      const close = closing(code, open);
      decls.set(name, { kind, name, members: parseMembersOf(code, docs, open + 1, close), exported: !!m[2] });
    } else {
      const end = statementEnd(code, start);
      const decl = code.slice(start, end).replace(/^\s*export\s+/, '').replace(/^declare\s+/, '').trim();
      const prev = decls.get(name);
      // a function's overloads: every declaration
      decls.set(name, { kind, name, text: prev?.kind === kind ? `${prev.text};${decl}` : decl, exported: !!m[2] });
    }
  }
  for (const m of code.matchAll(/export\s*\{([^}]*)\}\s*from\s*'([^']+)'/g)) {
    const names = m[1].split(',').map((x) => x.trim()).filter(Boolean);
    reexports.push({ names, from: m[2] });
    for (const n of names) exported.add(n);
  }
  return { file, decls, exported, reexports };
}

/** The members of an interface whose body runs from `from` to `to`, each with the doc comment before it. */
function parseMembersOf(code, docs, from, to) {
  const out = [];
  let depth = 0;
  let start = from;
  const take = (end) => {
    const raw = code.slice(start, end);
    const t = raw.trim();
    if (t) {
      const at = start + raw.indexOf(t);
      const doc = docs.filter((d) => d.end <= at && /^\s*$/.test(code.slice(d.end, at))).at(-1)?.text ?? '';
      out.push({ ...member(t), doc });
    }
    start = end + 1;
  };
  for (let i = from; i < to; i++) {
    const c = code[i];
    if (c === "'" || c === '"') i = code.indexOf(c, i + 1);
    else if ('([{'.includes(c)) depth++;
    else if (')]}'.includes(c)) depth--;
    else if (c === ';' && depth === 0) take(i);
  }
  take(to);
  return out.filter((x) => x.name);
}

/** One member of an object type, as written: name, optional, type; a method's type is its signature. */
export function member(t) {
  const method = /^(\w+)(\??)\s*(?=[(<])/.exec(t);
  const prop = /^(?:readonly\s+)?(\w+|\[[^\]]+\])(\??)\s*:\s*([\s\S]+)$/.exec(t);
  if (method && (!prop || t.search(/[(<]/) < t.indexOf(':'))) {
    return { name: method[1], optional: !!method[2], type: t.slice(method[0].length).trim(), method: true };
  }
  if (prop) return { name: prop[1], optional: !!prop[2], type: prop[3].trim() };
  return { name: null };
}

/** The members of an inline object type `{ a?: string; b: number }`, or null for another type. */
export function inlineMembers(type) {
  const t = type.trim();
  if (!t.startsWith('{') || closing(t, 0) !== t.length - 1) return null;
  return splitTop(t.slice(1, -1), ';').map(member).filter((x) => x.name);
}

/** The value a doc comment gives as a default, where it gives one as code, a quoted string or a number. */
export function docDefault(doc) {
  const pats = [
    /Default:?\s*`([^`]+)`/, /Default:?\s*"([^"]+)"/, /Default:?\s*'([^']+)'/, /Default:?\s*(-?\d+(?:\.\d+)?)\b/,
    /`([^`]+)` (?:by default|\((?:the )?default(?:\)| when\b))/, /\b(\d+(?:\.\d+)?|true|false) \((?:the )?default\)/,
    /\(default (\d+(?:\.\d+)?|true|false)\b/,
  ];
  for (const p of pats) {
    const m = p.exec(doc);
    if (m) return m[1];
  }
  return null;
}

/** A value as code, without the quotes of a string. */
const bare = (s) => String(s).trim().replace(/^(['"])(.*)\1$/, '$2');

// ---------------------------------------------------------------- the check

async function main() {
  const problems = [];
  const rel = (file) => path.relative(process.cwd(), file);
  const at = (line, msg) => problems.push(`${rel(apiPage)}:${line}: ${msg}`);
  const text = fs.readFileSync(apiPage, 'utf8');
  const blocks = readBlocks(text);
  const secs = sections(blocks);

  // ---- the entry points, their declarations and their exports
  const pkg = JSON.parse(fs.readFileSync(path.join(repo, 'package.json'), 'utf8'));
  const entries = [];
  for (const [key, target] of Object.entries(pkg.exports)) {
    if (typeof target !== 'object' || !target.types) continue;
    const name = key === '.' ? pkg.name : `${pkg.name}/${key.slice(2)}`;
    const dts = parseDts(path.join(repo, target.types));
    let runtime;
    const src = path.join(repo, target.default);
    if (key === './react') {
      // the components import React, which this package does not install: their names are read from the source
      const js = fs.readFileSync(src, 'utf8');
      runtime = [...js.matchAll(/^export (?:function|const|class|let) (\w+)/gm)].map((m) => m[1]);
    } else runtime = Object.keys(await import(pathToFileURL(src).href));
    entries.push({ key, name, dts, runtime: runtime.sort() });
  }
  // a re-exported name: its declaration where it is declared
  const declOf = (entry, name) => {
    if (entry.dts.decls.has(name)) return entry.dts.decls.get(name);
    for (const r of entry.dts.reexports) {
      if (!r.names.includes(name)) continue;
      const file = path.resolve(path.dirname(entry.dts.file), r.from.replace(/\.js$/, '.d.ts'));
      return parseDts(file).decls.get(name);
    }
    return null;
  };
  for (const e of entries) {
    const declared = [...e.dts.exported].filter((n) => e.dts.decls.get(n)?.kind !== 'interface' && e.dts.decls.get(n)?.kind !== 'type').sort();
    if (declared.join(' ') !== e.runtime.join(' ')) {
      problems.push(`${e.name}: exports ${e.runtime.join(', ')}, where its types declare ${declared.join(', ')}`);
    }
    e.values = declared;
  }

  // ---- each export's section: a ts block that imports it and declares it as the .d.ts does
  const signature = new Map();
  for (const s of secs) {
    const ts = s.blocks.find((b) => b.type === 'code' && /^tsx?$/.test(b.lang));
    const imp = ts && /^import\s*\{\s*(\w+)\s*\}\s*from\s*'([^']+)';?\s*$/.exec(ts.body.find((l) => l.trim()) ?? '');
    if (imp) signature.set(s.heading.text, { section: s, block: ts, name: imp[1], from: imp[2] });
  }
  let exportCount = 0;
  for (const e of entries) {
    for (const name of e.values) {
      exportCount++;
      const sig = signature.get(name);
      if (!sig) {
        at(1, `${name} (${e.name}) has no section: ### ${name}, with a ts block that imports it`);
        continue;
      }
      const from = entries.find((x) => x.name === sig.from);
      if (!from || !from.values.includes(name)) {
        at(sig.block.line + 1, `${sig.from} does not export ${name}`);
        continue;
      }
      if (sig.name !== name) at(sig.block.line + 1, `the section of ${name} imports ${sig.name}`);
      const want = declOf(from, name);
      const said = sig.block.body.slice(sig.block.body.findIndex((l) => l.trim().startsWith('import')) + 1).join('\n');
      const decls = splitTop(uncomment(said).code, ';').filter((d) => new RegExp(`^(?:function|const)\\s+${name}\\b`).test(d));
      const got = decls.map((d) => tight(d)).join(';');
      if (!want) at(sig.block.line, `${name}: no declaration in ${e.dts.file}`);
      else if (got !== tight(want.text)) {
        at(sig.block.line + 1, `${name} is declared ${want.text.replace(/\s+/g, ' ')}, not ${decls.join('; ').replace(/\s+/g, ' ') || '(nothing)'}`);
      }
      // the members of an object written out in its parameters are named in the section
      const params = /^function\s+\w+\s*(?:<[^(]*>)?\s*\(([\s\S]*)\)\s*:/.exec(want?.text ?? '');
      if (params) {
        // a span that names it: `name`, or `name: value` as an example writes it
        const said = new Set(inlineCode(sig.section.blocks).map((c) => c.split(/[:=.\s]/)[0]));
        for (const p of splitTop(params[1], ',')) {
          const type = p.replace(/^\w+\??\s*:\s*/, '');
          for (const part of splitTop(type, '&')) {
            for (const mem of inlineMembers(part) ?? []) {
              if (!said.has(mem.name)) at(sig.section.heading.line, `${name}: the section does not name the option \`${mem.name}\``);
            }
          }
        }
      }
    }
  }
  for (const [title, sig] of signature) {
    if (!entries.some((e) => e.values.includes(title))) at(sig.section.heading.line, `### ${title}: no entry exports ${title}`);
  }

  // ---- the options of generate(): ExtractOptions and PageOptions, a section each, and out
  const index = entries.find((e) => e.key === '.');
  const groups = { 'reading-options': 'ExtractOptions', 'page-options': 'PageOptions' };
  const generateDecl = index.dts.decls.get('generate')?.text ?? '';
  const outMember = inlineMembers(/\{\s*out[^}]*\}/.exec(generateDecl)?.[0] ?? '') ?? [];
  const optionSections = new Map();
  for (const s of secs) {
    const group = groups[s.h2?.id];
    if (s.heading.depth !== 3 || !group) continue;
    const first = s.blocks[0]?.type === 'para' ? s.blocks[0] : null;
    const line = first ? linkText(first.text.replace(/\n/g, ' ')) : '';
    const parts = line.split(' · ');
    optionSections.set(s.heading.text, {
      section: s, group, line: first?.line ?? s.heading.line, text: line,
      type: /^Type `/.test(parts[0] ?? '') ? codeSpans(parts[0])[0] : undefined,
      default: /^default:\s*(.*)$/.exec(parts[1] ?? '')?.[1],
      flags: /^flags?:\s*(.*)$/.exec(parts[2] ?? '')?.[1],
    });
  }
  const optionMembers = [];
  for (const [id, iface] of Object.entries(groups)) {
    const d = index.dts.decls.get(iface);
    if (!d) {
      problems.push(`types/index.d.ts declares no ${iface}`);
      continue;
    }
    const members = iface === 'PageOptions' ? [...outMember.map((m) => ({ ...m, doc: 'generate' })), ...d.members] : d.members;
    for (const m of members) optionMembers.push({ ...m, iface, group: id });
  }
  for (const m of optionMembers) {
    const s = optionSections.get(m.name);
    if (!s) {
      at(1, `${m.iface}.${m.name} has no section under the ${m.group} heading: ### ${m.name} [#${m.name.toLowerCase()}]`);
      continue;
    }
    if (s.group !== m.iface) at(s.section.heading.line, `${m.name} is an option of ${m.iface}, not of ${s.group}`);
    if (!s.section.heading.id) at(s.section.heading.line, `### ${m.name}: no explicit [#id]`);
    if (s.type === undefined || s.default === undefined || s.flags === undefined) {
      at(s.line, `${m.name}: the line under the heading reads "Type \`TYPE\` · default: VALUE · flag: FLAGS", not ${JSON.stringify(s.text.slice(0, 100))}`);
      continue;
    }
    const inline = inlineMembers(m.type);
    if (inline ? s.type !== 'object' : tight(s.type) !== tight(m.type)) {
      at(s.line, `${m.name}: type ${inline ? 'object' : m.type.replace(/\s+/g, ' ')}, not ${s.type}`);
    }
    const lit = docDefault(m.doc);
    if (lit !== null && !codeSpans(s.default).map(bare).includes(bare(lit))) {
      at(s.line, `${m.name}: default ${lit}, as its type's doc says, not ${s.default}`);
    }
    s.member = m;
  }
  for (const [name, s] of optionSections) {
    if (!s.member) at(s.section.heading.line, `### ${name}: no option of ${s.group} (types/index.d.ts)`);
  }

  // ---- the flags: those whose Command line sections name the option or one of its members
  const cliText = fs.readFileSync(cliPage, 'utf8');
  const cli = pageOptions(cliText);
  const cliOptions = cli.filter((o) => o.heading !== 'Paths').map((o) => ({
    flags: o.heading.split(' ').filter((w) => w.startsWith('-')).map((w) => w.replace(/,$/, '')), js: o.javascript ?? [],
  }));
  // a flag by its long name: -o is --out
  const canon = (f) => cliOptions.find((o) => o.flags.includes(f))?.flags.at(-1) ?? f;
  for (const [name, s] of optionSections) {
    if (!s.member || s.flags === undefined) continue;
    const said = [...new Set(codeSpans(s.flags).filter((f) => f.startsWith('-')).map((f) => canon(f.split(' ')[0])))].sort();
    const want = [...new Set(cliOptions.filter((o) => o.js.some((js) => js === name || js.startsWith(`${name}.`)))
      .map((o) => o.flags.at(-1)))].sort();
    if (said.join(' ') !== want.join(' ')) {
      at(s.line, `${name}: the flags ${said.join(', ') || 'none'}, where Command line gives ${want.join(', ') || 'none'}`);
    }
  }
  const onlyJs = sections(readBlocks(cliText)).find((x) => /^options only in javascript$/i.test(x.heading.text));
  const listed = new Set(onlyJs ? inlineCode(onlyJs.blocks) : []);
  if (!onlyJs) problems.push(`${rel(cliPage)}: no "Options only in JavaScript" section`);
  for (const [name, s] of optionSections) {
    if (!s.member || s.flags === undefined) continue;
    const flagged = codeSpans(s.flags).length > 0;
    if (!flagged && !listed.has(name)) problems.push(`${rel(cliPage)}: "Options only in JavaScript" does not name ${name}, which has no flag`);
    if (flagged && listed.has(name)) problems.push(`${rel(cliPage)}: "Options only in JavaScript" names ${name}, which has a flag (${s.flags})`);
  }

  // ---- the other interfaces and types: a table of each option type, a ts block of each other one
  const tables = new Map();
  for (const b of blocks) {
    if (b.type !== 'table') continue;
    const head = codeSpans(b.header[0])[0];
    if (head) tables.set(head, b);
  }
  const blockDecls = new Map();
  for (const b of blocks) {
    if (b.type !== 'code' || !/^tsx?$/.test(b.lang)) continue;
    const { code } = uncomment(b.body.join('\n'));
    for (const m of code.matchAll(/(^|\n)\s*(interface|type)\s+(\w+)/g)) {
      const start = m.index + m[1].length;
      if (m[2] === 'interface') {
        const open = code.indexOf('{', start);
        blockDecls.set(m[3], { kind: 'interface', members: splitTop(code.slice(open + 1, closing(code, open)), ';').map(member), line: b.line });
      } else {
        blockDecls.set(m[3], { kind: 'type', text: code.slice(start, statementEnd(code, start)).trim(), line: b.line });
      }
    }
  }
  const inlineTypes = new Map();
  for (const m of optionMembers) {
    const inl = inlineMembers(m.type);
    if (inl) inlineTypes.set(m.name, inl.map((x) => ({ ...x, doc: '' })));
  }
  const typeNames = [];
  for (const e of entries) {
    for (const [n, d] of e.dts.decls) if (d.exported && (d.kind === 'interface' || d.kind === 'type') && !groups[n]) typeNames.push([n, d]);
  }
  for (const [n] of inlineTypes) typeNames.push([n, { kind: 'interface', members: inlineTypes.get(n), inline: true }]);
  const compareMembers = (name, want, got, line, what) => {
    for (const w of want) {
      const g = got.find((x) => x.name === w.name);
      if (!g) at(line, `${name}.${w.name} is not in its ${what}`);
      else if (tight(g.type) !== tight(w.type) || !!g.optional !== !!w.optional) {
        at(g.line ?? line, `${name}.${w.name}${w.optional ? '?' : ''}: ${w.type.replace(/\s+/g, ' ')}, not ${g.name}${g.optional ? '?' : ''}: ${g.type}`);
      }
    }
    for (const g of got) if (!want.some((w) => w.name === g.name)) at(g.line ?? line, `${name} has no member ${g.name}`);
  };
  for (const [name, d] of typeNames) {
    if (name === 'ExtractOptions' || name === 'PageOptions') continue;
    const table = tables.get(name);
    const block = blockDecls.get(name);
    if (!table && !block) {
      at(1, `${name} (${d.inline ? 'an option object' : d.kind}) is not on the page: a table headed \`${name}\`, or a ts block`);
      continue;
    }
    if (table) {
      const col = (re) => table.header.findIndex((h) => re.test(h));
      const typeCol = col(/^type$/i);
      const defCol = col(/^default$/i);
      if (typeCol < 0) {
        at(table.line, `the table of ${name} has no Type column`);
        continue;
      }
      const got = table.rows.map((r) => {
        const cell = codeSpans(r.cells[0])[0] ?? r.cells[0];
        return { name: cell.replace(/\?$/, ''), optional: cell.endsWith('?'), type: codeSpans(r.cells[typeCol])[0] ?? r.cells[typeCol], line: r.line, def: r.cells[defCol] ?? '' };
      });
      const want = d.kind === 'interface' ? d.members : [];
      // an index signature has no row
      compareMembers(name, want.filter((m) => !m.name.startsWith('[')), got, table.line, 'table');
      for (const w of want) {
        const lit = docDefault(w.doc ?? '');
        const g = got.find((x) => x.name === w.name);
        if (lit !== null && g && defCol >= 0 && !codeSpans(g.def).map(bare).includes(bare(lit))) at(g.line, `${name}.${w.name}: default ${lit}, as its doc says`);
      }
    }
    if (block) {
      if (d.kind === 'type') {
        if (tight(block.text) !== tight(d.text)) at(block.line, `type ${name} is ${d.text.replace(/\s+/g, ' ')}, not ${block.text.replace(/\s+/g, ' ')}`);
      } else compareMembers(name, d.members, block.members, block.line, 'ts block');
    }
  }
  for (const [name, b] of blockDecls) {
    if (!typeNames.some(([n]) => n === name) && !['ExtractOptions', 'PageOptions'].includes(name)) at(b.line, `${name}: the .d.ts files declare no such type`);
  }

  for (const p of problems) console.log(p);
  console.log(`check-api: ${exportCount} exports of ${entries.length} entry points, ${optionMembers.length} options of generate() and `
    + `${typeNames.length} other types and option objects checked in ${rel(apiPage)}; ${problems.length} problems`);
  process.exitCode = problems.length ? 1 : 0;
}

if (process.argv[1] && import.meta.url === pathToFileURL(fs.realpathSync(process.argv[1])).href) await main();
