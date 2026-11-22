// fumadocs-fortran/math: the maths helpers a site needs, without the parser. normaliseTex writes TeX as KaTeX renders
// it, and katexMacros defines the commands Fortran docs write that KaTeX lacks. The generator lifts the maths out of a
// doc before escaping it, and puts it back as remark-math syntax, in ./math-spans.js.

/**
 * TeX that KaTeX renders, written as LaTeX and MathJax (FORD's renderer) take it:
 * - \label, which only numbering in a LaTeX document needs, is dropped;
 * - in \text{…} and its kin, _ & % # $ ^ are escaped, as LaTeX and KaTeX need and MathJax does not (Quantum ESPRESSO
 *   writes \text{cutoff_2D}), except in $…$ inside the text; \mbox, \textsl and \textsc, which KaTeX lacks, become
 *   \text, \textit and \text;
 * - environments KaTeX lacks: eqnarray becomes aligned, multline gathered, flalign align, and displaymath goes;
 *   a split with more than one & a row (MathJax allows it) becomes aligned;
 * - \( and \) inside maths are parentheses (stdlib writes them so);
 * - inline (opts.inline), the display-only environments become their inline forms (align and split aligned, gather
 *   gathered, alignat alignedat, equation goes) and \tag goes.
 * @param {string} tex
 * @param {{ inline?: boolean }} [opts]
 */
export function normaliseTex(tex, opts = {}) {
  let t = tex.replace(/\\label\{[^}]*\}/g, '');
  t = textArguments(t);
  t = t.replace(/\\begin\{eqnarray\*?\}([\s\S]*?)\\end\{eqnarray\*?\}/g, (m, body) => `\\begin{aligned}${body.replace(/&\s*(=|<|>|\\[A-Za-z]+|\+|-)\s*&/g, '&$1')}\\end{aligned}`);
  // KaTeX's split takes one & a row; MathJax's takes more (Quantum ESPRESSO aligns several columns): aligned does
  t = t.replace(/\\begin\{split\}([\s\S]*?)\\end\{split\}/g, (m, body) => (body.split('\\\\').some((row) => (row.match(/(?<!\\)&/g) ?? []).length > 1) ? `\\begin{aligned}${body}\\end{aligned}` : m));
  t = t.replace(/\\(begin|end)\{multline\*?\}/g, '\\$1{gathered}');
  t = t.replace(/\\(begin|end)\{flalign(\*?)\}/g, '\\$1{align$2}');
  t = t.replace(/\\(?:begin|end)\{displaymath\}/g, '');
  t = t.replace(/(?<!\\)\\([()])/g, '$1');
  if (opts.inline) {
    t = t.replace(/\\(begin|end)\{(?:align|split)\*?\}/g, '\\$1{aligned}');
    t = t.replace(/\\(begin|end)\{gather\*?\}/g, '\\$1{gathered}');
    t = t.replace(/\\(begin|end)\{alignat\*?\}/g, '\\$1{alignedat}');
    t = t.replace(/\\(?:begin|end)\{equation\*?\}/g, '');
    t = t.replace(/\\tag\*?\s*\{[^}]*\}/g, '');
  }
  return t;
}

const TEXT_CMD = /\\(text|textrm|texttt|textit|textbf|textsf|textnormal|textup|textmd|textsl|textsc|emph|mbox|hbox)\s*\{/g;
const RENAME = { mbox: 'text', textsl: 'textit', textsc: 'text' };

// the arguments of \text{…} and its kin, brace-matched at any depth (see normaliseTex)
function textArguments(t) {
  if (!t.includes('\\')) return t;
  const re = new RegExp(TEXT_CMD.source, 'g');
  let out = '';
  let last = 0;
  for (let m; (m = re.exec(t)); ) {
    const open = m.index + m[0].length;
    let depth = 1;
    let k = open;
    for (; k < t.length; k++) {
      if (t[k] === '\\') { k++; continue; }
      if (t[k] === '{') depth++;
      else if (t[k] === '}' && --depth === 0) break;
    }
    if (depth) break; // unbalanced: the rest stays as it is
    const body = textArguments(t.slice(open, k));
    // $…$ inside the text is maths again, unless the dollars do not pair
    const pairs = (body.match(/(?<!\\)\$/g) ?? []).length % 2 === 0;
    let fixed = '';
    let math = false;
    for (let p = 0; p < body.length; p++) {
      const c = body[p];
      if (c === '\\') { fixed += body.slice(p, p + 2); p++; continue; }
      if (c === '$' && pairs) { math = !math; fixed += c; continue; }
      if (!math && '_&%#$'.includes(c)) fixed += `\\${c}`;
      else if (!math && c === '^') fixed += '\\textasciicircum{}';
      else fixed += c;
    }
    out += `${t.slice(last, m.index)}\\${RENAME[m[1]] ?? m[1]}{${fixed}}`;
    last = k + 1;
    re.lastIndex = k + 1;
  }
  return out + t.slice(last);
}

const R = String.raw;
// a command of the physics package and its starred form, which does not stretch its delimiters
const starred = (name, plain, star) => ({
  [`\\${name}`]: R`\@ifstar{\fdf@${name}@s}{\fdf@${name}}`,
  [`\\fdf@${name}`]: plain,
  [`\\fdf@${name}@s`]: star,
});

/**
 * Macros for the commands Fortran docs write that KaTeX lacks: the physics package (\abs, \norm, \expval, \mel,
 * \comm, \order, \vb, \va, \vu, \grad, \dd, \dv, \pdv, \Tr and their kin), \vv (esvect), \mathbbm and \mathds (bbm,
 * dsfont), and the \eps, \C, \Q and \ud shorthands. For rehype-katex's `macros` option; pass a copy, as KaTeX adds a
 * page's \gdef to the object it is given: `[rehypeKatex, { macros: { ...katexMacros } }]`.
 * @type {Record<string, string>}
 */
export const katexMacros = {
  ...starred('abs', R`\left\lvert #1 \right\rvert`, R`\lvert #1 \rvert`),
  ...starred('norm', R`\left\lVert #1 \right\rVert`, R`\lVert #1 \rVert`),
  ...starred('expval', R`\left\langle #1 \right\rangle`, R`\langle #1 \rangle`),
  ...starred('ev', R`\left\langle #1 \right\rangle`, R`\langle #1 \rangle`),
  ...starred('mel', R`\left\langle #1 \middle\vert #2 \middle\vert #3 \right\rangle`, R`\langle #1 \vert #2 \vert #3 \rangle`),
  ...starred('ip', R`\left\langle #1 \middle\vert #2 \right\rangle`, R`\langle #1 \vert #2 \rangle`),
  ...starred('comm', R`\left[ #1, #2 \right]`, R`[ #1, #2 ]`),
  ...starred('acomm', R`\left\{ #1, #2 \right\}`, R`\{ #1, #2 \}`),
  ...starred('pqty', R`\left( #1 \right)`, R`( #1 )`),
  ...starred('bqty', R`\left[ #1 \right]`, R`[ #1 ]`),
  ...starred('Bqty', R`\left\{ #1 \right\}`, R`\{ #1 \}`),
  ...starred('vqty', R`\left\vert #1 \right\vert`, R`\vert #1 \vert`),
  ...starred('order', R`\mathcal{O}\left( #1 \right)`, R`\mathcal{O}( #1 )`),
  ...starred('vu', R`\hat{\mathbf{#1}}`, R`\hat{\boldsymbol{#1}}`),
  [R`\absolutevalue`]: R`\abs`,
  [R`\expectationvalue`]: R`\expval`,
  [R`\matrixelement`]: R`\mel`,
  [R`\innerproduct`]: R`\ip`,
  [R`\commutator`]: R`\comm`,
  [R`\anticommutator`]: R`\acomm`,
  [R`\ketbra`]: R`\ket{#1}\!\bra{#2}`,
  [R`\op`]: R`\ket{#1}\!\bra{#2}`,
  [R`\dyad`]: R`\ket{#1}\!\bra{#2}`,
  [R`\outerproduct`]: R`\op`,
  [R`\vb`]: R`\@ifstar{\boldsymbol}{\mathbf}`,
  [R`\va`]: R`\@ifstar{\vec}{\vec}`,
  [R`\vectorbold`]: R`\vb`,
  [R`\vectorarrow`]: R`\va`,
  [R`\vectorunit`]: R`\vu`,
  [R`\vdot`]: R`\cdot`,
  [R`\cross`]: R`\times`,
  [R`\grad`]: R`\nabla`,
  [R`\gradient`]: R`\nabla`,
  [R`\curl`]: R`\nabla\times`,
  [R`\divergence`]: R`\nabla\cdot`,
  [R`\laplacian`]: R`\nabla^2`,
  [R`\dd`]: R`\mathop{}\!\mathrm{d}`,
  [R`\differential`]: R`\dd`,
  [R`\dv`]: R`\frac{\mathrm{d} #1}{\mathrm{d} #2}`,
  [R`\derivative`]: R`\dv`,
  [R`\pdv`]: R`\frac{\partial #1}{\partial #2}`,
  [R`\partialderivative`]: R`\pdv`,
  [R`\Tr`]: R`\operatorname{Tr}`,
  [R`\tr`]: R`\operatorname{tr}`,
  [R`\trace`]: R`\operatorname{Tr}`,
  [R`\rank`]: R`\operatorname{rank}`,
  [R`\erf`]: R`\operatorname{erf}`,
  [R`\erfc`]: R`\operatorname{erfc}`,
  [R`\sgn`]: R`\operatorname{sgn}`,
  [R`\diag`]: R`\operatorname{diag}`,
  [R`\vv`]: R`\overrightarrow{#1}`,
  [R`\mathbbm`]: R`\mathbb{#1}`,
  [R`\mathds`]: R`\mathbb{#1}`,
  [R`\eps`]: R`\epsilon`,
  [R`\C`]: R`\mathbb{C}`,
  [R`\Q`]: R`\mathbb{Q}`,
  [R`\ud`]: R`\mathrm{d}`,
};
