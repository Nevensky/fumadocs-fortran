# Changelog

All notable changes to fumadocs-fortran are listed here. The project follows [semantic versioning](https://semver.org).

## Unreleased

Milestone M0, the parser and its gate, and the first parts of v0.1.

- **Doc comments.** The engine reads each entity's comments in the style they were written in: FORD (Markdown,
  metadata lines, `@note`…`@endnote`, `[[links]]`, `\( \)` maths), Doxygen (`\brief`, `\param[in]`, `\return`,
  `\note`, `\see`, `\verbatim`, `\f$` maths) or LAPACK (argument docs in `\verbatim` blocks, intents from
  `\param[in]` for F77 code that declares none). Doxygen and LAPACK text is escaped as plain text, so `B(LDB,*)`
  never turns into emphasis.
- **Pages.** `fumadocs-fortran generate` writes one MDX page per module, submodule and program, groups external
  procedures by `\ingroup`, and writes `meta.json` for the sidebar. Every entity gets a `###` heading with a stable
  ID, its signature, badges (OpenMP regions, OpenACC, offload, MPI, coarrays, cpp conditions), its documentation, its
  arguments and a link to its lines. A manifest makes regeneration delete only stale generated files. All 2,105 pages
  generated from LAPACK, ScaLAPACK, json-fortran, stdlib, Quantum ESPRESSO, Wannier90 and miniWeather compile as MDX.
- **Maths.** LaTeX in doc comments renders with KaTeX, in every notation Fortran codes use: `$…$`, `$$…$$`, `\( \)`,
  `\[ \]`, `\begin{equation}` and the other environments, bare `\begin{array}`-style environments, Doxygen's
  `\f$ \f[ \f{env}{`, and reStructuredText's `:math:` and `.. math::`. Dollars that are not maths (money, shell
  variables, `!$omp`, `$Id$`) stay text. TeX that MathJax accepts and KaTeX does not is rewritten (`eqnarray`,
  `multline`, `_` in `\text{…}`), and `katexMacros` (from `fumadocs-fortran/math`) defines the physics-package and
  other commands KaTeX lacks. `generate --math code` shows maths as code, for a site without remark-math.
- **MDX safety.** Doc comments written for FORD or Doxygen cannot break a fumadocs build or its hydration: HTML tags
  pair or become text, block elements stand as blocks, unknown code-block languages become `text`, `import`/`export`
  at a line start, braces in links, quotes in attributes and Object.prototype names (`constructor`) are handled,
  footnotes stay with their doc, headings have unique anchors, and images a site cannot import show their alt text.
  Doxygen's character references, HTML tags, Markdown, `\pre`, `\post`, `\li`, `\section` and `\cite` render, and
  commands that only steer Doxygen's output are dropped.

- **Parser.** A statement-level Fortran parser in plain JavaScript, with no dependencies:
  - free and fixed form, decided from the extension or, for `.F` and `.fpp`, from the text; continuation lines,
    `;`, DEC tab format, Hollerith constants, keywords run together in fixed form (`implicitnone`, `endsubroutine`);
  - a C preprocessor for Fortran: conditionals evaluated with the configured macros, every entity keeping its
    condition stack, object-like and function-like macros (with `#`, `##` and the traditional `/**/` paste),
    `#include`, line markers, and an option to keep every branch;
  - Fortran `include` lines, resolved from the including file's folder and then the include directories;
  - OpenMP, OpenACC, CUDA Fortran and vendor directives, with continuation lines; `!$` lines count as code only when
    `_OPENMP` is defined;
  - modules, submodules, programs, block data, external, module, internal and separate module procedures, interface
    blocks of every kind, derived types with components, type parameters, bindings, generics and finalisers, enums,
    module variables and parameters, `use` with `only` and renames, access, common blocks and namelists;
  - for every dummy argument: type, kind, length, intent, `optional`, `value`, dimensions, codimensions and the cpp
    condition it sits under; implicit typing where nothing is declared;
  - calls, references to other procedures, and coarray use in executable code;
  - doc comments attached in FORD and Doxygen style (`!!`, `!>`, `!<`, `!*`, `!|`, and `*>` in fixed form), kept raw
    for the doc engine that comes next.
- **Intermediate model.** Entities under stable IDs such as `module:solver_kernels/type:dense_matrix`, files, and
  coded diagnostics with file and line.
- **`fumadocs-fortran dump`** prints the model as JSON, or counts per file with `--summary`.
- **The parser gate** (`scripts/gate.mjs`) checks the parser against oracles that share no code with it: a golden file
  of 41 argument attributes, the signatures documented in Reference-LAPACK (2,300 of 2,300 routines), and a census of
  program units in gcc's preprocessor output for LAPACK, ScaLAPACK, json-fortran, Quantum ESPRESSO, stdlib, Wannier90
  and miniWeather (none lost). It parses about 1.4 million lines per second.
- **FORD as an oracle**, on demand: across all of LAPACK, json-fortran and Wannier90, FORD 7.0.13 agrees with the
  parser on the type, kind, length, intent, `optional`, `value` and dimensions of all 32,728 dummy arguments. The
  24 differences it shows are FORD's errors; they are listed with their reasons.
