# Changelog

All notable changes to fumadocs-fortran are listed here. The project follows [semantic versioning](https://semver.org).

## Unreleased

Milestone M0, the parser and its gate; the first parts of v0.1; the Shiki grammars of v0.2; and the first parts of
v0.3: the HPC registry, and the cards and graph colours the pages take from it.

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
- **HPC registry (v0.3, first part).** `registry/` holds the build-time data of the HPC layer: 4,602 entries, and 533
  more of vendor data, in 1.21 MB (0.23 MB gzipped). It covers BLAS and LAPACK 3.12.1 (2,265 routines in 584
  precision families, taken from `\ingroup`, the 155 of BLAS marked as BLAS), ScaLAPACK 2.2.2 with its tools, PBLAS,
  REDIST and BLACS (1,028, with the 18 routines it writes in C for Fortran to call, such as `?lamov`, `pcrot`,
  `reshape` and `PB_topget`), the MPI 5.0 procedures callable from Fortran with their callbacks (463, with MPI 4.1
  as an alias) and the 12 derived types of `mpi_f08` (`MPI_Comm`, `MPI_Status`, …), OpenMP 6.1, 6.0 and 5.2 (469
  directives, clauses, routines, environment variables, kinds and constants), OpenACC 3.4 (147), the Fortran
  intrinsics (218), and oneMKL's lapack95 and blas95 names, OpenBLAS and cuBLAS. Entries carry their arguments
  (name, intent and type; an argument that ScaLAPACK's prose heads as input but says is overwritten on exit, such as
  X and Y of `pcrot`, is input and output), summaries (of OpenMP's and OpenACC's items, the most used only), hint tags
  (LWORK = -1 workspace queries, leading dimensions, INFO, array descriptors, MPI collectives and nonblocking calls)
  and what the link providers need: Netlib (on `netlib.org`, which answers without a redirect), oneMKL, Open MPI,
  MPICH, the MPI standard, the OpenMP and OpenACC specifications, fortran-lang.org and gfortran. A summary keeps its
  source's whole first sentence up to the 200 characters a card shows, cut at a word beyond that, with Open MPI's
  reStructuredText markup taken off and the slips of the sources corrected, as `registry/SOURCES.md` lists them.
  `libraryOf(name)` (in `registry/read.mjs`, which the pages use) finds, whatever its case, a procedure of BLAS,
  LAPACK, ScaLAPACK, MPI, OpenMP or OpenACC, an intrinsic procedure, a derived type of `mpi_f08`, or a kind or named
  constant of `omp_lib`; the vendors' own names, directives, clauses and environment variables are not among them.
  `libraryOf(name, { subroutine: true })` gives the subroutine a `CALL` names where a name has two meanings:
  ScaLAPACK's `reshape`, not the intrinsic function `RESHAPE`.
  `scripts/registry/*.mjs` build it in Docker from pinned upstream sources (`npm run registry`): every download is
  checked against its SHA-256, and a `--frozen` build from an empty cache reproduces the files byte for byte.
  `registry/SOURCES.md` lists the sources with their versions, licences and URLs, and `registry/NOTICE` their licence
  texts. Only names, page numbers and fragment IDs come from the specifications and the GCC manuals, and from the
  OpenACC specification whether each routine is a subroutine or a function, which its Fortran form says; the OpenMP
  (kinds included), OpenACC, BLACS, MPI-callback, MPI-type and vendor one-liners are our own, as are those of the
  ScaLAPACK C routines whose comments have none (`?lamov`, `reshape`, `sl_gridreshape`). `npm run test:registry`
  checks the counts, the size, known entries, links, sources and notices on every Node version CI runs.
- **The registry in the pages (v0.3).** The generated pages take hover cards and graph colours from the registry, and
  a project's own names always win over a library's (a procedure, generic interface or variable of the name, shown
  or not, a dummy argument in scope, or a procedure pointer the caller declares):
  - in "Calls:" lines, a library subroutine is a `FortranRef` with its kind (where the registry has one), name and
    library
    (`subroutine dgesv (LAPACK)`, `subroutine acc_init (OpenACC)`), a summary where the registry has one (for every
    subroutine of BLAS, LAPACK, MPI and the intrinsics, all of ScaLAPACK's but two, and the most used of OpenMP and
    OpenACC) and a link: Netlib for BLAS, LAPACK and ScaLAPACK (Intel oneMKL's pages when the code uses MKL's
    modules), Open MPI 5.0's manual (its development manual for the newer procedures 5.0 lacks), the OpenMP 5.2
    specification (a later one for the routines 5.2 lacks), the OpenACC 3.4 specification, and fortran-lang.org for
    intrinsic subroutines (gfortran's manual for `random_init` and `split`); a routine with no page, such as
    `tokenize`, has a card without a link. A routine renamed by a use statement is looked up by its own name, and a
    `CALL` of a name the registry has as a function, an OpenACC one included, names some other subroutine, with no
    card, unless the registry also has a subroutine of the name: `call reshape` is ScaLAPACK's, with its card and
    ScaLAPACK's colour in the graphs, while a function reference of `reshape` is still the intrinsic;
  - a site chooses other pages with `hpc.links` (`--links lapack=mkl,mpi=mpich`), by library: `lapack` and
    `scalapack` take `netlib` or `mkl`, `mpi` `openmpi`, `mpich` or `standard`, `openmp` `5.2`, `6.0`, `6.1` or
    `libgomp`, `openacc` `spec` or `libgomp`, and `intrinsics` `fortran-lang` or `gfortran`. A name the provider has
    no page for links as by default, and an unknown library or provider is an error. `hpc.cards: false`
    (`--library-cards none`) leaves library names as code, with no card, and the graphs keep their colours;
  - in the tables, the derived types of `mpi_f08` (`type(MPI_Comm)`) and the kinds of `omp_lib`
    (`integer(omp_lock_kind)`) have cards when the declaration's scope uses the module (`use, intrinsic :: omp_lib`
    too), with a link to the MPI standard or the OpenMP specification and the use statement they come from;
    `use mpi` gives none;
  - the call graphs colour LAPACK and ScaLAPACK routines by default (PBLAS, BLACS, the tools and REDIST with
    ScaLAPACK), BLAS first, and draw the function references the registry knows, such as `dlamch`, spelt as the
    source first writes them, as calls are (`DLAMCH` beside `DGEMM` in fixed-form code); a site's `graphs.classify`
    takes the registry's place, and its second argument, `{ subroutine }`, says whether a `CALL` or an interface body
    names the routine as a subroutine. A `CALL` of a name that only an intrinsic function has is drawn as a routine
    from outside the project, and a call through a procedure pointer the caller declares is not drawn. Over a graph's
    40-node cap, the routines from outside the project go first, however many callers they have, the farthest first,
    and then the farthest of the rest.

  The registry is read the first time a page needs it; without it, the names are code with no card, and LAPACK and
  ScaLAPACK grey. CI's package check installs the packed package, looks up a name in each of the six registry files
  the pages read and generates pages, which must have a library card and a ScaLAPACK node, so that a pack without
  one of those files fails. Resolution through lapack95's generic names, hints and links in code blocks come next.

- **Doc comments.** The engine reads each entity's comments in the style they were written in: FORD (Markdown,
  metadata lines, `@note`…`@endnote`, `[[links]]`, `\( \)` maths), Doxygen (`\brief`, `\param[in]`, `\return`,
  `\note`, `\see`, `\verbatim`, `\f$` maths) or LAPACK (argument docs in `\verbatim` blocks, intents from
  `\param[in]` for F77 code that declares none). Doxygen and LAPACK text is escaped as plain text, so `B(LDB,*)`
  never turns into emphasis, while an underscore inside a name stays as written: Markdown never takes one for
  emphasis, and search then finds `norm2_parallel` as one word, in a heading as in the text.
- **Pages.** `fumadocs-fortran generate` writes one MDX page per module, submodule and program, groups external
  procedures by `\ingroup`, and writes `meta.json` for the sidebar. Every entity gets a `###` heading with a stable
  ID, its signature, badges (OpenMP regions, OpenACC, offload, MPI, coarrays, cpp conditions), its documentation, its
  arguments and a link to its lines. A manifest makes regeneration delete only stale generated files. All 2,105 pages
  generated from LAPACK, ScaLAPACK, json-fortran, stdlib, Quantum ESPRESSO, Wannier90 and miniWeather compile as MDX.
  Units that share a name get the name, then the name and kind, then a number after an underscore
  (`miniweather`, `miniweather-program`, `miniweather-program_2`, …), and a slug that has its kind already takes the
  number alone (`module-index_2`, `blockdata_2`). No page's URL ends in `-` and a number, the form fumadocs' search
  gives the ids of a page's records, so that no page shares its id with another's record: miniWeather's pages were
  `miniweather-program-2-3-4-5-6-7`, and a site could not build their search index. A group of external procedures
  named so, as a file `fft-2.f90` makes one, takes its kind (`fft-2-procedures`). The README shows a site how to keep
  the components' tags out of its search index, as the documentation site does, which makes the site's index 24%
  smaller (18% gzipped) and that of stdlib's pages 73% (64%), and when to turn off the sidebar's prefetch for large
  references.
- **Maths.** LaTeX in doc comments renders with KaTeX, in every notation Fortran codes use: `$…$`, `$$…$$`, `\( \)`,
  `\[ \]`, `\begin{equation}` and the other environments, bare `\begin{array}`-style environments, Doxygen's
  `\f$ \f[ \f{env}{`, and reStructuredText's `:math:` and `.. math::`. Dollars that are not maths (money, shell
  variables, `!$omp`, `$Id$`) stay text. TeX that MathJax accepts and KaTeX does not is rewritten (`eqnarray`,
  `multline`, `_` in `\text{…}`), and `katexMacros` (from `fumadocs-fortran/math`) defines the physics-package and
  other commands KaTeX lacks. `generate --math code` shows maths as code, for a site without remark-math.
- **Tables, cards and source.** Arguments, results, components, type parameters, type-bound procedures and
  enumerators are tables in the manner of fumadocs' `TypeTable`, with only the columns some row fills (name, type,
  shape, intent, attributes); a row opens to its documentation, its declaration as Fortran, its intent and each
  attribute beside its meaning, its shape in words, a character type's length (assumed, deferred, or as written) and
  the cpp condition it exists under, and prints open. Shapes keep their brackets (`(:,:)`), and a type parameter's
  row reads as its declaration: the type `integer, kind` and one attribute, `default dp`, for
  `integer, kind :: k = dp`. An initial value in the old style of F77 and GNU Fortran is written as the source has
  it, without `::` (`character*8 plain /'hi'/`), or left out where an attribute needs `::`, so that every
  declaration is Fortran. Kind names and derived types link to their definitions with a hover card
  (`FortranRef`): a project's own from its pages, and those of `iso_fortran_env` and `iso_c_binding` with their
  meaning and the `use` statement that renames them (`dp ⇒ real64`). A card sits inside its name, a link or, with
  nowhere to link, a button; it shows on hover and keyboard focus, describes the name to screen readers, and is
  placed against the screen where the browser has CSS anchor positioning. Each procedure's, type's, interface's,
  variable's and enum's source is a block that opens, numbered from its first line and read from the files parsed
  wherever they lie (`--source link` only links). The Fortran in tables and cards reads left to right on
  right-to-left pages. Each page's front matter lists its headings' kinds, for the letters `fortranToc()` puts in
  fumadocs' table of contents.
- **Meanings.** Every badge, intent, attribute and condition pill, shape, `*` or `:` of a character length, and
  `kind` or `len` of a type parameter's type (`integer, kind`) says what it means in a card on hover, in the look of
  the hover cards: `allocatable`, `pass(self)`, `default dp`, `when USE_MPI`, `(:,:)` ("rank 2, assumed shape"),
  `character(*)` ("Assumed length (len=*): taken from the actual argument"), a badge's kind. The components name the
  term in a `data-term` attribute, and `style.css` holds one meaning per term, so a page of thousands of pills holds
  no meaning twice (a shape's words, the components' own English, aside), and a site adds or rewords one with a CSS
  rule outside any `@layer`. Pills take no keyboard stop and have no native tooltip: a row with an intent, an
  attribute or a type parameter's `kind` or `len` opens, and lists the meanings of its intent, type parameter,
  attributes, shape and length, for the keyboard and screen readers, and on a touch screen a pill in a row that
  opens shows none; a badge's meaning is for the pointer alone. A `FortranBadge`'s `title` is a note in its card,
  under the meaning, which screen readers read with the badge, rather than a native tooltip; the generator leaves
  out a title that would only repeat the label.
- **Graphs.** Units, types and procedures get dependency, inheritance and call graphs as Mermaid blocks
  (`--graphs none` leaves them out; `buildGraphs` exports them), with calls and function references resolved through
  `use`, renames, host association, generics, type-bound procedures and submodules. Routines from outside the project
  are coloured by library, from the registry (above) or a site's `graphs.classify`, and by name for MPI, OpenMP,
  OpenACC, CUDA, the coarray collectives and BLAS. `style.css` gives graphs drawn by Pele the theme's colours, their
  lines and labels included.
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
    module variables and parameters, `use` with `only` and renames, access, common blocks and namelists; a module
    whose name starts with `procedure` (`module procedures_m`) is a module, not a `module procedure` statement;
  - for every dummy argument: type, kind, length, intent, `optional`, `value`, dimensions, codimensions and the cpp
    condition it sits under; implicit typing where nothing is declared; a length written after the name, which is
    the entity's own, in its type as Fortran would write it (`character*(*)` for `character :: a*(*)`, and
    `character(len=20)` for `character(len=10) :: d*20`, a kind kept); the comma that may end a length after a star
    when no `::` follows (`CHARACTER*8, A`, `CHARACTER*(*), B`); and a `::` inside a string or brackets, as in
    `bind(c, name='a::b')`, which does not end the attributes;
  - calls, those through a procedure pointer the caller declares marked `local`, references to other procedures,
    each spelt as the source first writes it, and coarray use in executable code;
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
- **Tests.** `npm test` gives each run a scratch folder of its own under `test/out`, removed when every check passes
  and kept, with its path printed, when one fails or the run stops with an error, so that runs side by side no
  longer disturb each other.
