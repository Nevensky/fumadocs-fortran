// An independent oracle for Reference-LAPACK: every routine's doc header repeats its signature in a "Definition:"
// section, and lists its arguments with \param. Neither is read by the parser, which takes arguments from the code.

/**
 * @param {string} text a LAPACK or BLAS source file
 * @returns {{ name: string, args: string[], params: string[] }|null}
 */
export function documentedSignature(text) {
  const lines = text.split('\n').map((l) => l.replace(/\r$/, ''));
  // the commented signature: "*  Definition:" … "*       SUBROUTINE DGESV( N, NRHS, … )", continued on the
  // following comment lines (with or without a "$" mark) until the closing parenthesis
  const at = lines.findIndex((l) => /^[*!c]\s+Definition:/i.test(l));
  let sig = '';
  if (at >= 0) {
    for (let i = at + 1; i < lines.length && i < at + 40; i++) {
      const l = lines[i].replace(/^[*!cC]>?/, '');
      if (!sig) {
        if (/\b(SUBROUTINE|FUNCTION)\s+\w+/i.test(l)) sig = l.trim();
        if (sig && (!sig.includes('(') || sig.includes(')'))) break;
        continue;
      }
      if (sig.includes(')')) break;
      sig += ' ' + l.replace(/^\s*[$+&]/, '').trim();
    }
  }
  const m = /\b(?:SUBROUTINE|FUNCTION)\s+(\w+)\s*(?:\(([^)]*)\))?/i.exec(sig);
  const params = [...text.matchAll(/^[*!]>\s*\\param\[[a-z,]+\]\s+(\w+)/gim)].map((x) => x[1].toLowerCase());
  if (!m) return null;
  // free-form headers (.f90) continue the commented signature with `&`
  const args = (m[2] ?? '').replace(/&/g, '').split(',').map((a) => a.trim().toLowerCase()).filter(Boolean);
  return { name: m[1].toLowerCase(), args, params };
}
