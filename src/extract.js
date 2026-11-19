// From source files to the IR: form, cpp, includes, the reader and the parser, file by file.

import fs from 'node:fs';
import path from 'node:path';
import { resolveForm } from './source/form.js';
import { CondTable, macroTable, preprocess } from './source/cpp.js';
import { readEvents, expandIncludes } from './source/reader.js';
import { discover, readText, toPosix } from './source/files.js';
import { parseEvents } from './parse/parser.js';
import { buildIR } from './model/ir.js';

const VERSION = JSON.parse(fs.readFileSync(new URL('../package.json', import.meta.url), 'utf8')).version;

const HAS_CPP = /^[ \t]*#[ \t]*(if|ifdef|ifndef|elif|else|endif|define|undef|include|line|error|pragma|\d)/m;
const HAS_INCLUDE = /^[ \t]*include[ \t]*['"]/im;
const IS_FYPP = /^[ \t]*#:|\$\{[^}\n]*\}\$|@\{[^}\n]*\}@/m;

/**
 * @typedef {object} ExtractOptions
 * @property {string} [root] the project folder; paths in the IR are relative to it
 * @property {string[]} [sources] files and folders to read (default: the root)
 * @property {string[]} [exclude] globs relative to the root
 * @property {string[]} [extensions] file extensions to read, without dots
 * @property {{ macros?: Record<string, string|number|boolean>, includeDirs?: string[], keepAllBranches?: boolean }} [cpp]
 * @property {'free'|'fixed'} [form] force one source form for every file
 * @property {string[]} [fixedExtensions] extensions read as fixed form
 * @property {string[]} [freeExtensions] extensions read as free form
 * @property {number} [fixedLength] fixed-form line length: 72 (default), 132, or 0 for no limit
 * @property {object} [marks] doc-comment marks: docmark, predocmark, docmarkAlt, predocmarkAlt, postmark
 */

/** Reads every source and returns the IR. */
export async function extract(options = {}) {
  const root = path.resolve(options.root ?? '.');
  const files = discover(options.sources ?? ['.'], { root, exclude: options.exclude, extensions: options.extensions });
  return extractFiles(files, options);
}

/** Reads the given files (absolute or relative to `root`) and returns the IR. */
export function extractFiles(files, options = {}, read = readText) {
  const ctx = createContext(options, read);
  const units = files.map((f) => parseOne(path.resolve(ctx.root, f), ctx));
  return buildIR(units, ctx);
}

/** Parses one in-memory source. `options.path` names it (default `input.f90`) and decides its form. */
export function parseSource(text, options = {}) {
  const name = options.path ?? 'input.f90';
  const root = path.resolve(options.root ?? '.');
  const abs = path.resolve(root, name);
  return extractFiles([abs], { ...options, root }, (f) => (f === abs ? text : readText(f)));
}

function createContext(options, read) {
  const root = path.resolve(options.root ?? '.');
  const files = [];
  const index = new Map();
  const fileIndex = (abs) => {
    let i = index.get(abs);
    if (i === undefined) {
      i = files.length;
      files.push(abs);
      index.set(abs, i);
    }
    return i;
  };
  const includeDirs = (options.cpp?.includeDirs ?? []).map((d) => path.resolve(root, d));
  const cache = new Map();
  const readCached = (abs) => {
    if (!cache.has(abs)) cache.set(abs, read(abs));
    return cache.get(abs);
  };
  const exists = (abs) => {
    try {
      return fs.statSync(abs).isFile();
    } catch {
      return false;
    }
  };
  return {
    root,
    read,
    fileIndex,
    rel: (i) => toPosix(path.relative(root, files[i])),
    diagnostics: [],
    macros: macroTable(options.cpp?.macros),
    keepAll: !!options.cpp?.keepAllBranches,
    form: options.form,
    formOpts: { form: options.form, fixedExtensions: options.fixedExtensions, freeExtensions: options.freeExtensions },
    fixedLength: options.fixedLength ?? 72,
    marks: options.marks,
    generator: { name: 'fumadocs-fortran', version: VERSION },
    options: {
      ...(options.cpp?.macros && Object.keys(options.cpp.macros).length ? { macros: options.cpp.macros } : {}),
      ...(options.cpp?.keepAllBranches ? { keepAllBranches: true } : {}),
    },
    readInclude(name, from, angle, record) {
      const dirs = angle ? [...includeDirs, path.dirname(files[from])] : [path.dirname(files[from]), ...includeDirs];
      for (const d of dirs) {
        const abs = path.resolve(d, name);
        if (exists(abs)) {
          record?.(abs);
          return { text: readCached(abs), index: fileIndex(abs) };
        }
      }
      return null;
    },
  };
}

function parseOne(abs, ctx) {
  const idx = ctx.fileIndex(abs);
  const text = ctx.read(abs);
  const info = { path: ctx.rel(idx) };
  const conds = new CondTable();
  if (/\.fypp$/i.test(abs) || IS_FYPP.test(text)) {
    info.skipped = 'fypp';
    ctx.diagnostics.push({ code: 'fypp', severity: 'warning', file: idx, line: 1, message: 'fypp source skipped: run fypp first, or set fypp.command' });
    return { info, roots: [], conds };
  }
  const form = resolveForm(abs, text, ctx.formOpts);
  info.form = form;
  const includes = new Set();
  const env = {
    macros: new Map(ctx.macros),
    conds,
    keepAll: ctx.keepAll,
    form,
    diagnostics: ctx.diagnostics,
    readInclude: (name, from, angle) => ctx.readInclude(name, from, angle, (p) => includes.add(p)),
    // line markers (`# 12 "src/a.F90"`) name files relative to where the preprocessor ran: the project root
    fileIndex: (name) => ctx.fileIndex(path.resolve(ctx.root, name)),
  };
  let lines;
  let inactive = 0;
  if (HAS_CPP.test(text)) {
    const r = preprocess(text, idx, env);
    lines = r.lines;
    inactive = r.inactive.length;
    info.cpp = true;
  } else {
    lines = text.split('\n').map((s, i) => ({ s, f: idx, n: i + 1, c: 0 }));
  }
  if (lines.length && lines[lines.length - 1].s === '' && lines[lines.length - 1].f === idx) lines.pop();
  info.lines = text.split('\n').length - (text.endsWith('\n') ? 1 : 0);
  if (HAS_INCLUDE.test(text) || includes.size) lines = expandIncludes(lines, env);
  const omp = ctx.keepAll || ctx.macros.has('_OPENMP');
  const events = readEvents(lines, { form, fixedLength: ctx.fixedLength, omp });
  const pctx = { file: idx, diagnostics: ctx.diagnostics, marks: ctx.marks };
  const roots = parseEvents(events, pctx);
  if (includes.size) info.includes = [...includes].map((p) => toPosix(path.relative(ctx.root, p)));
  if (inactive) info.inactiveLines = inactive;
  if (pctx.fileDirectives) info.directives = pctx.fileDirectives;
  return { info, roots, conds };
}
