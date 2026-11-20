// fumadocs-fortran/math: the maths helpers a site needs, without the parser.

/**
 * Macros for the commands Fortran docs write that KaTeX lacks: the physics package (\abs, \norm, \expval, \mel,
 * \comm, \order, \vb, \va, \vu, \grad, \dd, \dv, \pdv, \Tr and their kin), \vv, \mathbbm, \mathds, \eps, \C, \Q and
 * \ud. For rehype-katex's `macros` option; pass a copy, as KaTeX adds a page's \gdef to the object it is given:
 * `[rehypeKatex, { macros: { ...katexMacros } }]`.
 */
export declare const katexMacros: Record<string, string>;

/**
 * TeX that KaTeX renders, written as LaTeX and MathJax take it: \label dropped, text-mode characters escaped in
 * \text{…}, eqnarray, multline, flalign and displaymath rewritten, and (inline) the display-only environments in
 * their inline forms.
 */
export declare function normaliseTex(tex: string, options?: { inline?: boolean }): string;
