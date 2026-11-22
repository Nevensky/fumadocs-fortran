// LaTeX maths in doc comments. Fortran codes write it with every delimiter LaTeX and the documentation tools know:
//   $…$ and $$…$$, \( \) and \[ \] (FORD and MathJax), \begin{equation}…\end{equation} and the other display
//   environments, Doxygen's \f$…\f$, \f(…\f), \f[…\f] and \f{env}{…\f}, and reStructuredText's :math:`…` role and
//   `.. math::` block (stdlib).
// Before a doc is escaped for MDX, every span is lifted out and replaced by a placeholder that no escaping touches;
// afterwards it comes back as remark-math syntax ($…$ inline, a $$ block on lines of its own for display), or as
// code for a site without remark-math (math: 'code'). Spans may cross comment lines, but never a blank line.
// This module is the generator's own; fumadocs-fortran/math (./math.js) holds the helpers a site needs.

import { normaliseTex } from './math.js';

const IN = ['\uE000', '\uE001'];
const DISPLAY = ['\uE002', '\uE003'];
const PLACEHOLDER = /\uE000(\d+)\uE001|\uE002(\d+)\uE003/g;

/** A line that holds display maths and nothing else: never indented code (safeMarkdown in src/emit/mdx.js). */
export const DISPLAY_LINE = /^[ \t]*\uE002\d+\uE003[ \t]*$/;

// environments that are maths without delimiters around them, as MathJax (FORD's renderer) reads them: the display
// environments, and those that only exist in maths (Quantum ESPRESSO writes a bare \begin{array} table); a text
// environment such as \begin{description} (ESMF's ProTeX) is not maths
const DISPLAY_ENVS = new Set([
  'equation', 'equation*', 'align', 'align*', 'alignat', 'alignat*', 'flalign', 'flalign*', 'gather', 'gather*',
  'multline', 'multline*', 'eqnarray', 'eqnarray*', 'displaymath', 'split',
  'array', 'darray', 'subarray', 'matrix', 'matrix*', 'pmatrix', 'pmatrix*', 'bmatrix', 'bmatrix*', 'Bmatrix',
  'Bmatrix*', 'vmatrix', 'vmatrix*', 'Vmatrix', 'Vmatrix*', 'smallmatrix', 'cases', 'dcases', 'rcases', 'drcases',
  'aligned', 'alignedat', 'gathered', 'CD',
]);

/**
 * Lifts the maths out of a doc.
 * @param {string} text
 * @param {{ doxygen?: boolean }} [opts] doxygen: also skip \verbatim, \code and \htmlonly blocks
 * @returns {{ text: string, spans: Array<{ tex: string, display: boolean, src: string }> }} src: the span as written
 */
export function extractMath(text, opts = {}) {
  const spans = [];
  const n = text.length;
  let out = '';
  let i = 0;
  // the end of the paragraph holding position k: maths never crosses a blank line
  const paraEnd = (k) => {
    const m = /\n[ \t]*\n/g;
    m.lastIndex = k;
    const r = m.exec(text);
    return r ? r.index : n;
  };
  const lineStart = (k) => text.lastIndexOf('\n', k - 1) + 1;
  const lineEnd = (k) => {
    const e = text.indexOf('\n', k);
    return e < 0 ? n : e;
  };
  // the closing delimiter in [from, to); for $ and $$, an escaped character (\$) is skipped
  const find = (close, from, to) => {
    const skipEscapes = close[0] !== '\\';
    for (let k = from; k <= to - close.length; k++) {
      if (skipEscapes && text[k] === '\\') { k++; continue; }
      if (text.startsWith(close, k)) return k;
    }
    return -1;
  };
  const push = (tex, display, start, end) => {
    let kind = display;
    if (display) {
      // display maths on a table row, a heading or a list item's own line stays inline, so as not to break the
      // structure around it
      const line = text.slice(lineStart(start), lineEnd(start));
      if (/^\s*(\||[-*+]\s|\d+[.)]\s|#{1,6}\s)/.test(line)) kind = false;
    }
    spans.push({ tex, display: kind, src: text.slice(start, end) });
    const [a, b] = kind ? DISPLAY : IN;
    out += `${a}${spans.length - 1}${b}`;
    i = end;
  };
  let atLineStart = true;
  while (i < n) {
    const c = text[i];
    // fenced code and Doxygen's verbatim, code and HTML blocks are left alone
    if (atLineStart) {
      const rest = text.slice(i, Math.min(n, i + 40));
      // a CommonMark fence: a backtick fence's info string holds no backtick (inline ```code``` is not a fence)
      const fm = /^[ \t]*(`{3,}|~{3,})([^\n]*)/.exec(text.slice(i, lineEnd(i)));
      const fence = fm && !(fm[1][0] === '`' && fm[2].includes('`')) ? fm : null;
      const block = opts.doxygen ? /^[ \t]*[@\\](verbatim|code|htmlonly|latexonly|manonly|rtfonly|xmlonly|dot|msc)\b/.exec(rest) : null;
      // reStructuredText's `.. math::` block: the lines below it indented deeper (blank lines among them), and any
      // formula on the directive's own line
      const rst = /^([ \t]*)\.\. math::[ \t]*(.*)$/.exec(text.slice(i, lineEnd(i)));
      if (rst) {
        const body = rst[2].trim() ? [rst[2]] : [];
        let j = lineEnd(i);
        let last = j;
        while (j < n) {
          const next = text.slice(j + 1, lineEnd(j + 1));
          if (next.trim()) {
            if (next.length - next.trimStart().length <= rst[1].length) break;
            body.push(next.trim());
            last = lineEnd(j + 1);
          }
          j = lineEnd(j + 1);
        }
        if (body.length) {
          // the block's blank lines would end a $$ block early: only its lines with text are kept
          spans.push({ tex: body.join('\n'), display: true, src: text.slice(i, last) });
          out += `${rst[1]}${DISPLAY[0]}${spans.length - 1}${DISPLAY[1]}`;
          i = last;
          atLineStart = false;
          continue;
        }
      }
      if (fence || block) {
        let end;
        if (fence) {
          const re = new RegExp(`\\n[ \\t]*${fence[1][0] === '`' ? '`' : '~'}{${fence[1].length},}[ \\t]*(?=\\n|$)`, 'g');
          re.lastIndex = i + fence[0].length;
          const m = re.exec(text);
          end = m ? m.index + m[0].length : n;
        } else {
          const re = new RegExp(`[@\\\\]end${block[1]}\\b`, 'g');
          re.lastIndex = i;
          const m = re.exec(text);
          end = m ? m.index + m[0].length : n;
        }
        out += text.slice(i, end);
        i = end;
        atLineStart = false;
        continue;
      }
    }
    if (c === '\n') {
      out += c;
      i++;
      atLineStart = true;
      continue;
    }
    atLineStart = false;
    // reStructuredText's :math:`…` role
    if (c === ':' && text.startsWith(':math:`', i)) {
      const k = text.indexOf('`', i + 7);
      if (k > i + 7 && k < paraEnd(i)) { push(text.slice(i + 7, k), false, i, k + 1); continue; }
    }
    if (c === '`') {
      // inline code: a run of backticks to the same run, within the paragraph
      let j = i;
      while (text[j] === '`') j++;
      const run = text.slice(i, j);
      const close = text.indexOf(run, j);
      const end = close >= 0 && close < paraEnd(i) ? close + run.length : j;
      out += text.slice(i, end);
      i = end;
      continue;
    }
    if (c === '\\') {
      const two = text.slice(i, i + 3);
      const pe = paraEnd(i);
      let k;
      if (two === '\\f$' && (k = find('\\f$', i + 3, pe)) >= 0) { push(text.slice(i + 3, k), false, i, k + 3); continue; }
      if (two === '\\f(' && (k = find('\\f)', i + 3, pe)) >= 0) { push(text.slice(i + 3, k), false, i, k + 3); continue; }
      if (two === '\\f[' && (k = find('\\f]', i + 3, pe)) >= 0) { push(text.slice(i + 3, k), true, i, k + 3); continue; }
      if (two === '\\f{') {
        const m = /^\\f\{([A-Za-z*]+)\}\s*\{?/.exec(text.slice(i));
        if (m && (k = find('\\f}', i + m[0].length, pe)) >= 0) {
          push(`\\begin{${m[1]}}${text.slice(i + m[0].length, k)}\\end{${m[1]}}`, true, i, k + 3);
          continue;
        }
      }
      if (text.startsWith('\\begin{', i)) {
        const m = /^\\begin\{([A-Za-z*]+)\}/.exec(text.slice(i));
        if (m && DISPLAY_ENVS.has(m[1])) {
          const close = `\\end{${m[1]}}`;
          k = text.indexOf(close, i + m[0].length);
          if (k >= 0 && k < pe) { push(text.slice(i, k + close.length), true, i, k + close.length); continue; }
        }
      }
      const d = text[i + 1];
      if (d === '[' && (k = find('\\]', i + 2, pe)) >= 0) { push(text.slice(i + 2, k), true, i, k + 2); continue; }
      if (d === '(' && (k = find('\\)', i + 2, pe)) >= 0) { push(text.slice(i + 2, k), false, i, k + 2); continue; }
      // any other escape (\$, \\, \_) is kept as it is, with the character it escapes
      out += text.slice(i, i + 2);
      i += 2;
      continue;
    }
    if (c === '$') {
      const pe = paraEnd(i);
      if (text[i + 1] === '$') {
        const k = find('$$', i + 2, pe);
        if (k >= 0 && text.slice(i + 2, k).trim()) { push(text.slice(i + 2, k), true, i, k + 2); continue; }
        out += '$$';
        i += 2;
        continue;
      }
      const k = inlineDollar(text, i, pe);
      if (k >= 0) { push(text.slice(i + 1, k), false, i, k + 1); continue; }
    }
    out += c;
    i++;
  }
  return { text: out, spans };
}

// between dollars, version-control keywords ($Id$, $Revision: 1.2 $) and template placeholders ($COPYRIGHT$, $FILE$)
const RCS = /^(Id|Revision|Rev|Date|Author|Header|Source|Log|Locker|Name|RCSfile|State|URL|HeadURL|LastChanged\w*)(:[^\n]*)?$|^[A-Z][A-Z_]{4,}$|^(FILE|DATE|NAME|YEAR|USER|TIME|HOST|PATH)$/;
// what only TeX looks like: a command, a superscript, a subscript that is not inside an identifier (x_1 and x_{ij},
// but not OMP_NUM_THREADS), or an equals sign that is not a comparison or an arrow (==, /=, <=, =>)
const TEXISH = /\\[A-Za-z]+|\^|_\{|_[A-Za-z0-9](?![A-Za-z0-9])|(?<![=<>/!:])=(?![=>])/;

/**
 * Finds the `$` that closes an inline `$…$` opening at `i`, or -1 when this `$` is not maths: a directive sentinel
 * (`!$omp`), a shell variable (`$OMP_NUM_THREADS`), money (`$5 and $10`, `$20,000`), a version-control keyword
 * (`$Id$`), or text between dollars with spaces at its edges and nothing of TeX in it (`$B -> block, if b == -1, $`).
 */
function inlineDollar(text, i, end) {
  if (text[i - 1] === '!' || /[A-Za-z0-9]/.test(text[i - 1] ?? '')) return -1;
  let j = i + 1;
  for (; j < end; j++) {
    if (text[j] === '\\') { j++; continue; }
    if (text[j] === '$') break;
  }
  if (j >= end || text[j + 1] === '$') return -1;
  const content = text.slice(i + 1, j);
  if (!content.trim() || /\d/.test(text[j + 1] ?? '') || text[j - 1] === '!') return -1;
  if (RCS.test(content.trim())) return -1;
  const texish = TEXISH.test(content);
  const edged = /^\s/.test(content) || /\s$/.test(content);
  if (edged && !texish) return -1;
  if (/^\d/.test(content) && /\s$/.test(content)) return -1;
  if (content.includes('\n') && !texish) return -1;
  return j;
}

/**
 * Puts the maths back. A display block stands on lines of its own, indented as the line it was on, so that it stays
 * inside its list item; maths that ended up in a code block (indented code made fenced) goes back as it was written.
 * @param {'katex'|'code'} [mode] katex (default): $…$ and $$ blocks for remark-math; code: inline code and latex blocks
 */
export function restoreMath(text, spans, mode = 'katex') {
  if (!spans.length) return text;
  const blocks = [];
  const out = asWrittenInCode(text, spans).replace(PLACEHOLDER, (m, a, b) => {
    const s = spans[Number(a ?? b)];
    if (!s) return '';
    if (a !== undefined) {
      const line = normaliseTex(s.tex, { inline: true }).replace(/\s*\n\s*/g, ' ').trim();
      if (mode === 'code') return codeSpan(line);
      // remark-math reads no escapes inside maths: a $ in the TeX (\$) needs a longer run of dollars around it
      let d = '$';
      while (line.includes(d)) d += '$';
      return d.length > 1 ? `${d} ${line} ${d}` : `$${line}$`;
    }
    blocks.push(normaliseTex(s.tex).split('\n').map((l) => l.trimEnd()).join('\n').trim());
    return `\uE010${blocks.length - 1}\uE011`;
  });
  if (!blocks.length) return out;
  // the text around a display block is broken off, as LaTeX does (an optional group cannot match the empty start of
  // the string in JavaScript, so the ends are tested by position)
  // (the text broken off after a block starts a line: an `import` or `export` there would be an ES statement)
  return out.replace(/\n?[ \t]*\uE010(\d+)\uE011[ \t]*\n?((?:import|export)\b)?/g, (whole, k, esm, offset, str) => {
    const m = esm ? whole.slice(0, -esm.length) : whole;
    const after = esm ? `&#${esm.charCodeAt(0)};${esm.slice(1)}` : '';
    const at = offset + m.indexOf('\uE010');
    const indent = /^[ \t]*/.exec(str.slice(str.lastIndexOf('\n', at - 1) + 1, at))[0];
    const start = m.startsWith('\n') ? '\n' : offset === 0 ? '' : '\n';
    const end = (m.length > 1 && m.endsWith('\n') ? '\n' : offset + m.length === str.length ? '' : `\n${indent}`) + after;
    const block = blocks[Number(k)];
    let open = '$$';
    let close = '$$';
    if (mode === 'code') {
      close = '```';
      while (block.includes(close)) close += '`';
      open = `${close}latex`;
    }
    // the lines after the first keep the indentation they were written with, but never stand left of the block
    const tex = block.split('\n').map((l, i) => (i === 0 || l.length - l.trimStart().length < indent.length ? indent + l.trimStart() : l));
    return `${start}${indent}${open}\n${tex.join('\n')}\n${indent}${close}${end}`;
  });
}

// inside fenced code (indented code that safeMarkdown fenced, as Markdown reads it), a span is the text as written
function asWrittenInCode(text, spans) {
  if (!/`{3}|~{3}/.test(text)) return text;
  const lines = text.split('\n');
  let close = null;
  for (let i = 0; i < lines.length; i++) {
    if (close) {
      if (close.test(lines[i])) close = null;
      else lines[i] = lines[i].replace(PLACEHOLDER, (m, a, b) => spans[Number(a ?? b)]?.src ?? m);
      continue;
    }
    const f = /^[ \t]*(`{3,}|~{3,})(.*)$/.exec(lines[i]);
    if (f && !(f[1][0] === '`' && f[2].includes('`'))) close = new RegExp(`^[ \\t]*\\${f[1][0]}{${f[1].length},}[ \\t]*$`);
  }
  return lines.join('\n');
}

/** Removes placeholders, keeping the TeX (for plain-text summaries). */
export function mathAsText(text, spans) {
  return text.replace(PLACEHOLDER, (m, a, b) => normaliseTex(spans[Number(a ?? b)]?.tex ?? '', { inline: true }).replace(/\s+/g, ' ').trim());
}

function codeSpan(s) {
  let fence = '`';
  while (s.includes(fence)) fence += '`';
  const pad = s.startsWith('`') || s.endsWith('`') ? ' ' : '';
  return `${fence}${pad}${s}${pad}${fence}`;
}

const CONTROL_ESCAPES = { '\x07': '\\a', '\x08': '\\b', '\x0B': '\\v', '\x0C': '\\f' };

/**
 * Control characters in a doc, which no page can show. A generator that read `\alpha`, `\beta`, `\vec` or `\frac`
 * as string escapes leaves BEL, BS, VT or FF in their place (stdlib's sparse kernels): before a letter, these become
 * the backslash and letter again. The others are dropped.
 */
export function cleanControls(s) {
  if (!/[\x00-\x08\x0B-\x1F\x7F-\x9F]/.test(s)) return s;
  return s.replace(/[\x07\x08\x0B\x0C](?=[A-Za-z])/g, (c) => CONTROL_ESCAPES[c]).replace(/[\x00-\x08\x0B-\x1F\x7F-\x9F]/g, '');
}
