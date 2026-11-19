// Turns preprocessed physical lines into events: statements (continuation lines joined), comments and directives.
// One pass per line, aware of strings, so that a `'!!'` inside a string is never a comment.
//
// Events:
//   { t: 'stmt', text, f, n, e, c, parts, trail }  parts: [offset, line, …] where each continuation line starts in
//                                                  `text` (null for a one-line statement); trail: trailing comments
//   { t: 'comment', f, n, c, lead, body }          lead: '!', or the column-1 letter of a fixed-form comment
//   { t: 'dir', f, n, e, c, sentinel, text }       sentinel: omp, ompx, acc, cuf, $ (conditional line), dir, …

import { scanComment } from '../parse/text.js';

const isBlank = (c) => c === 32 || c === 9 || c === 13;

/**
 * @param {import('./cpp.js').Line[]} lines
 * @param {{ form: 'free'|'fixed', fixedLength?: number, omp?: boolean, dLines?: boolean }} opts omp: `!$` lines are
 *   code (the `_OPENMP` macro is defined); fixedLength: 72 (default), 132, or 0 for no limit
 */
export function readEvents(lines, opts) {
  return opts.form === 'fixed' ? readFixed(lines, opts) : readFree(lines, opts);
}

const SENTINEL = /^!\$(ompx|omp|acc|cuf)(?![A-Za-z0-9_])/i;
const VENDOR = /^!(dir|dec|gcc|ibm|pgi|nec|cdir|mic|vd)\$/i;

function readFree(lines, { omp = false }) {
  const out = [];
  let cur = null, q = null, dir = null;
  for (let i = 0; i < lines.length; i++) {
    const L = lines[i];
    let s = L.s;
    const n = s.length;
    let k = 0;
    while (k < n && isBlank(s.charCodeAt(k))) k++;
    if (k >= n) continue;
    if (dir) {
      const m = s.charCodeAt(k) === 33 ? SENTINEL.exec(s.slice(k)) : null;
      if (m && m[1].toLowerCase() === dir.sentinel) {
        let rest = s.slice(k + m[0].length).trim();
        if (rest.startsWith('&')) rest = rest.slice(1).trimStart();
        const cont = rest.endsWith('&');
        if (cont) rest = rest.slice(0, -1).trimEnd();
        dir.text += ' ' + rest;
        dir.e = L.n;
        if (!cont) dir = null;
        continue;
      }
      dir = null;
    }
    if (s.charCodeAt(k) === 33) {
      const tail = s.slice(k);
      if (tail.charCodeAt(1) === 36) {
        const m = SENTINEL.exec(tail);
        if (m) {
          let rest = tail.slice(m[0].length).trim();
          const cont = rest.endsWith('&');
          if (cont) rest = rest.slice(0, -1).trimEnd();
          const d = { t: 'dir', f: L.f, n: L.n, e: L.n, c: L.c, sentinel: m[1].toLowerCase(), text: rest };
          out.push(d);
          if (cont) dir = d;
          continue;
        }
        const c2 = tail.charCodeAt(2);
        if (Number.isNaN(c2) || isBlank(c2) || c2 === 38) {
          // `!$ code`: OpenMP conditional compilation
          if (omp) s = s.slice(0, k) + '  ' + s.slice(k + 2);
          else {
            out.push({ t: 'dir', f: L.f, n: L.n, e: L.n, c: L.c, sentinel: '$', text: tail.slice(2).trim() });
            continue;
          }
        } else {
          out.push({ t: 'comment', f: L.f, n: L.n, c: L.c, lead: '!', body: tail.slice(1).trimEnd() });
          continue;
        }
      } else {
        const v = VENDOR.exec(tail);
        if (v) {
          out.push({ t: 'dir', f: L.f, n: L.n, e: L.n, c: L.c, sentinel: v[1].toLowerCase(), text: tail.slice(v[0].length).trim() });
          continue;
        }
        out.push({ t: 'comment', f: L.f, n: L.n, c: L.c, lead: '!', body: tail.slice(1).trimEnd() });
        continue;
      }
    }
    // code
    const r = scanComment(s, cur ? q : null, false);
    let code = r.cut >= 0 ? s.slice(0, r.cut) : s;
    let end = code.length;
    while (end > 0 && isBlank(code.charCodeAt(end - 1))) end--;
    let cont = false;
    if (end > 0 && code.charCodeAt(end - 1) === 38) { cont = true; end--; }
    code = code.slice(0, end);
    if (cur) {
      let j = 0;
      while (j < code.length && isBlank(code.charCodeAt(j))) j++;
      const piece = code.charCodeAt(j) === 38 ? code.slice(j + 1) : code;
      (cur.parts ??= [0, cur.n]).push(cur.text.length, L.n);
      cur.text += piece;
      cur.e = L.n;
    } else {
      let j = 0;
      while (j < code.length && isBlank(code.charCodeAt(j))) j++;
      cur = { t: 'stmt', f: L.f, n: L.n, e: L.n, c: L.c, text: code.slice(j), parts: null, trail: null };
      out.push(cur);
    }
    if (r.cut >= 0) (cur.trail ??= []).push({ n: L.n, lead: '!', body: s.slice(r.cut + 1).trimEnd() });
    if (cont) q = r.q;
    else { cur = null; q = null; }
  }
  return out;
}

const FIXED_SENTINEL = /^[cC*!]\$(omp|acc|cuf)/i;
const FIXED_VENDOR = /^[cC*!](dir|dec|gcc|ibm|pgi|nec|mic|vd)\$/i;

/** DEC tab format: a tab in the first six columns ends the label field; a digit after it marks a continuation. */
function detab(s) {
  const m = /^([^\t]{0,5})\t(.*)$/.exec(s);
  if (!m) return s.replace(/\t/g, ' ');
  const label = (m[1] + '     ').slice(0, 5);
  const rest = m[2].replace(/\t/g, ' ');
  return /^[1-9]/.test(rest) ? label + rest : label + ' ' + rest;
}

function readFixed(lines, { omp = false, fixedLength = 72, dLines = false }) {
  const limit = fixedLength > 0 ? fixedLength : Infinity;
  const out = [];
  let cur = null, q = null, dir = null;
  for (let i = 0; i < lines.length; i++) {
    const L = lines[i];
    let s = L.s;
    if (s.charCodeAt(s.length - 1) === 13) s = s.slice(0, -1);
    const c0 = s[0];
    if (c0 === 'c' || c0 === 'C' || c0 === '*' || c0 === '!' || ((c0 === 'd' || c0 === 'D') && !dLines)) {
      let code = false;
      if (s[1] === '$') {
        const m = FIXED_SENTINEL.exec(s);
        if (m) {
          // c$omp, *$omp, !$omp in columns 1-5; a mark in column 6 continues the directive
          const sentinel = m[1].toLowerCase();
          if (s.length > limit) s = s.slice(0, limit);
          const mark = s[5] ?? ' ';
          const rest = s.slice(6).trim();
          if (mark !== ' ' && mark !== '0' && dir && dir.sentinel === sentinel) {
            dir.text += ' ' + rest;
            dir.e = L.n;
          } else {
            dir = { t: 'dir', f: L.f, n: L.n, e: L.n, c: L.c, sentinel, text: rest };
            out.push(dir);
          }
          continue;
        }
        if (/^..[ \t0-9]{0,3}$|^..[ \t0-9]{3}/.test(s.slice(0, 5))) {
          // conditional compilation: the sentinel in columns 1-2, then an ordinary fixed-form line
          if (!omp) {
            dir = null;
            out.push({ t: 'dir', f: L.f, n: L.n, e: L.n, c: L.c, sentinel: '$', text: s.slice(6).trim() });
            continue;
          }
          s = '  ' + s.slice(2);
          code = true;
        }
      }
      if (!code) {
        const v = FIXED_VENDOR.exec(s);
        dir = null;
        if (v) out.push({ t: 'dir', f: L.f, n: L.n, e: L.n, c: L.c, sentinel: v[1].toLowerCase(), text: s.slice(v[0].length).trim() });
        else out.push({ t: 'comment', f: L.f, n: L.n, c: L.c, lead: c0, body: s.slice(1).trimEnd() });
        continue;
      }
    }
    if (s.indexOf('\t') >= 0) s = detab(s);
    if (s.length > limit) s = s.slice(0, limit);
    let k = 0;
    while (k < s.length && isBlank(s.charCodeAt(k))) k++;
    if (k >= s.length) continue;
    if (s[k] === '!' && k !== 5) {
      out.push({ t: 'comment', f: L.f, n: L.n, c: L.c, lead: '!', body: s.slice(k + 1).trimEnd() });
      continue;
    }
    if (s[k] === '#') continue; // a stray preprocessor line in a file that was not preprocessed
    dir = null;
    const isCont = s.length > 5 && s[5] !== ' ' && s[5] !== '0' && k >= 5;
    const body = s.length > 6 ? s.slice(6) : '';
    const r = scanComment(body, isCont && cur ? q : null, true);
    const code = r.cut >= 0 ? body.slice(0, r.cut) : body;
    if (isCont && cur) {
      (cur.parts ??= [0, cur.n]).push(cur.text.length, L.n);
      cur.text += code;
      cur.e = L.n;
    } else {
      const label = s.slice(0, Math.min(5, s.length)).trim();
      cur = { t: 'stmt', f: L.f, n: L.n, e: L.n, c: L.c, text: code.trimStart(), parts: null, trail: null };
      if (label && /^\d+$/.test(label)) cur.label = label;
      out.push(cur);
    }
    if (r.cut >= 0) (cur.trail ??= []).push({ n: L.n, lead: '!', body: body.slice(r.cut + 1).trimEnd() });
    q = r.q;
  }
  return out;
}

const F_INCLUDE = /^\s*include\s*(['"])(.+?)\1\s*(?:!.*)?$/i;

/**
 * Replaces Fortran INCLUDE lines with the lines of the included file. As in gfortran, included files are not
 * preprocessed and keep the including file's form.
 * @param {import('./cpp.js').Line[]} lines
 * @param {{ form: string, readInclude: Function, diagnostics: object[] }} env
 */
export function expandIncludes(lines, env, depth = 0) {
  const out = [];
  for (const L of lines) {
    const s = env.form === 'fixed' ? (/^[cC*!dD]/.test(L.s) ? '' : L.s.slice(6)) : L.s;
    const m = (env.form !== 'fixed' || /^\s{6}/.test(L.s)) && /include/i.test(s) ? F_INCLUDE.exec(s) : null;
    if (!m) { out.push(L); continue; }
    if (depth >= 20) {
      env.diagnostics.push({ code: 'include-depth', severity: 'warning', file: L.f, line: L.n, message: 'includes nested too deeply' });
      continue;
    }
    const inc = env.readInclude(m[2], L.f, false);
    if (!inc) {
      env.diagnostics.push({ code: 'include-missing', severity: 'warning', file: L.f, line: L.n, message: `include file not found: ${m[2]}` });
      continue;
    }
    const sub = inc.text.split('\n').map((s, i) => ({ s: s.replace(/\r$/, ''), f: inc.index, n: i + 1, c: L.c }));
    for (const x of expandIncludes(sub, env, depth + 1)) out.push(x);
  }
  return out;
}
