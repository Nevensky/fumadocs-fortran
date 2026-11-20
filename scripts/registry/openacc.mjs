// Builds registry/openacc.json: OpenACC 3.4 directives, clauses, runtime routines and environment variables, with
// the PDF page of the section that documents each, read from the specification's outline.
//
//   node scripts/registry/openacc.mjs [--refresh]
//
// The names and one-liners are in data/openacc.mjs; only page numbers come from the PDF.
import {
  CLAUSE_HOMES,
  CLAUSE_SUMMARIES,
  DEPRECATED_CLAUSES,
  DEPRECATED_ROUTINES,
  DIRECTIVES,
  ENV,
  ROUTINE_HOMES,
  ROUTINE_SUMMARIES,
  ROUTINES,
} from './data/openacc.mjs';
import { fetchPinned, formatRegistry, isMain, loadSources, saveLock, source, writeRegistry } from './lib.mjs';
import { pdfOutline } from './pdf.mjs';

export async function build() {
  const sources = await loadSources();
  const src = source(sources, 'openacc-spec');
  const { pages, outline } = pdfOutline(await fetchPinned('openacc-spec', src.urls.pdf));
  const problems = [];
  const pageOf = (title) => outline.find((o) => o.title === title && o.depth > 0)?.page ?? outline.find((o) => o.title === title)?.page ?? null;

  const directives = {};
  for (const [name, [title, tags, summary]] of Object.entries(DIRECTIVES)) {
    const e = { k: name.includes(' loop') ? 'combined' : 'directive' };
    if (e.k === 'combined') e.c = name.split(' ');
    if (tags.length) e.t = tags;
    e.s = summary;
    const pg = pageOf(title);
    if (pg) e.pg = pg;
    else problems.push(`directive ${name}: no section "${title}"`);
    directives[name] = e;
  }

  const clauses = {};
  const sectioned = [...new Set(outline.map((o) => /^(\w+) clause$/.exec(o.title)?.[1]).filter(Boolean))];
  for (const name of [...sectioned, ...Object.keys(CLAUSE_HOMES)].filter((n, i, a) => a.indexOf(n) === i).sort()) {
    const e = {};
    if (CLAUSE_SUMMARIES[name]) e.s = CLAUSE_SUMMARIES[name];
    if (DEPRECATED_CLAUSES.has(name)) e.t = ['dep'];
    const pg = pageOf(`${name} clause`) ?? (CLAUSE_HOMES[name] && pageOf(CLAUSE_HOMES[name]));
    if (pg) e.pg = pg;
    else problems.push(`clause ${name}: no section`);
    clauses[name] = e;
  }
  for (const n of Object.keys(CLAUSE_SUMMARIES)) if (!clauses[n]) problems.push(`summary for clause ${n}: no such clause`);

  // a routine's section: the outline entry that names it ("acc_copyin and acc_create"), else that of the name
  // without its _async, _finalize, _device, _all, _any or _string suffixes
  const routineSection = (name) => {
    let n = ROUTINE_HOMES[name] ?? name;
    for (;;) {
      const hit = outline.find((o) => o.title.split(' and ').includes(n));
      if (hit) return hit.page;
      const shorter = n.replace(/_(?:async|finalize|device|all|any|string)$/, '');
      if (shorter === n) return null;
      n = shorter;
    }
  };
  const routines = {};
  for (const name of ROUTINES) {
    const e = {};
    if (ROUTINE_SUMMARIES[name]) e.s = ROUTINE_SUMMARIES[name];
    if (DEPRECATED_ROUTINES.has(name)) e.t = ['dep'];
    const pg = routineSection(name);
    if (pg) e.pg = pg;
    else problems.push(`routine ${name}: no section`);
    routines[name] = e;
  }
  for (const o of outline) {
    for (const n of o.title.split(' and ')) if (/^acc_\w+$/.test(n) && !routines[n]) problems.push(`routine ${n}: in the outline, not in data/openacc.mjs`);
  }

  const env = {};
  for (const [name, summary] of Object.entries(ENV)) {
    const pg = pageOf(name);
    env[name] = pg ? { s: summary, pg } : { s: summary };
    if (!pg) problems.push(`environment variable ${name}: no section`);
  }

  const out = {
    format: 1,
    id: 'openacc',
    title: 'OpenACC',
    version: '3.4',
    sources: ['openacc-spec'],
    legend: {
      kinds: { directive: 'directive or construct', combined: 'combined construct (c lists its parts)' },
      tags: {
        offload: 'runs on or moves data to a device (offloading)',
        par: 'starts parallel execution on the device',
        loop: 'applies to the loop that follows',
        sync: 'synchronisation',
        decl: 'declarative',
        dep: 'deprecated',
      },
      fields: { k: 'kind', c: 'parts of a combined construct', t: 'tags', s: 'our own one-line summary', pg: 'page of the specification PDF that documents it' },
      keys: 'directive names lower case with blanks (enter data); clauses and routines lower case; environment variables upper case',
    },
    links: {
      spec: { url: src.urls.pdf, page: '#page={pg}', pages },
      libgomp: { base: 'https://gcc.gnu.org/onlinedocs/libgomp/', page: '{name}.html', rule: 'routines and environment variables; _ is written _005f (acc_get_num_devices → acc_005fget_005fnum_005fdevices)' },
    },
    directives,
    clauses,
    routines,
    env,
  };
  const text = formatRegistry(out, ['directives', 'clauses', 'routines', 'env']);
  const bytes = await writeRegistry('openacc.json', text);
  const count = (o) => Object.keys(o).length;
  const stats = {
    entries: count(directives) + count(clauses) + count(routines) + count(env),
    directives: count(directives),
    clauses: count(clauses),
    routines: count(routines),
    env: count(env),
    summaries: [directives, clauses, routines, env].reduce((n, o) => n + Object.values(o).filter((e) => e.s).length, 0),
    problems,
    bytes,
  };
  return { file: 'openacc.json', bytes, stats };
}

if (isMain(import.meta.url)) {
  const { stats } = await build();
  await saveLock();
  console.log(JSON.stringify(stats, null, 2));
}
