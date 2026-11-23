// fumadocs-fortran/mdx: the MDX options and the page schema that a Fumadocs site's docs collection takes for the
// generated pages, in lib/source.ts (the macro API) or source.config.ts:
//
//   defineDocs({
//     dir: 'content/docs',
//     docs: { schema: fortranPageSchema(pageSchema), mdxOptions: applyMdxPreset(withFortran()) },
//   });
//
// It needs fumadocs-core, which every Fumadocs site has.

import {
  rehypeCode,
  rehypeCodeDefaultOptions,
  remarkMdxMermaid,
  remarkStructure,
  remarkStructureDefaultOptions,
} from 'fumadocs-core/mdx-plugins';
import { composeMdx, wrapSchema } from './compose.js';

const PLUGINS = {
  rehypeCode, rehypeCodeDefaultOptions, remarkMdxMermaid, remarkStructure, remarkStructureDefaultOptions,
};

/**
 * The MDX options for applyMdxPreset (a collection's mdxOptions) or defineConfig's mdxOptions: the site's own options,
 * with the Fortran grammars and transformers added to fumadocs' code blocks, the components' text, rather than their
 * tags, in the search records, and, on request, maths (`math`) and graphs (`graphs`).
 */
export function withFortran(options = {}) {
  return composeMdx(options, PLUGINS);
}

/**
 * A page schema that keeps the `fortran` field of the generated pages' frontmatter, whose kinds give the table of
 * contents its letters (fortranPlugin), on top of the site's own schema, such as fumadocs' pageSchema.
 */
export function fortranPageSchema(base) {
  return wrapSchema(base);
}
