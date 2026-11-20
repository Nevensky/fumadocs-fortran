// The doc-comment engine: the raw blocks the parser attached to an entity become MDX-safe Markdown, read in the
// style they were written in:
//   ford     Markdown, FORD metadata lines (author: …), @note…@endnote environments, [[links]], \( \) and \[ \] maths,
//            {!file!} includes;
//   doxygen  \brief, \details, \param[in] x …, \return, \note, \see, \author, \verbatim, \code, \f$ maths, \b \c \e,
//            \pre, \post, \li, \section, HTML tags and character references;
//   lapack   Doxygen whose argument docs are \verbatim blocks that open with "X is DOUBLE PRECISION array, …".
// Doxygen and LAPACK text is not Markdown, so it is escaped as plain text: `B(LDB,*)` must not become emphasis.

import { escapeText, safeMarkdown, plainText, inlineCode, stripHtmlComments, codeLang, mdLink, htmlTag, resolveTags, tidy, decodeRefs } from '../emit/mdx.js';
import { extractMath, restoreMath, mathAsText, cleanControls } from './math.js';

/**
 * @typedef {{ dir: string, line: number, lines: string[] }} DocBlock
 * @typedef {object} Doc
 * @property {'ford'|'doxygen'|'lapack'|'none'} style
 * @property {string} summary the first paragraph, as MDX
 * @property {string} body the whole documentation, as MDX (summary included)
 * @property {Record<string, string>} params argument docs from \param, by lower-case name, as MDX
 * @property {Record<string, string>} paramIntents the intents \param[in|out|in,out] states
 * @property {Record<string, string>} paramTypes "X is …" lines of LAPACK argument docs
 * @property {string} [returns] as MDX
 * @property {Record<string, string>} meta author, date, version, …
 * @property {string} [group] the \ingroup name
 * @property {boolean} [deprecated]
 */

const FORD_META = new Set([
  'author', 'date', 'version', 'license', 'copyright', 'category', 'deprecated', 'display', 'graph', 'proc_internals',
  'source', 'summary', 'title', 'media_dir',
]);
// Doxygen: a structural command, an admonition in its backslash form (@note and its kin are FORD environments), an
// inline command with its argument, or Doxygen's maths
const DOXY = /(^|\s)[@\\](brief|short|details|param|tparam|returns?|retval|author|authors|date|version|ingroup|defgroup|addtogroup|file|par|verbatim|code|see|sa|deprecated|since|pre|post|invariant|copyright|fn|exception|throws?)\b|(^|\s)\\(note|warning|todo|bug|attention|remarks?|li|arg)\b|(^|\s)[@\\](b|c|e|p|a|em)\s+\S|[@\\]f[$[]/m;
const ENV = { note: ['info', 'Note'], warning: ['warn', 'Warning'], todo: ['info', 'To do'], bug: ['error', 'Bug'], history: ['info', 'History'], attention: ['warn', 'Attention'], remark: ['info', 'Remark'], remarks: ['info', 'Remarks'], deprecated: ['warn', 'Deprecated'] };

/**
 * Renders the doc blocks of one entity.
 * @param {DocBlock[]|undefined} blocks
 * @param {{ resolve?: (name: string, child?: string) => string|null, style?: string, name?: string, math?: 'katex'|'code',
 *   ns?: string, include?: (file: string) => string|null, aliases?: Record<string, string> }} [opts]
 *   math: 'code' shows maths as code, for a site without remark-math; ns: a prefix, unique on the page, for the
 *   doc's footnote and link labels; include: reads a FORD {!file!} include; aliases: FORD's |name| aliases
 * @returns {Doc}
 */
export function renderDoc(blocks, opts = {}) {
  const empty = { style: 'none', summary: '', body: '', params: {}, paramIntents: {}, paramTypes: {}, meta: {} };
  if (!blocks?.length) return empty;
  const raw = [];
  let end = -1;
  for (const b of blocks) {
    // a Doxygen block with \file documents the file, not the entity that follows it
    if (b.lines.some((l) => /^\s*[@\\]file\b/.test(l))) continue;
    // blocks on consecutive lines (a trailing `!!` doc continued below its statement) are one paragraph;
    // blocks apart from each other are separate paragraphs
    if (raw.length && b.line !== end + 1) raw.push('');
    raw.push(...b.lines);
    end = b.end ?? b.line + b.lines.length - 1;
  }
  let lines = stripHtmlComments(dedent(raw.map((l) => cleanControls(l).trimEnd())));
  if (lines.some((l) => l.includes('{!'))) lines = includes(lines, opts.include);
  while (lines.length && !lines[0].trim()) lines.shift();
  while (lines.length && !lines[lines.length - 1].trim()) lines.pop();
  if (!lines.length) return empty;
  const text = lines.join('\n');
  const style = opts.style ?? (DOXY.test(text) ? (/\\verbatim/.test(text) && /\\param\[/.test(text) ? 'lapack' : 'doxygen') : 'ford');
  // maths is lifted out before anything is escaped, and put back at the end
  const { text: lifted, spans } = extractMath(text, { doxygen: style !== 'ford' });
  const lifts = lifted.split('\n');
  const doc = style === 'ford' ? renderFord(lifts, opts) : renderDoxygen(lifts, style, opts);
  if (!spans.length) return doc;
  const back = (s) => (typeof s === 'string' ? restoreMath(s, spans, opts.math) : s);
  const params = {}, paramTypes = {};
  for (const [k, v] of Object.entries(doc.params)) params[k] = back(v);
  for (const [k, v] of Object.entries(doc.paramTypes)) paramTypes[k] = mathAsText(v, spans);
  return { ...doc, summary: back(doc.summary), body: back(doc.body), returns: back(doc.returns), params, paramTypes };
}

/** Removes the indentation every non-blank line shares. */
export function dedent(lines) {
  let min = Infinity;
  for (const l of lines) {
    if (!l.trim()) continue;
    const n = l.length - l.trimStart().length;
    if (n < min) min = n;
  }
  return min === Infinity || min === 0 ? lines.slice() : lines.map((l) => l.slice(Math.min(min, l.length - l.trimStart().length)));
}

// the first paragraph of prose: not a Callout, a code block or a lone bold title such as **Purpose**
const firstParagraph = (md) => {
  const parts = md.split(/\n\s*\n/);
  for (const p of parts) {
    const t = p.trim();
    if (t && !t.startsWith('<') && !t.startsWith('```') && !/^\*\*[^*]+\*\*$/.test(t)) return t;
  }
  return '';
};

/**
 * Which lines are code, as Markdown (Python-Markdown, which FORD uses) reads them: a fence that closes (a stray ```
 * hides nothing), and indented code after a blank line, 4 columns past the list level.
 */
export function codeLines(lines) {
  const code = new Array(lines.length).fill(false);
  let depth = 0;
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const f = /^(\s*)(`{3,}|~{3,})(.*)$/.exec(line);
    if (f && !(f[2][0] === '`' && f[3].includes('`'))) {
      const close = new RegExp(`^\\s*${f[2][0] === '`' ? '`' : '~'}{${f[2].length},}\\s*$`);
      let j = i + 1;
      while (j < lines.length && !close.test(lines[j])) j++;
      if (j < lines.length) {
        for (let k = i; k <= j; k++) code[k] = true;
        i = j;
        continue;
      }
    }
    const blank = i === 0 || !lines[i - 1].trim();
    const ind = line.length - line.trimStart().length;
    if (line.trim() && blank && ind >= 4 * depth + 4) {
      const cut = 4 * depth + 4;
      for (; i < lines.length && ((lines[i].trim() && lines[i].length - lines[i].trimStart().length >= cut) || (!lines[i].trim() && (lines[i + 1] ?? '').trim() && (lines[i + 1].length - lines[i + 1].trimStart().length) >= cut)); i++) code[i] = !!lines[i].trim();
      i--;
      continue;
    }
    if (line.trim()) {
      if (/^\s*([-*+]|\d{1,9}[.)])(\s|$)/.test(line) && ind < 4 * depth + 4) depth = Math.floor(ind / 4) + 1;
      else if (blank) depth = Math.min(depth, Math.floor(ind / 4));
    }
  }
  return code;
}

// the [start, end) ranges of the code spans of a line
function codeSpans(line) {
  const spans = [];
  for (let k = 0; k < line.length;) {
    if (line[k] !== '`') { k++; continue; }
    let j = k;
    while (line[j] === '`') j++;
    const e = line.indexOf(line.slice(k, j), j);
    if (e < 0) { k = j; continue; }
    spans.push([k, e + (j - k)]);
    k = e + (j - k);
  }
  return spans;
}
const inSpan = (spans, at) => spans.some(([a, b]) => at >= a && at < b);

/**
 * FORD's {!file!} includes (markdown-include), outside code: the file's text through `read` (recursively, never the
 * same file twice), or nothing when it cannot be read.
 */
function includes(lines, read, seen = new Set()) {
  const code = codeLines(lines);
  const out = [];
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (code[i] || !line.includes('{!')) { out.push(line); continue; }
    const spans = codeSpans(line);
    let cur = '';
    let last = 0;
    for (const m of line.matchAll(/\{!\s*(.+?)\s*!\}/g)) {
      if (inSpan(spans, m.index)) continue;
      cur += line.slice(last, m.index);
      last = m.index + m[0].length;
      const file = m[1];
      const text = read && !seen.has(file) ? read(file) : null;
      if (typeof text !== 'string') continue;
      const inner = includes(text.replace(/\r/g, '').replace(/\n$/, '').split('\n'), read, new Set([...seen, file]));
      if (inner.length === 1) { cur += inner[0]; continue; }
      out.push(cur + inner[0], ...inner.slice(1, -1));
      cur = inner[inner.length - 1];
    }
    out.push(cur + line.slice(last));
  }
  return out;
}

// ---------------------------------------------------------------- FORD

function renderFord(lines, opts) {
  const meta = {};
  let i = 0;
  // FORD metadata: `key: value` lines at the very start (up to 3 spaces in, as FORD reads them), known keys only,
  // read leniently (a bad value stays text); a line 4 or more spaces in continues the previous value
  let last = null;
  for (; i < lines.length; i++) {
    const m = /^ {0,3}([A-Za-z_]+)\s*:\s*(.*)$/.exec(lines[i]);
    if (m && FORD_META.has(m[1].toLowerCase())) {
      last = m[1].toLowerCase();
      meta[last] = m[2].trim();
      continue;
    }
    if (last && /^ {4,}\S/.test(lines[i])) {
      meta[last] = `${meta[last]} ${lines[i].trim()}`.trim();
      continue;
    }
    break;
  }
  let rest = lines.slice(i);
  while (rest.length && !rest[0].trim()) rest.shift();
  if (opts.aliases) rest = fordAliases(rest, opts.aliases);
  if (opts.ns) rest = namespaceLabels(rest, opts.ns);
  // segments: Markdown, and @note…@endnote environments (Callouts); neither marker counts inside code
  const code = codeLines(rest);
  const segments = [];
  let md = [];
  for (let k = 0; k < rest.length; k++) {
    const m = !code[k] && /^@(note|warning|todo|bug|history)\b\s*(.*)$/i.exec(rest[k].trim());
    if (!m) {
      md.push(rest[k]);
      continue;
    }
    const kind = m[1].toLowerCase();
    const endRe = new RegExp(`^@end${kind}\\b`, 'i');
    const endAt = rest.findIndex((l, j) => j > k && !code[j] && endRe.test(l.trim()));
    const body = [m[2]];
    let j = k + 1;
    if (endAt >= 0) {
      for (; j < endAt; j++) body.push(rest[j]);
      k = endAt;
    } else {
      // a note with no end marker ends at the first blank line outside code
      for (; j < rest.length && (rest[j].trim() || code[j]); j++) body.push(rest[j]);
      k = j - 1;
    }
    segments.push({ md: md.join('\n') });
    md = [];
    segments.push({ callout: kind, md: dedent(body).join('\n').trim() });
  }
  segments.push({ md: md.join('\n') });
  const conv = (s) => safeMarkdown(fordLinks(s, opts.resolve), { math: opts.math });
  const parts = [];
  for (const s of segments) {
    if (!s.md.trim() && !s.callout) continue;
    if (s.callout) {
      const [type, title] = ENV[s.callout];
      parts.push(`<Callout type="${type}" title="${title}">\n\n${conv(s.md)}\n\n</Callout>`);
    } else parts.push(conv(s.md.replace(/^\s*\[TOC\]\s*$/gm, '')).trim());
  }
  const body = [parts.filter(Boolean).join('\n\n'), metaLine(meta)].filter(Boolean).join('\n\n');
  if (meta.deprecated !== undefined && !/^(false|no)$/i.test(meta.deprecated)) {
    // FORD's `deprecated: true`; anything else is the reason
    const why = /^(true|yes|)$/i.test(meta.deprecated) ? 'This is deprecated.' : `Deprecated: ${meta.deprecated}`;
    return { style: 'ford', summary: firstParagraph(body), body: `<Callout type="warn" title="Deprecated">\n\n${escapeText(why)}\n\n</Callout>\n\n${body}`.trim(), params: {}, paramIntents: {}, paramTypes: {}, meta, deprecated: true };
  }
  return { style: 'ford', summary: firstParagraph(body), body, params: {}, paramIntents: {}, paramTypes: {}, meta };
}

/** [[name]], [[name(kind)]], [[name:child]] become links, or inline code when they do not resolve. */
function fordLinks(s, resolve) {
  return outsideCode(s, (t) => t.replace(/\[\[\s*([A-Za-z_]\w*)\s*(?:\(\s*\w+\s*\))?\s*(?::\s*([A-Za-z_]\w*)\s*(?:\(\s*\w+\s*\))?)?\s*\]\]/g, (m, name, child) => {
    const label = child ? `${name}%${child}` : name;
    const url = resolve?.(name, child) ?? null;
    return url ? `[${inlineCode(label)}](${url})` : inlineCode(label);
  }));
}

/** Applies `f` to the text outside fenced code blocks and inline code. */
function outsideCode(s, f) {
  const parts = s.split(/(```[\s\S]*?```|~~~[\s\S]*?~~~|`[^`\n]*`)/);
  return parts.map((p, i) => (i % 2 ? p : f(p))).join('');
}

/** FORD's |name| aliases, outside code; a name the project does not define stays as written. */
function fordAliases(lines, aliases) {
  const code = codeLines(lines);
  return lines.map((l, i) => (code[i] || !l.includes('|') ? l : l.replace(/(?<!\\)\|([^ |][^|]*?)\|/g, (m, name, at) => (!inSpan(codeSpans(l), at) && Object.hasOwn(aliases, name) ? aliases[name] : m))));
}

/**
 * Footnotes and link reference definitions belong to their doc, but a page holds many docs and Markdown resolves
 * labels page-wide: the labels a doc defines are prefixed with its namespace, in their definitions and references.
 */
function namespaceLabels(lines, ns) {
  const code = codeLines(lines);
  const norm = (l) => l.trim().replace(/\s+/g, ' ').toLowerCase();
  const notes = new Set();
  const links = new Set();
  let blockStart = true;
  for (let i = 0; i < lines.length; i++) {
    const l = lines[i];
    if (code[i]) { blockStart = false; continue; }
    if (!l.trim()) { blockStart = true; continue; }
    const fn = /^ {0,3}\[\^([^\]\s]+)\]:/.exec(l);
    if (fn) { notes.add(norm(fn[1])); blockStart = false; continue; }
    const ld = /^ {0,3}\[((?:[^\][\\]|\\.)+)\]:\s*\S/.exec(l);
    if (ld && blockStart && !ld[1].startsWith('^')) { links.add(norm(ld[1])); continue; }
    blockStart = false;
  }
  if (!notes.size && !links.size) return lines;
  const ref = (label) => `${ns}-${label}`;
  return lines.map((l, i) => {
    if (code[i]) return l;
    const spans = codeSpans(l);
    // a definition at the start of the line
    let head = '';
    let body = l;
    const def = /^( {0,3})\[(\^?)((?:[^\][\\]|\\.)+)\]:/.exec(l);
    if (def && (def[2] ? notes.has(norm(def[3])) : links.has(norm(def[3])))) {
      head = `${def[1]}[${def[2]}${ref(def[3])}]:`;
      body = l.slice(def[0].length);
    }
    const offset = l.length - body.length;
    body = body.replace(/(!?)\[((?:[^\][\\]|\\.)*)\](?:\[((?:[^\][\\]|\\.)*)\])?/g, (m, bang, text, label, at, s) => {
      const end = at + m.length;
      if (inSpan(spans, at + offset) || s[at - 1] === '[' || s[end] === ']' || s[end] === '(' || (label === undefined && s[end] === ':')) return m;
      if (label !== undefined) {
        const target = label || text;
        return links.has(norm(target)) ? `${bang}[${text}][${ref(target)}]` : m;
      }
      if (text.startsWith('^')) return notes.has(norm(text.slice(1))) ? `[^${ref(text.slice(1))}]` : m;
      return links.has(norm(text)) ? `${bang}[${text}][${ref(text)}]` : m;
    });
    return head + body;
  });
}

// ---------------------------------------------------------------- Doxygen and LAPACK

// Doxygen starts a new section at these commands even in the middle of a line
const MIDLINE = /\s+(?=[@\\](?:see|sa|returns?|note|warning|param|pre|post|li)\b)/;
// commands that only steer Doxygen's own output
const DROPPED = /^[@\\](callgraph|callergraph|hidecallgraph|hidecallergraph|showinitializer|hideinitializer|showrefby|hiderefby|showrefs|hiderefs|nosubgrouping|showinlinesource|hideinlinesource|privatesection|protectedsection|publicsection|anchor\s+\S+|image\s+(?:latex|rtf|docbook|xml)\b.*)\s*$/;

function splitSections(lines) {
  const out = [];
  let block = null;
  for (const line of lines) {
    if (block) {
      out.push(line);
      if (new RegExp(`[@\\\\]end${block}\\b`).test(line)) block = null;
      continue;
    }
    const b = /^\s*[@\\](verbatim|code)\b/.exec(line);
    if (b) {
      if (!new RegExp(`[@\\\\]end${b[1]}\\b`).test(line)) block = b[1];
      out.push(line);
      continue;
    }
    out.push(...line.split(MIDLINE));
  }
  return out;
}

function renderDoxygen(input, style, opts) {
  const d = { brief: [], details: [], params: [], tparams: [], exceptions: [], returns: [], notes: [], see: [], meta: {}, group: undefined, deprecated: false };
  let cur = d.details;
  const take = (arr) => { cur = arr; };
  const lines = splitSections(input);
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const t = line.trim();
    let m;
    if ((m = /^[@\\]verbatim\b(.*)$/.exec(t))) {
      const block = [];
      if (m[1].trim()) block.push(m[1]);
      for (i++; i < lines.length && !/^\s*[@\\]endverbatim\b/.test(lines[i]); i++) block.push(lines[i]);
      cur.push({ verbatim: block });
      continue;
    }
    // \code … \endcode, also on one line, and an HTML <pre> block
    if ((m = /^[@\\]code(?:\{\.?([\w+#.-]+)\})?(.*)$/.exec(t))) {
      const one = /^(.*?)[@\\]endcode\b/.exec(m[2]);
      if (one) {
        cur.push({ code: [one[1].trim()], lang: m[1] });
        continue;
      }
      const block = m[2].trim() ? [m[2]] : [];
      for (i++; i < lines.length && !/^\s*[@\\]endcode\b/.test(lines[i]); i++) block.push(lines[i]);
      cur.push({ code: block, lang: m[1] });
      continue;
    }
    // Doxygen reads Markdown too: a fenced code block, and list items
    if ((m = /^(`{3,}|~{3,})\s*\{?\.?([\w+#.-]*)\}?\s*$/.exec(t))) {
      const close = new RegExp(`^\\s*${m[1][0] === '`' ? '`' : '~'}{${m[1].length},}\\s*$`);
      let j = i + 1;
      while (j < lines.length && !close.test(lines[j])) j++;
      if (j < lines.length) {
        cur.push({ code: lines.slice(i + 1, j), lang: m[2] || undefined });
        i = j;
        continue;
      }
    }
    if ((m = /^([-*+]|\d{1,9}[.)])\s+(.*)$/.exec(t)) && !/^[-*+]\s*[-*+]\s*[-*+]/.test(t)) {
      const ordered = /\d/.test(m[1]);
      const prev = cur[cur.length - 1];
      if (prev && typeof prev === 'object' && prev.list && prev.ordered === ordered) prev.list.push([m[2]]);
      else cur.push({ list: [[m[2]]], ordered });
      continue;
    }
    if ((m = /^<pre\b[^>]*>(.*)$/i.exec(t))) {
      const block = [];
      let rest = m[1];
      for (;;) {
        const e = /<\/pre\s*>/i.exec(rest);
        if (e) { if (rest.slice(0, e.index).trim()) block.push(rest.slice(0, e.index)); break; }
        if (rest.trim() || block.length) block.push(rest);
        if (++i >= lines.length) break;
        rest = lines[i];
      }
      cur.push({ code: block.map((l) => decodeRefs(l.replace(/<[^>]+>/g, ''))), lang: 'text' });
      continue;
    }
    if ((m = /^[@\\](htmlonly|latexonly|manonly|rtfonly|xmlonly|docbookonly)\b/.exec(t))) {
      const endRe = new RegExp(`[@\\\\]end${m[1]}\\b`);
      while (i < lines.length && !endRe.test(lines[i])) i++;
      const after = (lines[i] ?? '').replace(new RegExp(`^[\\s\\S]*?[@\\\\]end${m[1]}\\b`), '').trim();
      if (after) cur.push(after);
      continue;
    }
    if (DROPPED.test(t)) continue;
    // a display formula on a line of its own ends the brief: summaries hold no display maths
    if (/^\uE002\d+\uE003/.test(t) && cur === d.brief) take(d.details);
    if ((m = /^[@\\](brief|short)\b\s*(.*)$/.exec(t))) { take(d.brief); if (m[2]) cur.push(m[2]); continue; }
    if ((m = /^[@\\]details?\b\s*(.*)$/.exec(t))) { take(d.details); if (m[1]) cur.push(m[1]); continue; }
    if ((m = /^[@\\]param(?:\[([^\]]*)\])?\s+([A-Za-z_]\w*(?:\s*,\s*[A-Za-z_]\w*)*)\s*(.*)$/.exec(t))) {
      const p = { names: m[2].split(',').map((x) => x.trim()), dir: m[1] ? m[1].replace(/\s+/g, '').toLowerCase() : null, body: [] };
      if (m[3]) p.body.push(m[3]);
      d.params.push(p);
      take(p.body);
      continue;
    }
    if ((m = /^[@\\](tparam|exception|throws?)\s+(\S+)\s*(.*)$/.exec(t))) {
      const p = { name: m[2], body: m[3] ? [m[3]] : [] };
      (m[1] === 'tparam' ? d.tparams : d.exceptions).push(p);
      take(p.body);
      continue;
    }
    if ((m = /^[@\\](returns?|result)\b\s*(.*)$/.exec(t))) { take(d.returns); if (m[2]) cur.push(m[2]); continue; }
    if ((m = /^[@\\]retval\s+(\S+)\s*(.*)$/.exec(t))) { take(d.returns); cur.push(`${m[1]}: ${m[2]}`); continue; }
    if ((m = /^[@\\](note|remarks?|attention|warning|bug|todo|deprecated)\b\s*(.*)$/.exec(t))) {
      const n = { kind: m[1], body: [] };
      if (m[2]) n.body.push(m[2]);
      if (m[1] === 'deprecated') d.deprecated = true;
      d.notes.push(n);
      take(n.body);
      continue;
    }
    if ((m = /^[@\\](pre|post|invariant)\b\s*(.*)$/.exec(t))) {
      take(d.details);
      cur.push('', { label: { pre: 'Precondition', post: 'Postcondition', invariant: 'Invariant' }[m[1]] });
      if (m[2]) cur.push(m[2]);
      continue;
    }
    if ((m = /^[@\\](see|sa)\b\s*(.*)$/.exec(t))) { d.see.push(m[2]); take(d.details); continue; }
    if ((m = /^[@\\](authors?|date|version|copyright|since)\b\s*(.*)$/.exec(t))) {
      const k = m[1].replace(/s$/, '');
      const v = decodeRefs(m[2]);
      d.meta[k] = d.meta[k] ? `${d.meta[k]}; ${v}` : v;
      continue;
    }
    if ((m = /^[@\\]ingroup\s+(\w+)/.exec(t))) { d.group = m[1]; continue; }
    if ((m = /^[@\\]par(?:\s+(.*?))?\s*$/.exec(t))) {
      take(d.details);
      cur.push('');
      if (m[1]) cur.push({ title: decodeRefs(m[1]).replace(/:$/, '') });
      continue;
    }
    if ((m = /^[@\\](section|subsection|subsubsection|paragraph)\s+\S+\s*(.*)$/.exec(t))) {
      take(d.details);
      cur.push('');
      if (m[2]) cur.push({ title: decodeRefs(m[2]) });
      continue;
    }
    if ((m = /^[@\\](li|arg)\b\s*(.*)$/.exec(t))) {
      const prev = cur[cur.length - 1];
      if (prev && typeof prev === 'object' && prev.list) prev.list.push([m[2]]);
      else cur.push({ list: [[m[2]]] });
      continue;
    }
    if ((m = /^[@\\]image\s+html\s+(\S+)(?:\s+"([^"]*)")?/.exec(t))) { cur.push({ figure: m[2] || m[1] }); continue; }
    if ((m = /^[@\\](copydoc|copybrief|copydetails)\s+([A-Za-z_]\w*)/.exec(t))) { cur.push({ copy: m[2] }); continue; }
    if (/^[@\\](file|defgroup|addtogroup|fn|class|struct|internal|endinternal|name|cond|endcond)\b/.test(t)) continue;
    // a line that goes on with the last \li item
    const prev = cur[cur.length - 1];
    if (t && prev && typeof prev === 'object' && prev.list) prev.list[prev.list.length - 1].push(t);
    else cur.push(line);
  }
  const resolve = opts.resolve;
  const ctx = { math: opts.math };
  const render = (items) => renderDoxyItems(items, resolve, ctx);
  // BLAS's bare `\brief \b DGEMM` names the routine; its first Purpose sentence says what it does
  let brief = render(d.brief);
  const briefText = plainText(brief);
  if (opts.name && briefText.toLowerCase() === opts.name.toLowerCase()) brief = '';
  const details = render(d.details);
  // a summary made from Purpose is only the summary: the body already holds that sentence
  const summary = brief || firstSentence(details);
  const params = {}, paramIntents = {}, paramTypes = {};
  for (const p of d.params) {
    const r = renderDoxyItems(p.body, resolve, { ...ctx, param: true });
    for (const n of p.names) {
      const k = n.toLowerCase();
      params[k] = r.text ?? r;
      if (p.dir) paramIntents[k] = p.dir === 'in,out' || p.dir === 'inout' ? 'inout' : p.dir;
      if (r.type) paramTypes[k] = r.type;
    }
  }
  const listed = (title, items) => (items.length ? `**${title}:**\n\n${items.map((p) => `- ${inlineCode(p.name)}${p.body.length ? `: ${render(p.body).replace(/\n+/g, ' ')}` : ''}`).join('\n')}` : '');
  const notes = d.notes.map((n) => {
    const [type, title] = ENV[n.kind === 'remark' ? 'remark' : n.kind] ?? ENV.note;
    return `<Callout type="${type}" title="${title}">\n\n${render(n.body)}\n\n</Callout>`;
  });
  const see = d.see.length ? `**See also:** ${d.see.map((s) => linkify(s, resolve)).join(', ')}` : '';
  const body = [brief, details, listed('Type parameters', d.tparams), listed('Exceptions', d.exceptions), ...notes, see, metaLine(d.meta)].filter((x) => x && x.trim()).join('\n\n');
  const returns = d.returns.length ? render(d.returns) : undefined;
  return { style, summary: summary || firstParagraph(body), body, params, paramIntents, paramTypes, returns, meta: d.meta, group: d.group, deprecated: d.deprecated || undefined };
}

/** Author, date and version, as one quiet line. */
function metaLine(meta) {
  const items = [['author', 'Author'], ['date', 'Date'], ['version', 'Version'], ['since', 'Since'], ['copyright', 'Copyright'], ['license', 'Licence']]
    .filter(([k]) => meta[k]).map(([k, label]) => `${label}: ${escapeText(meta[k])}`);
  return items.length ? `<small>${items.join(' · ')}</small>` : '';
}

function firstSentence(md) {
  const p = firstParagraph(md);
  if (!p || p.startsWith('```')) return '';
  const m = /^(.+?[.!?])(\s|$)/s.exec(p);
  return (m ? m[1] : p).trim();
}

/** `see` items: names that resolve become links, URLs links of their own. */
function linkify(s, resolve) {
  return s.split(/[\s,]+/).filter(Boolean).map((w) => {
    if (/^(https?|ftp):\/\//i.test(w)) return escapeText(w);
    const name = w.replace(/\(\)$/, '');
    const url = /^[A-Za-z_]\w*$/.test(name) ? resolve?.(name) : null;
    return url ? `[${inlineCode(name)}](${url})` : inlineCode(w);
  }).join(', ');
}

function codeBlock(lines, lang) {
  let f = '```';
  while (lines.some((l) => l.includes(f))) f += '`';
  return `${f}${lang}\n${lines.join('\n')}\n${f}`;
}

/**
 * Renders Doxygen content: text lines (paragraphs), verbatim and code blocks, lists, labels, display maths and \par
 * titles. With `param`, a leading "X is INTEGER" line of a LAPACK argument doc is taken out as its type.
 */
function renderDoxyItems(items, resolve, ctx = {}) {
  const out = [];
  let para = [];
  let label = null;
  let type;
  const flush = () => {
    if (para.length) {
      const text = doxyInline(para.join(' ').replace(/\s+/g, ' ').trim(), resolve);
      out.push(!label ? text : /^(<|`{3})/.test(text) ? `**${label}:**\n\n${text}` : `**${label}:** ${text}`);
      label = null;
    }
    para = [];
  };
  let first = true;
  for (const it of items) {
    if (typeof it === 'string') {
      if (!it.trim()) flush();
      else para.push(it.trim());
      continue;
    }
    flush();
    if (it.label) {
      label = it.label;
      continue;
    }
    if (it.title) out.push(`**${escapeText(it.title)}**`);
    else if (it.list) out.push(it.list.map((item, k) => `${it.ordered ? `${k + 1}.` : '-'} ${doxyInline(item.join(' ').replace(/\s+/g, ' ').trim(), resolve).replace(/\n+/g, ' ')}`).join('\n'));
    else if (it.figure) out.push(`*${escapeText(decodeRefs(it.figure))}*`);
    else if (it.copy) {
      const url = resolve?.(it.copy);
      out.push(`See ${url ? `[${inlineCode(it.copy)}](${url})` : inlineCode(it.copy)}.`);
    } else if (it.code) out.push(codeBlock(dedent(it.code), codeLang(it.lang ?? 'f90', ctx) || 'f90'));
    else if (it.verbatim) {
      let v = dedent(it.verbatim);
      while (v.length && !v[0].trim()) v.shift();
      while (v.length && !v[v.length - 1].trim()) v.pop();
      if (ctx.param && first && v.length && /^\s*[A-Za-z_]\w*\s+is\s+\S/.test(v[0])) {
        // LAPACK's "X is DOUBLE PRECISION array, dimension (N-1)": kept as its own line, since the dimension it
        // documents is often more than the code's (*); a line that does not finish its sentence continues below
        let line = v[0].trim();
        let k = 1;
        const open = (s) => (s.match(/\(/g) ?? []).length > (s.match(/\)/g) ?? []).length;
        while (k < v.length && v[k].trim() && (open(line) || /(,|\bis|\bdimension|\bof|\bor|\band|\bwith)\s*$/i.test(line))) line += ` ${v[k++].trim()}`;
        type = line.replace(/^[A-Za-z_]\w*\s+is\s+/, '').replace(/\.\s*$/, '');
        // a bare scalar type ("N is INTEGER") says nothing the argument's row does not
        if (!/^(INTEGER|LOGICAL|REAL|DOUBLE PRECISION|DOUBLE COMPLEX|COMPLEX|CHARACTER)(\s*\*\s*(\d+|\(\*\)))?$/i.test(type)) {
          out.push(`*${escapeText(line.replace(/\.?\s*$/, '.'))}*`);
        }
        v = dedent(v.slice(k));
      }
      out.push(renderVerbatim(v));
    }
    first = false;
  }
  flush();
  const text = out.filter(Boolean).join('\n\n');
  return ctx.param ? { text, type } : text;
}

/**
 * LAPACK's \verbatim prose: paragraphs whose lines all start at the margin read as text; a paragraph with indented
 * lines or `= 0:` style lists keeps its layout as a text block.
 */
function renderVerbatim(lines) {
  const paras = [];
  let cur = [];
  for (const l of lines) {
    if (!l.trim()) {
      if (cur.length) paras.push(cur);
      cur = [];
    } else cur.push(l);
  }
  if (cur.length) paras.push(cur);
  return paras.map((p) => {
    // option and case lists (= 'N': …, < 0: …, If …) keep their line breaks
    const listed = p.filter((l) => /^\s*([=<>]|If\b|'[^']*'\s*[:=])/.test(l)).length >= 2;
    const laidOut = listed || p.some((l, i) => (i > 0 && /^\s/.test(l)) || /^\s*[=<>]\s*-?\d/.test(l) || /^\s{2,}/.test(l));
    if (laidOut) return codeBlock(dedent(p), 'text');
    return escapeText(p.map((l) => l.trim()).join(' ').replace(/\s+/g, ' '));
  }).join('\n\n');
}

const PUNCT = /[\p{P}\p{S}]/u;
const SPACE_OR_PUNCT = /[\s\p{P}\p{S}]/u;
const INLINE_RE = new RegExp([
  /<a\s[^>]*?\bhref\s*=\s*(?:"(?<href>[^"]*)"|'(?<href1>[^']*)')[^>]*>(?<atext>.*?)<\/a\s*>/.source,
  /[@\\](?<cmd>b|c|p|e|a|em)\s+(?<word>\S+)/.source,
  /<(?:b|B|strong|STRONG)>(?<bold>.*?)<\/(?:b|B|strong|STRONG)>/.source,
  /<(?:i|I|em|EM)>(?<em>.*?)<\/(?:i|I|em|EM)>/.source,
  /<(?:tt|TT|code|CODE)>(?<tt>.*?)<\/(?:tt|TT|code|CODE)>/.source,
  /[@\\]ref\s+(?<ref>[A-Za-z_]\w*)/.source,
  /[@\\]cite\s+(?<cite>\S+)/.source,
  /`(?<code>[^`]+)`/.source,
  /(?<![\w*\\])\*\*(?<mdbold>[^\s*](?:[^*]*?[^\s*])?)\*\*(?![\w*])/.source,
  /(?<![\w*\\])\*(?<mdem>[^\s*](?:[^*]*?[^\s*])?)\*(?![\w*])/.source,
  /[@\\](?<only>htmlonly|latexonly|manonly|rtfonly|xmlonly|docbookonly)\b[\s\S]*?[@\\]end\k<only>\b/.source,
  /[@\\](?<drop>callgraph|callergraph|hidecallgraph|hidecallergraph|showinitializer|hideinitializer)\b|[@\\]anchor\s+\S+/.source,
  /(?<tag><\/?[a-zA-Z][a-zA-Z0-9]*(?:\s(?:[^<>"']|"[^"]*"|'[^']*')*)?\/?>)/.source,
  /(?<br>[@\\]n\b)/.source,
].join('|'), 'g');

// a word argument of \b, \c, \e: trailing punctuation is not part of it (a Fortran .true. or .and. is)
function wordOf(w) {
  if (/^\.[A-Za-z]+\.$/.test(w)) return [w, ''];
  let core = w.replace(/[.,;:!?]+$/, '');
  while (core.endsWith(')') && (core.match(/\(/g) ?? []).length < (core.match(/\)/g) ?? []).length) core = core.slice(0, -1);
  return [core, w.slice(core.length)];
}

// **text** where CommonMark can open and close it there, else <strong>text</strong> (and * or <em> for emphasis)
function emphasis(mark, tag, inner, before, after) {
  if (!inner) return '';
  const ok = (!PUNCT.test(inner[0]) || !before || SPACE_OR_PUNCT.test(before)) && (!PUNCT.test(inner[inner.length - 1]) || !after || SPACE_OR_PUNCT.test(after));
  return ok ? `${mark}${inner}${mark}` : `<${tag}>${inner}</${tag}>`;
}

/**
 * Inline Doxygen: \b, \c, \p, \e, \a, \em, <b>, <i>, <tt>, <code>, <a href>, \ref, \cite, `code`, the phrasing HTML
 * tags (as JSX, when they pair) and character references; the rest is plain text. Maths was lifted out before.
 */
function doxyInline(s, resolve) {
  const text = (t) => escapeText(decodeRefs(t));
  const tags = [];
  const re = new RegExp(INLINE_RE.source, 'g');
  let out = '', last = 0, m;
  while ((m = re.exec(s))) {
    out += text(s.slice(last, m.index));
    last = re.lastIndex;
    const g = m.groups;
    const before = s[m.index - 1];
    const after = s[re.lastIndex];
    if (g.href !== undefined || g.href1 !== undefined) {
      const href = (g.href ?? g.href1).trim();
      const label = escapeText(decodeRefs(g.atext.replace(/<[^>]+>/g, '').trim() || href), { links: false });
      out += !href || /^\s*javascript:/i.test(href) ? label : mdLink(label, decodeRefs(href));
    } else if (g.cmd) {
      const [word, trail] = wordOf(g.word);
      if (word) {
        if (g.cmd === 'b') out += emphasis('**', 'strong', text(word), before, trail[0] ?? after);
        else if (g.cmd === 'c' || g.cmd === 'p') out += inlineCode(decodeRefs(word));
        else out += emphasis('*', 'em', text(word), before, trail[0] ?? after);
      }
      out += text(trail);
    } else if (g.bold !== undefined) out += emphasis('**', 'strong', doxyInline(g.bold.trim(), resolve), before, after);
    else if (g.em !== undefined) out += emphasis('*', 'em', doxyInline(g.em.trim(), resolve), before, after);
    else if (g.tt !== undefined) out += inlineCode(decodeRefs(g.tt));
    else if (g.mdbold !== undefined) out += emphasis('**', 'strong', doxyInline(g.mdbold, resolve), before, after);
    else if (g.mdem !== undefined) out += emphasis('*', 'em', doxyInline(g.mdem, resolve), before, after);
    else if (g.ref) {
      const url = resolve?.(g.ref);
      out += url ? `[${inlineCode(g.ref)}](${url})` : inlineCode(g.ref);
    } else if (g.cite) out += `\\[${text(g.cite)}\\]`;
    else if (g.code !== undefined) out += inlineCode(g.code);
    else if (g.only || g.drop !== undefined || /^[@\\]anchor/.test(m[0])) {
      // Doxygen's own output only
    } else if (g.tag) {
      const tag = htmlTag(g.tag);
      if (tag) {
        tags.push(tag);
        out += `\uE030${tags.length - 1}\uE031`;
      } else out += text(g.tag);
    } else out += '<br />';
  }
  out += text(s.slice(last));
  return tags.length ? tidy(resolveTags([out], ['text'], tags)).join('\n') : out;
}
