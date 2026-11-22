// LaTeX maths in doc comments: every delimiter, spans across comment lines, and the dollars that are not maths.
import { renderDoc } from '../src/docs/index.js';
import { extractMath, restoreMath } from '../src/docs/math-spans.js';
import { normaliseTex, katexMacros } from '../src/docs/math.js';

const ford = (text) => renderDoc([{ dir: 'after', line: 1, lines: text.split('\n').map((l) => ` ${l}`) }]).body;
const doxy = (text, opts) => renderDoc([{ dir: 'before', line: 1, lines: text.split('\n').map((l) => ` ${l}`) }], opts);
const round = (text, mode) => {
  const { text: t, spans } = extractMath(text);
  return restoreMath(t, spans, mode);
};

export default function ({ ok, eq }) {
  // ---- delimiters
  eq(ford('The energy $E = mc^2$ is conserved.'), 'The energy $E = mc^2$ is conserved.', '$…$ inline');
  eq(ford('With \\( a_{ij} = \\frac{1}{2} \\) inline.'), 'With $a_{ij} = \\frac{1}{2}$ inline.', '\\( \\) inline, braces kept');
  eq(ford('The norm is\n\n$$ \\|x\\|_2 = \\sqrt{\\sum_i x_i^2} $$\n\nAfter.'), 'The norm is\n\n$$\n\\|x\\|_2 = \\sqrt{\\sum_i x_i^2}\n$$\n\nAfter.', 'one-line $$ … $$ becomes a display block');
  eq(ford('$$ E = \\sum_k\n   \\epsilon_k f_k $$'), '$$\nE = \\sum_k\n   \\epsilon_k f_k\n$$', '$$ with content on its delimiter lines, across lines');
  eq(ford('$$\nx^2\n$$'), '$$\nx^2\n$$', '$$ on lines of their own');
  eq(ford('\\[ \\int_0^1 f(x)\\,dx \\]'), '$$\n\\int_0^1 f(x)\\,dx\n$$', '\\[ \\] display');
  eq(ford('\\begin{equation}\n  H \\psi = E \\psi\n\\end{equation}'), '$$\n\\begin{equation}\n  H \\psi = E \\psi\n\\end{equation}\n$$', 'equation environment');
  eq(ford('\\begin{eqnarray}\n a &=& b \\\\\n c &\\le& d\n\\end{eqnarray}'), '$$\n\\begin{aligned}\n a &= b \\\\\n c &\\le d\n\\end{aligned}\n$$', 'eqnarray, which KaTeX lacks, becomes aligned');
  eq(ford('Mid-sentence $$x^2$$ display.'), 'Mid-sentence\n$$\nx^2\n$$\ndisplay.', 'display maths in a sentence breaks the line, as in LaTeX');
  eq(ford('The sum $\\sum_i\n x_i$ spans lines.'), 'The sum $\\sum_i x_i$ spans lines.', 'inline maths across comment lines');
  eq(ford('Label \\begin{equation}\\label{eq:a} x \\end{equation}'), 'Label\n$$\n\\begin{equation} x \\end{equation}\n$$', '\\label is dropped');

  // ---- not maths
  eq(ford('It costs $5 and $10.'), 'It costs \\$5 and \\$10.', 'money');
  eq(ford('Between $20,000 and $30,000.'), 'Between \\$20,000 and \\$30,000.', 'money with commas');
  eq(ford('Set $OMP_NUM_THREADS and $MKL_NUM_THREADS first.'), 'Set \\$OMP\\_NUM\\_THREADS and \\$MKL\\_NUM\\_THREADS first.'.replace(/\\_/g, '_'), 'shell variables');
  eq(ford('Use !$omp parallel and !$omp end parallel.'), 'Use !\\$omp parallel and !\\$omp end parallel.', 'OpenMP sentinels');
  eq(ford('A literal \\$ sign.'), 'A literal \\$ sign.', 'an escaped dollar stays a dollar');
  eq(ford('Code `$x$` and\n\n```f90\nx = \'$y$\'\n```'), 'Code `$x$` and\n\n```f90\nx = \'$y$\'\n```', 'code is never maths');
  eq(ford('Unclosed $x and no end.'), 'Unclosed \\$x and no end.', 'an unclosed dollar');
  eq(ford('Paragraph $a\n\nbreak$ here.'), 'Paragraph \\$a\n\nbreak\\$ here.', 'maths never crosses a blank line');
  eq(ford('Version $Id$, $Revision: 1.4 $ and $COPYRIGHT$.'), 'Version \\$Id\\$, \\$Revision: 1.4 \\$ and \\$COPYRIGHT\\$.', 'version-control keywords and placeholders');
  eq(ford('Tokens: $B -> block ID, if blockID == -1, $N.'), 'Tokens: \\$B -> block ID, if blockID == -1, \\$N.', 'text between dollars with comparisons is not maths');
  eq(ford('Spaced $ x = 1 $ is maths.'), 'Spaced $x = 1$ is maths.', 'spaces inside the dollars, with an equation');

  // ---- reStructuredText (stdlib)
  eq(ford('The matrix :math:`A` is'), 'The matrix $A$ is', ':math:`…` role');
  eq(ford('Defined as\n\n.. math::\n\n   A = \\begin{bmatrix} a & b \\\\\n   c & d \\end{bmatrix}\n\nwhere'), 'Defined as\n\n$$\nA = \\begin{bmatrix} a & b \\\\\nc & d \\end{bmatrix}\n$$\n\nwhere', '.. math:: block');

  // ---- what generators and authors leave behind
  eq(ford('$$y = \x07lpha * x + \x08eta * y$$'), '$$\ny = \\alpha * x + \\beta * y\n$$', 'BEL and BS where \\alpha and \\beta were read as string escapes');
  eq(ford('a\x01b\x0C'), 'ab', 'other control characters are dropped');

  // ---- structure
  eq(ford('| x | $a_{i}$ |\n|---|---|\n| y | $$b$$ |'), '| x | $a_{i}$ |\n|---|---|\n| y | $b$ |', 'display maths in a table row stays inline');
  eq(ford('- item $$y^2$$ here'), '- item $y^2$ here', 'and in a list item');
  eq(ford('* order 2:\n    \\[ \\rho(t+dt) =\n       2\\rho(t) \\]\n* order 3'), '* order 2:\n    $$\n    \\rho(t+dt) =\n       2\\rho(t)\n    $$\n* order 3', 'display maths below a list item keeps its indentation, so it stays in the item');
  eq(ford('Text\n\n    \\[ x^2 \\]\n\nMore'), 'Text\n\n    $$\n    x^2\n    $$\n\nMore', 'indented display maths is maths, not indented code');
  eq(ford('Text \\[ x \\] more'), 'Text\n$$\nx\n$$\nmore', 'the text after a display block goes on');
  eq(ford('Example:\n\n    y = \\(a_1\\) + $b$\n\nAfter'), 'Example:\n\n```text\ny = \\(a_1\\) + $b$\n```\n\nAfter', 'maths in indented code stays as written');

  // ---- Doxygen and LAPACK
  {
    const d = doxy('\\brief Eigenvalues: \\f$ A v = \\lambda v \\f$.\n\\f[ A = V \\Lambda V^H \\f]\n\\f{align}{ a &= b \\f}\n\\param[out] w eigenvalues $w_1 \\le w_2$\n\\return $0$ on success');
    eq(d.summary, 'Eigenvalues: $A v = \\lambda v$.', '\\f$ … \\f$ in a brief');
    ok(d.body.includes('$$\nA = V \\Lambda V^H\n$$') && d.body.includes('$$\n\\begin{align} a &= b \\end{align}\n$$'), '\\f[ \\f] and \\f{env}{ \\f}');
    eq(d.params.w, 'eigenvalues $w_1 \\le w_2$', 'plain $…$ in a \\param');
    eq(d.returns, '$0$ on success', 'and in \\return');
    const v = doxy('\\param[in] N\n\\verbatim\n   N is INTEGER\n   N >= 0, costs $5$.\n\\endverbatim');
    ok(v.params.n.includes('\\$5\\$'), 'LAPACK \\verbatim text is never maths');
  }

  // ---- TeX that KaTeX renders
  eq(normaliseTex('\\mbox{ecut_rho} = 4\\,\\textsl{a} \\textsc{b}'), '\\text{ecut\\_rho} = 4\\,\\textit{a} \\text{b}', '\\mbox, \\textsl and \\textsc, which KaTeX lacks');
  eq(normaliseTex('E_{\\textrm{a{b{c_d}}}} \\text{x^2 & 50%} \\text{if $x_1$}'), 'E_{\\textrm{a{b{c\\_d}}}} \\text{x\\textasciicircum{}2 \\& 50\\%} \\text{if $x_1$}', 'text-mode characters escaped at any depth, but not in $…$ inside the text');
  eq(normaliseTex('\\begin{multline} a \\\\ b \\end{multline} \\begin{flalign*} c \\end{flalign*} \\begin{displaymath} d \\end{displaymath}'), '\\begin{gathered} a \\\\ b \\end{gathered} \\begin{align*} c \\end{align*}  d ', 'environments KaTeX lacks');
  eq(normaliseTex('\\begin{align} a &= b \\tag{1} \\end{align} \\begin{equation} c \\end{equation}', { inline: true }), '\\begin{aligned} a &= b  \\end{aligned}  c ', 'display-only environments and \\tag inline');
  eq(normaliseTex('A = \\( Q_1 Q_2'), 'A = ( Q_1 Q_2', '\\( inside maths is a parenthesis');
  eq(ford('- term \\begin{align} a &= b \\end{align}'), '- term $\\begin{aligned} a &= b \\end{aligned}$', 'an environment kept inline in a list item takes its inline form');
  ok(Object.values(katexMacros).every((v) => typeof v === 'string') && katexMacros['\\abs'] && katexMacros['\\mathbbm'], 'KaTeX macros');

  // ---- without remark-math
  eq(round('a $x^2$ b', 'code'), 'a `x^2` b', 'math: code, inline');
  eq(round('$$ \\frac{1}{2} $$', 'code'), '```latex\n\\frac{1}{2}\n```', 'math: code, display');
  eq(round('a\n$$x$$\nb'), 'a\n$$\nx\n$$\nb', 'a display block between lines keeps them');
  ok(!doxy('\\brief With $x_{i}$.', { math: 'code' }).body.includes('$'), 'math: code reaches the doc engine');
}
