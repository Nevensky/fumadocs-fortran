// An independent census of program units, written separately from the parser and sharing no code with it: line-based
// regular expressions that list the module, submodule, program, block data, subroutine and function headers of a
// file. The gate compares it with the parser's IR to prove that no program unit is lost.

const PROC_PREFIX = /^(?:(?:pure|impure|elemental|recursive|non_recursive|module|simple)\s+|(?:integer|real|double\s*precision|double\s*complex|complex|logical|character|type|class)\s*(?:\*\s*\(?[\w*:]+\)?|\((?:[^()]|\([^()]*\))*\))?\s*)*(subroutine|function)\s+([a-z_]\w*)/;
const NOT_MODULE = new Set(['procedure', 'subroutine', 'function', 'pure', 'impure', 'elemental', 'recursive', 'non_recursive', 'simple']);

/**
 * @param {string} text the source, after preprocessing if it has any
 * @param {'free'|'fixed'} form
 * @returns {string[]} `kind:name` for each unit header, lower case
 */
export function census(text, form) {
  const out = [];
  let prevAmp = false;
  for (let line of text.split('\n')) {
    line = line.replace(/\r$/, '');
    if (form === 'fixed') {
      if (/^[cC*!dD]/.test(line)) continue;
      if (line.length > 5 && line[5] !== ' ' && line[5] !== '0' && /^\s{5}/.test(line)) continue; // continuation
      line = line.replace(/\t/, '      ').slice(6, 72);
    } else {
      const was = prevAmp;
      const code = line.replace(/!.*$/, '').trimEnd();
      if (code.trim()) prevAmp = code.endsWith('&');
      if (was) continue; // a continuation line
    }
    const s = line.replace(/!.*$/, '').trim().toLowerCase().replace(/\s+/g, ' ');
    if (!s || s[0] === '#') continue;
    let m;
    if ((m = /^module ([a-z_]\w*)$/.exec(s)) && !NOT_MODULE.has(m[1])) out.push(`module:${m[1]}`);
    else if ((m = /^submodule ?\([^)]*\) ?([a-z_]\w*)/.exec(s))) out.push(`submodule:${m[1]}`);
    else if ((m = /^program ([a-z_]\w*)/.exec(s))) out.push(`program:${m[1]}`);
    else if ((m = /^block ?data(?: ([a-z_]\w*))?$/.exec(s))) out.push(`blockdata:${m[1] ?? ''}`);
    else if (!/^end\b/.test(s) && (m = PROC_PREFIX.exec(s))) out.push(`procedure:${m[2]}`);
  }
  return out;
}

/** The same `kind:name` list from the parser's IR, for the files given. */
export function irUnits(ir, files) {
  const set = files ? new Set(files) : null;
  const out = [];
  for (const e of Object.values(ir.entities)) {
    if (set && !set.has(e.file)) continue;
    const name = (e.name || '').toLowerCase();
    if (e.kind === 'module' || e.kind === 'submodule' || e.kind === 'program' || e.kind === 'blockdata') out.push(`${e.kind}:${name}`);
    else if (e.kind === 'procedure' && e.proc !== 'procedure') out.push(`procedure:${name}`);
  }
  return out;
}

/** The entries of `want` missing from `have`, counting repeats. */
export function missing(want, have) {
  const count = new Map();
  for (const x of have) count.set(x, (count.get(x) ?? 0) + 1);
  const out = [];
  for (const x of want) {
    const n = count.get(x) ?? 0;
    if (n > 0) count.set(x, n - 1);
    else out.push(x);
  }
  return out;
}
