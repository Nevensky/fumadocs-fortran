// node test/shiki/fumadocs-order.mjs <fumadocs-core package> <scenario> — one load order through fumadocs' rehypeCode,
// in a process of its own (its highlighter is shared by the whole process). Prints { version, blocks, lost } as
// JSON: lost lists the fences highlighted without our grammars. Used by load-order.test.mjs.
import fs from 'node:fs';
import { createRequire } from 'node:module';
import path from 'node:path';
import { fortranRehypeCode } from '../../shiki/index.js';

const [pkg, scenario] = process.argv.slice(2);
const { rehypeCode, rehypeCodeDefaultOptions } = await import(`${pkg}/mdx-plugins/rehype-code`);
const require = createRequire(import.meta.url);
const version = (() => {
  // the package's own package.json, found from an exported file (./package.json may not be exported)
  let dir = path.dirname(require.resolve(`${pkg}/mdx-plugins/rehype-code`));
  while (!fs.existsSync(path.join(dir, 'package.json'))) dir = path.dirname(dir);
  return JSON.parse(fs.readFileSync(path.join(dir, 'package.json'), 'utf8')).version;
})();

const FIXED = new Set(['fortran-fixed', 'fortran-fixed-form', 'f', 'for', 'f77', 'ftn']);
const ALL = ['fortran', 'fortran-free-form', 'f90', 'f95', 'f03', 'f08', 'f18', 'f23', 'fpp', 'fypp', ...FIXED];
const BUNDLED = ['f90', 'f77', 'fortran-free-form', 'fortran-fixed-form', 'f', 'for', 'f95'];
// github-light's colour for keywords; on a comment (the bundled grammars' reading of a directive) it is #6A737D
const KEYWORD = '--shiki-light:#D73A49';

const block = (lang) => ({
  type: 'element',
  tagName: 'pre',
  properties: {},
  children: [{
    type: 'element',
    tagName: 'code',
    properties: { className: [`language-${lang}`] },
    children: [{ type: 'text', value: FIXED.has(lang) ? 'C$OMP PARALLEL\n      X = 1\n' : '!$omp parallel\nx = 1\n' }],
  }],
});
const firstToken = (node) => (node.tagName === 'span' && node.children?.[0]?.type === 'text' && node.children[0].value.trim() ? node : node.children?.map(firstToken).find(Boolean));

const lost = [];
let blocks = 0;
/** Highlights a page of fences with rehypeCode and these options; with check, records the fences not ours. */
async function page(options, langs, check = true) {
  const tree = { type: 'root', children: langs.map(block) };
  await rehypeCode(options)(tree, { data: {}, path: 'page.mdx', value: '' });
  tree.children.forEach((pre, i) => {
    blocks++;
    const token = firstToken(pre);
    if (check && !String(token?.properties?.style).includes(KEYWORD)) lost.push(langs[i]);
  });
}

const plugin = fortranRehypeCode(rehypeCodeDefaultOptions);
if (scenario === 'plugin-first') {
  // a collection with the pack, then one without it (which shares the highlighter)
  await page(plugin, ALL);
  await page(rehypeCodeDefaultOptions, BUNDLED);
} else if (scenario === 'bundled-first') {
  // a collection without the pack loads the bundled grammars first
  await page(rehypeCodeDefaultOptions, BUNDLED, false);
  await page(plugin, ALL);
  await page(rehypeCodeDefaultOptions, BUNDLED);
} else if (scenario === 'control') {
  // without the pack: every fence must count as lost, or the check above proves nothing
  await page(rehypeCodeDefaultOptions, BUNDLED);
} else if (scenario === 'interleaved') {
  await page(rehypeCodeDefaultOptions, ['f77'], false);
  await page(plugin, ['f90']);
  await page(rehypeCodeDefaultOptions, ['fortran-free-form', 'f95']);
  await page(plugin, ALL);
} else {
  throw new Error(`unknown scenario ${scenario}`);
}
console.log(JSON.stringify({ version, blocks, lost }));
