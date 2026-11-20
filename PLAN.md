# fumadocs-fortran: the plan

Adopted on 19 November 2026, with every decision taken as recommended. Milestone M0 is done, v0.1 is under way, and
the Shiki grammars (v0.2) and the HPC registry (the first part of v0.3) are built; the [CHANGELOG](CHANGELOG.md) says
what exists. The plan rests on eight research reports, Docker experiments on public Fortran code, and three
independent design proposals compared on risk, maintainability and user value ([§17](#17-evidence)).

## In one paragraph

fumadocs-fortran reads Fortran sources with its own parser, written in plain JavaScript with no dependencies, and writes
the API reference as MDX pages that any fumadocs site builds like its hand-written pages. It reads the doc comments
projects already have, in FORD, Doxygen and LAPACK style, and takes its settings from an existing FORD project file or
`fpm.toml` when there is one. It understands HPC code:

- OpenMP and OpenACC directives, MPI and coarrays become badges;
- calls into BLAS, LAPACK and ScaLAPACK become links to their reference documentation, with hover cards and usage hints.

It also ships Shiki grammars, so ```` ```fortran ```` blocks work in fumadocs and directives stand out. It follows
fumadocs-feynman's conventions: MIT licence, plain ESM, hand-written types, installation from GitHub, and a
documentation site on GitHub Pages.

## Decisions

Each decision was taken as recommended, and the rest of the plan assumes it. The alternatives stay here for the record.

1. **Parser.** A hand-written, statement-level parser in plain JavaScript, or tree-sitter-fortran (web-tree-sitter plus
   a wasm grammar)? **Chosen: hand-written.** All three design reviews preferred it (see §3), and M0's gate confirmed
   it. Tree-sitter could still slot in behind the same reader and model.
2. **Output.** Generated MDX files only, or also a virtual fumadocs source like fumadocs-python's `createPython()`?
   **Chosen: MDX files only in v1.** They use fumadocs' most stable contract and work on every framework (§6).
3. **Which build the docs show.** Code under `#ifdef` exists only in some builds.
   - **Chosen:** evaluate cpp with the configured macros. `init` writes the HPC guards it finds (`_OPENMP`,
     `USE_MPI`, …) into the config. Code in branches that are switched off still produces "when `USE_MPI`" badges.
   - The alternative is FORD's behaviour without preprocessing: parse every branch. That inflates stdlib from 943 to
     2,491 procedures.
4. **Distribution.** Install from GitHub like fumadocs-feynman, or publish to npm so that `npx fumadocs-fortran init`
   just works for Fortran developers? **Chosen: GitHub during 0.x, npm once the project wants outside users.** The
   release workflow is prepared in advance; publishing needs the maintainer's npm account.
5. **Showcase.**
   - **Chosen:** the docs site shows only permissively licensed projects (§12).
   - Private code never appears there: it is used only in local acceptance tests, which report aggregate figures.
6. **Reference links.**
   - **Chosen for BLAS/LAPACK/ScaLAPACK:** Netlib by default, switching to Intel oneMKL when the code uses MKL
     modules (`lapack95`, `mkl_*`).
   - **Chosen for MPI:** Open MPI 5.0.x.
   - **Chosen for OpenMP:** version 5.2, since compilers trail 6.x.

   All three are configurable per site.
7. **Order of work.** **Chosen:** parser gate → API reference → highlighting and site scaffold → HPC layer → FORD
   drop-in → scale (§14). The alternative is to bring the HPC features forward.

### Defaults

- **The `!<` mark** means "documents the previous item", as in Doxygen. With a FORD project file, FORD's marks apply
  exactly, and `doctor` lists any `!<` comments they ignore.
- **Maths** renders with KaTeX. `init` wires remark-math and rehype-katex. Where they are missing, maths falls back to
  inline code (`math: 'code'`) instead of breaking the page.
- **Generated API pages** are committed and checked for drift in CI. Very large libraries generate them before the
  build instead (`output.mode: 'prebuild'`).
- **Graphs:** v1 has "Uses" / "Used by" lists and an HPC overview page. A ```` ```mermaid ```` graph is opt-in, and
  there is no Graphviz.
- **Dependencies:** none at runtime, and no fumadocs peer dependency. The package works with fumadocs-core 16.18.4 and
  later, the version fumadocs-feynman's site uses.
- **Hover cards** use the browser's own popovers, with no React UI library.
- **Source code** is not embedded in pages; each entity links to its lines on GitHub instead.

## 1. What v1 does

1. **API reference.** `fumadocs-fortran generate` writes one MDX page per module, submodule, program and derived type
   with bindings. It also writes pages for external procedures, grouped the way LAPACK groups them, and the `meta.json`
   files that order the sidebar. fumadocs then supplies the table of contents, search, llms.txt, OG images and Markdown
   copies, as for any page.
2. **Entities in hand-written pages.** `<auto-fortran entity="linalg::solve" />` embeds one entity's documentation in a
   guide. `[[solve]]` links work as in FORD.
3. **Code blocks.** ```` ```fortran ```` works in free and fixed form. Directives, cpp and fypp are highlighted, and
   fumadocs' `[!code …]` notations work with `!` comments. Names resolve to links: to the API pages, and to BLAS, LAPACK,
   ScaLAPACK, MPI and OpenMP reference pages.
4. **HPC awareness.** The parser records:
   - directives (OpenMP, OpenACC, `!$` conditional lines, vendor directives);
   - MPI and OpenMP module use;
   - library calls and coarrays;
   - the cpp guard each of these sits under.

   A build-time registry of about 5,000 external symbols turns these into links, badges, hints and hover cards.

**Not in v1:**
- FORD and LFortran backends (decided against; FORD is a test oracle only);
- a virtual source;
- running fypp ourselves (a command hook runs it);
- rendered call graphs;
- ProTeX, ROBODoc, NEMO and WRF comment styles (one project each);
- Sphinx `objects.inv` and Doxygen tag-file readers;
- bundled LAPACK prose (we link to it);
- i18n and versioned docs;
- analysis of executable code beyond calls, directives and coarrays.

## 2. How it works

```
fumadocs-fortran.config.mjs ─┐
fpm.toml [extra.*] ──────────┼─► loadConfig() ─► Config
FORD project file ───────────┘                     │
                                                   ▼
sources ─► discover ─► form ─► cpp (evaluate; condition stacks) ─► lines ─► statements ─► units
              includes ◄──┘         comments · doc marks · directives ─┘           │
                                                                                   ▼
                                          docs: attach blocks → FORD / Doxygen / LAPACK styles
                                                                                   ▼
                                          IR per file (cached by content hash)
                                                                                   ▼
          resolve: use/only/renames · host · generics · bindings · submodules · [[links]] · calls → registry
                                                                                   ▼
          buildPages() ─► content/docs/api/**.mdx + meta.json + fortran-inventory.json + modules.json
                                                                                   ▼
site build: fumadocs-mdx (GFM, remark-math, remarkFortran, rehypeCode + fortranRehypeCode())
            Callout/Cards from the site's own components · FortranBadges etc. (./react) · style.css
```

Everything before the site build runs in Node as pure functions, cached by content hash, so `--watch` reparses only the
files that changed. No module the site imports pulls in fumadocs or Shiki.

## 3. Parser

**Choice: a hand-written, statement-level parser** (`src/source/`, `src/parse/`). The tree-sitter-fortran prototype and
FORD remain development-time oracles, run in Docker.

**Why not tree-sitter:**
- **It would replace only the declaration layer.** The hard parts of HPC code are ours either way: tree-sitter has no
  fixed form (issue #61), only partial cpp, sees `!$` code and directives only as comments, drops kind suffixes
  (issue #203), and leaves attaching doc comments to us.
- **Its error recovery is not local.**
  - With unexpanded macros, json-fortran lost its module, its types and its type-bound procedures.
  - With every cpp branch kept, Quantum ESPRESSO kept 1 of 7 procedures.
- **Its supply chain is the weakest of the options.**
  - There is no npm package and no wasm release; the only prebuilt grammar is a third-party 6.7 MB binary.
  - A self-build reportedly needs about 13 GB of RAM.
  - Node names changed as recently as October 2026.

**Why the hand-written parser should work:** a 297-line statement-level probe, which three independent reviews re-ran
on 27 public files (70,711 lines):
- It reproduced the tree-sitter prototype's counts of units, procedures, arguments, types, bindings, generics,
  interfaces, calls and directives.
- It ran at about 1.5 million lines/s, roughly ten times faster than the prototype.
- It kept all 7 QE procedures and json-fortran's module even with every branch kept, because a statement-level scope
  stack ignores the ends of executable blocks.

The probe proves only structure. Field-level accuracy (kinds, dimensions, attributes) and docs must be earned: that is
M0's gate.

**Pipeline:**
1. **Form.**
   - `.f .for .f77 .ftn` are fixed form; `.f90` to `.f18` are free form.
   - `.F` and `.fpp` are decided from their content, since `.F` is free form in 5 of 7 sampled projects.
   - Config and FORD's `fixed_extensions` override all of this.
2. **Lines.** One pass that knows about strings, so a `'!!'` inside a string is not a comment.
   - Fixed form: column-1 comments, column-6 continuation, line length 72, 132 or off, DEC tabs, and keywords run
     together without blanks (`implicitnone`).
   - Free form: `&` continuation across comment and cpp lines, and `;`.
3. **cpp.** A Fortran-aware subset:
   - conditionals, evaluated by a small expression parser;
   - object-like and function-like macros, including `##`;
   - `#include` and line markers;
   - no expansion inside strings or comments.

   By default the macros you configure are evaluated, and every entity keeps its condition stack. Inactive branches are
   still scanned lexically for HPC use. `!$` lines count as code only when `_OPENMP` is defined.

   Keeping every branch is opt-in. `cpp.command` (for example `cpp -traditional-cpp -E` with line markers) is the
   escape hatch for macro-heavy code. The evaluation applies to every file that contains cpp, whatever its extension.
4. **fypp.** Never parsed. Files with `#:` or `${…}$` are skipped with a diagnostic unless `fypp.command` is set or an
   already-expanded tree is given; fypp's line markers map back to the source.
5. **Includes.** `include` and `#include` resolve from the including file's folder, then from the include directories.
   A missing include gives a diagnostic.
6. **Statements.** About 40 kinds of specification statement, on a stack of scopes. Executable code is scanned only for
   `call`, references to known procedures, coarray syntax and directives.
7. **Directives.**
   - Sentinels: `!$omp`, `!$ompx`, `!$acc`, `!$cuf`, `!$ `, `!dir$`/`!dec$`/`!gcc$` and fixed-form `c$omp`/`*$omp`,
     with continuation lines.
   - Constructs are matched longest first against the OpenMP 6.1 lists, accepting both `declare simd` and
     `declare_simd`.
   - Begin and end directives are paired into regions.
8. **Errors.** An error costs one statement, never the enclosing unit or the file. Diagnostics are coded and give file
   and line; `strict: true` fails the build. FORD, by contrast, skips a whole file on one bad doc line.

## 4. Doc-comment engine

**Marks:**
- before the item: `!>`, and `C>`/`c>`/`*>` in fixed form;
- after the item: `!!` and `!<`;
- FORD's alternates: `!*` and `!|`.

A FORD project file or `[extra.ford]` replaces this whole set. An empty mark value switches that mark off, which
json-fortran relies on to hide 494 banner lines.

**Attachment rules:**
1. The first line of a block sets its direction, and any mark continues the block, as in FORD and fortls. A block
   started with an alternate mark also absorbs plain `!` lines.
2. A before-block documents the next statement, across blank lines and banners such as LAPACK's `*  ====`.
3. An after-block, whether trailing or on the following lines, documents the previous statement:
   - on a procedure or module header, the unit itself (QE style);
   - on a declaration, every name it declares;
   - on one line of a continued statement, only the names on that line.
4. A block on a statement that declares nothing joins the enclosing entity.
5. Directives, `!!$` commented-out code, banners, fold marks and marks inside strings are never docs. Docs inside
   executable code are ignored.
6. `dump --explain file:line` names the rule that was applied.

**Styles** are detected per block and can be overridden per file pattern:
- **`ford`:** Markdown, metadata lines, `@note`…`@endnote` (and warning, todo, bug), `[[name(kind):child]]` links,
  `|alias|` and `{!file!}`.
- **`doxygen`** (`\` and `@` forms):
  - brief, details, `param[in|out|in,out]`;
  - return(s)/retval/result, par, note, warning, see, deprecated, author, version, ingroup;
  - verbatim, code and `\f` maths.
- **`lapack`:** Doxygen plus "X is DOUBLE PRECISION array, dimension (LDA,N)", checked against the declarations. BLAS's
  bare `\b DGEMM` brief is replaced by the first sentence of its Purpose section.
- **`legacy`** (opt-in): ScaLAPACK's Purpose/Arguments prose, where "(global input)" gives scope and intent.
- **`plain`** (opt-in): ordinary comments next to the code.

**Argument docs**, in order of precedence: the declaration's own doc, then a before-doc, then a header `\param`, then a
prose section. Conflicts give a warning.

**Intent** comes from the code. Fixed-form F77 code without `INTENT` takes it from `\param[in]`, and a mismatch between
code and docs gives a warning.

**Metadata:** only FORD's known keys are read, and leniently. FORD reads a line such as `!! DEPRECATED: …` as metadata
and throws the whole file away when the value does not parse; here, at worst, the line stays text.

**Conversion to MDX** goes through one emitter with no dependencies:
- FORD text stays Markdown. Doxygen, LAPACK and prose text is escaped as plain text, because `B(LDB,*)` would otherwise
  become emphasis; Doxygen's own Markdown is read where it cannot be LAPACK's (fences, list items, `**bold**` but not
  the exponents of `A**T`), and so are its HTML tags and character references.
- Maths, in every comment style (`src/docs/math.js`). Spans are lifted out before escaping and put back as remark-math
  syntax, so braces and `<` inside maths are never escaped:
  - inline: `$…$`, `\( \)`, Doxygen's `\f$ \f$` and `\f( \f)`, and reStructuredText's `:math:` role (stdlib);
  - display: `$$…$$` and `\[ \]` (on lines of their own, on one line, or with content on the delimiter lines),
    `\begin{equation|align|gather|multline|eqnarray|…}`, the environments that exist only in maths when written bare
    (`array`, `pmatrix`, `cases`, …, which MathJax renders too), Doxygen's `\f[ \f]` and `\f{env}{ \f}`, and
    reStructuredText's `.. math::` block. A display formula in mid-sentence breaks the line, as in LaTeX, except in a
    table row, a heading or a list item's own line, where it stays inline; below a list item it keeps its
    indentation, so it stays in the item (Quantum ESPRESSO indents its `\[` 30 columns under `*` items);
  - spans may cross comment lines, never a blank line. Code, `\verbatim` and LAPACK's argument prose are never maths;
    maths that ends up in a code block is shown as written;
  - not maths: money (`$5 and $10`, `$20,000`), shell variables (`$OMP_NUM_THREADS`), sentinels (`!$omp`), `\$`,
    version-control keywords (`$Id$`, `$Revision: 1.4 $`) and placeholders (`$COPYRIGHT$`), and text between
    dollars with blanks at its edges and nothing of TeX in it (MPAS's `$B -> block ID, if blockID == -1, $`);
  - for KaTeX: `eqnarray` becomes `aligned`, `multline` `gathered`, `flalign` `align`, `displaymath` goes, a
    multi-column `split` becomes `aligned`; inline, the display-only environments take their inline forms and `\tag`
    goes; `\label` is dropped; in `\text{…}` and its kin, `_ & % # $ ^` are escaped at any depth, except in `$…$`
    inside the text (MathJax, FORD's renderer, tolerates them; Quantum ESPRESSO relies on it); `\mbox`, `\textsl`
    and `\textsc` become what KaTeX has; `\(` inside maths is a parenthesis (stdlib); control characters left by a
    generator that read `\alpha` and `\beta` as string escapes become the backslash again (stdlib);
  - `katexMacros` (`fumadocs-fortran/math`) defines, for rehype-katex, the commands Fortran docs write that KaTeX
    lacks: the physics package (`\abs`, `\norm`, `\expval`, `\mel`, `\dv`, `\pdv`, `\vb`, …), `\vv`, `\mathbbm`,
    `\mathds`, `\eps`, `\C`, `\Q` and `\ud`. `init` wires it.
  - Measured on a corpus of real comments (99 snippets from 20 projects): 195 of the 199
    fragments that reach a page render as maths, and nothing else does; the other 4 are LAPACK's `ILO$-$1`, which FORD
    and Doxygen show as text too. On all 1,174 pages of LAPACK, stdlib, json-fortran, Quantum ESPRESSO, Wannier90, the
    showcase and the nasty fixture, KaTeX fails only on 18 formulas with typos in the sources (`\V^T`,
    `\tex/temttt`, `textrm` without its backslash).
- `\verbatim` becomes a text block, and Python-Markdown's indented code becomes fenced code, since MDX has no indented
  code.
- HTML in a doc becomes JSX that MDX parses and React hydrates: a phrasing tag pairs with its end tag within its
  paragraph, a block element stands as a block (end tags HTML lets an author leave out are added, and a table's
  `<tbody>`), `<a href>` becomes a Markdown link, and anything that does not pair (`a<b and b>c`) is text. Lists nest 4
  columns a level, as in Python-Markdown; a code block names a language Shiki has (anything else is `text`, since the
  build fails on it); an image a site cannot import (a relative path, FORD's `|media|`) is its alt text; footnotes and
  link definitions are namespaced per doc; `import` and `export` at the start of any line are neutralised.
- Headings inside doc bodies (93 in json-fortran, 206 in stdlib) become bold paragraphs, so they do not break the page
  outline.
- HTML is whitelisted and normalised: `<br>` becomes `<br />`, comments and `\htmlonly` are dropped. A paragraph that
  starts with `import` or `export` is neutralised.
- Admonitions become `<Callout>`.
- `[[…]]`, `\ref` and `\see` resolve as in FORD: the entity, then its parent, then the project. An unresolved link
  becomes inline code plus a diagnostic.

## 5. Intermediate model (IR)

`schema/ir-1.json` defines `{irVersion, generator, project, files[], entities{}, diagnostics[]}`. Large projects get one
shard per program unit; ten stdlib files alone made 2.3 MB as a single file.

**Kinds:**
- module, submodule, program, block data;
- procedure: module, internal, external, interface body or separate module procedure;
- interface: generic, operator, assignment, defined I/O, abstract or explicit;
- type: with components, bindings, finalisers and kind/len parameters;
- variable or parameter, enum, namelist, common block.

**Fields:**
- Every entity: `id`, `kind`, `name` (as spelled in the source), `parent`, `file`, `line`, `lineEnd`, `access`, `cond[]`
  (cpp guards), and `doc{summary, body, sections, meta, params, returns, groups}`.
- Procedures add `prefix`, `bind`, `args[{name, type{base,kind,len}, intent, optional, value, dims, codims, init, doc}]`,
  `result`, `uses[{module, only, renames}]`, `calls[{name, line, target, cond}]` and `hpc{directives, libs, coarray}`.
- Types add `extends`, `abstract`, `params`, `components`, `bindings` and `finals`.
- Kinds, dimensions and initial values are kept both as source text and as normalised fields.

**IDs.** Internally, IDs are lower-case paths tagged with kinds, such as
`module:json_value_module/type:json_core/binding:add_by_path`.
- They contain no line numbers, so they survive edits.
- Clashing external procedures get an `@file` suffix.
- Authors write readable references instead: `linalg::solve`, `linalg::dense_matrix%solve` or `[[solve]]`.
- Anchors are qualified by kind where names clash on a page; stdlib's `string_type` is both a type and an interface.
- Operators get fixed slugs (`operator-plus`).

**Resolution** ignores case.
- Names are looked up locally, then in the host, through use association (`only`, renames, re-exports), in the ancestor
  module, among the project's external procedures, and finally in the registry.
- Generics map to their specific procedures, and bindings to their implementations.
- Separate module procedures take their arguments from their interface.
- `extends` chains are followed, with inherited members marked.
- An unresolved name stays text with a diagnostic. It never aborts the build, as FORD's correlate step does.

**Versioning.** Minor versions only add optional fields, and readers refuse an unknown major version.
`generate --from-ir` accepts IR from any producer, so a FORD or LFortran backend can still come after v1.

## 6. Pages in fumadocs

**Choice: generated MDX files only in v1**, written from an internal `buildPages()` page model that a virtual source
could reuse later. MDX pages:
- work with every fumadocs framework and with static export;
- get the TOC, search, llms.txt (`getText('processed')`), OG images and `.md` copies for free;
- depend only on fumadocs' most stable contract: files, frontmatter and `meta.json`.

fumadocs-core redesigned sources, search and highlighting between 16.15 and 16.19, and fumadocs-python's runtime pages
render only under React Server Components and have no `getText()`.

**Files** go in `content/docs/api/` by default:
- `index.mdx`, taken from `fpm.toml` or the FORD project file;
- one page per module, submodule, program, and derived type with bindings;
- external procedures grouped by `\ingroup`, or by file when there is none. LAPACK's s/d/c/z variants share a page, as on
  Netlib, so its 2,304 routines become about 580 pages;
- `meta.json` with separators;
- a manifest, so that regeneration deletes only stale generated files and never touches hand-written ones;
- a banner in every generated file.

**Layout of a page:**
- frontmatter: title, description and an icon per kind;
- badges, then the doc body;
- `## Types`, `## Interfaces`, `## Procedures` and `## Variables`, with one `###` heading per entity under an explicit ID
  (`### solve [#solve]`).

Entity sections contain no sub-headings, so fumadocs' own `<include>…#solve</include>` embeds exactly one entity
(checked in fumadocs-core 16.19.4). `<auto-fortran>` is shorthand for it. Each entity has:
- its signature in an `f90` or `f77` fence. These are Shiki's own language IDs, so the pages build even on a site
  without our grammar pack;
- its summary and body;
- an argument list with full Markdown under each argument. Table cells cannot hold LAPACK's `\verbatim` argument docs,
  code or maths;
- its result, callouts, external calls with their badges, and a link to its lines on GitHub.

**Search.** fumadocs indexes entity headings and summaries. `remarkFortran` adds one record per argument.
- Above a size budget, the argument records are dropped (`search.granularity`), because a static export ships the whole
  index to every visitor.
- Huge modules can be split into a page per entity (json-fortran's `json_value_module` has 247 procedures).

**Links** are absolute paths under `baseUrl`. `fortran-inventory.json` feeds the remark plugin and the code-block
linker. A FORD-compatible `modules.json` lets FORD sites link into ours.

**Sidebar badges** (optional) come from a small loader plugin; no virtual source is needed.

## 7. Components and styling

- **Components** (`./react`) are synchronous `createElement` code with no hooks and no `'use client'`, as in
  fumadocs-feynman, so one set renders both on the server and in client-rendered MDX:
  - `FortranBadges`/`FortranBadge` (`kind`, `label`, `conditional`, `via`);
  - `FortranVariants` (a precision family, with an anchor per variant);
  - `FortranRef` (a name that links and carries a hover card);
  - `fortranComponents`, to spread into `getMDXComponents()`.
- **fumadocs' own components.** Generated MDX also uses `Callout` and `Cards`/`Card`, which every fumadocs site already
  registers. The package never imports from `fumadocs-ui/*`, because the Radix and Base UI packages have different names.
- **Hover cards.**
  - Names are ordinary links, and each symbol gets one native `popover` card per page, not one per occurrence.
  - The card opens on hover where the browser supports `interestfor`, and through a few lines of optional script
    elsewhere.
  - Without JavaScript the link and its title remain. The exact mechanism is settled in v0.3.
- **`style.css`.** Plain `.fdf-*` classes on fumadocs' `--color-fd-*` variables, with `.dark` overrides.
  - Library colour tokens (`--fdf-omp`, `--fdf-mpi`, …) can be overridden by sites.
  - Directive lines get a tint, because theme colours alone do not separate them from keywords.
  - No Tailwind `@source` line is needed.

## 8. HPC layer

**Recognition** (in the parser):
- directives and regions;
- `use` of `mpi`, `mpi_f08`, `omp_lib`, `openacc`, `cudafor`, `cublas`, `lapack95`, `mkl_*`, `hdf5`, `netcdf` and `elpa`,
  and `include 'mpif.h'`;
- calls, coarrays and CUDA attributes;
- the cpp guard of each.

**Registry.** `scripts/registry/*.mjs` build JSON files from pinned upstream sources in Docker, and the output is
committed with `SOURCES.md` and `NOTICE`.

| Library | Pinned source (licence) | Entries |
|---|---|---|
| BLAS + LAPACK 3.12.1 | Reference-LAPACK `\brief` and `\param` (BSD) | 2,304 |
| ScaLAPACK 2.2, PBLAS, BLACS | Reference-ScaLAPACK Purpose/Arguments (BSD) | 892 |
| MPI 5.0 (4.1 alias) | Open MPI's API data and man-page summaries, pinned (BSD-3); mpi-abi-stubs (MIT) | about 465 |
| OpenMP 6.1 / 6.0 / 5.2 | LLVM `omp_lib` (Apache-2.0), fragment IDs from the spec's contents; our own one-liners | about 463 |
| OpenACC 3.4, intrinsics | names and our own one-liners; M_intrinsics (MIT) | about 300 |
| MKL, OpenBLAS, cuBLAS | hand-curated names | small |

- **Size and use.** About 1 MB, or 0.2 MB gzipped. It is used only at build time, and pages embed only the entries they
  reference.
- **Text we do not copy:** prose from the GFDL manuals (gfortran, libgomp), the OpenMP and MPI standards, Intel, NVIDIA
  or FFTW.
- **Summaries.** v1 writes its own one-liners for the 100 or so most used OpenMP and OpenACC items; the others get a name
  and a link.

**Link providers** (`hpc.links`):
- `netlib`: member pages from Doxygen's search index, with file pages computed from their hash as the fallback;
- `mkl`;
- `openmpi` (5.0.x, the default), `mpich` or `standard`;
- `openmp`: stable fragment IDs plus a page map per version;
- `fortran-lang` and `gfortran` for intrinsics;
- `libgomp`.

**Scope-aware resolution:**
- Project symbols always win.
- `use … only` binds names exactly.
- `use cublas` retargets the BLAS names.
- `lapack95` and `stdlib_linalg_lapack` map generic names such as `getrf` to their LAPACK groups.
- Implicit or `external` calls reach the registry only when no project symbol matches.
- Ambiguous names stay unlinked.

**Badges** go on each procedure and roll up to the module and the sidebar. They say what a caller needs to know:
- "opens an OpenMP parallel region" versus orphaned worksharing;
- "offloads" (target, acc);
- "MPI collective" (every rank must call) versus point-to-point;
- coarray, CUDA Fortran, BLAS, LAPACK, ScaLAPACK.

Guarded code reads "when `USE_MPI`" (dashed). Use through wrapper modules reads "via `mp_bcast`", either detected or set
in `hpc.wrappers`; QE-style codes need this.

**Hints** come from registry tags, with no data-flow analysis:
- LWORK = −1 workspace queries (570 LAPACK and 254 ScaLAPACK routines);
- leading dimension ≥ max(1,N) (1,904 routines);
- INFO conventions (997 routines);
- ScaLAPACK descriptors (624 routines; DESCINIT, NUMROC) and global versus local arguments;
- `mpi_f08`'s optional `ierror`;
- deprecated `mpif.h`.

**Precision families** come from `\ingroup`, because stripping the s/d/c/z prefix groups 25% of routines wrongly. A call
shows as "?gesv (s d c z; ds zc)", with the variant actually called highlighted.

**`api/hpc`** is an overview page listing where each directive family, MPI routine and LAPACK/ScaLAPACK routine is used.

## 9. Highlighting

`scripts/build-grammars.mjs` generates `shiki/*.json` from pinned tm-grammars, keeping the upstream MIT notice.
- **Two base grammars:**
  - `fortran` (scope `source.fortran.free.fd`), with aliases `fortran-free-form`, `f90` to `f23`, `fpp` and `fypp`;
  - `fortran-fixed`, with aliases `fortran-fixed-form`, `f`, `for`, `f77` and `ftn`.

  Their names are unique because Shiki silently ignores a grammar of the same name that loads later.
- **Patches to the upstream grammars:**
  - the column-72 rule actually fires (72, 132 or off);
  - Fortran 2018/2023 constructs such as `enumeration type`, `local_init`, `typeof`/`classof`, `simple` and conditional
    expressions;
  - scopes for doc comments;
  - no `invalid.*` fallbacks.
- **Injections:**
  - `fortran-directives`: OpenMP 6.1 and older spellings, OpenACC 3.4, `!$` and `!dir$`, with word lists generated from
    the registry so they cannot drift;
  - `fortran-fypp`.
- **Helpers** in `./shiki`:
  - `fortranRehypeCode(base)` returns `{...base, langs, transformers}` for `applyMdxPreset({ rehypeCodeOptions })`. It
    never uses `langAlias`, which rebuilds the highlighter.
  - `transformerFortranNotation()` makes `! [!code highlight]` and the other notations work; Shiki's transformers do not
    know `!` comments.
  - `transformerFortranDirectives()` adds a line class, so directives stand out in every theme.
  - `transformerFortranLinks()` links resolved names only, which costs at most 3% CPU and 2–12% more HTML.

**Measured:** the injections add 13–23% to tokenising time, and Shiki's JS and Oniguruma engines give identical tokens.

## 10. Configuration and CLI

```js
// fumadocs-fortran.config.mjs (or [extra.fumadocs-fortran] in fpm.toml)
import { defineConfig } from 'fumadocs-fortran';

export default defineConfig({
  ford: 'doc/project.md',                 // optional: an existing FORD project file
  sources: { dirs: ['src'], exclude: [] },
  cpp: { macros: { _OPENMP: 1, USE_MPI: 1 }, includeDirs: ['include'] },
  output: { dir: 'content/docs/api', baseUrl: '/docs/api' },
  hpc: { links: { lapack: 'netlib', mpi: 'openmpi', openmp: '5.2' } },
  repo: { url: 'https://github.com/org/code', rev: 'main' },
});
```

**Precedence**, highest first: CLI, config file, `[extra.fumadocs-fortran]`, `[extra.ford]`, FORD project file,
`fpm.toml`, defaults.

**FORD import:**
- Syntax: Python-Markdown metadata, where `alias` and `external` use `=` and `extra_mods` uses `:`.
- Keys read:
  - the four marks (empty means off);
  - `src_dir`, `exclude(_dir)`, `extensions`, `fixed_extensions` and `fixed_length_limit`;
  - `fpp_extensions`, `preprocess`, `preprocessor` (which becomes `cpp.command`), `macro` (plus `__GFORTRAN__`) and
    `include`;
  - `display` and `proc_internals`;
  - `extra_mods`, `external` and `page_dir`;
  - the project metadata.
- `[TOC]` markers are stripped.
- `init --from-ford` lists the keys it ignores.
- A warning appears where output may differ from FORD's. For example, FORD keeps every branch in files outside
  `fpp_extensions`, while we evaluate them.

**fpm.toml** supplies the name, version, licence, authors, description, `source-dir`, `include-dir`, `source-form` and
`[preprocess.cpp]` macros. Its metapackages (openmp, mpi, blas, …) become project badges. It is read with our own small
TOML reader, tested against the manifests of stdlib, fpm, json-fortran and toml-f, which fails loudly on syntax it does
not support.

**CLI** (`fumadocs-fortran`):
- `init [--from-ford file] [--site dir]`:
  - detects the sources, their forms and any FORD or fpm configuration;
  - counts the cpp guard macros and writes the HPC ones into the config explicitly;
  - detects remark-math and rehype-katex;
  - prints the exact wiring for `lib/source.ts` and `components/mdx.tsx`.

  `--site` scaffolds a complete fumadocs site with a GitHub Pages workflow, for projects that have none (most FORD
  projects).
- `generate [--watch] [--clean] [--from-ir file]`.
- `check [--render] [--strict]`, for CI: drift, unresolved links, and every page compiled, evaluated and rendered.
- `doctor`: doc coverage, why each block was attached where it was, ignored marks, and unresolved links.
- `dump [--explain file:line]`.

## 11. Package, exports and distribution

There is one package in fumadocs-feynman's style: plain ESM, hand-written `types/*.d.ts`, no build step, Node 18 or
later, zero runtime dependencies, MIT.

**Layout:**

```
bin/ src/{config,source,parse,docs,model,hpc,emit}/ react/ remark/ shiki/ registry/ schema/ types/
style.css scripts/ test/ docs/ examples/
```

`scripts/` is for development only.

**Exports:**
- `.` (Node only): `defineConfig`, `loadConfig`, `extract`, `buildPages`, `generate`;
- `./react`;
- `./remark`: `remarkFortran` for `[[links]]`, `<auto-fortran>` and search records;
- `./shiki`;
- `./style.css`;
- `./schema/ir-1.json`;
- the bin `fumadocs-fortran`.

The bin and the data folders (registry, grammars) are the only departures from fumadocs-feynman's layout; a generator
needs them.

**Peer dependencies:** only an optional `react` ≥18. There is deliberately no fumadocs peer, since the package imports
neither fumadocs nor Shiki at runtime. A `^16.19` peer would make `npm install` fail on sites still on 16.18.4, such
as fumadocs-feynman's.

Sites need fumadocs-core 16.18.4 or later and fumadocs-mdx 15, with either UI variant. The target tarball size is 2 MB
or less (the registry is about 1 MB). Distribution is decision 4.

## 12. Documentation site

`docs/` mirrors fumadocs-feynman's site and uses every feature of the plugin:
- Next 16, fumadocs-core/ui 16.19 (aliased to Base UI), the fumadocs-mdx 15 macro API and Tailwind 4;
- a static export to nevensky.github.io/fumadocs-fortran, deployed by `docs.yml`;
- llms.txt, OG images and Markdown copies;
- `check-pages`, extended to render every page.

**Pages:**
- **Home:** a live LAPACK `gesv` card and a highlighted OpenMP block.
- **Get started:** Introduction, Installation, and a five-minute Quick start (`init`, `generate`, `dev`).
- **Guides:** Migrating from FORD; Writing doc comments (FORD, Doxygen, LAPACK); Preprocessing (cpp, fypp, includes);
  Fixed form; HPC features; Code blocks; Embedding entities in guides; Maths; Large libraries; Deploying to GitHub
  Pages; Troubleshooting (`doctor`, `--explain`); How it works.
- **Reference** (generated from the package and checked for drift): CLI, configuration, IR schema, components,
  `./shiki`, `./remark`, diagnostics, registry coverage and licences, and a FORD/Doxygen command matrix.
- **Showcase**: generated in CI from pinned upstream tags, shown with licence notices, and not committed:
  1. `examples/modern`, our own code, which uses every feature (OpenMP, OpenACC, MPI, coarrays, cpp, both doc styles);
  2. Reference-LAPACK's `gesv`, `syev`/`heev` and `gemm` groups (fixed form with Doxygen);
  3. ScaLAPACK's `pdgesv` family (legacy prose);
  4. json-fortran, built from its unchanged `ford.md`;
  5. a stdlib subset, after fypp;
  6. one real, permissively licensed code with OpenMP or MPI directives. The candidate is the Fortran version of
     miniWeather; its licence is checked in M0.
- **About:** author, citation, funding and licence.

## 13. Testing and CI

- **Local work** runs through `scripts/dev.sh`, a `node:22` container, because the host has no Node.
- **Unit tests** (`test/run.mjs`, no framework):
  - the lexer;
  - cpp, also tested differentially against `cpp -traditional-cpp -E` and pcpp in Docker;
  - regressions for statements that are easy to misclassify: `END FILE`, `END BLOCK DATA`, `END ENUMERATION TYPE`,
    labelled ends, Hollerith constants, keywords without blanks;
  - attachment fixtures for each comment style;
  - a set of 40 hand-labelled doc blocks from json-fortran, MOM6, CP2K, ELPA and LAPACK;
  - name resolution.
- **Emitter tests.** Doc strings fuzzed from the corpora (`*>`, `${rt}$`, `\(`, braces, `import`/`export`, HTML) must
  compile, evaluate and render, with and without remark-math. The tools for this are development dependencies only.
- **Conformance:**
  - the research's hand counts as assertions: `modern_ford` 41/41 argument attributes, 13/13 `!>` and 24/24 `!!` docs;
    `stdlib_hashmaps` 88/88 docs; `dgesv` 8/8 argument docs with intents;
  - IR and page snapshots of the public fixtures;
  - IR schema validation.
- **Oracles** (weekly or on demand, in Docker, never shipped): FORD 7.0.13 and the tree-sitter extractor.
  - They are compared field by field: argument type, kind, intent and dimensions; bindings; the specific procedures of
    each generic.
  - Known differences go in an allowlist.
  - The FORD script carries its own GPL-3.0-or-later header and is excluded from the package.
- **Whole repositories** (nightly):
  - Reference-LAPACK, checked against the 2,308-routine registry;
  - json-fortran with its include files;
  - QE `PW/src` and Wannier90, which are GPL: fetched at pinned commits, never committed, with only counts and hashes
    recorded;
  - stdlib after fypp, and fpm.

  A lost program unit fails the run.
- **Package** (every push, Node 18 to 26): tests, publint, `tsc` on the `.d.ts` files, and an `npm pack` consumer
  smoke test that runs `generate` and renders each component.
- **Site:** drift check, `check-pages` with rendering, static export and internal links. A weekly external link check
  tolerates 403 responses from intel.com and mpich.org.
- **Canary** (weekly): the showcase built against fumadocs 16.18.4 and against the latest release.
- **Grammars:** scope snapshots on both regex engines, plus load-order and no-cascade tests.
- **Privacy:** private code used in acceptance tests stays on the maintainer's machine. Nothing derived from it is
  committed or published.

## 14. Milestones

Every release has a tag, a CHANGELOG entry and a working docs site. The grammar pack (v0.2) and the registry builders
(v0.3) do not depend on the parser, so they can be built in parallel.

**M0: foundations and the parser gate**
- *Scope:*
  - the repository in house style: package.json, LICENSE, CHANGELOG, CITATION.cff, FUNDING, CI skeleton;
  - `scripts/dev.sh`, and pinned fetchers for the corpora;
  - the parser core (form, lines, cpp, includes, statements, units, IR, `dump`);
  - the oracle harness;
  - a measurement of the static search index at LAPACK scale.
- *Done when:*
  - `modern_ford` has 41/41 argument attributes;
  - at least 99% of the 2,308 LAPACK routines are found with matching argument names;
  - json-fortran (with its include files), QE `PW/src` and stdlib lose no program unit;
  - a private project parses completely, in a local acceptance test that reports aggregate figures only;
  - parsing runs at 200k lines/s or faster.

  If the gate fails, we decide on tree-sitter behind the same reader.

**v0.1: the first API reference**
- *Scope:*
  - the doc engine (FORD, Doxygen and LAPACK styles);
  - FORD and fpm import;
  - `buildPages()` and the MDX emitter;
  - badges and CSS;
  - `init`, `generate`, `check --render` and `dump --explain`;
  - the docs site live, with the Introduction, Installation, Quick start and Doc comments pages and the first showcase
    (`examples/modern`, json-fortran).
- *Done when:*
  - `init` → `generate` → static export works for `examples/modern` and for json-fortran from its unchanged `ford.md`;
  - the hand counts pass, and at least 38 of the 40 labelled blocks are attached correctly;
  - every page renders on fumadocs 16.18.4 and 16.19.4;
  - a private FORD project builds locally from its unchanged project file (aggregate figures only).

**v0.2: highlighting and the site scaffold**
- *Scope:*
  - the grammar pack, its injections and patches;
  - `fortranRehypeCode` and the transformers;
  - `init --site`.
- *Done when:*
  - ```` ```fortran ````, `f90` and `f77` fences build on stock fumadocs 16.18.4 and 16.19.4 in any grammar load order;
  - directives stand out in github-light and github-dark;
  - both regex engines give the same scopes, and tokenising costs at most 25% more;
  - `init --site` on a bare Fortran repository gives a site that builds and deploys.

**v0.3: the HPC layer**
- *Scope:*
  - the registry and its builders, and the link providers;
  - scope-aware resolution;
  - badges with their meaning, hints and precision families;
  - hover cards, `api/hpc`, "Uses"/"Used by", and links in code blocks.
- *Done when:*
  - every BLAS, LAPACK, ScaLAPACK, MPI and OpenMP call in the showcase links correctly;
  - a project's own `dgemm` shadows BLAS;
  - the badges in `examples/modern` are right, conditional ones included;
  - the registry is at most 1.2 MB, with its sources and notices;
  - the external link check passes.

**v0.4: FORD drop-in and authoring**
- *Scope:*
  - `page_dir` to MDX guides;
  - full `[[links]]`, `|alias|` and `{!file!}`;
  - reading and writing `modules.json`, and `extra_mods` and `external`;
  - `<auto-fortran>`;
  - `generate --watch` and `doctor`.
- *Done when:*
  - json-fortran's documentation, its pages included, builds from its unchanged `ford.md`;
  - the guides embed showcase entities;
  - an edit to a source file updates its page in under a second.

**v0.5: scale**
- *Scope:*
  - the full Reference-LAPACK showcase (`\ingroup` pages with variant blocks);
  - the search levers, the per-entity split and the prebuild mode;
  - cpp variants, so that MPI-only arguments are labelled;
  - `fypp.command`.
- *Done when:*
  - all of Reference-LAPACK builds statically in CI within the measured index budget;
  - `examples/modern` shows `comm` as an MPI-only argument;
  - stdlib builds from its `.fypp` sources.

**v1.0**
- *Scope:* the IR frozen at 1.0, complete documentation, the release (on npm, if decided by then).
- *Done when:* no nightly whole-repository run loses a file, and the canary has been green on fumadocs 16.18.4 and the
  latest release for four weeks.

## 15. Risks and mitigations

| Risk | Mitigation |
|---|---|
| The parser misses constructs | Errors cost one statement; two oracles; nightly whole-repository runs; the M0 gate with tree-sitter as the fallback |
| Ambiguous marks put docs on the wrong entity | FORD import; per-pattern styles; `--explain`; a labelled test set |
| Macro-heavy cpp | `cpp.command` with line markers; a differential cpp test |
| fypp needs Python | A command hook and a CI recipe; skipped files are always reported |
| Doc text breaks MDX, or the site lacks remark-math | One emitter; fuzzing; `math: 'code'`; `check --render` |
| fumadocs API churn | No runtime imports from fumadocs; the narrow MDX contract; the weekly canary |
| Search index size at LAPACK scale | `\ingroup` pages; search granularity; measured in M0 |
| Links to external docs rot (Netlib hashes, OpenMP page numbers) | Fallbacks derived from names; refresh scripts; the weekly link check |
| Licensing of the registry | Permissive sources only; our own one-liners; `NOTICE` and `SOURCES.md` |
| The grammar fork falls behind upstream | Sync script against tm-grammars; patches sent upstream |
| One maintainer | Zero dependencies; generated data; `--explain` in issue templates |
| Private code leaks | Local tests only; aggregate figures only |

## 16. Prior art in one line each

- **FORD 7.0.13:** GPL; the reference for comment syntax; a test oracle here.
- **formal:** FORD to VitePress. It imports FORD in-process and covers only modules.
- **sphinx-fortran-domain and sphinx-ford:** Sphinx domains with regex and FORD lexers. stdlib now builds its docs with
  sphinx-fortran-domain, running FORD's lexer after fypp.
- **fumadocs-python:** a Python extractor writes JSON, and TypeScript turns it into pages; its pages render only under
  React Server Components.
- **Doxygen:** weak on submodules, generics and type-bound procedures (38 open Fortran issues).
- **No Fortran integration was found** for fumadocs, Docusaurus, Starlight or mkdocstrings.

## 17. Evidence

The research behind this plan is not published with the repository. It consisted of:

- eight reports, checked for gaps by a final review:
  - fumadocs integrations and APIs;
  - FORD and formal;
  - a tree-sitter bake-off with a working extractor;
  - a FORD bake-off;
  - other parsers (LFortran, fparser, fortls, Flang, gfortran);
  - HPC references and registry data;
  - Shiki experiments;
  - prior art and comment dialects across about 20 HPC codes;
- three design proposals (lean, native and HPC-first), each scored by three independent reviews. The lean proposal
  ranked first on risk and maintainability and the HPC proposal first on user value; this plan combines the two;
- a 297-line parser probe, a tree-sitter prototype, the FORD dump script (now `scripts/oracle/ford/ford_dump.py`) and
  the LAPACK and ScaLAPACK registry prototypes;
- the public corpora that `scripts/fetch-corpus.sh` fetches.
