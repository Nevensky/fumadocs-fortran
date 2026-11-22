#!/usr/bin/env node
// The fumadocs-fortran command line. M0 has `dump`; init, generate, check and doctor arrive with v0.1.

import fs from 'node:fs';
import { performance } from 'node:perf_hooks';
import { extract, generate } from '../src/index.js';
import { linkProviders } from '../src/emit/library.js';

const HELP = `Usage: fumadocs-fortran <command> [options]

Commands:
  dump [paths…]        parse Fortran sources and print the intermediate model (JSON)
  generate [paths…]    write the API reference as MDX pages into a fumadocs content folder

Options for dump:
  -D NAME[=VALUE]      define a preprocessor macro (repeatable)
  -I DIR               add an include directory (repeatable)
  --all-branches       keep every #if branch instead of evaluating them
  --form free|fixed    read every file in one source form
  --fixed-length N     fixed-form line length: 72 (default), 132, or 0 for no limit
  --exclude GLOB       skip matching files (repeatable)
  --summary            print counts per file instead of JSON
  -o, --out FILE       write the JSON to FILE

Options for generate (and -D, -I, --all-branches, --form, --exclude as for dump):
  -o, --out DIR        the content folder to write (default content/docs/api)
  --base-url URL       the URL of that folder (default /docs/api)
  --title TEXT         the overview page's title
  --display LIST       access levels to show, comma-separated (default public,protected)
  --repo URL           link each entity to its lines in this repository (GitHub or GitLab)
  --rev REV            the branch, tag or commit for those links (default main)
  --math MODE          katex (default): $…$ maths for remark-math and rehype-katex; code: maths shown as code,
                       for a site without them
  --source MODE        embed (default): each procedure, type, interface, variable and enum shows its source lines in
                       a collapsible block (up to 400 lines), read from the files parsed (those given and the files
                       they include) wherever they lie; link: only a link to them
  --graphs MODE        mermaid (default): dependency, inheritance and call graphs as Mermaid blocks, for a site
                       with remarkMdxMermaid; none: no graphs
  --library-cards MODE registry (default): the library routines in Calls lines, and mpi_f08's types and omp_lib's
                       kinds in the tables, have hover cards from the HPC registry; none: they are plain code (the
                       graphs keep their colours)
  --links LIST         where those cards link, as library=provider pairs, comma-separated (mpi=mpich,openmp=6.0):
                         lapack (BLAS and LAPACK) and scalapack (with PBLAS, BLACS, its tools and REDIST): netlib
                           or mkl (default: mkl when the code uses Intel oneMKL's modules, else netlib)
                         mpi: openmpi (default), mpich or standard
                         openmp: 5.2 (default), 6.0, 6.1 or libgomp
                         openacc: spec (default) or libgomp
                         intrinsics: fortran-lang (default) or gfortran
                       a name the provider has no page for links as it would by default
  -h, --help           show this help
  -v, --version        print the version

FORD's {!file!} includes in doc comments are read relative to the current folder, and only from under it.
`;

function parse(argv) {
  const o = { cmd: null, paths: [], macros: {}, includeDirs: [], exclude: [] };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    const val = () => {
      if (i + 1 >= argv.length) fail(`${a} needs a value`);
      return argv[++i];
    };
    if (a === '-h' || a === '--help') o.help = true;
    else if (a === '-v' || a === '--version') o.version = true;
    else if (a === '-D' || a.startsWith('-D')) {
      const spec = a === '-D' ? val() : a.slice(2);
      const eq = spec.indexOf('=');
      if (eq < 0) o.macros[spec] = true;
      else o.macros[spec.slice(0, eq)] = spec.slice(eq + 1);
    } else if (a === '-I' || a.startsWith('-I')) o.includeDirs.push(a === '-I' ? val() : a.slice(2));
    else if (a === '--all-branches') o.keepAll = true;
    else if (a === '--form') o.form = val();
    else if (a === '--fixed-length') o.fixedLength = Number(val());
    else if (a === '--exclude') o.exclude.push(val());
    else if (a === '--summary') o.summary = true;
    else if (a === '-o' || a === '--out') o.out = val();
    else if (a === '--base-url') o.baseUrl = val();
    else if (a === '--title') o.title = val();
    else if (a === '--display') o.display = val().split(',').map((x) => x.trim()).filter(Boolean);
    else if (a === '--repo') o.repo = val();
    else if (a === '--rev') o.rev = val();
    else if (a === '--math') {
      o.math = val();
      if (!['katex', 'code'].includes(o.math)) fail('--math takes katex or code');
    }
    else if (a === '--source') {
      o.source = val();
      if (!['embed', 'link'].includes(o.source)) fail('--source takes embed or link');
    }
    else if (a === '--graphs') {
      o.graphs = val();
      if (!['mermaid', 'none'].includes(o.graphs)) fail('--graphs takes mermaid or none');
    }
    else if (a === '--library-cards') {
      o.cards = val();
      if (!['registry', 'none'].includes(o.cards)) fail('--library-cards takes registry or none');
    }
    else if (a === '--links') o.links = { ...o.links, ...links(val()) };
    else if (a.startsWith('-')) fail(`unknown option ${a}`);
    else if (!o.cmd) o.cmd = a;
    else o.paths.push(a);
  }
  return o;
}

/** --links lapack=mkl,mpi=mpich: library → provider, checked as the hpc.links option is. */
function links(list) {
  // without a prototype, so that every name given is a key of its own: `__proto__=mkl` fails as an unknown library
  const out = Object.create(null);
  for (const item of list.split(',').map((x) => x.trim()).filter(Boolean)) {
    const eq = item.indexOf('=');
    if (eq <= 0 || eq === item.length - 1) {
      fail(`--links takes library=provider pairs, comma-separated, such as mpi=mpich, not ${item}`);
    }
    out[item.slice(0, eq).trim()] = item.slice(eq + 1).trim();
  }
  try {
    return linkProviders(out, '--links');
  } catch (e) {
    return fail(e.message);
  }
}

function fail(msg) {
  process.stderr.write(`fumadocs-fortran: ${msg}\n`);
  process.exit(2);
}

const opts = parse(process.argv.slice(2));
if (opts.version) {
  const pkg = JSON.parse(fs.readFileSync(new URL('../package.json', import.meta.url), 'utf8'));
  process.stdout.write(`${pkg.version}\n`);
  process.exit(0);
}
if (opts.help || !opts.cmd) {
  process.stdout.write(HELP);
  process.exit(opts.cmd || opts.help ? 0 : 1);
}

if (opts.cmd === 'dump') {
  const t0 = performance.now();
  const ir = await extract({
    sources: opts.paths.length ? opts.paths : ['.'],
    exclude: opts.exclude,
    cpp: { macros: opts.macros, includeDirs: opts.includeDirs, keepAllBranches: opts.keepAll },
    form: opts.form,
    fixedLength: opts.fixedLength,
  });
  const ms = performance.now() - t0;
  if (opts.summary) process.stdout.write(summary(ir, ms));
  else {
    const json = JSON.stringify(ir, null, 1) + '\n';
    if (opts.out) fs.writeFileSync(opts.out, json);
    else process.stdout.write(json);
  }
  // exitCode rather than exit(): a large write to a pipe must finish first
  process.exitCode = ir.diagnostics.some((d) => d.severity === 'error') ? 1 : 0;
} else if (opts.cmd === 'generate') {
  const t0 = performance.now();
  const r = await generate({
    sources: opts.paths.length ? opts.paths : ['.'],
    exclude: opts.exclude,
    cpp: { macros: opts.macros, includeDirs: opts.includeDirs, keepAllBranches: opts.keepAll },
    form: opts.form,
    fixedLength: opts.fixedLength,
    out: opts.out ?? 'content/docs/api',
    baseUrl: opts.baseUrl,
    title: opts.title,
    display: opts.display,
    repo: opts.repo ? { url: opts.repo, rev: opts.rev } : undefined,
    math: opts.math,
    source: opts.source,
    graphs: opts.graphs !== 'none',
    hpc: { links: opts.links, cards: opts.cards !== 'none' },
  });
  const warn = r.ir.diagnostics.length;
  process.stdout.write(`${r.written.length} files (${r.changed.length} changed, ${r.removed.length} removed) from ${r.ir.files.length} sources in ${(performance.now() - t0).toFixed(0)} ms${warn ? `; ${warn} diagnostics` : ''}\n`);
  for (const d of r.ir.diagnostics.slice(0, 20)) process.stderr.write(`${d.file}:${d.line}: ${d.severity}: ${d.message} [${d.code}]\n`);
} else if (['init', 'check', 'doctor'].includes(opts.cmd)) {
  fail(`${opts.cmd} is not implemented yet (it arrives with v0.1)`);
} else fail(`unknown command ${opts.cmd}`);

function summary(ir, ms) {
  const per = new Map(ir.files.map((f) => [f.path, { units: 0, procs: 0, types: 0, ifaces: 0, args: 0 }]));
  for (const e of Object.values(ir.entities)) {
    const c = per.get(e.file);
    if (!c) continue;
    if (!e.parent) c.units++;
    if (e.kind === 'procedure') { c.procs++; c.args += e.args?.length ?? 0; }
    if (e.kind === 'type') c.types++;
    if (e.kind === 'interface') c.ifaces++;
  }
  const rows = [['file', 'form', 'lines', 'units', 'procedures', 'arguments', 'types', 'interfaces']];
  let lines = 0;
  for (const f of ir.files) {
    const c = per.get(f.path);
    lines += f.lines ?? 0;
    rows.push([f.path, f.skipped ? `skipped (${f.skipped})` : f.form + (f.cpp ? '+cpp' : ''), f.lines ?? '', c.units, c.procs, c.args, c.types, c.ifaces]);
  }
  const width = rows[0].map((_, i) => Math.max(...rows.map((r) => String(r[i]).length)));
  const fmt = (r) => r.map((x, i) => (i === 0 ? String(x).padEnd(width[i]) : String(x).padStart(width[i]))).join('  ');
  const warn = ir.diagnostics.length;
  return `${rows.map(fmt).join('\n')}\n\n${ir.files.length} files, ${lines} lines, ${Object.keys(ir.entities).length} entities, ${warn} diagnostics, ${ms.toFixed(0)} ms\n`;
}
