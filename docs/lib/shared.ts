import { createGetUrl } from 'fumadocs-core/source';

export const appName = 'fumadocs-fortran';
export const appDescription =
  'Fortran API reference for fumadocs: FORD, Doxygen and LAPACK doc comments, and HPC code (OpenMP, OpenACC, MPI, BLAS, LAPACK).';
export const docsRoute = '/docs';
// a sub-path the site is served from (GitHub Pages), for URLs that do not go through next/link
export const basePath = process.env.NEXT_PUBLIC_BASE_PATH ?? '';
// DOCS_EXPORT=1 builds the static export, whose pages next.config.mjs gives a trailing slash (…/solver_kernels/, the
// folder whose index.html GitHub Pages serves). It is no NEXT_PUBLIC variable, so the browser's bundle lacks it: only
// server components may call siteHref.
const trailingSlash = process.env.DOCS_EXPORT === '1';

/**
 * A link to this site as next/link writes it, for the links next/link never sees (hover cards, graph nodes, the llms
 * files): with the base path the site is served under and, in the static export, the trailing slash of a page before
 * its `?` or `#`, so that a link to an anchor of the page being read only scrolls, with no reload and no redirect. A
 * file (a last segment with a dot) gets no slash, as with next/link. A link that is no path on the site (https:,
 * //host, #anchor) is returned as it is.
 */
export function siteHref(href: string): string;
export function siteHref(href: string | undefined): string | undefined;
export function siteHref(href: string | undefined): string | undefined {
  if (!href?.startsWith('/') || href.startsWith('//')) return href;
  const cut = href.search(/[?#]/);
  const path = cut < 0 ? href : href.slice(0, cut);
  const slash = trailingSlash && !path.endsWith('/') && !/\.[^/]+$/.test(path) ? '/' : '';
  return basePath + path + slash + (cut < 0 ? '' : href.slice(cut));
}

// a path on the site after what starts a link in a page's Markdown: a Markdown link `](`, an href attribute (Card,
// FortranRef), a graph node's click line (`click n1 href "`) or a hover card in an argument row's refs (`"href":"`)
const SITE_LINK = /(\]\(|\bhref(?:"?\s*:\s*|\s*=\s*|\s+)["'])(\/(?!\/)[^\s"'()?#]*)/g;
// a line that opens or closes a fenced code block: its run of backticks or tildes, and the word after it
const FENCE = /^\s*(`{3,}|~{3,})\s*(\S*)/;

/**
 * Markdown whose links to the site are siteHref's, for the llms files and the pages' Markdown copies. A code block is
 * a sample, such as the MDX the generator writes on the Components page, and keeps its links as written; a graph's own
 * ```mermaid block is the graph, whose click lines are links of the page. A ```mermaid block inside a sample is the
 * sample's.
 */
export function siteLinks(markdown: string): string {
  const link = (_: string, before: string, path: string) => before + siteHref(path);
  // the run that opened the code block the line is in, and whether that block is a graph
  let fence = '';
  let graph = false;
  return markdown
    .split('\n')
    .map((line) => {
      const f = FENCE.exec(line);
      if (fence) {
        // the block ends at a run of its fence's character, at least as long, with nothing after it
        if (f && f[1][0] === fence[0] && f[1].length >= fence.length && !f[2]) fence = '';
        else if (graph) return line.replace(SITE_LINK, link);
        return line;
      }
      // backticks with another backtick after them on the line are inline code, not a fence
      if (f && !(f[1][0] === '`' && line.slice(line.indexOf(f[1]) + f[1].length).includes('`'))) {
        fence = f[1];
        graph = f[2].toLowerCase() === 'mermaid';
        return line;
      }
      return line.replace(SITE_LINK, link);
    })
    .join('\n');
}

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
