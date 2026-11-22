# fumadocs-fortran

Fortran API reference for [fumadocs](https://fumadocs.dev). It reads Fortran sources with its own parser, written in
plain JavaScript with no dependencies, and will write the API reference as MDX pages that a fumadocs site builds like
its hand-written pages. It reads the doc comments projects already have, in FORD, Doxygen and LAPACK style, and it
understands HPC code: OpenMP and OpenACC directives, MPI and coarrays, and calls into BLAS, LAPACK and ScaLAPACK.

**Status: in development.** The parser is done and checked (milestone M0). The doc-comment engine, page generation
and the documentation site (v0.1) are in progress: `generate` already writes the pages for the example in
`examples/modern`.

## What works now

It is not published to npm yet. Install it from GitHub:

```bash
npm install github:Nevensky/fumadocs-fortran --allow-git=root
```

```bash
npx fumadocs-fortran dump --summary src/
```

```bash
npx fumadocs-fortran dump -D_OPENMP -DUSE_MPI -I include src/ -o model.json
```

`dump` prints the intermediate model: every module, procedure, type, interface and variable with its arguments,
types, attributes, cpp conditions, directives, calls and doc comments. `fumadocs-fortran dump --help` lists the
options.

```bash
npx fumadocs-fortran generate src/ -o content/docs/api --base-url /docs/api -D_OPENMP
```

`generate` writes the API reference as MDX pages into a fumadocs content folder: one page per module, submodule and
program, external procedures grouped as LAPACK groups them, and the `meta.json` files of the sidebar. The pages use
the components from `fumadocs-fortran/react`; register them with `fortranComponents` and import
`fumadocs-fortran/style.css`.

LaTeX in doc comments (`$…$`, `$$…$$`, `\( \)`, `\[ \]`, `\begin{equation}`, Doxygen's `\f$` and `\f[`) renders with
KaTeX. Add remark-math and rehype-katex to the site, with the macros for the commands Fortran docs write that KaTeX
lacks (the physics package and others), and import `katex/dist/katex.css`:

```ts
import remarkMath from 'remark-math';
import rehypeKatex from 'rehype-katex';
import { katexMacros } from 'fumadocs-fortran/math';

// in defineDocs: docs.mdxOptions
applyMdxPreset({
  remarkPlugins: [remarkMath],
  rehypePlugins: (defaults) => [[rehypeKatex, { macros: { ...katexMacros } }], ...defaults],
});
```

A site without them can show the maths as code instead: `generate --math code`.

Arguments, results and components are tables whose rows open to their documentation and declaration. Kind names and
derived types in them link to their definitions, with a card on hover or keyboard focus, and every badge, intent,
attribute, shape and type parameter's `kind` or `len` says what it means in a card on hover; an opened row lists the
meanings of its intent, type parameter, attributes, shape and length, for the keyboard and screen readers, while a
badge's meaning is for the pointer alone. The registry of HPC library names that the package ships (`registry/`)
gives cards to the libraries' names: in a procedure's "Calls:" line, a BLAS, LAPACK, ScaLAPACK (the routines it
writes in C for Fortran, such as `pcrot` and `reshape`, included), MPI, OpenMP or OpenACC routine has a card with its
library and, where the registry has them, its kind, a summary and a link to its documentation, and in the tables
mpi_f08's types (`type(MPI_Comm)`) and omp_lib's kinds have theirs; a project's own names always win.
`--links mpi=mpich,openmp=6.0` (`hpc.links` in JavaScript) chooses the pages the cards link to, by library, and
`--library-cards none` (`hpc.cards: false`) leaves the names as code; `generate --help` lists the providers. Each
entry's source code is in a block that opens, with line numbers, read from the files parsed wherever they lie
(`--source link` only links to the lines). Modules, types and procedures have dependency, inheritance and call
graphs, written as ` ```mermaid ` blocks: add fumadocs' `remarkMdxMermaid` and a `Mermaid` component to the site, or
leave them out with `--graphs none`. Calls into BLAS, LAPACK, ScaLAPACK, MPI, OpenMP, OpenACC, CUDA and the coarray
collectives are drawn in their library's colour (the JavaScript option `graphs.classify` takes the registry's
place). Graphs drawn by [Pele](https://github.com/obsidianmd/pele) take the theme's colours from
`fumadocs-fortran/style.css`. A page's front matter says what each heading is, for the letters (`t` type,
`s` subroutine, `f` function, …) that `fortranToc()` puts in the table of contents.
[Components](https://nevensky.github.io/fumadocs-fortran/docs/reference/components) shows how to set these up.

From JavaScript:

```js
import { extract, parseSource } from 'fumadocs-fortran';

const model = await extract({ sources: ['src'], cpp: { macros: { _OPENMP: 1 } } });
const one = parseSource('subroutine hello(n)\n  integer, intent(in) :: n\nend subroutine\n');
```

It needs Node 18 or later.

## Highlighting Fortran code blocks

`fumadocs-fortran/shiki` has Shiki grammars for Fortran, in free and fixed form. Unlike Shiki's own, they highlight
OpenMP, OpenACC, CUDA Fortran and compiler directives rather than reading them as comments, and fypp too. Give them
to fumadocs' `rehypeCode` with fumadocs' default options as the base:

```ts
import { rehypeCodeDefaultOptions } from 'fumadocs-core/mdx-plugins';
import { fortranRehypeCode } from 'fumadocs-fortran/shiki';

// in defineDocs: docs.mdxOptions
applyMdxPreset({
  rehypeCodeOptions: fortranRehypeCode(rehypeCodeDefaultOptions),
});
```

Every Fortran fence then uses them (`fortran`, `f90`, `f77` and Shiki's other Fortran ids), directive lines are tinted
by `fumadocs-fortran/style.css`, and fumadocs' `[!code highlight]` notations work in `!` comments. With Shiki alone,
load `fortranLanguages` and add the transformers `transformerFortranDirectives()` and `transformerFortranNotation()`.

## Search and prefetch on large references

fumadocs indexes a page's headings and paragraphs for search. For the pages of a fumadocs-mdx collection, it keeps the
element of each component in the records as an HTML tag with its text attributes, so a statically exported site
ships every badge, source header and argument row without docs to each reader, and the search dialog shows them as
chips. Give the Fortran components their text instead:

```ts
// in defineDocs: docs.mdxOptions (in source.config.ts, defineConfig's mdxOptions take the same option)
applyMdxPreset({
  remarkStructureOptions: {
    // the elements of other components stay tags, as by default; HTML elements give their text
    filterElement: (node) => /^(?!Fortran[A-Z])[A-Z][\w$]*$/.test(node.name ?? ''),
  },
});
```

Headings, argument docs and the names on "Calls:" lines stay searchable, while badges, source headers, the rows of
undocumented arguments and the words only their attributes hold, such as an argument's type, leave the index. The
option replaces fumadocs' own choice for every element, which is why it keeps the other components, the capitalised
names, itself. With it, the documentation site's index is 24% smaller (18% gzipped), and that of stdlib's pages 73%
(64% gzipped).

Next.js prefetches the page behind each link in view, and fumadocs' sidebar keeps Next's default. On a site with large
reference pages (a first visit to stdlib's `stdlib_ansi` page prefetched 10.3 MB gzipped with the pages' source
blocks and graphs, and 1.4 MB without either), turn the sidebar's prefetch off:

```tsx
// app/docs/layout.tsx
<DocsLayout tree={source.getPageTree()} sidebar={{ prefetch: false }} {...baseOptions()}>
  {children}
</DocsLayout>
```

Its links then load a page when they are clicked, not when they come into view or are hovered. The previous and next
links under a page, its breadcrumbs, the links in its text, the navigation title and the sidebar's tab switcher (root
folders) still prefetch. Next prefetches the links in view and under the pointer only in production builds, so
measure one. The documentation site keeps the default, as its pages are small.

## Development

The scripts run in Docker, so the machine needs no Node: `scripts/dev.sh` runs a command in a `node:24-bookworm`
container with the repository mounted.

```bash
scripts/dev.sh npm test
```

```bash
scripts/fetch-corpus.sh
```

```bash
scripts/dev.sh node scripts/gate.mjs
```

`fetch-corpus.sh` fetches the public test corpora at pinned commits into `.corpus/`. These are Reference-LAPACK,
ScaLAPACK, json-fortran, Quantum ESPRESSO, stdlib, Wannier90 and miniWeather, and they are never committed.
`gate.mjs` then checks the parser against them.

`scripts/build-grammars.mjs` builds the Shiki grammars in `shiki/` from tm-grammars, and `npm run test:shiki` tests
them with Shiki (and through fumadocs-core, when it is installed). These tools are not dependencies of the package:
install the versions that `.github/workflows/ci.yml` installs, with `npm install --no-save`.

Two further checks run on demand:
- `scripts/oracle/ford.sh` runs FORD 7.0.13 in Docker, and `scripts/oracle/compare-ford.mjs` compares every dummy
  argument with FORD's, field by field. The FORD script is GPL-3.0-or-later, like FORD, and is not part of the
  package.
- `scripts/search/measure.mjs` measures the static search index of a generated reference, Reference-LAPACK's library
  by default, with fumadocs' own index builder: under fumadocs' defaults and under the docs site's MDX options.
  `--sample N` measures N pages of a large corpus. It needs the docs site's `node_modules`, which `scripts/docs.sh`
  keeps in a Docker volume:

  ```bash
  docker run --rm -u "$(id -u):$(id -g)" -e HOME=/tmp -v "$PWD":/work \
    -v fdf-docs-node-modules:/work/docs/node_modules -w /work node:24-bookworm \
    node scripts/search/measure.mjs .corpus/stdlib src -I include --sample 10
  ```

## Licence

MIT. The package also ships material from other projects under their own licences: the HPC registry draws on
Reference-LAPACK, ScaLAPACK, Open MPI, LLVM and others (BSD-style licences, MIT, Apache-2.0 with the LLVM
exception), and the code-block grammars on vscode-fortran-support (MIT). Their notices are in `registry/NOTICE` and
`shiki/NOTICE`.
Test corpora keep their own licences and are only fetched, never committed or shipped.
