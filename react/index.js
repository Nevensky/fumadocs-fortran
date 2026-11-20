// MDX components for generated Fortran pages: badges, argument lists and a link to the source. No hooks and no
// 'use client', so one set renders on the server (React Server Components) and in client-rendered MDX alike. Props
// are plain strings, numbers and booleans, as generated MDX writes them. The look is in style.css (.fdf-* classes,
// on fumadocs' colour variables); the elements outside Markdown carry fumadocs' not-prose class.

import { Children, createElement as h } from 'react';

// The label of each known kind. Any other kind is shown as it is written, in the neutral style.
const LABELS = {
  module: 'module', submodule: 'submodule', program: 'program', subroutine: 'subroutine', function: 'function',
  type: 'type', interface: 'interface',
  omp: 'OpenMP', acc: 'OpenACC', offload: 'offload', mpi: 'MPI', coarray: 'coarray', cuda: 'CUDA Fortran',
  blas: 'BLAS', lapack: 'LAPACK', scalapack: 'ScaLAPACK', cpp: 'cpp',
  bindc: 'bind(C)', pure: 'pure', elemental: 'elemental', recursive: 'recursive', abstract: 'abstract',
  deferred: 'deferred', private: 'private', public: 'public', deprecated: 'deprecated',
};

// What the entity is: a filled badge. HPC models and libraries: a colour each (--fdf-<kind>). The rest are neutral.
const ENTITY = new Set(['module', 'submodule', 'program', 'subroutine', 'function', 'type', 'interface']);
const HPC = new Set(['omp', 'acc', 'offload', 'mpi', 'coarray', 'cuda', 'blas', 'lapack', 'scalapack', 'cpp']);

// Hover text for the labels that are abbreviations or terse
const TITLES = {
  offload: 'Offloads to an accelerator (OpenMP target or OpenACC)',
  mpi: 'Message Passing Interface',
  blas: 'Basic Linear Algebra Subprograms',
  lapack: 'Linear Algebra Package',
  scalapack: 'Scalable Linear Algebra Package, for distributed memory',
  cpp: 'C preprocessor',
  bindc: 'Interoperable with C',
};

// Intent markers differ in text and arrow, not in colour alone. U+FE0E keeps ↔ a text glyph, never an emoji.
const INTENTS = {
  in: { arrow: '→', title: 'intent(in): read, not changed' },
  out: { arrow: '←', title: 'intent(out): undefined on entry, set by the procedure' },
  inout: { arrow: '↔\uFE0E', title: 'intent(inout): read, and may be changed' },
};

const cx = (...names) => names.filter(Boolean).join(' ');
const slug = (s) => s.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');
const on = (v) => v === true || v === 'true';
const text = (v) => (v === undefined || v === null || v === false ? '' : String(v).trim());
const positive = (v) => {
  const n = Number(v);
  return Number.isInteger(n) && n > 0 ? n : 0;
};

// Items with a space between each, which keeps words apart in copied text and for screen readers. In the flex rows
// the gaps set the items apart and the spaces are not drawn; inside a pill the space is the gap.
function spaced(items) {
  const out = [];
  for (const item of items) {
    if (item === null || item === undefined || item === false || item === '') continue;
    if (typeof item === 'string' && !item.trim()) continue;
    if (out.length) out.push(' ');
    out.push(item);
  }
  return out;
}

// A path that may break after each slash on a narrow screen
function breakable(s) {
  const out = [];
  let start = 0;
  for (let i = s.indexOf('/'); i >= 0; i = s.indexOf('/', i + 1)) {
    out.push(s.slice(start, i + 1), h('wbr'));
    start = i + 1;
  }
  out.push(s.slice(start));
  return out;
}

// Splits `allocatable, target, bind(c, name="f")` at the top-level commas
function splitAttrs(s) {
  const out = [];
  let depth = 0, quote = '', cur = '';
  for (const c of s) {
    if (quote) {
      if (c === quote) quote = '';
    } else if (c === '"' || c === "'") quote = c;
    else if (c === '(' || c === '[') depth++;
    else if (c === ')' || c === ']') depth = Math.max(0, depth - 1);
    else if (c === ',' && depth === 0) {
      out.push(cur.trim());
      cur = '';
      continue;
    }
    cur += c;
  }
  out.push(cur.trim());
  return out.filter(Boolean);
}

/** A wrapping row of badges. */
export function FortranBadges({ children }) {
  return h('div', { className: 'fdf-badges not-prose' }, ...spaced(Children.toArray(children)));
}

/**
 * A small pill. `kind` picks the default label and the colour: a kind of entity is filled, an HPC model or library
 * has a colour of its own, anything else is neutral. `conditional` (a cpp condition) dashes the border and adds
 * "when <condition>". `title` replaces the hover text, which by default expands an abbreviated label.
 */
export function FortranBadge({ kind, label, conditional, title }) {
  const raw = text(kind);
  const key = raw.toLowerCase();
  const cond = text(conditional);
  const shown = text(label) || LABELS[key] || raw;
  // nothing to say: no pill, rather than an empty one
  if (!shown && !cond) return null;
  const name = slug(raw);
  const className = cx(
    'fdf-badge',
    ENTITY.has(key) && 'fdf-badge-entity',
    HPC.has(key) && 'fdf-badge-hpc',
    name && `fdf-kind-${name}`,
    cond && 'fdf-badge-conditional',
    'not-prose',
  );
  return h('span', { className, title: text(title) || TITLES[key] || undefined },
    ...spaced([shown, cond ? h('span', { className: 'fdf-when' }, 'when ', h('code', null, cond)) : null]));
}

/** A titled definition list of arguments, components or results: FortranArg rows. */
export function FortranArgs({ title = 'Arguments', children }) {
  const heading = text(title);
  return h('div', { className: 'fdf-args' },
    heading ? h('p', { className: 'fdf-args-title not-prose' }, heading) : null,
    h('dl', { className: 'fdf-args-list' }, children));
}

/**
 * One argument: its name, its type with dimensions and codimensions, an intent marker, flags (optional, value and
 * the attributes in `attrs`), and the cpp condition it exists under; then its Markdown doc, indented.
 */
export function FortranArg({ name, type, dims, codims, intent, optional, value, attrs, cond, children }) {
  const t = text(type);
  let d = text(dims);
  let cd = text(codims);
  if (d && !d.startsWith('(')) d = `(${d})`;
  if (cd && !cd.startsWith('[')) cd = `[${cd}]`;
  const typeEl = t || d || cd
    ? h('code', { className: 'fdf-arg-type' },
      t || null,
      d ? h('span', { className: 'fdf-arg-dims' }, d) : null,
      cd ? h('span', { className: 'fdf-arg-codims' }, cd) : null)
    : null;

  const i = text(intent);
  const key = i.toLowerCase().replace(/[\s_]+/g, '');
  const known = INTENTS[key];
  const intentEl = !i ? null : known
    ? h('span', { className: `fdf-intent fdf-intent-${key}`, title: known.title },
      h('span', { className: 'fdf-intent-arrow', 'aria-hidden': 'true' }, known.arrow), ' ', key)
    : h('span', { className: 'fdf-intent', title: `intent(${i})` }, i);

  const flags = [];
  const seen = new Set();
  for (const f of [on(optional) && 'optional', on(value) && 'value', ...splitAttrs(text(attrs))]) {
    if (!f || seen.has(f.toLowerCase())) continue;
    seen.add(f.toLowerCase());
    flags.push(h('span', { className: 'fdf-flag' }, f));
  }

  const c = text(cond);
  const condEl = c ? h('span', { className: 'fdf-cond' }, 'when ', h('code', null, c)) : null;
  const sig = spaced([typeEl, intentEl, ...flags, condEl]);
  // whitespace alone is no doc, and leaves the dd empty
  const doc = Children.toArray(children).some((x) => typeof x !== 'string' || x.trim()) ? children : null;

  return h('div', { className: cx('fdf-arg', c && 'fdf-arg-conditional') },
    h('dt', { className: 'fdf-arg-head not-prose' },
      ...spaced([
        h('code', { className: 'fdf-arg-name' }, text(name)),
        sig.length ? h('span', { className: 'fdf-arg-sig' }, ...sig) : null,
      ])),
    // a definition list needs a dd in every group; an empty one is hidden
    h('dd', { className: 'fdf-arg-doc' }, doc));
}

/** A quiet "Defined in file:line–lineEnd" line, linked when `href` is given. */
export function FortranSource({ file, line, lineEnd, href }) {
  const f = text(file);
  const link = text(href);
  // neither a file nor a link: nothing to point at
  if (!f && !link) return null;
  const start = positive(line);
  const end = positive(lineEnd);
  const range = !start ? '' : end > start ? `${start}–${end}` : `${start}`;
  const label = f ? (range ? `${f}:${range}` : f) : link;
  const lines = !start ? '' : end > start ? `lines ${start} to ${end}` : `line ${start}`;
  const title = lines ? (f ? `${f}, ${lines}` : lines) : undefined;
  const code = h('code', null, ...breakable(label));
  const plain = title ? h('span', { title }, code) : code;
  return h('p', { className: 'fdf-source not-prose' },
    'Defined in ', link ? h('a', { className: 'fdf-source-link', href: link, title }, code) : plain);
}

/** The components, to spread into getMDXComponents(). */
export const fortranComponents = { FortranBadges, FortranBadge, FortranArgs, FortranArg, FortranSource };
