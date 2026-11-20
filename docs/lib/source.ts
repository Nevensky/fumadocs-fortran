import { llms, loader } from 'fumadocs-core/source';
import type * as PageTree from 'fumadocs-core/page-tree';
import { lucideIconsPlugin } from 'fumadocs-core/source/lucide-icons';
import { docsRoute, siteHref, siteLinks } from './shared';
import { defineDocs } from 'fumadocs-mdx/macro';
import { applyMdxPreset } from 'fumadocs-mdx/config';
import { metaSchema, pageSchema } from 'fumadocs-core/source/schema';
import { rehypeCodeDefaultOptions, remarkMdxMermaid } from 'fumadocs-core/mdx-plugins';
import { z } from 'zod';
import remarkMath from 'remark-math';
import rehypeKatex from 'rehype-katex';
import { katexMacros } from 'fumadocs-fortran/math';
import { fortranRehypeCode } from 'fumadocs-fortran/shiki';

// the commands Fortran docs write that KaTeX lacks (the physics package, \mathbbm, \vv, …); a copy, as KaTeX adds
// a page's \gdef to the object it is given
const katex: [typeof rehypeKatex, { macros: Record<string, string> }] = [rehypeKatex, { macros: { ...katexMacros } }];

const docs = defineDocs({
  dir: 'content/docs',
  docs: {
    // keep the fumadocs defaults and add $…$ and $$…$$ maths (a collection-level mdxOptions replaces the defaults)
    // and ```mermaid diagrams; KaTeX runs before the syntax highlighter, so that maths blocks are not highlighted as
    // code
    mdxOptions: applyMdxPreset({
      remarkPlugins: [remarkMath, remarkMdxMermaid],
      rehypePlugins: (defaults) => [katex, ...defaults],
      // Fortran code blocks with the package's grammars: OpenMP, OpenACC and other directive lines are highlighted
      // and marked, and fumadocs' [!code …] notations work in ! comments. fumadocs' own options are the base, since
      // rehypeCode replaces its default transformers with the ones it is given.
      rehypeCodeOptions: fortranRehypeCode(rehypeCodeDefaultOptions),
    }),
    // generated API pages say what each heading is (fortran.toc), for the kind letters in the table of contents
    schema: pageSchema.extend({
      fortran: z.object({ kind: z.string().optional(), toc: z.record(z.string(), z.string()).optional() }).optional(),
    }),
    postprocess: {
      includeProcessedMarkdown: true,
    },
  },
  meta: {
    schema: metaSchema,
  },
});

// See https://fumadocs.dev/docs/headless/source-api for more info
export const source = loader({
  baseUrl: docsRoute,
  source: docs.toFumadocsSource(),
  plugins: [lucideIconsPlugin()],
});

function firstPage(nodes: PageTree.Node[], prefix: string): string | undefined {
  for (const node of nodes) {
    if (node.type === 'page' && node.url.startsWith(prefix)) return node.url;
    if (node.type === 'folder') {
      const url = node.index?.url.startsWith(prefix) ? node.index.url : firstPage(node.children, prefix);
      if (url) return url;
    }
  }
}

/** The first Showcase page in sidebar order (the pages are generated, so their names are not fixed), if there is one. */
export function getShowcaseUrl(): string | undefined {
  return firstPage(source.getPageTree().children, `${docsRoute}/showcase/`);
}

// The llms files and the Markdown copies of the pages hold plain links, which next/link never sees, so they get here
// what it would give them: the base path the site is served under (GitHub Pages) and, in the static export, a page's
// trailing slash. In the index, in each page's heading, and in its links (siteLinks): Markdown links, href attributes,
// the click lines of graph nodes and the hover cards of argument rows, but not those of code samples.
export const docsLlms = llms(source, {
  renderUrl: (item) => siteHref(item.url),
  renderPage: async (page) => `# ${page.data.title} (${siteHref(page.url)})

${siteLinks(await page.data.getText('processed'))}`,
});
