#!/usr/bin/env node
// Measures the static search index that an API reference for all of Reference-LAPACK would produce, with fumadocs'
// own index builder (createSearchAPI + staticGET, as a statically exported site ships it to every visitor).
// Pages are LAPACK's \ingroup groups, so the s/d/c/z variants share a page, as on Netlib. The index is measured with
// and without one search record per argument (the plan's `search.granularity`).
//
//   npm install --prefix scripts/search    (fumadocs-core, development only)
//   scripts/dev.sh node scripts/search/measure.mjs [.corpus/lapack]

import path from 'node:path';
import zlib from 'node:zlib';
import { performance } from 'node:perf_hooks';
import { createSearchAPI } from 'fumadocs-core/search/server';
import { extract } from '../../src/index.js';

const root = path.resolve(process.argv[2] ?? '.corpus/lapack');
const ir = await extract({ root, sources: ['SRC', 'BLAS/SRC', 'INSTALL'] });

const first = (s) => (/^(.+?[.:])(\s|$)/.exec(s.replace(/\s+/g, ' ').trim())?.[1] ?? s.replace(/\s+/g, ' ').trim()).slice(0, 200);
const pages = new Map();
let routines = 0, argRecords = 0;
for (const e of Object.values(ir.entities)) {
  if (e.kind !== 'procedure' || e.parent) continue;
  const lines = (e.doc?.blocks ?? []).flatMap((b) => b.lines.map((l) => l.replace(/^\s?/, '')));
  const text = lines.join('\n');
  const group = /\\ingroup\s+(\w+)/.exec(text)?.[1] ?? 'other';
  const brief = (/\\brief\s+(.*)/.exec(text)?.[1] ?? '').replace(/<\/?b>|\\b\s*/g, '').trim();
  const params = new Map();
  for (const m of text.matchAll(/\\param\[[^\]]*\]\s+(\w+)\s*\n\s*\\verbatim\s*\n([\s\S]*?)\\endverbatim/g)) params.set(m[1].toLowerCase(), first(m[2]));
  const page = pages.get(group) ?? { headings: [], summaries: [], args: [] };
  const id = e.name.toLowerCase();
  page.headings.push({ id, content: e.name.toUpperCase() });
  page.summaries.push({ heading: id, content: brief || e.name });
  for (const a of e.args ?? []) {
    page.args.push({ heading: id, content: `${a.name.toUpperCase()}: ${params.get(a.name.toLowerCase()) ?? a.type?.text ?? ''}` });
    argRecords++;
  }
  pages.set(group, page);
  routines++;
}

async function measure(withArgs) {
  const indexes = [...pages].map(([group, p]) => ({
    id: `/docs/api/lapack/${group}`,
    url: `/docs/api/lapack/${group}`,
    title: group,
    description: p.summaries[0]?.content ?? '',
    structuredData: { headings: p.headings, contents: withArgs ? [...p.summaries, ...p.args] : p.summaries },
  }));
  const t0 = performance.now();
  const api = createSearchAPI('advanced', { indexes });
  const body = await (await api.staticGET()).text();
  const ms = performance.now() - t0;
  const gz = zlib.gzipSync(body, { level: 9 }).length;
  const br = zlib.brotliCompressSync(body).length;
  return { records: indexes.reduce((n, x) => n + x.structuredData.headings.length + x.structuredData.contents.length, 0), bytes: body.length, gzip: gz, brotli: br, ms: Math.round(ms) };
}

const mb = (n) => `${(n / 1024 / 1024).toFixed(2)} MB`;
console.log(`Reference-LAPACK: ${routines} routines on ${pages.size} pages (\\ingroup groups), ${argRecords} arguments`);
for (const withArgs of [false, true]) {
  const r = await measure(withArgs);
  console.log(`${withArgs ? 'headings, summaries and one record per argument' : 'headings and summaries'}: ${r.records} records, ${mb(r.bytes)} raw, ${mb(r.gzip)} gzip, ${mb(r.brotli)} brotli; built in ${r.ms} ms`);
}
