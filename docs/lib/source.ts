import { llms, loader } from 'fumadocs-core/source';
import { lucideIconsPlugin } from 'fumadocs-core/source/lucide-icons';
import { absoluteUrl, docsRoute, getPageMarkdownUrl, siteHref, siteLinks } from './shared';
import { defineDocs } from 'fumadocs-mdx/macro';
import { applyMdxPreset } from 'fumadocs-mdx/config';
import { metaSchema, pageSchema } from 'fumadocs-core/source/schema';
import { remarkSteps } from 'fumadocs-core/mdx-plugins';
import remarkMath from 'remark-math';
import rehypeKatex from 'rehype-katex';
import { fortranPageSchema, withFortran } from 'fumadocs-fortran/mdx';
import { fortranPlugin } from 'fumadocs-fortran/source';

type MdNode = { type: string; depth?: number; children?: MdNode[] };

/**
 * Drops the headings of depth 1: those of the files a page includes whole, CHANGELOG.md and docs/CONTRIBUTING.md,
 * whose title the page's own stands for (a page writes none of its own). It runs after remarkInclude and before the
 * table of contents and the search records are made, so neither holds them.
 */
function remarkDropTitles() {
  const drop = (node: MdNode) => {
    if (!node.children) return;
    node.children = node.children.filter((child) => !(child.type === 'heading' && child.depth === 1));
    node.children.forEach(drop);
  };
  return (tree: unknown) => drop(tree as MdNode);
}

const docs = defineDocs({
  dir: 'content/docs',
  docs: {
    // keep the fumadocs defaults (a collection-level mdxOptions replaces them, applyMdxPreset keeps them) and add
    // fumadocs-fortran's (withFortran): the Fortran grammars in the code blocks, the components' text rather than their
    // tags in the search records, $…$ and $$…$$ maths, set by KaTeX before the code blocks with the package's macros,
    // and ```mermaid diagrams; and the site's own: the included files' titles dropped, and steps. remarkSteps makes
    // the headings written `## 1. Title [#id]` a list of numbered steps, and drops the number from the heading; the
    // explicit id is needed, as these plugins run after remarkHeading, which would otherwise slug the heading with its
    // number (1-title).
    mdxOptions: applyMdxPreset(
      withFortran({
        math: { remarkMath, rehypeKatex },
        graphs: true,
        remarkPlugins: [remarkDropTitles, remarkSteps],
      }),
    ),
    // generated API pages say what each heading is (fortran.toc), for the kind letters in the table of contents
    schema: fortranPageSchema(pageSchema),
    postprocess: {
      includeProcessedMarkdown: true,
    },
    // page.data.lastModified: the date of the last commit that changed the page, from git log (undefined where the
    // folder is no Git checkout, as in a container that mounts a worktree), for the Last updated line and the sitemap
    lastModified: true,
  },
  meta: {
    schema: metaSchema,
  },
});

// See https://fumadocs.dev/docs/headless/source-api for more info
// fortranPlugin: the kind letters of the generated pages, in their tables of contents and in the sidebar
export const source = loader({
  baseUrl: docsRoute,
  source: docs.toFumadocsSource(),
  plugins: [fortranPlugin(), lucideIconsPlugin()],
});

/**
 * Whether a page is generated (the Showcase's reference and its sources page, which docs/scripts/gen-showcase.mjs
 * writes): its file on GitHub is no page to edit, and its last commit dates the generator's run, not the page.
 */
export function isGenerated(page: { path: string }): boolean {
  return page.path.startsWith('showcase/modern/') || page.path === 'showcase/sources.mdx';
}

// The llms files and the Markdown copies of the pages hold plain links, which next/link never sees, so they get here
// what it would give them: the base path the site is served under (GitHub Pages) and, in the static export, a page's
// trailing slash. In each page's heading, and in its links (siteLinks): Markdown links, href attributes, the click
// lines of graph nodes and the hover cards of argument rows, but not those of code samples. llms.txt, which an agent
// reads on its own, links each page's Markdown copy with an absolute URL; its title and summary are those of
// content/docs/meta.json.
/**
 * A page's Markdown without the headings of depth 1 outside its code blocks: those of the files it includes, which
 * remarkDropTitles leaves out of its HTML, and which its Markdown copy carries as written.
 */
function withoutTitles(markdown: string): string {
  let fence = '';
  return markdown
    .split('\n')
    .filter((line) => {
      const f = /^\s*(`{3,}|~{3,})\s*(\S*)/.exec(line);
      if (fence) {
        if (f && f[1][0] === fence[0] && f[1].length >= fence.length && !f[2]) fence = '';
        return true;
      }
      if (f && !(f[1][0] === '`' && line.slice(line.indexOf(f[1]) + f[1].length).includes('`'))) fence = f[1];
      return fence || !/^# /.test(line);
    })
    .join('\n');
}

export const docsLlms = llms(source, {
  renderUrl: (item, { lang }) => {
    const page = source.getNodePage(item, lang);
    return absoluteUrl(page ? getPageMarkdownUrl(page).url : item.url);
  },
  renderPage: async (page) => `# ${page.data.title} (${siteHref(page.url)})

${siteLinks(withoutTitles(await page.data.getText('processed')))}`,
});
