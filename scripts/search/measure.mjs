#!/usr/bin/env node
// Measures the static search index that a generated API reference gives a fumadocs site, built with fumadocs' own
// index builder (createSearchAPI + staticGET, as a statically exported site ships it to every visitor). The pages are
// generated with the package's defaults (graphs, embedded source blocks), and their records come through the docs
// site's MDX setup (records.mjs): once with fumadocs' defaults, which keep each component's element in the records as
// an HTML tag, and once with the site's own options, which keep the text of the Fortran components and leave their
// tags out. --sample N measures N pages: the largest half and the half around the median, by MDX bytes. Only figures
// are printed, no text of the corpus.
//
//   node scripts/search/measure.mjs [<root> [<dir>…]] [-I dir] [-D NAME] [--sample N]
//
// It needs the docs site's node_modules (scripts/docs.sh keeps them in a Docker volume). The corpora are fetched by
// scripts/fetch-corpus.sh. Without a root it measures Reference-LAPACK's library, SRC and BLAS/SRC in .corpus/lapack;
// with a root and no folders, all of the root.

import path from 'node:path';
import zlib from 'node:zlib';
import { performance } from 'node:perf_hooks';
import { fileURLToPath } from 'node:url';
import { extract, buildPages } from '../../src/index.js';
import { readText } from '../../src/source/files.js';
import { loadSite } from './records.mjs';

const repo = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const argv = process.argv.slice(2);
const macros = {};
const includeDirs = [];
const pos = [];
let sample = 0;
for (let i = 0; i < argv.length; i++) {
  if (argv[i] === '-D') macros[argv[++i]] = 1;
  else if (argv[i] === '-I') includeDirs.push(argv[++i]);
  else if (argv[i] === '--sample') sample = Number(argv[++i]);
  else pos.push(argv[i]);
}
const root = path.resolve(pos[0] ?? path.join(repo, '.corpus/lapack'));
const dirs = pos.length > 1 ? pos.slice(1) : pos.length ? ['.'] : ['SRC', 'BLAS/SRC'];

const ir = await extract({
  root, sources: dirs, cpp: { macros, includeDirs: includeDirs.map((d) => path.resolve(root, d)) },
});
const readSource = (file) => {
  const abs = path.resolve(root, file);
  if (!abs.startsWith(root + path.sep)) return null;
  try {
    return readText(abs);
  } catch {
    return null;
  }
};
const repoLink = { url: 'https://github.com/o/r', rev: 'v1' };
const all = buildPages(ir, { baseUrl: '/docs/api', repo: repoLink, readSource }).pages;
const bytes = (p) => Buffer.byteLength(p.mdx);
let pages = all;
const top = Math.ceil(sample / 2);
if (sample > 0 && sample < all.length) {
  const bySize = [...all].sort((a, b) => bytes(b) - bytes(a));
  const from = Math.max(top, Math.floor(all.length / 2) - Math.floor((sample - top) / 2));
  pages = [...bySize.slice(0, top), ...bySize.slice(from, from + sample - top)];
}

const site = await loadSite({ docs: path.join(repo, 'docs'), out: path.join(repo, 'test/out/search-measure') });
const description = (mdx) => {
  const m = /^description: (".*")$/m.exec(mdx.slice(0, mdx.indexOf('\n---\n', 4) + 1));
  try {
    return m ? JSON.parse(m[1]) : undefined;
  } catch {
    return undefined;
  }
};
const tagged = /<\/?Fortran[A-Z]/;

async function measure(which) {
  const t0 = performance.now();
  const indexes = [];
  let records = 0, withTags = 0;
  for (const p of pages) {
    const structuredData = await site.records(p.mdx, which);
    const list = [...structuredData.headings, ...structuredData.contents];
    records += list.length;
    withTags += list.filter((r) => tagged.test(r.content)).length;
    indexes.push({ id: p.url, url: p.url, title: p.title, description: description(p.mdx), structuredData });
  }
  const t1 = performance.now();
  let body;
  try {
    body = await (await site.createSearchAPI('advanced', { indexes }).staticGET()).text();
  } catch (e) {
    if (e?.code !== 'DOCUMENT_ALREADY_EXISTS') throw e;
    // fumadocs gives a page's records the ids <url>-0, <url>-1, …, which a page whose URL ends in -<number> can share.
    // The error names the page, so it is not printed: only figures are
    console.error("fumadocs cannot build this index: a page's URL is the id of another page's record (<url>-0,"
      + ' <url>-1, …).');
    process.exit(1);
  }
  const ms = [t1 - t0, performance.now() - t1].map(Math.round);
  return {
    records, withTags, bytes: Buffer.byteLength(body), gzip: zlib.gzipSync(body, { level: 9 }).length,
    brotli: zlib.brotliCompressSync(body).length, ms,
  };
}

const mb = (n) => `${(n / 1024 / 1024).toFixed(2)} MB`;
const pct = (a, b) => `${(((b - a) / a) * 100).toFixed(1)}%`;
const mdxBytes = pages.reduce((n, p) => n + bytes(p), 0);
const part = pages === all ? '' : ` (the ${top} largest and ${sample - top} around the median)`;
console.log(`${path.basename(root)} (${dirs.join(', ')}): ${ir.files.length} files, ${pages.length} of ${all.length}`
  + ` pages${part}, ${mb(mdxBytes)} of MDX`);
const results = {};
for (const [which, label] of [['defaults', "fumadocs' defaults"], ['site', "the docs site's options"]]) {
  const r = await measure(which);
  results[which] = r;
  console.log(`${label}: ${r.records} records, ${r.withTags} with a Fortran component's tag; index ${mb(r.bytes)} raw,`
    + ` ${mb(r.gzip)} gzip, ${mb(r.brotli)} brotli; records in ${r.ms[0]} ms, index in ${r.ms[1]} ms`);
}
const [d, s] = [results.defaults, results.site];
console.log(`the site's options against fumadocs' defaults: records ${pct(d.records, s.records)},`
  + ` raw ${pct(d.bytes, s.bytes)}, gzip ${pct(d.gzip, s.gzip)}, brotli ${pct(d.brotli, s.brotli)}`);
