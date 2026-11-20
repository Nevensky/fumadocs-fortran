import { fileURLToPath } from 'node:url';
import { createMDX } from 'fumadocs-mdx/next';

const withMDX = createMDX();

// The site uses the package from this repository (file:..), linked into node_modules from one folder up, so the
// build's root is the repository itself.
const root = fileURLToPath(new URL('..', import.meta.url));

// DOCS_EXPORT=1 builds a static site into out/ (GitHub Pages); NEXT_PUBLIC_BASE_PATH serves it from a sub-path,
// such as /fumadocs-fortran for https://<user>.github.io/fumadocs-fortran/
const exportSite = process.env.DOCS_EXPORT === '1';
const basePath = process.env.NEXT_PUBLIC_BASE_PATH || '';
// DOCS_POLL=<ms> makes the dev server poll for changed files, for a container in which Turbopack misses files
// changed on the host (scripts/docs.sh sets it)
const poll = Number(process.env.DOCS_POLL) || 0;

/** @type {import('next').NextConfig} */
const config = {
  reactStrictMode: true,
  turbopack: { root },
  outputFileTracingRoot: root,
  ...(poll > 0 ? { watchOptions: { pollIntervalMs: poll } } : {}),
  ...(exportSite ? { output: 'export', trailingSlash: true, images: { unoptimized: true } } : {}),
  ...(basePath ? { basePath } : {}),
};

export default withMDX(config);
