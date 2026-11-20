// Writes generated pages into a fumadocs content folder. A manifest lists what was generated, so a later run deletes
// only its own stale files and never a hand-written page.

import fs from 'node:fs';
import path from 'node:path';
import { extract } from '../extract.js';
import { buildPages } from './pages.js';

export const MANIFEST = '.fumadocs-fortran.json';

/**
 * Writes pages and meta.json files; files whose content is unchanged are not touched.
 * @param {{ pages: Array<{ path: string, mdx: string }>, metas: Array<{ path: string, data: object }> }} result
 * @param {string} outDir
 * @returns {{ written: string[], changed: string[], removed: string[] }}
 */
export function writePages(result, outDir) {
  fs.mkdirSync(outDir, { recursive: true });
  let previous = [];
  try {
    previous = JSON.parse(fs.readFileSync(path.join(outDir, MANIFEST), 'utf8')).files ?? [];
  } catch {
    // no manifest: nothing was generated here before
  }
  const written = [], changed = [], removed = [];
  const put = (rel, text) => {
    const file = path.join(outDir, rel);
    fs.mkdirSync(path.dirname(file), { recursive: true });
    let old = null;
    try {
      old = fs.readFileSync(file, 'utf8');
    } catch {
      // a new file
    }
    if (old !== text) {
      fs.writeFileSync(file, text);
      changed.push(rel);
    }
    written.push(rel);
  };
  for (const p of result.pages) put(p.path, p.mdx);
  for (const m of result.metas) put(m.path, `${JSON.stringify(m.data, null, 2)}\n`);
  for (const rel of previous) {
    if (written.includes(rel) || rel.includes('..')) continue;
    try {
      fs.unlinkSync(path.join(outDir, rel));
      removed.push(rel);
    } catch {
      // already gone
    }
  }
  const manifest = `${JSON.stringify({ generator: 'fumadocs-fortran', files: [...written].sort() }, null, 2)}\n`;
  put(MANIFEST, manifest);
  written.pop();
  return { written, changed: changed.filter((f) => f !== MANIFEST), removed };
}

/**
 * Reads the sources, builds the pages and writes them.
 * @param {import('../extract.js').ExtractOptions & import('./pages.js').PageOptions & { out: string }} options
 */
export async function generate(options) {
  const ir = await extract(options);
  // FORD's {!file!} includes, read relative to the project root, and never from outside it
  const root = path.resolve(options.root ?? '.');
  const include = options.include ?? ((file) => {
    const abs = path.resolve(root, file);
    if (abs !== root && !abs.startsWith(root + path.sep)) return null;
    try {
      return fs.readFileSync(abs, 'utf8');
    } catch {
      return null;
    }
  });
  const result = buildPages(ir, { ...options, include });
  const out = path.resolve(options.root ?? '.', options.out);
  return { ir, pages: result.pages, ...writePages(result, out) };
}
