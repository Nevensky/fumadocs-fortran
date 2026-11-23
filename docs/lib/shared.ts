import { createGetUrl } from 'fumadocs-core/source';

export const appName = 'fumadocs-fortran';
// the site's description, in its metadata and on the home page's Open Graph image; content/docs/meta.json gives
// llms.txt the same words
export const appDescription =
  'Fortran API reference for Fumadocs: FORD, Doxygen and LAPACK doc comments, and HPC code (OpenMP, OpenACC, MPI, BLAS, LAPACK).';
// the home page's title, which the root layout's metadata gives it
export const appTitle = `${appName}: Fortran API reference for Fumadocs`;
/**
 * The package's status, in one sentence: on the home page, under its buttons, and in every page's footer. The
 * Introduction's callout, Get started's Pre-release callout and the README carry it word for word; the release routine
 * (docs/CONTRIBUTING.md) changes them together.
 */
export const statusSentence =
  'fumadocs-fortran installs from GitHub, and its pages, options and components can change in any 0.x version.';
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
 * A line with `edit` applied to its text outside inline code spans, which are samples, as code blocks are. A span is a
 * run of backticks and the text up to the next run of as many; a run with no such partner is text.
 */
function outsideCode(line: string, edit: (text: string) => string): string {
  const runs = [...line.matchAll(/`+/g)];
  let out = '';
  let last = 0;
  for (let i = 0; i < runs.length; i++) {
    const close = runs.findIndex((r, j) => j > i && r[0].length === runs[i][0].length);
    if (close < 0) continue;
    const start = runs[i].index ?? 0;
    const end = (runs[close].index ?? 0) + runs[close][0].length;
    out += edit(line.slice(last, start)) + line.slice(start, end);
    last = end;
    i = close;
  }
  return out + edit(line.slice(last));
}

/**
 * Markdown whose links to the site are siteHref's, for the llms files and the pages' Markdown copies. A code block is
 * a sample, such as the MDX the generator writes on the Components page, and keeps its links as written, and so does
 * inline code; a graph's own ```mermaid block is the graph, whose click lines are links of the page. A ```mermaid
 * block inside a sample is the sample's.
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
      return outsideCode(line, (text) => text.replace(SITE_LINK, link));
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
  displayName: 'Neven Golenić',
  url: 'https://github.com/Nevensky',
};
export const copyrightYear = 2026;
export const licenseUrl = `${githubUrl}/blob/${gitConfig.branch}/LICENSE`;
// the licences of the third-party material the package ships, which the registry's cards show on every site that
// generates its reference with them (registry/SOURCES.md lists the sources; shiki/NOTICE covers the grammars)
export const noticesUrl = `${githubUrl}/blob/${gitConfig.branch}/registry/NOTICE`;
export const citationUrl = `${githubUrl}/blob/${gitConfig.branch}/CITATION.cff`;
// thanks.dev; .github/FUNDING.yml points GitHub's Sponsor button at the same page
export const fundingUrl = 'https://thanks.dev/u/gh/nevensky';
export const issuesUrl = `${githubUrl}/issues`;
// what changed in each version, which the status sentence points to: the Changelog page, which includes CHANGELOG.md
export const changelogRoute = `${docsRoute}/changelog`;

/** A page's file on GitHub, opened for editing: `path` is its path under content/docs, as fumadocs gives it. */
export function editUrl(path: string) {
  return `${githubUrl}/edit/${gitConfig.branch}/docs/content/docs/${encodeURI(path)}`;
}

/**
 * An issue about this site, to open on GitHub in the documentation form (.github/ISSUE_TEMPLATE/documentation.yml),
 * which labels it: its title, the page's address and, if given, what is wrong filled in, each form field by its id.
 */
export function reportUrl(title: string, page: string, problem?: string) {
  const query = new URLSearchParams({ template: 'documentation.yml', title, page, ...(problem ? { problem } : {}) });
  return `${githubUrl}/issues/new?${query}`;
}

// the site's origin, for the absolute URLs of its metadata (canonical links, Open Graph, the sitemap, llms.txt): set
// when it is built for a host (|| and not ??, as an empty value is not a URL)
export const siteUrl = process.env.NEXT_PUBLIC_SITE_URL || 'http://localhost:3000';

/** A path on this site as an absolute URL: siteHref's link (the base path, the export's slash) on siteUrl's origin. */
export function absoluteUrl(href: string): string {
  return new URL(siteHref(href), siteUrl).href;
}

// what every page's Open Graph tags share (a page's openGraph replaces the root layout's, rather than adding to it)
export const openGraphBase = { siteName: appName, locale: 'en_GB' };

/** The site's own Open Graph card: the home page's, and the root layout's for a page that gives none. */
export function siteOpenGraph() {
  return {
    ...openGraphBase,
    type: 'website' as const,
    title: appTitle,
    description: appDescription,
    images: siteHref('/og/image.png'),
  };
}

/**
 * `text` in at most `max` characters, cut after a word, with an ellipsis: the description on a page's Open Graph image,
 * which has room for about 140 characters under a title of one line, and in its og:description; its meta description
 * at 160.
 */
export function clampText(text: string, max?: number): string;
export function clampText(text: string | undefined, max?: number): string | undefined;
export function clampText(text: string | undefined, max = 140): string | undefined {
  if (!text || text.length <= max) return text;
  const cut = text.slice(0, max);
  const word = cut.lastIndexOf(' ');
  const kept = word > max / 2 ? cut.slice(0, word) : cut.slice(0, max - 1);
  return `${kept.replace(/[\s,;:.\u2013\u2014-]+$/, '')}\u2026`;
}

const getContentUrl = createGetUrl(docsContentRoute);

/**
 * The page's Markdown copy, for Copy Markdown and View as Markdown. Its URL has no base path: fumadocs-ui's page
 * actions put import.meta.env.BASE_URL, the base path, in front of it (scripts/check-links.mjs checks the result).
 */
export function getPageMarkdownUrl(page: { slugs: string[]; locale?: string }) {
  const segments = [...page.slugs, 'content.md'];

  return { segments, url: getContentUrl(segments, page.locale) };
}

const getImageUrl = createGetUrl(docsImageRoute);

export function getPageImageUrl(page: { slugs: string[]; locale?: string }) {
  const segments = [...page.slugs, 'image.png'];

  return { segments, url: basePath + getImageUrl(segments, page.locale) };
}
