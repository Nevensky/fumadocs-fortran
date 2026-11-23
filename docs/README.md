# fumadocs-fortran documentation

The documentation site of [fumadocs-fortran](../README.md), built with [Fumadocs](https://fumadocs.dev) on Next.js.
It uses the package from this repository (`"fumadocs-fortran": "file:.."`), so the docs always show the code
beside them. [CONTRIBUTING.md](CONTRIBUTING.md) covers working on the package and these pages: the tests, the house
style, which page documents which part of the code, and the release routine.

## Develop

The machine needs Docker, not Node: `scripts/docs.sh` runs the site in a `node:24-bookworm` container, with
`node_modules` in a Docker volume, and runs `npm install` itself when `package.json` or the lock file has changed.
From the repository root, start the development server, which reloads as you edit, at http://localhost:3000/docs:

```bash
scripts/docs.sh dev
```

Build the static export into `docs/out`:

```bash
scripts/docs.sh build
```

Stop a development server started elsewhere:

```bash
scripts/docs.sh stop
```

With Node 22.22 or later, `npm install` and `npm run dev` or `npm run build` here work too.

Restart the dev server after a change to the `exports` of the package's own `package.json`: Node reads a package's
`package.json` once per process, so an export added since does not resolve until then, and the pages that import
it fail.

## Content

- `content/docs/` holds the pages; each folder's `meta.json` orders the sidebar, and Previous and Next follow it. A
  separator (`---Guides---`) goes in with the first page under it, as a separator with no page under it still shows.
- `content/docs/showcase/modern/` and `content/docs/showcase/sources.mdx` are generated from `examples/modern` by
  `scripts/gen-showcase.mjs` (`npm run gen`) and are not edited by hand; CI fails when they differ from what it
  writes. `content/docs/showcase/index.mdx`, the Showcase's own page, is written by hand, and shows the script's
  options from its `// #region generate`. The page template gives the generated pages no edit link and no date.
- `content/docs/reference/doc-comments.mdx` includes its examples from `snippets/doc-comments/`: a Fortran file each
  and, beside it, the partial that `scripts/gen-examples.mjs` writes from it through the package's `generate()`
  (`npm run gen` writes them with the Showcase). Other files there, such as `units.md`, are read by the examples'
  `{!file!}` includes.
- `content/docs/reference/cli.mdx` includes the command's `--help` from `snippets/cli/help.txt`, which
  `node scripts/check-cli.mjs --write` writes from `bin/fumadocs-fortran.js`.
- `content/docs/reference/components.mdx` shows every component of `fumadocs-fortran/react` live, so a build checks
  that they all render.
- The site takes the package as Get started has a site take it: `lib/source.ts` gives the docs collection
  `fortranPageSchema` and `withFortran` (with remark-math, rehype-katex and the graphs) and the loader
  `fortranPlugin`; `components/mdx.tsx` registers `createFortranComponents` and `Mermaid`, beside `fumadocs-ui`'s
  Tabs, Steps, TypeTable, Accordions and Files; `app/global.css` imports `fumadocs-fortran/style.css`, before its own
  rules, so that they can override its variables, and `app/layout.tsx` KaTeX's stylesheet. `global.css` also gives
  the HDF5 badge of the Components page a meaning, as a site gives its own badges one, and, where the browser lacks
  CSS anchor positioning, leaves room under a row of badges that ends a tab, whose box would cut off their cards.
- The site uses the package from this repository (`file:..`), which npm links into `node_modules`. Node.js and
  Turbopack resolve what the package's files import (`fumadocs-core`, `pele`, React) from where those files are, the
  repository's top folder, so the site's `postinstall`, `scripts/link-package.mjs`, links the top folder's
  `node_modules` to the site's, which `.gitignore` leaves out. An installed copy needs nothing of the kind.
- `lib/source.ts` adds Fumadocs' `remarkSteps`: headings written `## 1. Title [#id]` become numbered steps, and each
  needs its explicit id, as the plugins run after the headings have their ids. It also drops the headings of depth 1
  of the files a page includes whole, `CHANGELOG.md` and `docs/CONTRIBUTING.md`, from the page and its Markdown copy:
  the page's title stands for them. No page writes a heading of depth 1 of its own.
- The graphs are ```` ```mermaid ```` blocks, which `withFortran`'s `graphs` (in `lib/source.ts`) hands to the
  `Mermaid` component of `fumadocs-fortran/mermaid`; it draws them as SVG at build time with
  [Pele](https://github.com/obsidianmd/pele), with a second layout for phones (`narrow`), and shows a diagram Pele
  cannot parse as its code. `fumadocs-fortran/style.css` maps Pele's colours to Fumadocs' for every diagram it draws
  and colours the generated graphs' nodes by kind. `fortranPlugin` reads the generated pages' `fortran` front matter,
  which `fortranPageSchema` keeps, for the letters in their tables of contents and in the sidebar. Ahead of
  `DocsPage`, the page template renders a hidden element with the class of fumadocs-ui's table of contents, which
  gives a long page the table of contents' column from its first paint, as Large references shows;
  `scripts/check-docs.mjs` holds the class to fumadocs-ui's.
- `withFortran` gives search the text of the Fortran components and leaves their tags out
  (`remarkStructureOptions.filterElement`). `test/site.test.mjs` checks the pages' records against Fumadocs' own,
  reading them through `scripts/search/records.mjs`, which leaves remark-image out, as images never reach the
  records, and `scripts/search/measure.mjs` measures the index both ways. The sidebar keeps Next's prefetch, as the
  Showcase pages are small.
- Links that next/link does not draw get what it would give them, the base path and, in the static export, a page's
  trailing slash, from `siteHref` in `lib/shared.ts`: those of hover cards, source headers and graph nodes through
  the `href` of `createFortranComponents` and `Mermaid` in `components/mdx.tsx`, and those of the llms files and the
  pages' Markdown copies in `lib/source.ts`. `components/mdx.tsx` is server only (`import 'server-only'`), as the
  trailing slash depends on `DOCS_EXPORT`, which the browser's bundle does not have.

## Around the pages

- `lib/shared.ts` holds what several places show: the package's status sentence (`statusSentence`), which the home
  page and the footer show and the Introduction, Get started and the README carry word for word; the site's name,
  description and links; and `absoluteUrl`, which gives a path on the site its origin, from `NEXT_PUBLIC_SITE_URL`.
- `components/credits.tsx` is the footer of every page, outside its main content: the credits, the status and the
  privacy line. A docs page's own foot (`components/page-footer.tsx`) has Edit this page on GitHub and the date of
  its last commit (`lastModified` in `lib/source.ts`, from git log, so a build needs the repository's history:
  `fetch-depth: 0` in a workflow's checkout), both left out on the generated pages, and Report a problem with this
  page.
- `lib/layout.shared.tsx` gives the top links: Get started, Docs and Showcase in the home layout's navbar, and none in
  the docs layout, whose sidebar holds those pages.
- `app/not-found.tsx` is the 404 page, in the home layout, which the export writes as `404.html` for GitHub Pages to
  serve. Next sends it with every page and loads its client components on each, so it has few: the home layout,
  `fumadocs-ui`'s search button and the report link (`components/report-broken-link.tsx`).
- Every page has a canonical link and Open Graph tags with absolute URLs, through `siteHref` and `metadataBase`
  (`app/layout.tsx`), and an Open Graph image (`app/og/`) whose description is cut, at a word, to fit under its title.
- `app/sitemap.ts` writes `sitemap.xml` with every page's absolute URL. There is no `robots.txt`: a site served under
  a path of a host, as on GitHub Pages, cannot own the host's.
- `app/llms.txt/route.ts` writes `llms.txt`: the title and description of `content/docs/meta.json`, the pages in
  sidebar order with absolute links to their Markdown copies, and an Optional section with `llms-full.txt`.
- `app/api/search.json/route.ts` exports the search index as `api/search.json`, which the search dialog
  (`components/search.tsx`) fetches under the base path; its extension lets a server that compresses by type send it
  compressed.
- `app/global.css` darkens Fumadocs' muted text and focus ring in light mode, which fall short of WCAG's contrast
  otherwise, and shows the skip links when they have keyboard focus.

## Deploy

`DOCS_EXPORT=1` builds a static site into `out/`, as `scripts/docs.sh build` does. For GitHub Pages, also set
`NEXT_PUBLIC_BASE_PATH=/<repository>` and `NEXT_PUBLIC_SITE_URL=https://<owner>.github.io`. `npm run build` first runs
`npm run check` (prebuild), the checks of the pages against the code that
[CONTRIBUTING.md](CONTRIBUTING.md#run-the-tests) lists. With `DOCS_EXPORT=1`, it then checks `out/` with
`scripts/check-links.mjs` (postbuild): every link and asset under `NEXT_PUBLIC_BASE_PATH`, the same-page anchors, the
Markdown URL of Copy Markdown and View as Markdown, the search index (a `.json` file, whose path under the base path a
client chunk names), and the absolute URLs of the metadata, the sitemap and `llms.txt`, on `NEXT_PUBLIC_SITE_URL`. By
hand:

```bash
node scripts/check-links.mjs out /fumadocs-fortran
```

`.github/workflows/docs.yml` builds and deploys the site to GitHub Pages. It needs one setting in the repository:
Settings, Pages, Build and deployment, Source: GitHub Actions. Search runs in the browser on an index built at build
time.
