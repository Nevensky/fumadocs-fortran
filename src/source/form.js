// Source form: fixed (columns, F77) or free. Extensions decide where they are unambiguous; `.F` and `.fpp` are decided
// from the text, because `.F` is free form in most of the projects sampled for the plan.

const FIXED = new Set(['f', 'for', 'f77', 'ftn', 'FOR', 'F77', 'FTN']);
const FREE = new Set(['f90', 'f95', 'f03', 'f08', 'f18', 'f23', 'F90', 'F95', 'F03', 'F08', 'F18', 'F23']);
const BY_CONTENT = new Set(['F', 'fpp', 'FPP']);

/** Every extension read by default, without the dot. */
export const EXTENSIONS = [...FIXED, ...FREE, ...BY_CONTENT];

function extOf(path) {
  const m = /\.([A-Za-z0-9]+)$/.exec(path);
  return m ? m[1] : '';
}

/**
 * The form an extension implies: 'fixed', 'free', or null when the text must decide.
 * @param {string} path
 * @param {{ fixedExtensions?: string[], freeExtensions?: string[] }} [opts] FORD-style overrides, without dots
 */
export function formFromPath(path, opts = {}) {
  const ext = extOf(path);
  if (opts.fixedExtensions?.includes(ext)) return 'fixed';
  if (opts.freeExtensions?.includes(ext)) return 'free';
  if (FIXED.has(ext)) return 'fixed';
  if (FREE.has(ext)) return 'free';
  return null;
}

// statements that begin with c or d in column 1 and so may be free-form code rather than fixed-form comments
const C_WORDS = /^[cd](all|ase|haracter|lass|lose|odimension|ommon|omplex|ontains|ontinue|ritical|ycle|ata|eallocate|imension|o\b|o |ouble|eferred)/i;

/**
 * Decides the form from the text: indented statements and trailing `&` say free form; comment letters in column 1
 * and continuation marks in column 6 say fixed form.
 * @param {string} text
 * @param {'fixed'|'free'} [fallback] the answer when the text says nothing (gfortran treats `.F` as fixed)
 */
export function detectForm(text, fallback = 'fixed') {
  let free = 0, fixed = 0, prevAmp = false, seen = 0;
  let start = 0;
  const n = text.length;
  while (start < n && seen < 4000) {
    let end = text.indexOf('\n', start);
    if (end < 0) end = n;
    const line = text.slice(start, end).replace(/\r$/, '');
    start = end + 1;
    if (!line.trim()) continue;
    seen++;
    const c0 = line[0];
    if (c0 === '#') continue;
    const k = line.search(/\S/);
    if (line[k] === '!') continue;
    if (c0 === '*') { fixed += 2; prevAmp = false; continue; }
    if ((c0 === 'c' || c0 === 'C' || c0 === 'd' || c0 === 'D') && !C_WORDS.test(line)) { fixed += 2; prevAmp = false; continue; }
    if (k >= 1 && k <= 4 && /[A-Za-z]/.test(line[k])) free += 2; // a statement in the label field
    else if (k === 0 && /[A-Za-z]/.test(c0)) free += 1;
    if (k === 5 && /[&$+*.:>|1-9]/.test(line[5]) && line.length > 6 && !prevAmp) fixed += 2;
    const code = line.split('!')[0].trimEnd();
    prevAmp = code.endsWith('&');
    if (prevAmp && !(k === 5)) free += 1;
    if (Math.abs(free - fixed) > 40) break;
  }
  if (free > fixed) return 'free';
  if (fixed > free) return 'fixed';
  return fallback;
}

/** The form of one file: the configured or extension form, else the text's. */
export function resolveForm(path, text, opts = {}) {
  if (opts.form === 'fixed' || opts.form === 'free') return opts.form;
  return formFromPath(path, opts) ?? detectForm(text, 'fixed');
}
