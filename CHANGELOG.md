# Changelog

All notable changes to fumadocs-fortran are listed here. The project follows [semantic versioning](https://semver.org).

## Unreleased

Milestone M0, the parser and its gate; the first parts of v0.1; the Shiki grammars of v0.2; and the HPC registry, the
first part of v0.3.

- **Shiki grammars (v0.2).** `fumadocs-fortran/shiki` highlights Fortran code blocks in free and fixed form. Where
  Shiki's own grammars read directives as comments, these highlight OpenMP 6.1 (and the spellings of 5.2 and
  earlier), OpenACC 3.4, CUDA Fortran and compiler directives, and `!$` lines, with their names, clauses and
  modifiers. They also cover fypp, Fortran 2018 and 2023 constructs, doc comments and the column limit of fixed form
  (72, 132 or none), and give nothing an error colour. They carry the ids of Shiki's Fortran grammars (`f90`,
  `f77`, `fortran-free-form` and the rest) as aliases, so every Fortran fence uses them in whichever order the
  grammars load. `fortranRehypeCode()` adds them to fumadocs' `rehypeCode` with two transformers: one marks directive
  lines, which `style.css` tints in the colours of the badges, and one makes fumadocs' `[!code …]` notations work in
  `!` comments. `scripts/build-grammars.mjs` builds them from tm-grammars 1.32.22 (MIT), checking every upstream rule
  it patches. `npm run test:shiki` checks scope snapshots on both of Shiki's regex engines, load orders in Shiki and
  through fumadocs-core 16.19, the transformers, and the cost of the directives and fypp: under 10% more tokenising
  time on Shiki's JavaScript engine and 15–20% on Oniguruma, within a budget of 25%. The documentation site uses them,
  and its Highlighting page describes them.
- **HPC registry (v0.3, first part).** `registry/` holds the build-time data of the HPC layer: 4,568 entries, and 533
  more of vendor data, in 1.12 MB (0.22 MB gzipped). It covers BLAS and LAPACK 3.12.1 (2,265 routines in 584
  precision families, taken from `\ingroup`), ScaLAPACK 2.2.2 with its tools, PBLAS, REDIST and BLACS (1,009), the
  MPI 5.0 procedures callable from Fortran with their callbacks (463, with MPI 4.1 as an alias), OpenMP 6.1, 6.0 and
  5.2 (466 directives, clauses, routines, environment variables, kinds and constants), OpenACC 3.4 (147), the Fortran
  intrinsics (218), and oneMKL's lapack95 and blas95 names, OpenBLAS and cuBLAS. Entries carry their arguments
  (name, intent and type), summaries, hint tags (LWORK = -1 workspace queries, leading dimensions, INFO, array
  descriptors, MPI collectives and nonblocking calls) and what the link providers need: Netlib, oneMKL, Open MPI,
  MPICH, the MPI standard, the OpenMP and OpenACC specifications, fortran-lang.org and gfortran.
  `scripts/registry/*.mjs` build it in Docker from pinned upstream sources (`npm run registry`): every download is
  checked against its SHA-256, and a `--frozen` build from an empty cache reproduces the files byte for byte.
  `registry/SOURCES.md` lists the sources with their versions, licences and URLs, and `registry/NOTICE` their licence
  texts. Only names, page numbers and fragment IDs come from the specifications and the GCC manuals; the OpenMP,
  OpenACC, BLACS and vendor one-liners are our own. `npm run test:registry` checks the counts, the size, known
  entries, links, sources and notices on every Node version CI runs. The package ships it; resolution, links, hints
  and hover cards, which will use it, come next.

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
- **Tables, cards and source.** Arguments, results, components, type parameters, type-bound procedures and
  enumerators are tables in the manner of fumadocs' `TypeTable`, with only the columns some row fills (name, type,
  shape, intent, attributes); a row opens to its documentation, its declaration as Fortran, its shape in words and
  the cpp condition it exists under, and prints open. Kind names and derived types link to their definitions with a
  hover card (`FortranRef`): a project's own from its pages, and those of `iso_fortran_env` and `iso_c_binding` with
  their meaning and the `use` statement that renames them (`dp ⇒ real64`). A card sits inside its name, a link or,
  with nowhere to link, a button; it shows on hover and keyboard focus, describes the name to screen readers, and is
  placed against the screen where the browser has CSS anchor positioning. Each procedure's, type's, interface's,
  variable's and enum's source is a block that opens, numbered from its first line and read from the files parsed
  wherever they lie (`--source link` only links). The Fortran in tables and cards reads left to right on
  right-to-left pages. Each page's front matter lists its headings' kinds, for the letters `fortranToc()` puts in
  fumadocs' table of contents.
- **Graphs.** Units, types and procedures get dependency, inheritance and call graphs as Mermaid blocks
  (`--graphs none` leaves them out; `buildGraphs` exports them), with calls and function references resolved through
  `use`, renames, host association, generics, type-bound procedures and submodules. Routines of MPI, OpenMP,
  OpenACC, CUDA, the coarray collectives and BLAS are coloured by library, and those of LAPACK and ScaLAPACK through
  the `graphs.classify` option until the registry of library symbols arrives. `style.css` gives graphs drawn by Pele
  the theme's colours, their lines and labels included.
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
