// MDX safety. Doc comments were written for FORD, Doxygen or LAPACK, not for MDX, where `{` starts an expression, `<`
// starts JSX, `import` and `export` at the start of a line are ES module statements, there is no indented code, and
// a site's build fails on a code block in a language its highlighter lacks. Everything that goes into a generated
// page passes through one of these functions.

import { DISPLAY_LINE } from '../docs/math.js';
import { ENTITIES } from './entities.js';
import { SHIKI_LANGS } from './shiki-langs.js';

// ---------------------------------------------------------------- plain text

// An underscore between two ASCII letters or digits stays as written: Markdown never reads one inside a word as
// emphasis, and unescaped it keeps a name such as norm2_parallel one word for a site's search, whose records keep the
// page's Markdown.
const WORD = /[A-Za-z0-9]/;
const escapeChars = (s) => s.replace(/\\/g, '\\\\')
  .replace(/[`*_[\]{}|~$]/g, (c, i, t) => (c === '_' && WORD.test(t[i - 1] ?? '') && WORD.test(t[i + 1] ?? '') ? c : `\\${c}`))
  .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

// a bare URL as GFM finds one: it ends at white space, <, >, " or `, or at a maths placeholder
const BARE_URL = /(?<![\w@/.-])(?:(?:https?|ftp):\/\/|www\.)[^\s<>"`\uE000-\uE003]+/gi;

// GFM: trailing punctuation, and a ) that does not pair, are not part of a URL
function trimUrl(u) {
  for (;;) {
    const c = u[u.length - 1];
    if ("?!.,:;*_~'".includes(c)) u = u.slice(0, -1);
    else if (c === ')' && u.split(')').length > u.split('(').length) u = u.slice(0, -1);
    else return u;
  }
}

/** A Markdown link whose destination is the URL as written: no escape of the text reaches the href. */
export function mdLink(label, url) {
  const dest = (/^www\./i.test(url) ? `http://${url}` : url)
    .replace(/[()\\ <>]/g, (c) => `%${c.charCodeAt(0).toString(16).toUpperCase()}`)
    .replace(/&/g, '&amp;');
  return `[${label}](${dest})`;
}

/**
 * Escapes plain text (Doxygen and LAPACK prose) so that Markdown and MDX show it literally; a bare URL becomes a
 * link (links: false keeps it text, for the label of a link).
 */
export function escapeText(s, { links = true } = {}) {
  let out = '';
  let last = 0;
  if (links) {
    for (const m of s.matchAll(BARE_URL)) {
      const url = trimUrl(m[0]);
      if (/^(?:(?:https?|ftp):\/\/|www\.)$/i.test(url)) continue;
      out += escapeChars(s.slice(last, m.index)) + mdLink(escapeChars(url), url);
      last = m.index + url.length;
    }
  }
  out += escapeChars(s.slice(last));
  // a line that would start a heading, a list or a setext underline (quotes and tables are escaped above)
  out = out.replace(/^(\s*)(#{1,6}(?=\s)|[-+](?=\s)|=+\s*$|-{3,}\s*$)/gm, (m, sp, lead) => `${sp}\\${lead}`);
  out = out.replace(/^(\s*)(\d+)([.)])(?=\s)/gm, (m, sp, d, p) => `${sp}${d}\\${p}`);
  return neutraliseESM(out);
}

/** Escapes a string for use inside inline code: backticks are the only problem, solved by a longer fence. */
export function inlineCode(s) {
  const text = String(s);
  let fence = '`';
  while (text.includes(fence)) fence += '`';
  const pad = text.startsWith('`') || text.endsWith('`') ? ' ' : '';
  return `${fence}${pad}${text}${pad}${fence}`;
}

/**
 * A JSX attribute: strings in quotes (or as a JS string when they hold a quote or a line break), numbers and true
 * in braces. A quoted JSX string decodes character references, so & is written &amp;: '&lt;' stays '&lt;'.
 */
export function attr(name, value) {
  if (value === undefined || value === null || value === false || value === '') return '';
  if (value === true) return ` ${name}`;
  if (typeof value === 'number') return ` ${name}={${value}}`;
  const s = String(value);
  return /["\n\r]/.test(s) ? ` ${name}={${JSON.stringify(s)}}` : ` ${name}="${s.replace(/&/g, '&amp;')}"`;
}

/** A YAML front-matter value: always a double-quoted scalar, which JSON's escaping satisfies. */
export function yamlString(s) {
  return JSON.stringify(String(s));
}

/** `import` or `export` at the start of a line would be read as an ES module statement. */
export function neutraliseESM(s) {
  return s.replace(/^([ \t]*)(import|export)\b/gm, (m, sp, w) => `${sp}&#${w.charCodeAt(0)};${w.slice(1)}`);
}

// ---------------------------------------------------------------- code blocks

const PLAIN = new Set(['text', 'txt', 'plain', 'plaintext', 'ansi']);

/**
 * A code block's language as Shiki knows it, for the first word of a fence's info string (FORD's {.python} and
 * .python included) or Doxygen's \code{.x}: the Fortran names become f90 or f77, and a language Shiki lacks becomes
 * text, since a fumadocs site's build fails on it. ```math stays for rehype-katex, unless math is 'code'.
 */
export function codeLang(name, { math = 'katex' } = {}) {
  let l = String(name ?? '').trim();
  const braced = /^\{([^}]*)\}?$/.exec(l);
  if (braced) l = /(?:^|\s)\.([^\s.#}]+)/.exec(braced[1])?.[1] ?? '';
  l = l.replace(/^\./, '').toLowerCase();
  if (!l) return '';
  if (/^(f|for|ftn|f77|fortran77|fortranfixed|fortran-fixed-form)$/.test(l)) return 'f77';
  if (/^(fortran|fortran9[05]|fortran20\d\d|fortran-free-form|f9\d|f0\d|f1\d|f2\d|fpp|fypp)$/.test(l)) return 'f90';
  if (l === 'math') return math === 'code' ? 'text' : 'math';
  return PLAIN.has(l) || SHIKI_LANGS.has(l) ? l : 'text';
}

// ---------------------------------------------------------------- Markdown

const detab = (l) => l.replace(/^[ \t]+/, (ws) => {
  let n = 0;
  for (const c of ws) n = c === '\t' ? n + 4 - (n % 4) : n + 1;
  return ' '.repeat(n);
});
const columns = (l) => {
  const d = detab(l);
  return d.length - d.trimStart().length;
};
const LIST_ITEM = /^\s*([-*+]|\d{1,9}[.)])(\s|$)/;
const TABLE_DELIM = /^\s*\|?\s*:?-+:?\s*(\|\s*:?-+:?\s*)*\|?\s*$/;
const FENCE = /^(\s*)(`{3,}|~{3,})(.*)$/;
const isFence = (f) => f && !(f[2][0] === '`' && f[3].includes('`'));
const closer = (marks) => new RegExp(`^\\s*${marks[0] === '`' ? '`' : '~'}{${marks.length},}\\s*$`);
// a line that starts a block of its own, which no paragraph carries on into
const INTERRUPTS = /^\s*(`{3,}|~{3,}|#{1,6}(\s|$)|>)/;
/**
 * Where a list item's text starts, as MDX reads it: past its marker and the blanks after it (a tab to the next
 * multiple of 4); for an item with no text, one column past its marker.
 */
const textColumn = (line) => {
  const m = /^([ \t]*)([-*+]|\d{1,9}[.)])([ \t]*)/.exec(line);
  let n = columns(m[1]) + m[2].length;
  if (m[0].length === line.length) return n + 1;
  for (const c of m[3]) n = c === '\t' ? n + 4 - (n % 4) : n + 1;
  return n;
};

/**
 * Removes HTML comments from doc lines, as FORD and Doxygen do, leaving code alone. A comment that starts a line
 * leaves a blank line; one that starts mid-line leaves nothing; one at the start of a line that never closes hides
 * the rest of the doc, and one mid-line that never closes stays text.
 */
export function stripHtmlComments(lines) {
  if (!lines.some((l) => l.includes('<!--'))) return lines;
  const out = [];
  let fence = null;
  let block = null;
  let open = false;
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (!open) {
      if (fence) {
        out.push(line);
        if (fence.test(line)) fence = null;
        continue;
      }
      if (block) {
        out.push(line);
        if (new RegExp(`^\\s*[@\\\\]end${block}\\b`).test(line)) block = null;
        continue;
      }
      const f = FENCE.exec(line);
      if (isFence(f)) {
        fence = closer(f[2]);
        out.push(line);
        continue;
      }
      const v = /^\s*[@\\](verbatim|code)\b/.exec(line);
      if (v) {
        block = v[1];
        out.push(line);
        continue;
      }
      if (!line.includes('<!--')) {
        out.push(line);
        continue;
      }
    }
    let s = '';
    let k = 0;
    const wasOpen = open;
    while (k < line.length) {
      if (open) {
        const e = line.indexOf('-->', k);
        if (e < 0) { k = line.length; break; }
        k = e + 3;
        open = false;
        continue;
      }
      if (line[k] === '`') {
        let j = k;
        while (line[j] === '`') j++;
        const tick = line.slice(k, j);
        const e = line.indexOf(tick, j);
        if (e >= 0) { s += line.slice(k, e + tick.length); k = e + tick.length; continue; }
        s += tick;
        k = j;
        continue;
      }
      if (line.startsWith('<!--', k)) {
        const startsLine = !s.trim();
        const closes = line.includes('-->', k + 4) || lines.slice(i + 1).some((l) => l.includes('-->'));
        if (!closes && !startsLine) { s += line[k++]; continue; }
        open = true;
        k += 4;
        continue;
      }
      s += line[k++];
    }
    if (wasOpen && open) continue;
    out.push(s.replace(/\s+$/, ''));
  }
  return out;
}

/**
 * Makes Markdown (FORD's dialect) safe for MDX while keeping it Markdown:
 * - fenced code is kept, its language as Shiki knows it (```fortran becomes ```f90); indented code (4 columns past
 *   the list level, as Python-Markdown nests lists) and <pre> blocks become fenced code;
 * - in text, `{`, `}` and `$` are escaped, `<` that does not open a known HTML tag becomes &lt;, HTML comments are
 *   dropped, `<https://…>` autolinks become links, headings become bold paragraphs, and `import` and `export` at the
 *   start of a line are neutralised;
 * - HTML tags become JSX that MDX can parse and React can render: a phrasing tag pairs within its paragraph, a block
 *   element stands as a block (end tags HTML lets an author leave out are added, as is a table's <tbody>), and
 *   anything that does not pair is shown as text.
 * Maths must be lifted out first (extractMath in src/docs/math.js): a `$` that reaches this function is a dollar.
 * @param {string} md
 * @param {{ math?: 'katex'|'code' }} [opts]
 */
export function safeMarkdown(md, opts = {}) {
  const lines = stripHtmlComments(md.replace(/\r/g, '').split('\n'));
  const out = [];
  const meta = []; // per output line: its kind, for the HTML pass
  const tags = [];
  const push = (line, kind) => {
    out.push(line);
    meta.push(kind);
  };
  let fence = null; // the closing pattern of the open code fence
  let marks = ''; // the run of backticks or tildes that opened it, which closes it when the doc does not
  let open = ''; // the indentation of the line that opened it, where that closer goes
  let item = 0; // the text column of the list item it opened in, which MDX ends it with; 0 outside lists
  let para = -1; // where the open paragraph starts in `out` (for setext headings), or -1
  let depth = 0; // the list level the text is in, 4 columns a level as in Python-Markdown (FORD); 0 outside lists
  // the text columns of the list items open at a line, as MDX reads them: a line left of an item's text ends the item,
  // unless it carries on the item's paragraph
  const items = [];
  let table = false;
  // closes the open fence as far in as it opened, before the blank lines that end it
  const closeFence = () => {
    let at = out.length;
    while (meta[at - 1] === 'fence' && !out[at - 1].trim()) at--;
    out.splice(at, 0, open + marks);
    meta.splice(at, 0, 'fence');
    fence = null;
  };
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const ind = columns(line);
    let cut = false;
    if (fence) {
      // a line left of the text of the list item the fence opened in ends the item, and the fence with it
      if (!(item && line.trim() && ind < item)) {
        push(line, 'fence');
        if (fence.test(line)) fence = null;
        continue;
      }
      // so the fence's own closer is moved into the item; another line is read after the fence, closed in the item
      if (fence.test(line)) {
        push(open + line.trim(), 'fence');
        fence = null;
        continue;
      }
      closeFence();
      cut = true;
    }
    const blank = cut || out.length === 0 || out[out.length - 1].trim() === '';
    // a list item sets the level; a line after a blank line that is indented less leaves it
    if (line.trim() && !(blank && ind >= 4 * depth + 4)) {
      if (LIST_ITEM.test(line) && ind < 4 * depth + 4) depth = Math.floor(ind / 4) + 1;
      else if (blank) depth = Math.min(depth, Math.floor(ind / 4));
    }
    // the list items the line is left of end with it, unless it carries on their paragraph
    const lazy = /^(text|list)$/.test(meta[meta.length - 1] ?? '') && !LIST_ITEM.test(line) && !INTERRUPTS.test(line);
    if (line.trim() && !lazy) while (items.length && ind < items[items.length - 1]) items.pop();
    // a fence as MDX reads it: at any indentation (MDX has no indented code), and a backtick fence's info string
    // holds no backtick (so a line that opens with inline ```code``` is text)
    const f = FENCE.exec(line);
    if (isFence(f)) {
      fence = closer(f[2]);
      marks = f[2];
      open = f[1];
      item = items.length ? items[items.length - 1] : 0;
      const info = /^\s*(\{[^}]*\}?|\S*)(.*)$/.exec(f[3]);
      const lang = codeLang(info[1], opts);
      push(`${f[1]}${f[2]}${lang}${lang && info[2] && !/^\s/.test(info[2]) ? ' ' : ''}${info[2]}`, 'fence');
      para = -1;
      table = false;
      continue;
    }
    // a <pre> block is code
    const pre = /^(\s*)<pre(?:\s[^>]*)?>(.*)$/i.exec(line);
    if (pre) {
      const body = [pre[2]];
      let j = i;
      while (j < lines.length && !/<\/pre\s*>/i.test(body[body.length - 1])) body.push(lines[++j] ?? '');
      if (j < lines.length) {
        const last = body.length - 1;
        const after = body[last].replace(/^[\s\S]*?<\/pre\s*>/i, '').trim();
        body[last] = body[last].replace(/<\/pre\s*>[\s\S]*$/i, '');
        if (!body[0].trim()) body.shift();
        if (body.length && !body[body.length - 1].trim()) body.pop();
        const text = body.map((l) => l.replace(/<[^>]+>/g, '').replace(/&(lt|gt|amp|quot|#39);/g, (m, e) => ({ lt: '<', gt: '>', amp: '&', quot: '"', '#39': "'" })[e]));
        let marks = '```';
        while (text.some((l) => l.includes(marks))) marks += '`';
        push(`${pre[1]}${marks}text`, 'fence');
        for (const l of text) push(l, 'fence');
        push(`${pre[1]}${marks}`, 'fence');
        if (after) push(neutraliseESM(inline(after, tags)), 'text');
        i = j;
        para = -1;
        table = false;
        continue;
      }
    }
    // a setext underline (=== or ---) under a paragraph: the whole paragraph is the heading, a bold paragraph here
    if (para >= 0 && /^\s*(=+|-+)\s*$/.test(line)) {
      const text = out.splice(para).map((l) => l.trim()).join(' ');
      meta.splice(para);
      push(`**${text}**`, 'heading');
      para = -1;
      continue;
    }
    // indented code (4 columns past the list level, after a blank line) becomes a fenced block, inside its list
    // item; a line of display maths alone is maths, not code
    if (blank && line.trim() && ind >= 4 * depth + 4 && !DISPLAY_LINE.test(line)) {
      const cut = 4 * depth + 4;
      const pad = ' '.repeat(4 * depth);
      const code = (l) => l !== undefined && l.trim() !== '' && columns(l) >= cut && !DISPLAY_LINE.test(l);
      const block = [];
      while (i < lines.length && (code(lines[i]) || (!lines[i].trim() && code(lines[i + 1])))) {
        block.push(lines[i].trim() ? pad + detab(lines[i]).slice(cut) : '');
        i++;
      }
      i--;
      let marks = '```';
      while (block.some((l) => l.includes(marks))) marks += '`';
      push(`${pad}${marks}text`, 'fence');
      for (const l of block) push(l, 'fence');
      push(`${pad}${marks}`, 'fence');
      para = -1;
      table = false;
      continue;
    }
    // an ATX heading (at any indentation, as MDX reads it) with no text (#, ###, ## ##) only ends the paragraph;
    // one with text becomes a bold paragraph
    if (/^[ \t]*#{1,6}(?:[ \t]+#*)?[ \t]*$/.test(line)) {
      push('', 'blank');
      para = -1;
      continue;
    }
    const h = /^[ \t]*#{1,6}[ \t]+(.*)$/.exec(line);
    if (h) {
      let text = h[1].trim();
      let e = text.length;
      while (e > 0 && text[e - 1] === '#') e--;
      if (e < text.length && (e === 0 || text[e - 1] === ' ' || text[e - 1] === '\t')) text = text.slice(0, e).trim();
      push(text ? `**${inline(text, tags)}**` : '', text ? 'heading' : 'blank');
      para = -1;
      continue;
    }
    const text = neutraliseESM(inline(line, tags));
    const next = lines[i + 1] ?? '';
    if (!text.trim()) table = false;
    else if (!table && line.includes('|') && next.includes('|') && TABLE_DELIM.test(next)) table = true;
    const kind = !text.trim() ? 'blank' : DISPLAY_LINE.test(text) ? 'math' : table ? 'table' : LIST_ITEM.test(line) ? 'list'
      : /^\s*>/.test(line) ? 'quote' : TAGS_ONLY.test(text) ? 'flow' : 'text';
    push(text, kind);
    if (kind === 'list') items.push(textColumn(line));
    // paragraph lines, which a setext underline could turn into a heading; a line of nothing but tags is a block
    if (kind !== 'text') para = -1;
    else if (para < 0) para = out.length - 1;
  }
  // as long as the fence that opened it (a shorter run would leave it open, to the end of the page), and as far in: a
  // closer left of a list item's text would end the item and open a fence of its own
  if (fence) push(open + marks, 'fence');
  return tidy(resolveTags(out, meta, tags)).join('\n');
}

// ---------------------------------------------------------------- HTML

const VOID = new Set(['br', 'hr', 'img', 'wbr', 'col']);
const PHRASING = new Set([
  'a', 'abbr', 'b', 'br', 'cite', 'code', 'del', 'dfn', 'em', 'i', 'img', 'ins', 'kbd', 'mark', 'q', 's', 'samp',
  'small', 'span', 'strike', 'strong', 'sub', 'sup', 'tt', 'u', 'var', 'wbr',
]);
const BLOCK = new Set([
  'blockquote', 'caption', 'center', 'col', 'colgroup', 'dd', 'div', 'dl', 'dt', 'hr', 'li', 'ol', 'p', 'table', 'tbody',
  'td', 'tfoot', 'th', 'thead', 'tr', 'ul',
]);
const RENAMED = { tt: 'code', strike: 's', center: 'div' };
// elements whose end tag HTML lets an author leave out: they close at their parent's end, and when one of the tags
// listed opens (a sibling, or a sibling of an ancestor), as HTML's parser closes them
const OPTIONAL_END = new Set(['li', 'dt', 'dd', 'tr', 'td', 'th', 'thead', 'tbody', 'tfoot', 'caption', 'colgroup']);
const SECTIONS = ['thead', 'tbody', 'tfoot'];
const TABLE_PARTS = new Set(['caption', 'col', 'colgroup', 'tbody', 'td', 'tfoot', 'th', 'thead', 'tr']);
const CLOSED_BY = {
  li: ['li'], dt: ['dt', 'dd'], dd: ['dt', 'dd'], tr: ['tr', ...SECTIONS], td: ['td', 'th', 'tr', ...SECTIONS],
  th: ['td', 'th', 'tr', ...SECTIONS], thead: SECTIONS, tbody: SECTIONS, tfoot: SECTIONS,
  caption: ['colgroup', 'tr', ...SECTIONS], colgroup: ['colgroup', 'tr', ...SECTIONS],
};
const ATTRS = {
  href: 'href', src: 'src', alt: 'alt', title: 'title', id: 'id', class: 'className', width: 'width', height: 'height',
  colspan: 'colSpan', rowspan: 'rowSpan', align: 'align', name: 'name', target: 'target', rel: 'rel', lang: 'lang',
  dir: 'dir', start: 'start', type: 'type', reversed: 'reversed', scope: 'scope', nowrap: 'noWrap', span: 'span',
  abbr: 'abbr', headers: 'headers',
};
const BOOLEAN_ATTRS = new Set([
  'nowrap', 'compact', 'reversed', 'open', 'hidden', 'noshade', 'disabled', 'checked', 'selected', 'readonly',
  'multiple', 'ismap', 'itemscope', 'inert', 'default',
]);
const TAG = /^<(\/?)([a-zA-Z][a-zA-Z0-9]*)((?:\s+[a-zA-Z_:][\w:.-]*(?:\s*=\s*(?:"[^"]*"|'[^']*'|[^\s"'=<>`]+))?)*)\s*(\/?)>/;
const ATTR = /\s+([a-zA-Z_:][\w:.-]*)(?:\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s"'=<>`]+)))?/g;
const MARK = /\uE030(\d+)\uE031/g;
const TAGS_ONLY = /^\s*(\uE030\d+\uE031\s*)+$/;
const BREAK = '\uE040';

/** The attributes of an HTML tag as JSX: known ones renamed (class to className), the rest (style, on…) dropped. */
function jsxAttrs(text) {
  let out = '';
  for (const m of text.matchAll(ATTR)) {
    const key = m[1].toLowerCase();
    const name = Object.hasOwn(ATTRS, key) ? ATTRS[key] : undefined;
    const value = m[2] ?? m[3] ?? m[4];
    if (!name) continue;
    if (value === undefined) {
      if (BOOLEAN_ATTRS.has(key)) out += ` ${name}`;
      continue;
    }
    if (/^\s*javascript:/i.test(value)) continue;
    // a JSX string in double quotes: only " needs encoding (character references are decoded, as in HTML)
    out += ` ${name}="${value.replace(/"/g, '&quot;')}"`;
  }
  return out;
}

/** An HTML tag at the start of s, as a tag record, or null when the text is not one (`<b and b>`, `<filename>`). */
export function htmlTag(s) {
  const m = TAG.exec(s);
  if (!m) return null;
  const raw = m[2].toLowerCase();
  if (!PHRASING.has(raw) && !BLOCK.has(raw)) return null;
  // a bare word that is no boolean attribute means this is prose, not a tag
  for (const a of m[3].matchAll(ATTR)) if (a[2] === undefined && a[3] === undefined && a[4] === undefined && !BOOLEAN_ATTRS.has(a[1].toLowerCase())) return null;
  if (m[1] && m[3].trim()) return null;
  const name = RENAMED[raw] ?? raw;
  const isVoid = VOID.has(name);
  const attrs = m[1] ? '' : jsxAttrs(m[3]);
  const href = /\bhref\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s"'=<>`]+))/i.exec(m[3]);
  return {
    src: m[0], name, close: !!m[1], void: isVoid, self: !!m[4] && !isVoid,
    jsx: isVoid ? `<${name}${attrs} />` : `<${m[1]}${name}${attrs}${m[4] ? ' /' : ''}>`,
    href: href && !/^\s*javascript:/i.test(href[1] ?? href[2] ?? href[3]) ? (href[1] ?? href[2] ?? href[3]) : null,
    mode: null, pre: [], entry: null,
  };
}

// one line of Markdown text, escaped for MDX; HTML tags become markers resolved by resolveTags
function inline(line, tags) {
  let out = '';
  let k = 0;
  const n = line.length;
  while (k < n) {
    const c = line[k];
    if (c === '`') {
      let j = k;
      while (line[j] === '`') j++;
      const tick = line.slice(k, j);
      const end = line.indexOf(tick, j);
      if (end >= 0) {
        out += line.slice(k, end + tick.length);
        k = end + tick.length;
        continue;
      }
      out += '\\`'.repeat(tick.length);
      k = j;
      continue;
    }
    if (c === '$') {
      out += '\\$';
      k++;
      continue;
    }
    if (c === '\\' && k + 1 < n) {
      out += line.slice(k, k + 2);
      k += 2;
      continue;
    }
    if (c === '{' || c === '}') {
      out += `\\${c}`;
      k++;
      continue;
    }
    // an image from a URL or a site path stays; one from a relative path or a FORD alias (|media|/logo.png), which a
    // fumadocs site's build would fail to import, is shown as its alt text
    if (c === '!' && line[k + 1] === '[') {
      const img = /^!\[((?:[^\[\]\\]|\\.)*)\]\(\s*<?([^\s)>]*)>?(?:\s+(?:"[^"]*"|'[^']*'))?\s*\)/.exec(line.slice(k));
      if (img && !/^(https?:|data:|\/)/i.test(img[2])) {
        if (img[1].trim()) out += `*${inline(img[1].trim(), tags)}*`;
        k += img[0].length;
        continue;
      }
    }
    if (c === '<') {
      if (line.startsWith('<!--', k)) {
        const end = line.indexOf('-->', k);
        if (end >= 0) {
          k = end + 3;
          continue;
        }
      }
      const auto = /^<((?:https?|ftp|mailto):[^\s<>]+)>/.exec(line.slice(k));
      if (auto) {
        out += mdLink(escapeChars(auto[1]), auto[1]);
        k += auto[0].length;
        continue;
      }
      const tag = htmlTag(line.slice(k));
      if (tag) {
        tags.push(tag);
        out += `\uE030${tags.length - 1}\uE031`;
        k += tag.src.length;
        continue;
      }
      out += '&lt;';
      k++;
      continue;
    }
    out += c;
    k++;
  }
  return out;
}

/** Escapes one line of Markdown text for MDX, leaving inline code alone (maths has been lifted out already). */
export function safeInline(line) {
  const tags = [];
  const text = inline(line, tags);
  return tidy(resolveTags([text], [TAGS_ONLY.test(text) ? 'flow' : 'text'], tags)).join('\n');
}

// The HTML tags of a doc become JSX that MDX parses and React renders without complaint, or text. A phrasing tag pairs
// with its end tag within its paragraph (a table cell, a heading); a block element is paired over the whole doc, as
// a browser builds the tree, and laid out as a block: on its own when it opens and closes in one paragraph, its tags
// on lines of their own when it spans paragraphs (only at the top level, where MDX can close it).
export function resolveTags(lines, meta, tags) {
  if (!tags.length) return lines;
  let unit = 0;
  let open = []; // the phrasing tags open in the unit
  const stack = []; // the open block elements
  const pairInline = (t) => {
    if (t.self) { t.mode = 'jsx'; return; }
    if (!t.close) { open.push(t); return; }
    const top = open[open.length - 1];
    if (top && top.name === t.name) {
      open.pop();
      if (t.name === 'a' && top.href !== null && !open.some((o) => o.name === 'a')) {
        top.mode = 'link-open';
        t.mode = 'link-close';
        t.dest = top.href;
      } else top.mode = t.mode = 'jsx';
    } else t.mode = 'text';
  };
  const flush = () => {
    for (const o of open) o.mode = 'text';
    open = [];
    unit++;
  };
  const enter = (name, t, line, synthetic) => {
    const e = { name, t, unit, line, parent: stack[stack.length - 1] ?? null, synthetic, flow: false, same: false };
    stack.push(e);
    if (t) t.entry = e;
    return e;
  };
  // the element e ends at the tag `at` (its own end tag, or implied before it), or at the end of the doc (at = null)
  const close = (e, at, implied) => {
    const endLine = at ? at.line : lines.length;
    e.endLine = endLine;
    const topLevel = (l) => l >= lines.length || (/^\S|^$/.test(lines[l]) && (meta[l] === 'text' || meta[l] === 'flow'));
    e.same = at !== null && at.unit === e.unit;
    if (!e.same && !(topLevel(e.line) && topLevel(endLine))) {
      // it cannot be laid out as a block here: its tags are text
      if (e.t) e.t.mode = 'text';
      else e.dropped = true;
      if (at && !implied) at.mode = 'text';
      return;
    }
    e.flow = !e.same;
    if (e.t) e.t.mode = 'jsx';
    const end = { jsx: `</${e.name}>`, entry: e };
    if (!at) e.tail = end;
    else if (implied) at.pre.push(end);
    else {
      at.mode = 'jsx';
      at.entry = e;
    }
  };
  const blockTag = (t) => {
    if (!t.close) {
      if (t.self) { t.mode = 'jsx'; return; }
      // end tags left out: an open element that this one closes, as HTML's parser does
      // the parts of a table outside one are dropped, as a browser drops them
      if (TABLE_PARTS.has(t.name) && !stack.some((e) => e.name === 'table')) { t.mode = 'drop'; return; }
      while (stack.length && Object.hasOwn(CLOSED_BY, stack[stack.length - 1].name) && CLOSED_BY[stack[stack.length - 1].name].includes(t.name)) close(stack.pop(), t, true);
      // the <tbody> and <tr> a browser adds around rows and cells written straight into a table
      const top = () => stack[stack.length - 1]?.name;
      if ((t.name === 'tr' || t.name === 'td' || t.name === 'th') && top() === 'table') {
        t.pre.push({ jsx: '<tbody>', entry: enter('tbody', null, t.line, true), opens: true });
      }
      if ((t.name === 'td' || t.name === 'th') && SECTIONS.includes(top())) {
        t.pre.push({ jsx: '<tr>', entry: enter('tr', null, t.line, true), opens: true });
      }
      enter(t.name, t, t.line, false);
      return;
    }
    let at = -1;
    for (let k = stack.length - 1; k >= 0; k--) if (stack[k].name === t.name) { at = k; break; }
    if (at < 0 || stack.slice(at + 1).some((e) => !OPTIONAL_END.has(e.name))) { t.mode = 'drop'; return; }
    while (stack.length - 1 > at) close(stack.pop(), t, true);
    close(stack.pop(), t, false);
  };
  let prev = 'blank';
  for (let l = 0; l < lines.length; l++) {
    const kind = meta[l];
    if (kind !== 'text' || prev === 'heading' || prev === 'flow' || prev === 'table' || prev === 'fence' || prev === 'math' || prev === 'blank') {
      if (!(kind === 'text' && prev === 'list') && !(kind === 'quote' && prev === 'quote')) flush();
    }
    prev = kind;
    if (kind === 'fence' || kind === 'blank' || kind === 'math') continue;
    for (const tok of lines[l].matchAll(/\uE030(\d+)\uE031|\uE002\d+\uE003|(?<!\\)\|/g)) {
      if (tok[0] === '|') {
        if (kind === 'table') flush();
        continue;
      }
      if (tok[1] === undefined) { flush(); continue; }
      const t = tags[Number(tok[1])];
      t.line = l;
      t.unit = unit;
      if (t.void) {
        // a rule stands on its own; a column belongs in a table
        if (t.name === 'hr') t.mode = kind === 'text' || kind === 'flow' ? 'jsx' : 'drop';
        else if (t.name === 'col') t.mode = stack.some((e) => e.name === 'table') ? 'jsx' : 'drop';
        else t.mode = 'jsx';
        t.own = t.name === 'hr' && t.mode === 'jsx';
        continue;
      }
      if (t.name === 'p') {
        // a paragraph tag is a paragraph break (a <p> inside a paragraph would nest)
        t.mode = kind === 'text' || kind === 'flow' ? 'break' : 'drop';
        continue;
      }
      const blockish = BLOCK.has(t.name) || kind === 'flow';
      if (!blockish || kind === 'list' || kind === 'table') pairInline(t);
      else if (kind === 'heading' || kind === 'quote') t.mode = 'drop';
      else blockTag(t);
    }
  }
  flush();
  while (stack.length) close(stack.pop(), null, false);

  // the layout: markers become JSX or text; a block element in a paragraph is broken out of it
  const outer = (e) => e.same && !(e.parent && e.parent.same && e.parent.unit === e.unit && !e.parent.dropped);
  const wrap = (s, e, opening) => {
    if (!e || e.dropped) return s;
    if (e.flow) return `${BREAK}${s}${BREAK}`;
    if (outer(e)) return opening ? `${BREAK}${s}` : `${s}${BREAK}`;
    return s;
  };
  const render = (t) => {
    let s = '';
    for (const p of t.pre) if (!p.entry.dropped) s += wrap(p.jsx, p.entry, !!p.opens);
    switch (t.mode) {
      case 'jsx': s += t.own ? `${BREAK}${t.jsx}${BREAK}` : wrap(t.jsx, t.void || t.self ? null : t.entry, !t.close); break;
      case 'link-open': s += '['; break;
      case 'link-close': s += `](${mdLink('', t.dest).slice(3, -1)})`; break;
      case 'break': s += BREAK; break;
      case 'drop': s += t.name === 'p' || t.name === 'hr' ? ' ' : ''; break;
      default: s += escapeChars(t.src);
    }
    return s;
  };
  // an element laid out within its paragraph is put on one line: a line of nothing but tags would be a block in MDX,
  // which interrupts the paragraph
  const joined = lines.slice();
  const entries = new Set(tags.map((t) => t.entry).filter(Boolean));
  for (const e of entries) {
    if (!outer(e) || e.dropped || !(e.endLine > e.line)) continue;
    for (let l = e.line + 1; l <= e.endLine && l < lines.length; l++) {
      if (joined[l] === null) continue;
      joined[e.line] = `${joined[e.line].trimEnd()} ${joined[l].trim()}`;
      joined[l] = null;
    }
  }
  const result = [];
  const tails = [];
  for (const e of entries) if (e.tail) tails.push(e.tail);
  for (let l = 0; l < lines.length; l++) {
    if (joined[l] === null) continue;
    if (meta[l] === 'fence' || !joined[l].includes('\uE030')) { result.push(joined[l]); continue; }
    const text = joined[l].replace(MARK, (m, id) => render(tags[Number(id)]));
    if (!text.includes(BREAK)) { result.push(text); continue; }
    const indent = /^[ \t]*/.exec(lines[l])[0];
    const pieces = text.split(BREAK);
    pieces.forEach((p, k) => {
      if (k > 0) result.push('');
      if (p.trim()) result.push(indent + neutraliseESM(p.trim()));
    });
  }
  // synthetic end tags of elements left open, top to bottom
  for (const t of tails.reverse()) result.push('', t.jsx);
  return result;
}

/** Lines with no blank line doubled outside code, and none at either end. */
export function tidy(lines) {
  const out = [];
  let inFence = null;
  for (const line of lines) {
    if (inFence) {
      out.push(line);
      if (inFence.test(line)) inFence = null;
      continue;
    }
    const f = FENCE.exec(line);
    if (isFence(f)) inFence = closer(f[2]);
    if (!line.trim() && (!out.length || !out[out.length - 1].trim())) continue;
    out.push(line);
  }
  while (out.length && !out[out.length - 1].trim()) out.pop();
  return out;
}

// ---------------------------------------------------------------- plain text

/**
 * Plain text for front matter, cards and link titles: Markdown and maths markup removed, escapes and character
 * references decoded. Code spans and maths keep their text as written, and emphasis is taken off only at word
 * boundaries, so `stdlib_linalg_lapack` and `B(LDB,*)` survive.
 */
export function plainText(md) {
  const keep = [];
  let s = '';
  for (let k = 0; k < md.length;) {
    const c = md[k];
    if (c === '\\' && /[!-/:-@[-`{-~]/.test(md[k + 1] ?? '')) {
      s += md.slice(k, k + 2);
      k += 2;
      continue;
    }
    if (c === '`') {
      let j = k;
      while (md[j] === '`') j++;
      const run = j - k;
      let close = -1;
      for (let p = md.indexOf('`', j); p >= 0; p = md.indexOf('`', p)) {
        let q = p;
        while (md[q] === '`') q++;
        if (q - p === run) { close = p; break; }
        p = q;
      }
      if (close < 0) { s += md.slice(k, j); k = j; continue; }
      keep.push(md.slice(j, close).replace(/\s+/g, ' ').trim());
      s += `\uE020${keep.length - 1}\uE021`;
      k = close + run;
      continue;
    }
    if (c === '$') {
      const d = md[k + 1] === '$' ? '$$' : '$';
      const e = md.indexOf(d, k + d.length);
      if (e > k + d.length) {
        keep.push(md.slice(k + d.length, e).replace(/\s+/g, ' ').trim());
        s += `\uE020${keep.length - 1}\uE021`;
        k = e + d.length;
        continue;
      }
    }
    s += c;
    k++;
  }
  s = s
    .replace(/!?\[([^\]]*)\]\([^)]*\)/g, '$1')
    .replace(/\[\^[^\]\s]+\]/g, '')
    .replace(/<br\s*\/?>/gi, ' ')
    .replace(/<[^>]+>/g, '')
    .replace(/(^|[^\w\\])(\*\*|__)(?=\S)([\s\S]*?\S)\2(?!\w)/g, '$1$3')
    .replace(/(^|[^\w\\*])([*_])(?=[^\s*_])([\s\S]*?[^\s\\])\2(?![\w*])/g, '$1$3');
  s = decodeText(s).replace(/\s+/g, ' ').trim();
  return s.replace(/\uE020(\d+)\uE021/g, (m, k) => keep[Number(k)]);
}

/**
 * Markdown's backslash escapes and HTML's character references as the characters they stand for, in one pass (so
 * &amp;mdash; stays &mdash;). A named reference HTML 4 lacks stays as written; a bad code point becomes U+FFFD.
 */
export function decodeText(s) {
  return s.replace(/\\([!-/:-@[-`{-~])|&(?:#(\d{1,7})|#[xX]([0-9a-fA-F]{1,6})|([A-Za-z][A-Za-z0-9]{0,31}));/g, (m, esc, dec, hex, name) => (esc !== undefined ? esc : reference(m, dec, hex, name)));
}

/** HTML's character references as the characters they stand for (for Doxygen text, which is not Markdown). */
export function decodeRefs(s) {
  return s.replace(/&(?:#(\d{1,7})|#[xX]([0-9a-fA-F]{1,6})|([A-Za-z][A-Za-z0-9]{0,31}));/g, (m, dec, hex, name) => reference(m, dec, hex, name));
}

function reference(m, dec, hex, name) {
  if (name !== undefined) return Object.hasOwn(ENTITIES, name) ? ENTITIES[name] : m;
  const cp = dec !== undefined ? Number(dec) : parseInt(hex, 16);
  return cp === 0 || cp > 0x10ffff || (cp >= 0xd800 && cp <= 0xdfff) ? '\uFFFD' : String.fromCodePoint(cp);
}
