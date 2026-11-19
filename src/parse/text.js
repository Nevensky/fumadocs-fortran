// Lexical helpers shared by the reader and the parser. Every scan knows about character literals ('…' or "…",
// with a doubled quote inside), so a `!`, `;`, `,` or bracket inside a string is never taken for syntax.

const SPACE = 32, TAB = 9, CR = 13, QUOTE = 39, DQUOTE = 34;

/** True for the character codes of [A-Za-z0-9_]. */
export function isWord(c) {
  return (c >= 97 && c <= 122) || (c >= 65 && c <= 90) || (c >= 48 && c <= 57) || c === 95;
}

/** The index of the quote that closes the string opening at `k`, or -1 when the string does not close. */
export function skipString(s, k) {
  const q = s.charCodeAt(k);
  for (let j = k + 1; j < s.length; j++) {
    if (s.charCodeAt(j) === q) {
      if (s.charCodeAt(j + 1) === q) j++;
      else return j;
    }
  }
  return -1;
}

/**
 * Finds the `!` that starts a trailing comment.
 * @param {string} s a line of code
 * @param {string|null} q the quote still open from the previous line (a continued string), or null
 * @param {boolean} [hollerith] skip Hollerith constants such as `4HAB!C` (fixed form)
 * @returns {{ cut: number, q: string|null }} the index of the `!` (-1 when there is none) and the quote left open
 *   at the end of the line
 */
export function scanComment(s, q, hollerith) {
  const n = s.length;
  let k = 0;
  if (q) {
    const qc = q.charCodeAt(0);
    for (; k < n; k++) {
      if (s.charCodeAt(k) === qc) {
        if (s.charCodeAt(k + 1) === qc) k++;
        else { q = null; k++; break; }
      }
    }
    if (q) return { cut: -1, q };
  }
  for (; k < n; k++) {
    const c = s.charCodeAt(k);
    if (c === 33) return { cut: k, q: null };
    if (c === QUOTE || c === DQUOTE) {
      const j = skipString(s, k);
      if (j < 0) return { cut: -1, q: s[k] };
      k = j;
    } else if (hollerith && c >= 48 && c <= 57) {
      // nH followed by n characters, after a delimiter: (4HABCD, /2H!!/
      const prev = k > 0 ? s.charCodeAt(k - 1) : 40;
      if (prev === 40 || prev === 44 || prev === 47 || prev === 61 || prev === 42 || prev === SPACE) {
        let j = k;
        while (j < n && s.charCodeAt(j) >= 48 && s.charCodeAt(j) <= 57) j++;
        const h = s.charCodeAt(j);
        if ((h === 72 || h === 104) && j > k) {
          const len = Number(s.slice(k, j));
          if (len > 0) k = Math.min(n, j + len);
          else k = j;
        } else k = j - 1;
      }
    }
  }
  return { cut: -1, q: null };
}

/** The index of the bracket that closes the `(` or `[` at `i`, or -1. */
export function matchClose(s, i) {
  let depth = 0;
  for (let k = i; k < s.length; k++) {
    const c = s.charCodeAt(k);
    if (c === QUOTE || c === DQUOTE) {
      k = skipString(s, k);
      if (k < 0) return -1;
    } else if (c === 40 || c === 91) depth++;
    else if (c === 41 || c === 93) {
      if (--depth === 0) return k;
    }
  }
  return -1;
}

/**
 * The ranges of `s` between top-level occurrences of `sep` (outside strings and brackets).
 * @returns {Array<[number, number]>} [start, end) pairs
 */
export function splitRanges(s, sep) {
  const out = [];
  const len = sep.length, c0 = sep.charCodeAt(0);
  let depth = 0, start = 0;
  for (let k = 0; k < s.length; k++) {
    const c = s.charCodeAt(k);
    if (c === QUOTE || c === DQUOTE) {
      const j = skipString(s, k);
      if (j < 0) break;
      k = j;
    } else if (c === 40 || c === 91) depth++;
    else if (c === 41 || c === 93) depth--;
    else if (depth === 0 && c === c0 && (len === 1 || s.startsWith(sep, k))) {
      out.push([start, k]);
      start = k + len;
      k += len - 1;
    }
  }
  out.push([start, s.length]);
  return out;
}

/** Splits `s` at top-level occurrences of `sep`. */
export function splitTop(s, sep) {
  return splitRanges(s, sep).map(([a, b]) => s.slice(a, b));
}

/** The index of the first top-level occurrence of `sub` at or after `from`, or -1. */
export function indexTop(s, sub, from = 0) {
  const len = sub.length, c0 = sub.charCodeAt(0);
  let depth = 0;
  for (let k = from; k < s.length; k++) {
    const c = s.charCodeAt(k);
    if (c === QUOTE || c === DQUOTE) {
      const j = skipString(s, k);
      if (j < 0) return -1;
      k = j;
    } else if (c === 40 || c === 91) depth++;
    else if (c === 41 || c === 93) depth--;
    else if (depth === 0 && c === c0 && (len === 1 || s.startsWith(sub, k))) return k;
  }
  return -1;
}

/**
 * The canonical form of a statement, in its original case: whitespace outside strings is removed, except for one space
 * between two word characters (`real ( dp ) , intent ( in ) :: x` becomes `real(dp),intent(in)::x`, and
 * `double  precision a( lda, * )` becomes `double precision a(lda,*)`).
 */
export function canon(text) {
  const n = text.length;
  let o = '', k = 0, last = -1;
  while (k < n) {
    let c = text.charCodeAt(k);
    if (c === SPACE || c === TAB || c === CR) {
      let j = k + 1;
      while (j < n && ((c = text.charCodeAt(j)) === SPACE || c === TAB || c === CR)) j++;
      if (j >= n) break;
      if (last >= 0 && isWord(last) && isWord(text.charCodeAt(j))) o += ' ';
      k = j;
      continue;
    }
    if (c === QUOTE || c === DQUOTE) {
      const j = skipString(text, k);
      const end = j < 0 ? n : j + 1;
      o += text.slice(k, end);
      last = QUOTE;
      k = end;
      continue;
    }
    let j = k + 1;
    while (j < n) {
      const d = text.charCodeAt(j);
      if (d === SPACE || d === TAB || d === CR || d === QUOTE || d === DQUOTE) break;
      j++;
    }
    o += text.slice(k, j);
    last = text.charCodeAt(j - 1);
    k = j;
  }
  return o;
}

/** Lower-cases `o` outside strings; the result has the same length and offsets. */
export function lower(o) {
  if (o.indexOf("'") < 0 && o.indexOf('"') < 0) return o.toLowerCase();
  const n = o.length;
  let s = '', k = 0;
  while (k < n) {
    const c = o.charCodeAt(k);
    if (c === QUOTE || c === DQUOTE) {
      const j = skipString(o, k);
      const end = j < 0 ? n : j + 1;
      s += o.slice(k, end);
      k = end;
      continue;
    }
    let j = k + 1;
    while (j < n) {
      const d = o.charCodeAt(j);
      if (d === QUOTE || d === DQUOTE) break;
      j++;
    }
    s += o.slice(k, j).toLowerCase();
    k = j;
  }
  return s;
}

/** Replaces the contents of every string with nothing (`'abc'` becomes `''`), so that regular expressions can scan code. */
export function blankStrings(s) {
  if (s.indexOf("'") < 0 && s.indexOf('"') < 0) return s;
  return s.replace(/'(?:[^']|'')*'?|"(?:[^"]|"")*"?/g, (m) => m[0] + m[0]);
}

const NAME = /[A-Za-z_][A-Za-z0-9_]*/y;

/** The identifier starting at `i`, or null. */
export function nameAt(s, i) {
  NAME.lastIndex = i;
  const m = NAME.exec(s);
  return m ? m[0] : null;
}
