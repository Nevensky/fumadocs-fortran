# fumadocs-fortran documentation

The documentation site of [fumadocs-fortran](../README.md), built with [fumadocs](https://fumadocs.dev) on Next.js.
It uses the package from this repository (`"fumadocs-fortran": "file:.."`), so the docs always show the code
beside them.

## Develop

The machine needs Docker, not Node: `scripts/docs.sh` runs the site in a `node:24-bookworm` container, with
`node_modules` in a Docker volume, and runs `npm install` itself when `package.json` or the lock file has changed.
From the repository root:

```bash
scripts/docs.sh dev     # http://localhost:3000/docs, reloading as you edit
scripts/docs.sh build   # a static export into docs/out
scripts/docs.sh stop    # stops a dev server started elsewhere
```

With Node 22.22 or later, `npm install` and `npm run dev` or `npm run build` here work too.

Restart the dev server after a change to the `exports` of the package's own `package.json`: Node reads a package's
`package.json` once per process, so a new export does not resolve until then, and the pages that import it fail.

## Content

- `content/docs/` holds the pages; each folder's `meta.json` orders the sidebar.
- `content/docs/showcase/` is generated from `examples/modern` by `scripts/gen-showcase.mjs` (`npm run gen`) and is
  not edited by hand.
- `content/docs/reference/components.mdx` shows every component of `fumadocs-fortran/react` live, so a build checks
  that they all render.
- The site registers `fortranComponents` and fumadocs-ui's Tabs, Steps, TypeTable, Accordions and Files for MDX in
  `components/mdx.tsx`, adds remark-math, rehype-katex and the Fortran grammars of `fumadocs-fortran/shiki` in
  `lib/source.ts`, and imports KaTeX's stylesheet and `fumadocs-fortran/style.css` in `app/layout.tsx`, before
  `global.css`, so that `global.css` can override their variables.

## Deploy

`DOCS_EXPORT=1` builds a static site into `out/`, as `scripts/docs.sh build` does. For GitHub Pages, also set
`NEXT_PUBLIC_BASE_PATH=/<repository>` and `NEXT_PUBLIC_SITE_URL=https://<owner>.github.io`. Search runs in the
browser on an index built at build time.
