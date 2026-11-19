// A Fortran-aware subset of the C preprocessor:
// - conditionals, evaluated by a small expression parser, with every line keeping its condition stack;
// - object-like and function-like macros, with #, ## and the traditional /**/ paste that gfortran's cpp mode relies on;
// - #include and line markers.
// Macros are never expanded inside Fortran strings or comments. Lines in branches that are switched off are kept
// apart, so that HPC use inside them can still be reported.

import { isWord, skipString } from '../parse/text.js';

/**
 * @typedef {{ s: string, f: number, n: number, c: number }} Line  text, file index, line number, condition id
 * @typedef {{ params: string[]|null, variadic: boolean, body: string }} Macro
 */

/** Interns condition stacks: id 0 is "always". */
export class CondTable {
  constructor() {
    this.list = [[]];
    this.ids = new Map([['', 0]]);
  }
  id(terms) {
    const key = terms.join('\u0000');
    let id = this.ids.get(key);
    if (id === undefined) {
      id = this.list.length;
      this.list.push(terms.slice());
      this.ids.set(key, id);
    }
    return id;
  }
  get(id) {
    return this.list[id] ?? [];
  }
}

/** Builds a macro table from `{ NAME: value }`; `true` or '' define the name as 1, as `-DNAME` does. */
export function macroTable(defs = {}) {
  const map = new Map();
  for (const [spec, value] of Object.entries(defs)) {
    if (value === false || value === null || value === undefined) continue;
    const body = value === true ? '1' : String(value);
    const m = /^([A-Za-z_]\w*)(?:\(([^)]*)\))?$/.exec(spec);
    if (!m) continue;
    map.set(m[1], makeMacro(m[2] === undefined ? null : m[2], body));
  }
  return map;
}

function makeMacro(paramText, body) {
  let params = null, variadic = false;
  if (paramText !== null) {
    params = paramText.split(',').map((p) => p.trim()).filter(Boolean);
    if (params[params.length - 1] === '...') { params[params.length - 1] = '__VA_ARGS__'; variadic = true; }
  }
  // comments become a paste marker: traditional cpp joins `wrap_/**/NAME` into one token after substitution
  return { params, variadic, body: body.replace(/\/\*.*?\*\//g, '\u0001').trim() };
}

const negate = (t) => (t.startsWith('!defined(') && t.endsWith(')') && t.indexOf(')') === t.length - 1 ? t.slice(1)
  : /^defined\([A-Za-z_]\w*\)$/.test(t) ? '!' + t : `!(${t})`);

const tidy = (e) => e.replace(/\/\*.*?\*\//g, ' ').replace(/\/\/.*$/, '').replace(/\s+/g, ' ').trim();

/**
 * Preprocesses one file.
 * @param {string} text
 * @param {number} file the file's index
 * @param {object} env shared state: macros (Map), conds (CondTable), keepAll, form, readInclude(name, fromFile, angle),
 *   fileIndex(name), diagnostics
 * @returns {{ lines: Line[], inactive: Line[] }}
 */
export function preprocess(text, file, env, frames = [], depth = 0, out = { lines: [], inactive: [] }) {
  const raw = text.split('\n');
  if (raw.length > 1 && raw[raw.length - 1] === '') raw.pop(); // the final newline ends the last line
  let cur = file, base = 0;
  const entry = frames.length;
  let cond = condOf(frames, env);
  const active = () => frames.length === 0 || frames[frames.length - 1].active;
  for (let i = 0; i < raw.length; i++) {
    let s = raw[i];
    if (s.charCodeAt(s.length - 1) === 13) s = s.slice(0, -1);
    const n = i + 1 + base;
    let k = 0;
    while (k < s.length && (s.charCodeAt(k) === 32 || s.charCodeAt(k) === 9)) k++;
    if (s.charCodeAt(k) !== 35) {
      if (active()) out.lines.push({ s: env.macros.size ? expandLine(s, env) : s, f: cur, n, c: cond });
      else out.inactive.push({ s, f: cur, n, c: cond });
      continue;
    }
    // a directive, possibly continued with backslashes
    let d = s.slice(k + 1);
    while (d.endsWith('\\') && i + 1 < raw.length) d = d.slice(0, -1) + ' ' + raw[++i].replace(/\r$/, '');
    const m = /^\s*([A-Za-z_]+|\d+)?\s*(.*)$/.exec(d);
    const word = m[1] ?? '';
    const rest = m[2];
    const isActive = active();
    const diag = (code, message) => env.diagnostics.push({ code, severity: 'warning', file: cur, line: n, message });
    switch (word) {
      case 'if': case 'ifdef': case 'ifndef': {
        let term, val = false;
        if (word === 'if') {
          term = tidy(rest);
          if (isActive) val = evalCond(rest, env, diag);
        } else {
          const name = /^[A-Za-z_]\w*/.exec(rest)?.[0] ?? '';
          term = word === 'ifdef' ? `defined(${name})` : `!defined(${name})`;
          val = env.macros.has(name) === (word === 'ifdef');
        }
        frames.push({ parent: isActive, taken: val, active: isActive && (env.keepAll || val), terms: [term], prev: [term] });
        cond = condOf(frames, env);
        break;
      }
      case 'elif': case 'elifdef': case 'elifndef': {
        const f = frames[frames.length - 1];
        if (!f || frames.length <= entry) { diag('cpp-unbalanced', `#${word} without #if`); break; }
        let term, val = false;
        if (word === 'elif') {
          term = tidy(rest);
          if (f.parent && !f.taken) val = evalCond(rest, env, diag);
        } else {
          const name = /^[A-Za-z_]\w*/.exec(rest)?.[0] ?? '';
          term = word === 'elifdef' ? `defined(${name})` : `!defined(${name})`;
          val = !f.taken && env.macros.has(name) === (word === 'elifdef');
        }
        f.terms = [...f.prev.map(negate), term];
        f.prev.push(term);
        f.active = f.parent && (env.keepAll || val);
        f.taken = f.taken || val;
        cond = condOf(frames, env);
        break;
      }
      case 'else': {
        const f = frames[frames.length - 1];
        if (!f || frames.length <= entry) { diag('cpp-unbalanced', '#else without #if'); break; }
        f.terms = f.prev.map(negate);
        f.active = f.parent && (env.keepAll || !f.taken);
        f.taken = true;
        cond = condOf(frames, env);
        break;
      }
      case 'endif':
        if (frames.length <= entry) { diag('cpp-unbalanced', '#endif without #if'); break; }
        frames.pop();
        cond = condOf(frames, env);
        break;
      case 'define':
        if (isActive) {
          const dm = /^([A-Za-z_]\w*)(\(([^)]*)\))?(.*)$/.exec(rest);
          if (dm) env.macros.set(dm[1], makeMacro(dm[2] ? dm[3] : null, dm[4]));
        }
        break;
      case 'undef':
        if (isActive) env.macros.delete(/^[A-Za-z_]\w*/.exec(rest)?.[0]);
        break;
      case 'include': case 'include_next': {
        if (!isActive) break;
        let spec = rest.trim();
        if (!/^["<]/.test(spec)) spec = expandText(spec, env.macros, new Set(), false).trim();
        const im = /^"([^"]+)"|^<([^>]+)>/.exec(spec);
        if (!im) { diag('cpp-include', `cannot read #include ${rest.trim()}`); break; }
        if (depth >= 40) { diag('cpp-include', 'includes nested too deeply'); break; }
        const inc = env.readInclude(im[1] ?? im[2], cur, !!im[2]);
        if (!inc) { diag('include-missing', `include file not found: ${im[1] ?? im[2]}`); break; }
        preprocess(inc.text, inc.index, env, frames, depth + 1, out);
        cond = condOf(frames, env);
        break;
      }
      case 'line': case '': {
        // line markers: `# 12 "file.F90" 1` (cpp output) or `#line 12 "file.F90"`
        const lm = /^(\d+)(?:\s+"([^"]*)")?/.exec(word === 'line' ? rest : (m[1] ?? '') + ' ' + rest);
        if (lm) {
          base = Number(lm[1]) - (i + 2);
          if (lm[2] !== undefined && env.fileIndex) cur = env.fileIndex(lm[2], cur);
        }
        break;
      }
      case 'error':
        if (isActive) diag('cpp-error', `#error ${rest.trim()}`);
        break;
      default:
        if (/^\d+$/.test(word)) {
          const lm = /^"([^"]*)"/.exec(rest.trim());
          base = Number(word) - (i + 2);
          if (lm && env.fileIndex) cur = env.fileIndex(lm[1], cur);
        }
      // #pragma, #warning, #ident and the like are ignored
    }
  }
  if (frames.length > entry) {
    env.diagnostics.push({ code: 'cpp-unbalanced', severity: 'warning', file, line: raw.length, message: `${frames.length - entry} #if without #endif` });
    frames.length = entry;
  }
  return out;
}

function condOf(frames, env) {
  if (!frames.length) return 0;
  const terms = [];
  for (const f of frames) for (const t of f.terms) terms.push(t);
  return env.conds.id(terms);
}

// ---------------------------------------------------------------- macro expansion

/** Expands the macros in one line of Fortran, leaving strings and comments alone. */
export function expandLine(s, env) {
  const macros = env.macros;
  if (macros.size <= 24) {
    let any = false;
    for (const name of macros.keys()) if (s.includes(name)) { any = true; break; }
    if (!any) return s;
  }
  // comment lines: fixed-form column-1 letters, and `!` lines other than directive sentinels
  const c0 = s[0];
  if (env.form === 'fixed' && (c0 === 'c' || c0 === 'C' || c0 === '*' || c0 === 'd' || c0 === 'D') && s[1] !== '$') return s;
  const k = s.search(/\S/);
  if (k >= 0 && s[k] === '!') {
    if (s[k + 1] !== '$') return s;
    const m = /^!\$[A-Za-z]*/.exec(s.slice(k));
    return s.slice(0, k + m[0].length) + expandText(s.slice(k + m[0].length), macros, new Set(), true);
  }
  return expandText(s, macros, new Set(), true);
}

/**
 * Expands macros in `text`.
 * @param {boolean} fortran stop at a `!` comment and leave Fortran strings alone
 */
export function expandText(text, macros, hide, fortran) {
  const n = text.length;
  let out = '', k = 0;
  while (k < n) {
    const c = text.charCodeAt(k);
    if (c === 33 && fortran) { out += text.slice(k); break; }
    if (c === 39 || c === 34) {
      const j = skipString(text, k);
      const end = j < 0 ? n : j + 1;
      out += text.slice(k, end);
      k = end;
      continue;
    }
    if ((c >= 65 && c <= 90) || (c >= 97 && c <= 122) || c === 95) {
      let j = k + 1;
      while (j < n && isWord(text.charCodeAt(j))) j++;
      const name = text.slice(k, j);
      const m = macros.get(name);
      if (!m || hide.has(name)) { out += name; k = j; continue; }
      if (m.params === null) {
        hide.add(name);
        out += expandText(m.body, macros, hide, false).replace(/\u0001/g, '');
        hide.delete(name);
        k = j;
        continue;
      }
      let p = j;
      while (p < n && (text[p] === ' ' || text[p] === '\t')) p++;
      const args = text[p] === '(' ? collectArgs(text, p) : null;
      if (!args) { out += name; k = j; continue; }
      hide.add(name);
      out += expandText(substitute(m, args.args), macros, hide, false).replace(/\u0001/g, '');
      hide.delete(name);
      k = args.end + 1;
      continue;
    }
    if (c >= 48 && c <= 57) {
      // a pp-number such as 1.0e-3_dp is one token: its suffix is not a macro name
      let j = k + 1;
      while (j < n) {
        const d = text.charCodeAt(j);
        if (isWord(d) || d === 46) j++;
        else if ((d === 43 || d === 45) && /[eEdD]/.test(text[j - 1])) j++;
        else break;
      }
      out += text.slice(k, j);
      k = j;
      continue;
    }
    out += text[k];
    k++;
  }
  return out;
}

function collectArgs(text, p) {
  const args = [];
  let depth = 0, start = p + 1;
  for (let k = p; k < text.length; k++) {
    const c = text.charCodeAt(k);
    if (c === 39 || c === 34) {
      const j = skipString(text, k);
      if (j < 0) return null;
      k = j;
    } else if (c === 40) depth++;
    else if (c === 41) {
      if (--depth === 0) {
        args.push(text.slice(start, k));
        return { args, end: k };
      }
    } else if (c === 44 && depth === 1) {
      args.push(text.slice(start, k));
      start = k + 1;
    }
  }
  return null;
}

function substitute(m, rawArgs) {
  const args = rawArgs.map((a) => a.trim());
  if (m.variadic) {
    const fixed = m.params.length - 1;
    args.splice(fixed, args.length - fixed, args.slice(fixed).join(','));
  }
  const index = new Map(m.params.map((p, i) => [p, i]));
  // ## pastes become a marker first, so that `a ## b` is not read as the stringify `# b`
  let body = m.body.replace(/\s*##\s*/g, '\u0002');
  body = body.replace(/#\s*([A-Za-z_]\w*)/g, (all, p) => (index.has(p) ? JSON.stringify(args[index.get(p)] ?? '') : all));
  body = body.replace(/[A-Za-z_]\w*/g, (w) => (index.has(w) ? args[index.get(w)] ?? '' : w));
  return body.replace(/\u0002/g, '');
}

// ---------------------------------------------------------------- #if expressions

function evalCond(expr, env, diag) {
  let e = tidy(expr);
  e = e.replace(/\bdefined\s*\(\s*([A-Za-z_]\w*)\s*\)|\bdefined\s+([A-Za-z_]\w*)/g, (_, a, b) => (env.macros.has(a || b) ? ' 1 ' : ' 0 '));
  e = expandText(e, env.macros, new Set(), false).replace(/\u0001/g, '');
  e = e.replace(/\b[A-Za-z_]\w*\b/g, ' 0 ');
  try {
    return evaluate(e) !== 0;
  } catch (err) {
    diag('cpp-expr', `cannot evaluate #if ${tidy(expr)}: ${err.message}`);
    return false;
  }
}

const TOKEN = /\s*(0[xX][0-9a-fA-F]+|\d+|'(?:\\.|[^'\\])'|&&|\|\||<<|>>|<=|>=|==|!=|[-+*/%<>!~&|^?:()])[uUlL]*/y;
const BIN = { '*': 10, '/': 10, '%': 10, '+': 9, '-': 9, '<<': 8, '>>': 8, '<': 7, '<=': 7, '>': 7, '>=': 7, '==': 6, '!=': 6, '&': 5, '^': 4, '|': 3, '&&': 2, '||': 1 };

/** Evaluates an integer constant expression of the C preprocessor. */
export function evaluate(e) {
  const toks = [];
  TOKEN.lastIndex = 0;
  let pos = 0;
  for (;;) {
    if (/^\s*$/.test(e.slice(pos))) break;
    TOKEN.lastIndex = pos;
    const m = TOKEN.exec(e);
    if (!m) throw new Error(`unexpected "${e.slice(pos).trim()}"`);
    pos = TOKEN.lastIndex;
    const t = m[1];
    if (/^0[xX]/.test(t)) toks.push(parseInt(t, 16));
    else if (/^0\d/.test(t)) toks.push(parseInt(t, 8));
    else if (/^\d/.test(t)) toks.push(Number(t));
    else if (t[0] === "'") toks.push(t.charCodeAt(1));
    else toks.push(t);
  }
  let i = 0;
  const peek = () => toks[i];
  const unary = () => {
    const t = peek();
    if (t === '!') { i++; return unary() ? 0 : 1; }
    if (t === '-') { i++; return -unary(); }
    if (t === '+') { i++; return unary(); }
    if (t === '~') { i++; return ~unary(); }
    if (t === '(') {
      i++;
      const v = ternary();
      if (toks[i++] !== ')') throw new Error('missing )');
      return v;
    }
    if (typeof t === 'number') { i++; return t; }
    throw new Error(t === undefined ? 'unexpected end' : `unexpected "${t}"`);
  };
  const binary = (min) => {
    let left = unary();
    for (;;) {
      const op = peek();
      const p = BIN[op];
      if (p === undefined || p < min) return left;
      i++;
      const right = binary(p + 1);
      left = apply(op, left, right);
    }
  };
  const ternary = () => {
    const c = binary(1);
    if (peek() !== '?') return c;
    i++;
    const a = ternary();
    if (toks[i++] !== ':') throw new Error('missing :');
    const b = ternary();
    return c ? a : b;
  };
  const v = ternary();
  if (i !== toks.length) throw new Error(`unexpected "${toks[i]}"`);
  return v;
}

function apply(op, a, b) {
  switch (op) {
    case '*': return a * b;
    case '/': return b ? Math.trunc(a / b) : 0;
    case '%': return b ? a % b : 0;
    case '+': return a + b;
    case '-': return a - b;
    case '<<': return a << b;
    case '>>': return a >> b;
    case '<': return +(a < b);
    case '<=': return +(a <= b);
    case '>': return +(a > b);
    case '>=': return +(a >= b);
    case '==': return +(a === b);
    case '!=': return +(a !== b);
    case '&': return a & b;
    case '^': return a ^ b;
    case '|': return a | b;
    case '&&': return +(!!a && !!b);
    case '||': return +(!!a || !!b);
  }
  return 0;
}
