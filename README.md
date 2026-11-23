# fumadocs-fortran

Fortran API reference for [Fumadocs](https://www.fumadocs.dev/). It reads Fortran sources with its own parser, written
in plain JavaScript with no dependencies, and writes their API reference as MDX pages that a Fumadocs site builds like
its hand-written pages. It reads the doc comments that projects write in FORD, Doxygen and LAPACK style, and it
understands high-performance computing (HPC) code: OpenMP and OpenACC directives, MPI and coarrays, the conditions of
the C preprocessor (cpp), and calls into BLAS, LAPACK and ScaLAPACK.

**Pre-release.** fumadocs-fortran installs from GitHub, and its pages, options and components can change in any 0.x
version.

The documentation is at [nevensky.github.io/fumadocs-fortran](https://nevensky.github.io/fumadocs-fortran/).

## Install

The package needs Node.js 18 or later, and npm runs Git to install it from GitHub. A Fumadocs site needs Node.js 22.22
or a later 22 release, or Node.js 24.11 or later. Install the package in the site's folder, such as `docs/` in your
project:

```bash
npm install github:Nevensky/fumadocs-fortran --allow-git=root
```

npm 12 installs a package from GitHub only with `--allow-git=root`; npm 10 and 11 do not need the flag, and npm
11.12.1 refuses the install even with it
([Troubleshooting](https://nevensky.github.io/fumadocs-fortran/docs/guides/troubleshooting/#eallowgit-non-root)). To
pin a commit, write it after a `#`: `github:Nevensky/fumadocs-fortran#<commit>`.

[Get started](https://nevensky.github.io/fumadocs-fortran/docs/get-started/) adds the reference to a Fumadocs site,
as Fumadocs' own integrations are added: the package's MDX options and loader plugin in the site's content source,
its components and its stylesheet. [Start a new site](https://nevensky.github.io/fumadocs-fortran/docs/new-site/)
makes a site for a project without one.

## Documentation

- [Get started](https://nevensky.github.io/fumadocs-fortran/docs/get-started/): from the Fortran in your `src/` to its
  API reference in your Fumadocs site.
- [Start a new site](https://nevensky.github.io/fumadocs-fortran/docs/new-site/): a Fumadocs site in a `docs/` folder
  of your project, from Fumadocs' static template.
- [Set up your site](https://nevensky.github.io/fumadocs-fortran/docs/guides/site-setup/): maths and graphs on the
  generated pages, and updates of the package.
- [Generate the reference](https://nevensky.github.io/fumadocs-fortran/docs/guides/generate/): the build to document,
  with its cpp macros and include folders, what the pages show, the links to your repository, and running it again.
- [Move from FORD or Doxygen](https://nevensky.github.io/fumadocs-fortran/docs/guides/from-ford-doxygen/): what carries
  over from a FORD project file or a Doxyfile, and what works differently.
- [Publish on GitHub Pages](https://nevensky.github.io/fumadocs-fortran/docs/guides/github-pages/): the site at your
  repository's GitHub Pages address, built by a workflow.
- [Large references](https://nevensky.github.io/fumadocs-fortran/docs/guides/large-references/): a search index named
  `search.json` for the servers that compress by type, no prefetching of large pages, and no layout shift on long
  ones.
- [Troubleshooting](https://nevensky.github.io/fumadocs-fortran/docs/guides/troubleshooting/): each message or symptom,
  its cause and its fix.
- [Command line](https://nevensky.github.io/fumadocs-fortran/docs/reference/cli/): `dump` and `generate`, with every
  option, default, message and exit code.
- [JavaScript API](https://nevensky.github.io/fumadocs-fortran/docs/reference/javascript/): the exported functions,
  `generate`, `extract` and `parseSource` among them, and the options that have no flag.
- [Doc comments](https://nevensky.github.io/fumadocs-fortran/docs/reference/doc-comments/): what is read in FORD,
  Doxygen and LAPACK style, and what it becomes.
- [Components](https://nevensky.github.io/fumadocs-fortran/docs/reference/components/): the badges, the tables whose
  rows open, the hover cards and meanings, the library cards from the HPC registry, the source blocks and graphs, and
  their styling.
- [Highlighting](https://nevensky.github.io/fumadocs-fortran/docs/reference/highlighting/): `fumadocs-fortran/shiki`,
  Shiki grammars for Fortran in free and fixed form that highlight OpenMP, OpenACC, CUDA Fortran and compiler
  directives, and fypp, in any Fumadocs or Shiki site.
- [Generated files](https://nevensky.github.io/fumadocs-fortran/docs/reference/generated-files/): every file
  `generate` writes, its name, front matter and anchors, and how a later run treats it.
- [How it works](https://nevensky.github.io/fumadocs-fortran/docs/how-it-works/): from the sources to the pages, one
  build at a time, the library names, the graphs and what the model leaves out.
- [Showcase](https://nevensky.github.io/fumadocs-fortran/docs/showcase/): the reference generated for
  `examples/modern`, beside its sources.
- [Changelog](https://nevensky.github.io/fumadocs-fortran/docs/changelog/) and
  [Contributing](https://nevensky.github.io/fumadocs-fortran/docs/contributing/).

A site takes the package through its entry points: `fumadocs-fortran/mdx` (`withFortran` and `fortranPageSchema`)
and `fumadocs-fortran/source` (`fortranPlugin`) in its content source, `fumadocs-fortran/react` and
`fumadocs-fortran/mermaid` among its MDX components, and `fumadocs-fortran/style.css` in its global CSS.
[JavaScript API](https://nevensky.github.io/fumadocs-fortran/docs/reference/javascript/) has each of them.

## Acknowledgements

fumadocs-fortran is built on [Fumadocs](https://www.fumadocs.dev/), the documentation framework by
[Fuma Nama](https://github.com/fuma-nama), which is MIT-licensed too: the pages it writes are Fumadocs pages, and its
documentation site is a Fumadocs site.

## Licence

MIT ([LICENSE](https://github.com/Nevensky/fumadocs-fortran/blob/main/LICENSE)). The package also ships material from
other projects under their own licences: the HPC registry draws on Reference-LAPACK, ScaLAPACK, Open MPI, LLVM and
others (BSD-style licences, MIT, Apache-2.0 with the LLVM exception), and the code-block grammars on
vscode-fortran-support (MIT). Their notices are in
[registry/NOTICE](https://github.com/Nevensky/fumadocs-fortran/blob/main/registry/NOTICE) and
[shiki/NOTICE](https://github.com/Nevensky/fumadocs-fortran/blob/main/shiki/NOTICE), and
[registry/SOURCES.md](https://github.com/Nevensky/fumadocs-fortran/blob/main/registry/SOURCES.md) lists the registry's
sources. Test corpora keep their own licences and are only fetched, never committed or shipped.

## Citing, issues and contributing

- To cite fumadocs-fortran, use
  [CITATION.cff](https://github.com/Nevensky/fumadocs-fortran/blob/main/CITATION.cff), or GitHub's "Cite this
  repository".
- Report a problem in the [issues](https://github.com/Nevensky/fumadocs-fortran/issues); for one in the
  documentation, use its [form](https://github.com/Nevensky/fumadocs-fortran/issues/new?template=documentation.yml).
- [docs/CONTRIBUTING.md](https://github.com/Nevensky/fumadocs-fortran/blob/main/docs/CONTRIBUTING.md) says how to work
  on the package and its documentation.
