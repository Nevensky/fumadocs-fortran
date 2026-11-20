import { createGetUrl } from 'fumadocs-core/source';

export const appName = 'fumadocs-fortran';
export const appDescription =
  'Fortran API reference for fumadocs: FORD, Doxygen and LAPACK doc comments, and HPC code (OpenMP, OpenACC, MPI, BLAS, LAPACK).';
export const docsRoute = '/docs';
// a sub-path the site is served from (GitHub Pages), for URLs that do not go through next/link
export const basePath = process.env.NEXT_PUBLIC_BASE_PATH ?? '';
export const docsImageRoute = '/og/docs';
export const docsContentRoute = '/llms.mdx/docs';

export const gitConfig = {
  user: 'Nevensky',
  repo: 'fumadocs-fortran',
  branch: 'main',
};
export const githubUrl = `https://github.com/${gitConfig.user}/${gitConfig.repo}`;

// who makes the package: shown under every page and in the site's metadata
export const author = {
  name: 'Neven Golenić',
  displayName: 'Dr. Neven Golenić',
  url: 'https://github.com/Nevensky',
};
export const copyrightYear = 2026;
export const licenseUrl = `${githubUrl}/blob/${gitConfig.branch}/LICENSE`;
export const citationUrl = `${githubUrl}/blob/${gitConfig.branch}/CITATION.cff`;
// thanks.dev; .github/FUNDING.yml points GitHub's Sponsor button at the same page
export const fundingUrl = 'https://thanks.dev/u/gh/nevensky';

const getContentUrl = createGetUrl(docsContentRoute);

export function getPageMarkdownUrl(page: { slugs: string[]; locale?: string }) {
  const segments = [...page.slugs, 'content.md'];

  return { segments, url: basePath + getContentUrl(segments, page.locale) };
}

const getImageUrl = createGetUrl(docsImageRoute);

export function getPageImageUrl(page: { slugs: string[]; locale?: string }) {
  const segments = [...page.slugs, 'image.png'];

  return { segments, url: basePath + getImageUrl(segments, page.locale) };
}
