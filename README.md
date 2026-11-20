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

Arguments, results and components are tables whose rows open to their documentation and declaration, and kind
names and derived types in them link to their definitions, with a card on hover or keyboard focus. Each entry's
source code is in a block that opens, with line numbers, read from the files parsed wherever they lie
(`--source link` only links to the lines). Modules, types and procedures have dependency, inheritance and call
graphs, written as ` ```mermaid ` blocks: add fumadocs' `remarkMdxMermaid` and a `Mermaid` component to the site, or
leave them out with `--graphs none`. Calls into MPI, OpenMP, OpenACC, CUDA, the coarray collectives and BLAS are drawn
in their library's colour; LAPACK and ScaLAPACK routines take theirs from the JavaScript option `graphs.classify`
until the registry of library symbols arrives. Graphs drawn by [Pele](https://github.com/obsidianmd/pele) take the
theme's colours from `fumadocs-fortran/style.css`. A page's front matter says what each heading is, for the letters
(`t` type, `s` subroutine, `f` function, …) that `fortranToc()` puts in the table of contents.
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
- `scripts/search/measure.mjs` measures the static search index for all of LAPACK with fumadocs' own index builder.

## Licence

MIT. The package also ships material from other projects under their own licences: the HPC registry draws on
Reference-LAPACK, ScaLAPACK, Open MPI, LLVM and others (BSD-style licences, MIT, Apache-2.0 with the LLVM
exception), and the code-block grammars on vscode-fortran-support (MIT). Their notices are in `registry/NOTICE` and
`shiki/NOTICE`.
Test corpora keep their own licences and are only fetched, never committed or shipped.
