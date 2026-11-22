// Shared helpers for the registry builders (scripts/registry/*.mjs): pinned downloads, an in-memory tar reader, a
// safe reader for Doxygen's search index, text helpers and the JSON writer.
//
// Downloads are untrusted data. Each is checked against the SHA-256 recorded in sources.lock.json, cached in a new,
// empty folder of its own under .cache/registry/ (gitignored), parsed as text and never executed. Archives are read
// in memory, so no path from inside one ever reaches the file system.
import { createHash } from 'node:crypto';
import { existsSync } from 'node:fs';
import { mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { gunzipSync } from 'node:zlib';

export const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
export const OUT_DIR = path.join(ROOT, 'registry');
export const CACHE_DIR = path.join(ROOT, '.cache/registry');
const LOCK_FILE = path.join(ROOT, 'scripts/registry/sources.lock.json');

// A generic client name: no project or personal details go to the upstream servers.
const USER_AGENT = 'registry-builder/1.0';

/**
 * Pinning modes. By default a download must match its pin, and a URL without one is pinned (and reported); with
 * --refresh (or REGISTRY_REFRESH=1) changed content is accepted too; with --frozen (or REGISTRY_FROZEN=1, for CI) a
 * URL without a pin is an error.
 */
export const REFRESH = process.argv.includes('--refresh') || process.env.REGISTRY_REFRESH === '1';
export const FROZEN = process.argv.includes('--frozen') || process.env.REGISTRY_FROZEN === '1';

// ------------------------------------------------------------------------------------------------ the lock file

let lock = null;
let lockDirty = false;
const used = new Set();
export const lockNotes = [];

async function loadLock() {
  if (!lock) {
    lock = existsSync(LOCK_FILE) ? JSON.parse(await readFile(LOCK_FILE, 'utf8')) : {};
    lock.files ??= {};
  }
  return lock;
}

/**
 * Writes the lock back when pins changed. With `prune` (a full build), pins no download used are dropped. Keys are
 * sorted, so the file diffs well.
 */
export async function saveLock({ prune = false } = {}) {
  if (!lock) return false;
  if (prune) {
    for (const url of Object.keys(lock.files)) {
      if (!used.has(url)) {
        delete lock.files[url];
        lockDirty = true;
      }
    }
  }
  if (!lockDirty) return false;
  const files = Object.fromEntries(Object.keys(lock.files).sort().map((k) => [k, lock.files[k]]));
  await writeFile(LOCK_FILE, JSON.stringify({ files }, null, 2) + '\n');
  lockDirty = false;
  return true;
}

const sha256 = (buf) => createHash('sha256').update(buf).digest('hex');

// Some pages carry a per-request script (a bot-management beacon), so their pinned hash covers the page without
// its <script> elements.
const NORMALISE = {
  raw: (buf) => buf,
  'strip-scripts': (buf) => Buffer.from(buf.toString('utf8').replace(/<script\b[\s\S]*?<\/script>/gi, '')),
};

function pin(url, hash) {
  used.add(url);
  const known = lock.files[url];
  if (known === hash) return;
  if (known && !REFRESH) {
    throw new Error(`${url}: its content changed upstream (sha256 ${hash}, pinned ${known}). Check the change, then re-run with --refresh to accept it.`);
  }
  if (!known && FROZEN) throw new Error(`${url}: not pinned in sources.lock.json (--frozen)`);
  lockNotes.push(`${known ? 'repinned' : 'pinned'} ${url}`);
  lock.files[url] = hash;
  lockDirty = true;
}

// ------------------------------------------------------------------------------------------------ downloads

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

async function download(url) {
  let lastError;
  for (let attempt = 0; attempt < 4; attempt++) {
    if (attempt) await sleep(1000 * 2 ** attempt);
    try {
      const res = await fetch(url, { headers: { 'user-agent': USER_AGENT }, signal: AbortSignal.timeout(120_000) });
      if (res.status === 404) throw Object.assign(new Error(`${url}: HTTP 404`), { fatal: true, status: 404 });
      if (!res.ok) throw new Error(`${url}: HTTP ${res.status}`);
      return Buffer.from(await res.arrayBuffer());
    } catch (err) {
      if (err.fatal) throw err;
      lastError = err;
    }
  }
  throw lastError;
}

/**
 * Returns the bytes of a pinned download, from the cache when its hash still matches the pin.
 * - `source` names the folder in the cache (a source id from sources.json);
 * - `normalise` is 'raw' (the default) or 'strip-scripts'.
 * A 404 throws an error with `status: 404`.
 */
export async function fetchPinned(source, url, { normalise = 'raw' } = {}) {
  await loadLock();
  const id = sha256(url).slice(0, 12);
  const base = (new URL(url).pathname.split('/').filter(Boolean).pop() || 'index').replace(/[^\w.+-]/g, '_');
  const dir = path.join(CACHE_DIR, source, `${id}-${base}`.slice(0, 80));
  const file = path.join(dir, base);
  const hashOf = (buf) => sha256(NORMALISE[normalise](buf));
  if (existsSync(file)) {
    const buf = await readFile(file);
    if (hashOf(buf) === lock.files[url]) {
      used.add(url);
      return buf;
    }
    if (!lock.files[url] && !FROZEN) {
      // a download from before this URL was pinned: pin what is cached rather than fetch it again
      pin(url, hashOf(buf));
      return buf;
    }
  }
  // a new, empty folder for every download
  await rm(dir, { recursive: true, force: true });
  await mkdir(dir, { recursive: true });
  const buf = await download(url);
  pin(url, hashOf(buf));
  await writeFile(file, buf);
  return buf;
}

/** Runs `fn` over `items` with at most `limit` at a time; results keep the order of `items`. */
export async function pool(items, limit, fn) {
  const out = new Array(items.length);
  let next = 0;
  const worker = async () => {
    while (next < items.length) {
      const i = next++;
      out[i] = await fn(items[i], i);
    }
  };
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, worker));
  return out;
}

// ------------------------------------------------------------------------------------------------ archives

const cstr = (buf, start, len) => {
  const s = buf.subarray(start, start + len);
  const end = s.indexOf(0);
  return s.subarray(0, end < 0 ? s.length : end).toString('utf8');
};

function paxRecords(data) {
  const out = {};
  let i = 0;
  const text = data.toString('utf8');
  while (i < text.length) {
    const sp = text.indexOf(' ', i);
    if (sp < 0) break;
    const len = Number(text.slice(i, sp));
    if (!len) break;
    const rec = text.slice(sp + 1, i + len - 1);
    const eq = rec.indexOf('=');
    if (eq > 0) out[rec.slice(0, eq)] = rec.slice(eq + 1);
    i += len;
  }
  return out;
}

/**
 * Reads the regular files of a .tar.gz in memory. Paths lose their first component (GitHub's `repo-tag/`), and only
 * those for which `want(path)` is true are kept. Nothing is written to disk.
 */
export function readTarGz(gz, want = () => true) {
  const tar = gunzipSync(gz);
  const files = new Map();
  let off = 0;
  let longName = null;
  let paxPath = null;
  while (off + 512 <= tar.length) {
    const h = tar.subarray(off, off + 512);
    if (h.every((b) => b === 0)) break;
    const name = cstr(h, 0, 100);
    const prefix = cstr(h, 345, 155);
    const size = parseInt(cstr(h, 124, 12).trim() || '0', 8);
    const type = String.fromCharCode(h[156] || 48);
    const start = off + 512;
    const data = tar.subarray(start, start + size);
    const full = longName ?? paxPath ?? (prefix ? `${prefix}/${name}` : name);
    longName = null;
    paxPath = null;
    if (type === 'L') longName = cstr(data, 0, size);
    else if (type === 'x') paxPath = paxRecords(data).path ?? null;
    else if (type === '0' || type === '7') {
      const rel = full.split('/').slice(1).join('/');
      if (rel && !rel.split('/').includes('..') && want(rel)) files.set(rel, Buffer.from(data));
    }
    off = start + Math.ceil(size / 512) * 512;
  }
  return files;
}

// ------------------------------------------------------------------------------------------------ Doxygen

/**
 * Parses the array literal of a Doxygen search-index file (`var searchData=[…];`) without evaluating it: only
 * arrays, quoted strings and numbers are accepted.
 */
export function parseSearchData(text) {
  const start = text.indexOf('[');
  if (!/^\s*var\s+searchData\s*=\s*$/.test(text.slice(0, start))) throw new Error('not a Doxygen search-index file');
  let i = start;
  const ws = () => {
    while (i < text.length && /\s/.test(text[i])) i++;
  };
  const value = () => {
    ws();
    const c = text[i];
    if (c === '[') {
      i++;
      const arr = [];
      ws();
      if (text[i] === ']') {
        i++;
        return arr;
      }
      for (;;) {
        arr.push(value());
        ws();
        if (text[i] === ',') {
          i++;
          continue;
        }
        if (text[i] === ']') {
          i++;
          return arr;
        }
        throw new Error(`unexpected ${JSON.stringify(text[i])} at ${i}`);
      }
    }
    if (c === "'" || c === '"') {
      i++;
      let s = '';
      while (i < text.length && text[i] !== c) {
        if (text[i] === '\\') {
          i++;
          const e = text[i];
          s += e === 'n' ? '\n' : e === 't' ? '\t' : e;
        } else s += text[i];
        i++;
      }
      if (text[i] !== c) throw new Error('unterminated string');
      i++;
      return s;
    }
    const m = /^-?\d+/.exec(text.slice(i, i + 20));
    if (m) {
      i += m[0].length;
      return Number(m[0]);
    }
    throw new Error(`unexpected ${JSON.stringify(c)} at ${i}`);
  };
  const data = value();
  ws();
  if (text[i] === ';') i++;
  ws();
  if (i !== text.length) throw new Error('trailing content after the search data');
  return data;
}

/** The section letters of Doxygen's searchdata.js, read with a pattern (never evaluated). */
export function searchSections(text) {
  const names = {};
  const body = /indexSectionNames\s*=\s*\{([\s\S]*?)\}/.exec(text)?.[1] ?? '';
  for (const m of body.matchAll(/(\d+)\s*:\s*"(\w+)"/g)) names[m[2]] = Number(m[1]);
  const letters = {};
  const content = /indexSectionsWithContent\s*=\s*\{([\s\S]*?)\}/.exec(text)?.[1] ?? '';
  for (const m of content.matchAll(/(\d+)\s*:\s*"([^"]*)"/g)) letters[Number(m[1])] = [...m[2]];
  return { names, letters };
}

/**
 * Doxygen's file-name escaping (util.cpp, escapeCharsInString) for the characters LAPACK and ScaLAPACK names use,
 * with CASE_SENSE_NAMES off: `dgesv.f` → `dgesv_8f`, `la_constants.f90` → `la__constants_8f90`.
 */
export function doxygenEscape(name) {
  return name.replace(/[_.A-Z]/g, (c) => (c === '_' ? '__' : c === '.' ? '_8' : `_${c.toLowerCase()}`));
}

/** The CREATE_SUBDIRS folder Doxygen derives from a page's base name: `d{md5[14]&0xf}/d{md5[15]:02x}`. */
export function doxygenDir(base) {
  const md5 = createHash('md5').update(base).digest();
  return `d${(md5[14] & 0xf).toString(16)}/d${md5[15].toString(16).padStart(2, '0')}`;
}

// ------------------------------------------------------------------------------------------------ text

export const squash = (s) => s.replace(/\s+/g, ' ').trim();

const ABBREVIATION = /\b(?:e\.g|i\.e|etc|vs|resp|cf|approx|no|eq|fig|ref|max|min)\.$/i;
// Fortran's dotted operators (.NOT., .EQ.) take an operand, so they end no sentence; its logical constants (.TRUE.)
// end one only before a capital
const OPERATOR = /(?:^|[\s(])\.(?:not|and|or|eqv|neqv|eq|ne|lt|le|gt|ge)\.$/i;
const LOGICAL = /(?:^|[\s(])\.(?:true|false)\.$/i;

/** The text up to the first full stop, question or exclamation mark that ends a sentence, or null. */
function sentenceEnd(s) {
  for (const m of s.matchAll(/[.!?](?=\s+\S|\s*$)/g)) {
    const head = s.slice(0, m.index + 1);
    if (ABBREVIATION.test(head)) continue;
    // "LSAME returns .TRUE. if CA is …" goes on
    if (OPERATOR.test(head) || (LOGICAL.test(head) && /^\s+[^\sA-Z]/.test(s.slice(m.index + 1)))) continue;
    // so does a list with an ellipsis in it: "W( CLSTRT ), W( CLSTRT+1 ), ... W( CLEND ), DLARRF2 finds …"
    if (head.endsWith('...') && /^\s+\S/.test(s.slice(m.index + 1))) continue;
    return head;
  }
  return null;
}

/**
 * The first sentence of a text. It may run on through paragraphs of one line (BLAS sets its formulas apart:
 * "performs one of the matrix-matrix operations / C := alpha*op( A )*op( B ) + beta*C, / where …") and through prose
 * that goes on with it, in lower case and indented as the text starts ("alpha and beta are scalars, …"), but stops
 * before any other paragraph of several lines, such as a table or an indented formula, with an ellipsis when the
 * sentence is unfinished (and without the "i.e.," that led to the table).
 */
export function firstSentence(text) {
  const paras = text.split(/\n\s*\n/).map((p) => p.split('\n').filter((l) => l.trim())).filter((p) => p.length);
  const indent = (line) => /^\s*/.exec(line)[0].length;
  const prose = (lines) => /^\s*[a-z]/.test(lines[0]) && indent(lines[0]) <= indent(paras[0][0]) + 1;
  let s = '';
  for (const [i, lines] of paras.entries()) {
    if (i > 0 && ((lines.length > 1 && !prose(lines)) || s.length > 200)) break;
    s = squash(`${s} ${lines.join(' ')}`);
    const end = sentenceEnd(s);
    if (end) return end;
  }
  if (!s || /[.!?]$/.test(s)) return s;
  return `${s.replace(/[:,;]$/, '').replace(/,?\s*\b(?:i\.e|e\.g)\.$/i, '')}…`;
}

/**
 * Joins the words a text breaks at the end of a line ("topo-" before "logies" in PB_topget_.c), and keeps the hyphen
 * of a compound broken there ("quasi-" before "triangular"): the hyphen goes when the joined word is one of `words`
 * (the words of the source's prose, in lower case; see wordsOf), or the part before the hyphen is not.
 */
export function dehyphenate(text, words) {
  return text.replace(/([A-Za-z]+)-\n[ \t]*([a-z]+)/g, (all, a, b) =>
    words.has(`${a}${b}`.toLowerCase()) || !words.has(a.toLowerCase()) ? `${a}${b}` : `${a}-${b}`,
  );
}

/** The words of a text, in lower case, without the halves of the words it breaks at the end of a line. */
export const wordsOf = (text) => text.replace(/[A-Za-z]+-\n[ \t]*[a-z]+/g, ' ').toLowerCase().match(/[a-z]+/g) ?? [];

/**
 * The longest summary the builders keep, in code points: a hover card shows 200 (routineCard in src/emit/library.js),
 * so a first sentence that fits is shown whole, and a longer one is cut once, here.
 */
export const SUMMARY_MAX = 200;

/**
 * Shortens a text to at most `max` code points, the ellipsis included: at the last blank that leaves room for it,
 * unless that is in the first half.
 */
export function clip(text, max) {
  const cps = Array.from(text);
  if (cps.length <= max) return text;
  let cut = cps.lastIndexOf(' ', max - 1);
  if (cut < max / 2) cut = max - 1;
  return cps.slice(0, cut).join('').replace(/[\s,;:(]+$/, '') + '…';
}

/**
 * Corrects slips in text copied from upstream: `table` is a builder's corrections, name → [[text, replacement], …],
 * applied to `text`, the summary of `name`. A correction whose text is not there (fixed upstream, say) is noted in
 * `problems`, so that the table keeps only live slips. registry/SOURCES.md lists the tables.
 */
export function correct(table, name, text, problems) {
  let out = text;
  for (const [from, to] of Object.hasOwn(table, name) ? table[name] : []) {
    if (out.includes(from)) out = out.split(from).join(to);
    else problems.push(`${name}: the correction of "${from}" finds no such text`);
  }
  return out;
}

export const capitalise = (s) => (s ? s[0].toUpperCase() + s.slice(1) : s);

/** The most common value of a list (by JSON identity); ties go to the first seen. */
export function mode(values) {
  const counts = new Map();
  let best = null;
  let bestCount = 0;
  for (const v of values) {
    const key = JSON.stringify(v);
    const n = (counts.get(key) ?? 0) + 1;
    counts.set(key, n);
    if (n > bestCount) {
      best = v;
      bestCount = n;
    }
  }
  return best;
}

// ------------------------------------------------------------------------------------------------ output

/**
 * Serialises a registry file: compact JSON, with each top-level key on a line of its own and, for the keys listed in
 * `perLine`, one entry per line, so that diffs stay readable.
 */
export function formatRegistry(obj, perLine = []) {
  const lines = Object.entries(obj).map(([k, v]) => {
    if (perLine.includes(k) && v && typeof v === 'object' && !Array.isArray(v)) {
      const body = Object.entries(v).map(([ek, ev]) => `${JSON.stringify(ek)}:${JSON.stringify(ev)}`);
      return `${JSON.stringify(k)}:{\n${body.join(',\n')}\n}`;
    }
    return `${JSON.stringify(k)}:${JSON.stringify(v)}`;
  });
  return `{\n${lines.join(',\n')}\n}\n`;
}

/** Writes registry/<name> and returns its size in bytes. */
export async function writeRegistry(name, text) {
  await mkdir(OUT_DIR, { recursive: true });
  await writeFile(path.join(OUT_DIR, name), text);
  return Buffer.byteLength(text);
}

/** True when the module with this import.meta.url is the script Node was started with. */
export const isMain = (url) => Boolean(process.argv[1]) && url === pathToFileURL(path.resolve(process.argv[1])).href;

/** Loads scripts/registry/sources.json: the pinned upstream sources, with their versions and licences. */
export async function loadSources() {
  const text = await readFile(path.join(ROOT, 'scripts/registry/sources.json'), 'utf8');
  return JSON.parse(text);
}

/** The source with the given id, or an error. */
export function source(sources, id) {
  const s = sources.sources.find((x) => x.id === id);
  if (!s) throw new Error(`unknown source ${id}`);
  return s;
}
