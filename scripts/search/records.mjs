// The search records of MDX pages as the docs site's search index reads them, under the site's own MDX options and
// under fumadocs' defaults. docs/lib/source.ts is bundled with esbuild, with fumadocs-mdx's defineDocs macro replaced
// by one that keeps the options it is given. A page is compiled as fumadocs-mdx compiles the pages of a collection,
// whose outputs are functions of the page's props (unstable_runtimeOutputs), up to the remark stage, where
// remark-structure writes the records: the rehype plugins (KaTeX, Shiki) leave them alone. They are then read with
// fumadocs-mdx's own runtime, as createFromSource reads page.data.structuredData for the static index. remark-image is
// left out, both ways: fumadocs leaves images out of the records anyway, and with it a page's code would import each
// image (from the public folder of the current directory, or from beside the page), which Node cannot run, and would
// fetch the size of an image on another site. Needs the site's node_modules (esbuild, fumadocs-mdx, @mdx-js/mdx,
// React).
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import { pathToFileURL } from 'node:url';

/**
 * The docs site's MDX setup, bundled into `out`.
 *
 * @returns {Promise<{ records(mdx: string, which: 'site' | 'defaults'): Promise<object>, remarkStructure: object,
 *   createSearchAPI: Function }>} `records` gives a page's structured data (the front matter is read apart, as
 *   fumadocs-mdx does); `remarkStructure` holds the options the site gives remark-structure
 */
export async function loadSite({ docs, out }) {
  const need = createRequire(path.join(docs, 'package.json'));
  const esbuild = need('esbuild');
  const repo = path.dirname(docs);
  const exportsMap = JSON.parse(fs.readFileSync(path.join(repo, 'package.json'), 'utf8')).exports;
  fs.mkdirSync(out, { recursive: true });
  const entry = path.join(out, 'records-entry.mjs');
  fs.writeFileSync(entry, [
    `import ${JSON.stringify(path.join(docs, 'lib/source.ts'))};`,
    "export { kept } from 'fumadocs-mdx/macro';",
    "export { compile, run } from '@mdx-js/mdx';",
    "export * as runtime from 'react/jsx-runtime';",
    "export { server } from 'fumadocs-mdx/runtime/server';",
    "export { remarkImage, remarkStructure } from 'fumadocs-core/mdx-plugins';",
    "export { createSearchAPI } from 'fumadocs-core/search/server';",
  ].join('\n'));
  const site = {
    name: 'site',
    setup(b) {
      // the macro, which only fumadocs-mdx's bundler plugin compiles: keep the collection's options
      b.onResolve({ filter: /^fumadocs-mdx\/macro$/ }, () => ({ path: 'macro', namespace: 'stub' }));
      b.onLoad({ filter: /^macro$/, namespace: 'stub' }, () => ({
        contents: ['export const kept = {};', 'export function defineDocs(options) {', '  kept.docs = options;',
          '  return { toFumadocsSource: () => ({ files: [] }) };', '}'].join('\n'),
        loader: 'js',
      }));
      // the package from this repository, whatever docs/node_modules links to
      b.onResolve({ filter: /^fumadocs-fortran(\/.*)?$/ }, (a) => {
        const target = exportsMap[`.${a.path.slice('fumadocs-fortran'.length)}`];
        const file = typeof target === 'string' ? target : target?.default;
        return file ? { path: path.join(repo, file) } : undefined;
      });
      b.onResolve({ filter: /^server-only$/ }, () => ({ path: 'server-only', namespace: 'empty' }));
      b.onLoad({ filter: /.*/, namespace: 'empty' }, () => ({ contents: '' }));
    },
  };
  const bundle = path.join(out, 'records.mjs');
  await esbuild.build({
    entryPoints: [entry], outfile: bundle, bundle: true, format: 'esm', platform: 'node', jsx: 'automatic',
    logLevel: 'silent', plugins: [site], nodePaths: [path.join(docs, 'node_modules')],
    // CommonJS inside an ES module bundle: its require() calls need one
    banner: { js: "import { createRequire as __cr } from 'node:module'; const require = __cr(import.meta.url);" },
  });
  const m = await import(`${pathToFileURL(bundle).href}?${Date.now()}`);
  // the collection's options: applyMdxPreset's function of the build environment, as fumadocs-mdx's bundler calls it
  const given = m.kept.docs?.docs?.mdxOptions;
  if (!given) throw new Error('docs/lib/source.ts gives its docs collection no mdxOptions');
  const preset = typeof given === 'function' ? await given('bundler') : given;
  const plugin = (p) => (Array.isArray(p) ? p[0] : p);
  const options = { ...preset, remarkPlugins: preset.remarkPlugins.filter((p) => plugin(p) !== m.remarkImage) };
  const isStructure = (p) => plugin(p) === m.remarkStructure;
  const entries = options.remarkPlugins.filter(isStructure);
  if (entries.length !== 1) throw new Error(`the site's MDX options have ${entries.length} remark-structure entries`);
  const own = Array.isArray(entries[0]) ? entries[0][1] ?? {} : {};
  // fumadocs' defaults: the same plugins, with remark-structure's options as the preset gives them without the site's
  const defaults = [m.remarkStructure, { exportAs: own.exportAs }];
  const sets = {
    site: options,
    defaults: { ...options, remarkPlugins: options.remarkPlugins.map((p) => (isStructure(p) ? defaults : p)) },
  };
  const baseUrl = pathToFileURL(`${out}/`).href;
  return {
    remarkStructure: own,
    createSearchAPI: m.createSearchAPI,
    async records(mdx, which) {
      const head = /^---\r?\n[\s\S]*?\r?\n---\r?\n/.exec(mdx);
      const file = { value: head ? mdx.slice(head[0].length) : mdx, path: path.join(out, 'page.mdx'),
        data: { unstable_runtimeOutputs: true } };
      const code = String(await m.compile(file, {
        ...sets[which], rehypePlugins: [], outputFormat: 'function-body', development: false,
      }));
      const exports = await m.run(code, { ...m.runtime, baseUrl });
      const [page] = await m.server().doc('docs', '', { 'page.mdx': exports });
      return page.structuredData;
    },
  };
}
