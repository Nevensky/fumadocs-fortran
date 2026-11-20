// A small reader for the fixed- and free-form Fortran 77/90 of reference libraries (LAPACK, ScaLAPACK): program
// units, their dummy arguments and the type declarations of those arguments. It is not the project's parser; it only
// has to read code written in one house style, and it treats the code as text.

/** Splits a source file into statements with their first line number; comments and cpp lines are dropped. */
export function statements(text, { free = false } = {}) {
  const out = [];
  const lines = text.split(/\r?\n/);
  let cur = null;
  lines.forEach((raw, i) => {
    if (/^\s*#/.test(raw)) return;
    if (free) {
      let line = raw.replace(/!.*$/, '');
      if (!line.trim()) return;
      const cont = cur && cur.open;
      line = line.trim();
      if (cont) line = line.replace(/^&/, '');
      const open = /&\s*$/.test(line);
      line = line.replace(/&\s*$/, '');
      if (cont) cur.text += ' ' + line;
      else {
        cur = { line: i + 1, text: line };
        out.push(cur);
      }
      cur.open = open;
      return;
    }
    if (/^[*cC!]/.test(raw) || !raw.trim()) return;
    const body = raw.slice(0, 72);
    if (body.length > 5 && body.slice(0, 5).trim() === '' && body[5] !== ' ' && body[5] !== '0' && cur) {
      cur.text += ' ' + body.slice(6).replace(/!.*$/, '').trim();
      return;
    }
    cur = { line: i + 1, text: body.replace(/^\s*\d*\s*/, '').replace(/!.*$/, '').trim() };
    out.push(cur);
  });
  return out.map(({ line, text }) => ({ line, text: text.replace(/\s+/g, ' ').trim() }));
}

const TYPE_SPEC =
  'double\\s*precision|double\\s*complex|complex\\s*\\*\\s*\\d+|complex\\s*\\(\\s*(?:kind\\s*=\\s*)?\\w+\\s*\\)|complex|' +
  'real\\s*\\*\\s*\\d+|real\\s*\\(\\s*(?:kind\\s*=\\s*)?\\w+\\s*\\)|real|' +
  'integer\\s*\\*\\s*\\d+|integer\\s*\\(\\s*(?:kind\\s*=\\s*)?\\w+\\s*\\)|integer|' +
  'logical\\s*\\*\\s*\\d+|logical\\s*\\(\\s*(?:kind\\s*=\\s*)?\\w+\\s*\\)|logical|' +
  'character\\s*\\*\\s*\\(\\s*\\*\\s*\\)|character\\s*\\*\\s*\\d+|character\\s*\\(\\s*(?:len\\s*=\\s*)?[\\w*]+\\s*\\)|character';

const PREFIX = '(?:(?:recursive|pure|elemental|impure)\\s+)*';
const UNIT_RE = new RegExp(
  `^${PREFIX}(?:(${TYPE_SPEC})\\s+)?${PREFIX}(subroutine|function)\\s+(\\w+)\\s*(?:\\(([^)]*)\\))?`,
  'i',
);
const END_RE = /^end(?:\s*(?:subroutine|function)(?:\s+\w+)?)?$/i;
const DECL_RE = new RegExp(`^(${TYPE_SPEC})\\s*(?:,([^:]*))?(?:::)?\\s*(.*)$`, 'i');

/** Splits an entity list at top-level commas: `A( LDA, * ), B` → ['A( LDA, * )', 'B']. */
function splitTop(s) {
  const parts = [];
  let depth = 0;
  let cur = '';
  for (const c of s) {
    if (c === '(') depth++;
    if (c === ')') depth--;
    if (c === ',' && depth === 0) {
      parts.push(cur);
      cur = '';
    } else cur += c;
  }
  if (cur.trim()) parts.push(cur);
  return parts.map((p) => p.trim()).filter(Boolean);
}

/**
 * Reads the program units of a file: name, kind, result type, dummy arguments with their declared types and
 * dimensions, the names in EXTERNAL statements, and the line range of the unit.
 */
export function units(text, opts) {
  const out = [];
  let unit = null;
  for (const st of statements(text, opts)) {
    if (!unit) {
      if (/^(?:block\s*data|module|program)\b/i.test(st.text)) {
        unit = { name: null, skip: true, start: st.line };
        continue;
      }
      const m = UNIT_RE.exec(st.text);
      if (m) {
        unit = {
          name: m[3].toLowerCase(),
          kind: m[2].toLowerCase(),
          result: m[1] ? m[1].toLowerCase().replace(/\s+/g, ' ') : null,
          args: m[4] ? m[4].split(',').map((a) => a.trim().toLowerCase()).filter(Boolean) : [],
          decls: {},
          externals: new Set(),
          start: st.line,
        };
      }
      continue;
    }
    if (END_RE.test(st.text) || /^end\s*(?:module|program|block\s*data)\b/i.test(st.text)) {
      unit.end = st.line;
      if (!unit.skip) out.push(unit);
      unit = null;
      continue;
    }
    if (unit.skip) continue;
    if (/^external\b/i.test(st.text)) {
      for (const n of st.text.replace(/^external\s*(?:::)?/i, '').split(',')) unit.externals.add(n.trim().toLowerCase());
      continue;
    }
    const d = DECL_RE.exec(st.text);
    if (!d || /^\s*function\b/i.test(d[3])) continue;
    const base = d[1].toLowerCase().replace(/\s+/g, ' ');
    const attrs = (d[2] ?? '').toLowerCase();
    const dimAttr = /dimension\s*(\((?:[^()]|\([^()]*\))*\))/.exec(attrs)?.[1] ?? null;
    for (const ent of splitTop(d[3])) {
      const em = /^(\w+)\s*(\((?:[^()]|\([^()]*\))*\))?/.exec(ent);
      if (!em) continue;
      const name = em[1].toLowerCase();
      const intent = /intent\s*\(\s*(in\s*out|in|out)\s*\)/.exec(attrs)?.[1].replace(/\s+/g, '') ?? null;
      unit.decls[name] = {
        base,
        dims: em[2] ? em[2].replace(/\s+/g, '').toLowerCase() : dimAttr?.replace(/\s+/g, '') ?? null,
        intent,
      };
      if (name === unit.name && !unit.result) unit.result = base;
    }
  }
  return out;
}

/**
 * The type code of a declaration, as used in registry/lapack.json and scalapack.json:
 * i integer, r real, d double precision, c complex, z complex*16, l logical, a character (length 1),
 * a* character(*), a<n> character*n, x<code> a procedure (EXTERNAL) returning <code>.
 * `prec` resolves kind parameters (`real(wp)`): 's'/'c' single, 'd'/'z' double.
 */
export function typeCode(base, prec) {
  const b = base.toLowerCase().replace(/\s+/g, '');
  const double = /^(real|complex)\((?:kind=)?(dp|wp|8|16)\)$/.test(b) && (b.includes('dp') || b.includes('16') || b.includes('8') || prec === 'd' || prec === 'z');
  if (b === 'doubleprecision' || b === 'real*8' || (b.startsWith('real(') && double)) return 'd';
  if (b === 'real' || b === 'real*4' || b.startsWith('real(')) return 'r';
  if (b === 'doublecomplex' || b === 'complex*16' || (b.startsWith('complex(') && double)) return 'z';
  if (b === 'complex' || b === 'complex*8' || b.startsWith('complex(')) return 'c';
  if (b.startsWith('integer')) return 'i';
  if (b.startsWith('logical')) return 'l';
  if (b.startsWith('character')) {
    const len = /^character(?:\*\(?|\((?:len=)?)([\w*]+)\)?$/.exec(b)?.[1];
    if (!len || len === '1') return 'a';
    return len === '*' ? 'a*' : `a${len}`;
  }
  return '?';
}
