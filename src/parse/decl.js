// Type specifications, attribute lists and entity declarations. Every function takes the canonical lower-case text `s`
// and its original-case twin `o` (same offsets; see canon() and lower() in text.js).

import { matchClose, splitRanges, nameAt } from './text.js';

const INTRINSIC = /^(integer|real|complex|logical|character|byte|double ?precision|double ?complex)(?![a-z0-9_])/;
const DERIVED = /^(type|class|procedure|typeof|classof)\(/;
const BASE = { doubleprecision: 'double precision', doublecomplex: 'double complex' };

/**
 * Parses the type specification at the start of `s`.
 * @returns {{ type: { base: string, kind: string|null, len: string|null, text: string }, end: number }|null}
 */
export function typeSpec(s, o) {
  let m = INTRINSIC.exec(s);
  if (m) {
    const word = m[1].replace(' ', '');
    const base = BASE[word] ?? word;
    let i = m[0].length, kind = null, len = null;
    const c = s[i];
    if (c === '(' && base !== 'double precision' && base !== 'double complex') {
      const k = matchClose(s, i);
      if (k < 0) return null;
      const items = splitRanges(s.slice(i + 1, k), ',').map(([a, b]) => [s.slice(i + 1 + a, i + 1 + b).trim(), o.slice(i + 1 + a, i + 1 + b).trim()]);
      let pos = 0;
      for (const [ls, os] of items) {
        const kw = /^(kind|len)=/.exec(ls);
        if (kw) {
          if (kw[1] === 'kind') kind = os.slice(5);
          else len = os.slice(4);
        } else if (base === 'character') {
          if (pos++ === 0) len = os;
          else kind = os;
        } else kind = os;
      }
      i = k + 1;
    } else if (c === '*') {
      // the old star forms: real*8, complex*16, character*(*), character*10
      let j = i + 1, sel;
      if (s[j] === '(') {
        const k = matchClose(s, j);
        if (k < 0) return null;
        sel = o.slice(j + 1, k).trim();
        j = k + 1;
      } else {
        const d = /^\d+/.exec(s.slice(j));
        if (!d) return null;
        sel = d[0];
        j += d[0].length;
      }
      if (base === 'character') len = sel;
      else if (base === 'complex' && /^\d+$/.test(sel)) kind = String(Number(sel) / 2);
      else kind = sel;
      i = j;
    }
    return { type: { base, kind, len, text: o.slice(0, i) }, end: i };
  }
  m = DERIVED.exec(s);
  if (m) {
    const open = m[1].length;
    const k = matchClose(s, open);
    if (k < 0) return null;
    const inner = o.slice(open + 1, k).trim();
    const type = { base: m[1], kind: inner, len: null, text: o.slice(0, k + 1) };
    // a parameterised derived type: class(banded_matrix(k=dp, kl=*)) has kind banded_matrix and its type parameters
    const pm = /^([A-Za-z_]\w*)\s*\((.*)\)$/.exec(inner);
    if (pm && (m[1] === 'type' || m[1] === 'class')) {
      type.kind = pm[1];
      type.params = pm[2].trim();
    }
    return { type, end: k + 1 };
  }
  return null;
}

/** Splits a bracketed list (`a,b(1:2),*`) into trimmed items, in original case. */
export function listItems(o, s = o) {
  if (!s.trim()) return [];
  return splitRanges(s, ',').map(([a, b]) => o.slice(a, b).trim());
}

/**
 * Parses an attribute list: the text between the type specification and `::`, without the leading comma.
 * @returns {object} flags (intent, optional, value, …), dims/codims, access, bind, and `list` with every attribute as
 *   written
 */
export function parseAttrs(s, o) {
  const a = { list: [] };
  if (!s) return a;
  for (const [x, y] of splitRanges(s, ',')) {
    const ls = s.slice(x, y).trim(), os = o.slice(x, y).trim();
    if (!ls) continue;
    a.list.push(os);
    const m = /^([a-z_]+)(\(|\[)?/.exec(ls);
    if (!m) continue;
    const word = m[1];
    const arg = m[2] ? os.slice(word.length + 1, -1).trim() : null;
    switch (word) {
      case 'intent': a.intent = intentOf(arg); break;
      case 'dimension': if (arg !== null) a.dims = listItems(arg); break;
      case 'codimension': if (arg !== null) a.codims = listItems(arg); break;
      case 'public': case 'private': a.access = word; break;
      case 'bind': a.bind = arg ?? ''; break;
      case 'extends': a.extends = arg; break;
      case 'pass': a.pass = arg ?? true; break;
      case 'rank': a.rank = arg; break;
      case 'kind': case 'len': a.typeParam = word; break;
      case 'non_overridable': a.nonOverridable = true; break;
      default:
        a[word] = true;
    }
  }
  return a;
}

export function intentOf(arg) {
  const x = String(arg ?? '').toLowerCase().replace(/\s+/g, '');
  return x === 'in' || x === 'out' || x === 'inout' ? x : x || null;
}

/**
 * Parses an entity-declaration list: `a(n,*), b[*], c*10 = 'x', p => null()`.
 * @returns {Array<{ name: string, dims?: string[], codims?: string[], len?: string, init?: string, pointerInit?: boolean, at: number }>}
 *   `at` is the offset of the name in `s`
 */
export function parseEntities(s, o, base = 0) {
  const out = [];
  for (const [x, y] of splitRanges(s, ',')) {
    let i = x;
    while (i < y && s[i] === ' ') i++;
    const name = nameAt(s, i);
    if (!name) continue;
    const e = { name: o.slice(i, i + name.length), at: base + i };
    i += name.length;
    if (s[i] === '(') {
      const k = matchClose(s, i);
      if (k < 0 || k >= y) continue;
      e.dims = listItems(o.slice(i + 1, k), s.slice(i + 1, k));
      i = k + 1;
    }
    if (s[i] === '[') {
      const k = matchClose(s, i);
      if (k < 0 || k >= y) continue;
      e.codims = listItems(o.slice(i + 1, k), s.slice(i + 1, k));
      i = k + 1;
    }
    if (s[i] === '*') {
      let j = i + 1;
      if (s[j] === '(') {
        const k = matchClose(s, j);
        if (k < 0 || k >= y) continue;
        e.len = o.slice(j + 1, k).trim();
        j = k + 1;
      } else {
        const d = /^\d+/.exec(s.slice(j, y));
        if (d) { e.len = d[0]; j += d[0].length; }
      }
      i = j;
    }
    if (s.startsWith('=>', i)) {
      e.init = o.slice(i + 2, y).trim();
      e.pointerInit = true;
    } else if (s[i] === '=') e.init = o.slice(i + 1, y).trim();
    else if (s[i] === '/') e.init = o.slice(i, y).trim(); // the old `integer x / 1 /` form
    out.push(e);
  }
  return out;
}

/**
 * Parses a whole type declaration statement: type specification, attributes and entities.
 * @returns {{ type: object, attrs: object, entities: object[] }|null} null when the statement is not a declaration
 */
export function parseDeclaration(s, o) {
  const t = typeSpec(s, o);
  if (!t) return null;
  let i = t.end;
  let attrs = { list: [] };
  const dc = s.indexOf('::', i);
  if (s[i] === ',') {
    if (dc < 0) return null;
    attrs = parseAttrs(s.slice(i + 1, dc), o.slice(i + 1, dc));
    i = dc + 2;
  } else if (s.startsWith('::', i)) i += 2;
  else if (s[i] === ' ') i++;
  else if (!/[a-z_]/.test(s[i] ?? '')) return null; // `real(dp)x`: canon() drops the blank after a bracket
  const rest = s.slice(i);
  if (!rest || !/^[a-z_]/.test(rest)) return null;
  const entities = parseEntities(rest, o.slice(i), i);
  if (!entities.length) return null;
  return { type: t.type, attrs, entities };
}
