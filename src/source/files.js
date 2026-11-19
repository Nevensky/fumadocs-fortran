// Finding source files and reading them.

import fs from 'node:fs';
import path from 'node:path';
import { EXTENSIONS } from './form.js';

/**
 * Lists the Fortran sources under the given files and folders, sorted.
 * @param {string[]} paths files are always read, whatever their extension; folders are searched recursively
 * @param {{ root?: string, extensions?: string[], exclude?: string[] }} [opts] exclude: globs relative to root
 */
export function discover(paths, opts = {}) {
  const root = path.resolve(opts.root ?? '.');
  const exts = new Set((opts.extensions ?? EXTENSIONS).map((e) => e.replace(/^\./, '')));
  const exclude = (opts.exclude ?? []).map(globToRegExp);
  const out = new Set();
  const excluded = (abs) => {
    const rel = toPosix(path.relative(root, abs));
    return exclude.some((re) => re.test(rel));
  };
  const visit = (dir) => {
    let names;
    try {
      names = fs.readdirSync(dir, { withFileTypes: true });
    } catch {
      return;
    }
    names.sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0));
    for (const d of names) {
      if (d.name.startsWith('.') || d.name === 'node_modules') continue;
      const abs = path.join(dir, d.name);
      if (excluded(abs)) continue;
      if (d.isDirectory()) visit(abs);
      else if (d.isFile() && exts.has(path.extname(d.name).slice(1))) out.add(abs);
    }
  };
  for (const p of paths) {
    const abs = path.resolve(root, p);
    let st;
    try {
      st = fs.statSync(abs);
    } catch {
      continue;
    }
    if (st.isFile()) out.add(abs);
    else if (st.isDirectory() && !excluded(abs)) visit(abs);
  }
  return [...out];
}

/** `**` matches across folders, `*` within one; a pattern without a slash matches a name at any depth. */
export function globToRegExp(glob) {
  let re = '';
  for (let i = 0; i < glob.length; i++) {
    const c = glob[i];
    if (c === '*') {
      if (glob[i + 1] === '*') {
        re += '.*';
        i++;
        if (glob[i + 1] === '/') i++;
      } else re += '[^/]*';
    } else if (c === '?') re += '[^/]';
    else re += c.replace(/[.+^${}()|[\]\\]/g, '\\$&');
  }
  return new RegExp(glob.includes('/') ? `^${re}(/.*)?$` : `(^|/)${re}(/.*)?$`);
}

export const toPosix = (p) => p.split(path.sep).join('/');

const utf8 = new TextDecoder('utf-8', { fatal: true });
const latin1 = new TextDecoder('latin1');

/** Reads a source file as UTF-8, or as Latin-1 when it is not valid UTF-8 (old codes often are not). */
export function readText(file) {
  const buf = fs.readFileSync(file);
  try {
    return utf8.decode(buf);
  } catch {
    return latin1.decode(buf);
  }
}
