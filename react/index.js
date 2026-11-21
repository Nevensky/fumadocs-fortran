// MDX components for generated Fortran pages: badges, argument tables with hover cards, source blocks, graphs, and
// the kind letters of fumadocs' table of contents. No state, effects or context and no 'use client', so one set
// renders on the server (React Server Components) and in client-rendered MDX alike: what opens and closes is a
// <details> element, and the hover cards are CSS. The one hook is useId, which server components have too, for the id
// that ties a hover card to its name. Props are plain strings, numbers, booleans and objects, as generated MDX writes
// them. The look is in style.css (.fdf-* classes, on fumadocs' colour variables); the parts outside Markdown carry
// fumadocs' not-prose class.
//
// What a pill, a badge or the * of character(*) means is written once, in style.css: the components name the term
// (data-term, and data-arg for what goes with it, as self in pass(self)), and CSS says it, in a card on hover and in
// the lines of an opened row (its intent, its attributes and its length). A page of thousands of pills holds no meaning
// twice. A shape's words ("rank 2, assumed shape") are the one exception: the components make them from the
// dimensions, in English, as the argument of the shape's term and as the text of an opened row's Shape line.

import { Children, createElement as h, useId } from 'react';

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

// The labels that make a kind of badge a term of its own: the kinds of interface, a separate module procedure, an
// OpenMP parallel region, an OpenACC routine, and a cpp condition. Any other badge's term is its kind.
const VARIANTS = {
  interface: {
    'generic interface': 'generic-interface', operator: 'operator-interface', assignment: 'assignment-interface',
    'defined i/o': 'dtio-interface', 'abstract interface': 'abstract-interface', 'module interface': 'module-interface',
  },
  submodule: { 'separate module procedure': 'separate-procedure' },
  omp: { 'openmp parallel region': 'omp-parallel' },
  acc: { 'openacc routine': 'acc-routine' },
  cpp: { conditional: 'conditional' },
};

// Intent markers differ in text and arrow, not in colour alone. U+FE0E keeps ↔ a text glyph, never an emoji.
const INTENTS = {
  in: { arrow: '→' },
  out: { arrow: '←' },
  inout: { arrow: '↔\uFE0E' },
};

// The terms of the * and the : of a character length, which say what each means, in their cards and an opened row's
// Length line. The * of a function's result (an obsolescent form) is a term of its own: the length comes from where
// the function is called.
const LENGTHS = { '*': 'assumed-length', ':': 'deferred-length' };
const lengthTerm = (spec, result) => (spec === '*' && result ? 'assumed-length-result'
  : Object.hasOwn(LENGTHS, spec) ? LENGTHS[spec] : '');

// The optional columns of an argument table, in the order they are drawn, with their headings. The name column and
// the expander are always there.
const COLUMNS = { type: 'Type', shape: 'Shape', intent: 'Intent', attrs: 'Attributes' };

// The letter of each kind in the table of contents
const LETTERS = {
  module: 'mod', submodule: 'smod', program: 'prog', type: 't', interface: 'i', subroutine: 's', function: 'f',
  variable: 'v', parameter: 'p', enum: 'e',
};

// Hosts a source link is named after; any other shows its own name
const HOSTS = {
  'github.com': 'GitHub', 'gitlab.com': 'GitLab', 'codeberg.org': 'Codeberg', 'bitbucket.org': 'Bitbucket',
  'git.sr.ht': 'sourcehut',
};

const cx = (...names) => names.filter(Boolean).join(' ');
const slug = (s) => s.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');
const on = (v) => v === true || v === 'true';
const text = (v) => (v === undefined || v === null || v === false ? '' : String(v).trim());
const positive = (v) => {
  const n = Number(v);
  return Number.isInteger(n) && n > 0 ? n : 0;
};
// whitespace alone is no content: MDX hands over the blank lines around a block
const filled = (children) => Children.toArray(children).some((x) => typeof x !== 'string' || x.trim());

// A link to a page, an anchor or the web. Another scheme (javascript:, data:) is dropped rather than drawn: React
// would block it anyway, with an error in the console.
function safeHref(v) {
  const s = text(v);
  const scheme = /^([a-z][a-z0-9+.-]*):/i.exec(s.replace(/[\u0000- ]/g, ''))?.[1].toLowerCase();
  return scheme && scheme !== 'http' && scheme !== 'https' && scheme !== 'mailto' ? '' : s;
}

// Items with a space between each, which keeps words apart in copied text and for screen readers. In the flex and
// grid rows the gaps set the items apart and the spaces are not drawn; inside a pill the space is the gap.
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

// Where `allocatable, target, bind(c, name="f")` splits at the top-level commas, from `from` up to `to`: [start, end]
// of each item, its blanks included
function itemsOf(s, from = 0, to = s.length) {
  const out = [];
  let depth = 0, quote = '', start = from;
  for (let i = from; i < to; i++) {
    const c = s[i];
    if (quote) {
      if (c === quote) quote = '';
    } else if (c === '"' || c === "'") quote = c;
    else if (c === '(' || c === '[') depth++;
    else if (c === ')' || c === ']') depth = Math.max(0, depth - 1);
    else if (c === ',' && depth === 0) {
      out.push([start, i]);
      start = i + 1;
    }
  }
  out.push([start, to]);
  return out;
}

// Splits `allocatable, target, bind(c, name="f")` at the top-level commas
const splitAttrs = (s) => itemsOf(s).map(([a, b]) => s.slice(a, b).trim()).filter(Boolean);

// Where the bracket that opens at s[at] closes, or -1
function closing(s, at) {
  let depth = 0, quote = '';
  for (let i = at; i < s.length; i++) {
    const c = s[i];
    if (quote) {
      if (c === quote) quote = '';
    } else if (c === '"' || c === "'") quote = c;
    else if (c === '(' || c === '[') depth++;
    else if ((c === ')' || c === ']') && !--depth) return i;
  }
  return -1;
}

/**
 * The length of a character type, as written, and where it stands in the type: '*', ':', an expression such as 'n',
 * or '' when none is given (at -1). It is what follows character* or, leniently, the selector (character(len=10)*20
 * gives 20, though the generator writes that type as character(len=20)), or else len= in the selector, or its first
 * item without a keyword (the second is the kind). Null for any other type.
 */
function lengthOf(t) {
  const m = /^\s*character\b\s*/i.exec(t);
  if (!m) return null;
  const i = m[0].length;
  const spec = (a, b) => {
    while (a < b && /\s/.test(t[a])) a++;
    while (b > a && /\s/.test(t[b - 1])) b--;
    return { spec: t.slice(a, b), at: a };
  };
  const none = { spec: '', at: -1 };
  // *(*) or *10 from `at`, or null
  const starred = (at) => {
    let j = at;
    while (t[j] === ' ') j++;
    if (t[j] !== '*') return null;
    j++;
    while (t[j] === ' ') j++;
    const k = t[j] === '(' ? closing(t, j) : -1;
    if (k > 0) return spec(j + 1, k);
    const n = /^\d+/.exec(t.slice(j));
    return n ? spec(j, j + n[0].length) : null;
  };
  // character*(*), character*10
  if (t[i] === '*') return starred(i) ?? none;
  const k = t[i] === '(' ? closing(t, i) : -1;
  if (k < 0) return none;
  const own = starred(k + 1);
  if (own) return own;
  let n = 0;
  for (const [a, b] of itemsOf(t, i + 1, k)) {
    const kw = /^\s*(len|kind)\s*=\s*/i.exec(t.slice(a, b));
    if (kw) {
      if (kw[1].toLowerCase() === 'len') return spec(a + kw[0].length, b);
    } else if (n++ === 0) return spec(a, b);
  }
  return none;
}

/**
 * What an attribute pill stands for, for its card (the meanings are in style.css, by term): [term, what goes with it].
 * The keyword in lower case and what its brackets hold, as pass and self for pass(self); `default dp` is default and
 * dp, `= 0` init and 0, `=> null()` pointer-init and null(). Nothing for text that is none of these, such as => alone,
 * which is no initialisation to '>'.
 */
function termOf(flag) {
  let m = /^(=>|=(?!>))\s*(\S[\s\S]*)$/.exec(flag);
  if (m) return [m[1] === '=' ? 'init' : 'pointer-init', m[2]];
  m = /^default\s+(\S[\s\S]*)$/i.exec(flag);
  if (m) return ['default', m[1]];
  m = /^([a-z]\w*)\s*(?:\(([\s\S]*)\))?$/i.exec(flag);
  return m ? [m[1].toLowerCase(), m[2]?.trim() || undefined] : [];
}

// The data attributes that name a term for style.css: no attribute for no term or no argument
const termed = (term, arg) => ({ 'data-term': term || undefined, 'data-arg': term && arg ? arg : undefined });

// lucide's chevron-down, as fumadocs' TypeTable draws it; CSS turns it when its row or block is open. The size
// attributes keep it small on a page without the stylesheet.
const chevron = () => h('svg', {
  className: 'fdf-chevron', viewBox: '0 0 24 24', width: 16, height: 16, fill: 'none', stroke: 'currentColor',
  strokeWidth: 2, strokeLinecap: 'round', strokeLinejoin: 'round', 'aria-hidden': 'true',
}, h('path', { d: 'm6 9 6 6 6-6' }));

// lucide's arrow-up-right: the link leaves the site
const arrow = () => h('svg', {
  className: 'fdf-icon', viewBox: '0 0 24 24', width: 14, height: 14, fill: 'none', stroke: 'currentColor',
  strokeWidth: 2, strokeLinecap: 'round', strokeLinejoin: 'round', 'aria-hidden': 'true',
}, h('path', { d: 'M7 7h10v10' }), h('path', { d: 'M7 17 17 7' }));

/** A wrapping row of badges. */
export function FortranBadges({ children }) {
  return h('div', { className: 'fdf-badges not-prose' }, ...spaced(Children.toArray(children)));
}

/**
 * A small pill. `kind` picks the default label and the colour: a kind of entity is filled, an HPC model or library
 * has a colour of its own, anything else is neutral. `conditional` (a cpp condition) dashes the border and adds
 * "when <condition>". On hover a card says what the badge means (style.css has the meanings, by the term in
 * data-term: the kind, or the kind that some labels make, such as omp-parallel), then `title`, such as the routines
 * or constructs the badge stands for. The title is text in the badge, hidden from the eye until the card shows, so
 * that screen readers read it with the badge.
 */
export function FortranBadge({ kind, label, conditional, title }) {
  const raw = text(kind);
  const key = raw.toLowerCase();
  const cond = text(conditional);
  const given = text(label);
  const shown = given || (Object.hasOwn(LABELS, key) && LABELS[key]) || raw;
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
  // a condition alone is the condition's term; the badge's argument is its condition
  const variants = Object.hasOwn(VARIANTS, key) ? VARIANTS[key] : {};
  const variant = given.toLowerCase();
  const term = (Object.hasOwn(variants, variant) && variants[variant]) || name || (cond && 'when');
  const note = text(title);
  // The note is the card when there is one, the meaning before its text. It has the condition too: a browser that
  // reads data-arg where the meaning is drawn, rather than on the badge that names the term, finds it there.
  return h('span', { className, ...termed(term, cond) }, ...spaced([
    shown,
    note ? h('span', { className: 'fdf-badge-note', 'data-arg': (term && cond) || undefined }, note) : null,
    cond ? h('span', { className: 'fdf-when' }, 'when ', h('code', null, cond)) : null,
  ]));
}

// The optional columns to show: those `columns` names (space- or comma-separated) in table order; all when absent
function columnsOf(columns) {
  if (columns === undefined || columns === null) return Object.keys(COLUMNS);
  const want = new Set((Array.isArray(columns) ? columns.join(' ') : String(columns)).toLowerCase().split(/[\s,]+/));
  return Object.keys(COLUMNS).filter((c) => want.has(c));
}

/**
 * A table of arguments, components, bindings or results in the manner of fumadocs' TypeTable: a title, a header
 * row, then the FortranArg rows. `columns` names the optional columns to show (type, shape, intent, attrs; all four
 * by default). The widths come from the table, through CSS variables, so that every row lines up; data-columns tells
 * the stylesheet which columns are left out.
 */
export function FortranArgs({ title = 'Arguments', columns, children }) {
  const heading = text(title);
  const shown = columnsOf(columns);
  // the header is for the eye: each row reads on its own, and the pills say what they are
  const head = [
    h('span', { className: 'fdf-col-name' }, 'Name'),
    ...shown.map((c) => h('span', { className: `fdf-col-${c}` }, COLUMNS[c])),
  ];
  return h('div', { className: 'fdf-args', 'data-columns': shown.join(' ') },
    heading ? h('p', { className: 'fdf-args-title not-prose' }, heading) : null,
    h('div', { className: 'fdf-args-head not-prose', 'aria-hidden': 'true' }, ...spaced(head)),
    children);
}

// refs as an MDX expression gives them (an object), or as JSON text. Keys are matched without regard to case.
function refsOf(refs) {
  let r = refs;
  if (typeof r === 'string') {
    try {
      r = JSON.parse(r);
    } catch {
      return null;
    }
  }
  if (!r || typeof r !== 'object' || Array.isArray(r)) return null;
  const out = new Map();
  for (const [k, v] of Object.entries(r)) {
    const key = k.trim().toLowerCase();
    if (key && v && typeof v === 'object' && !out.has(key)) out.set(key, v);
  }
  return out.size ? out : null;
}

// The type as code, with each whole-word name that `refs` knows as a FortranRef, and the * or : of a character length
// in a span of its own, which has a card that says what it means. The code is cut around these rather than wrapping
// them, so that a card, which sits inside its name or its glyph, takes the page's font and not the code's. A long type
// breaks where it must (overflow-wrap in style.css): break opportunities written into it would split the names that
// screen readers read. `result`: the type is a function result's, whose * has a meaning of its own.
function typeRuns(t, refs, result = false) {
  const code = (s) => h('code', null, s);
  // what is cut out of the code: [where, how long, the element]
  const cuts = [];
  const len = lengthOf(t);
  const term = len ? lengthTerm(len.spec, result) : '';
  if (term) cuts.push([len.at, 1, () => h('span', { className: 'fdf-len', 'data-term': term }, code(len.spec))]);
  if (refs) {
    for (const m of t.matchAll(/[A-Za-z_][\w$]*/g)) {
      // the tail of a longer word (the dp of 2dp) is not a name
      if (m.index > 0 && /[\w$]/.test(t[m.index - 1])) continue;
      const ref = refs.get(m[0].toLowerCase());
      if (!ref) continue;
      cuts.push([m.index, m[0].length,
        () => h(FortranRef, { href: ref.href, title: ref.title, detail: ref.detail, note: ref.note }, m[0])]);
    }
  }
  const out = [];
  let from = 0;
  for (const [at, n, el] of cuts.sort((a, b) => a[0] - b[0])) {
    if (at > from) out.push(code(t.slice(from, at)));
    out.push(el());
    from = at + n;
  }
  if (from < t.length) out.push(code(t.slice(from)));
  return out;
}

/**
 * The shape in words, from the dimensions, the codimensions and the attributes (lower case): "rank 2, assumed shape",
 * "rank 1, deferred shape" (allocatable or pointer), "rank 2, assumed size", "assumed rank", then "coarray".
 */
function shapeWords(dims, codims, attrs) {
  const out = [];
  const specs = dims ? splitAttrs(dims.slice(1, -1)) : [];
  if (specs.length === 1 && specs[0] === '..') out.push('assumed rank');
  else if (specs.length) {
    const last = specs[specs.length - 1];
    const deferred = attrs.has('allocatable') || attrs.has('pointer');
    // `:` alone defers or assumes the extent; `lb:` assumes it; `*` (or `lb:*`) last is assumed size
    const kind = /^(?:.*:)?\s*\*$/.test(last) ? (attrs.has('parameter') ? 'implied shape' : 'assumed size')
      : specs.every((s) => s === ':') ? (deferred ? 'deferred shape' : 'assumed shape')
        : specs.every((s) => s.endsWith(':')) ? 'assumed shape'
          : specs.every((s) => !s.startsWith(':') && !s.endsWith(':')) ? 'explicit shape' : '';
    out.push(`rank ${specs.length}${kind ? `, ${kind}` : ''}`);
  }
  if (codims) {
    const corank = splitAttrs(codims.slice(1, -1)).length;
    out.push(corank > 1 ? `coarray, corank ${corank}` : 'coarray');
  }
  return out.join('; ');
}

/**
 * One row of a FortranArgs table: the name, the type (names in `refs` link and carry a hover card), the shape
 * (dimensions and codimensions), the intent marker (or "result"), and the attributes with the cpp condition the row
 * exists under. Each pill, the shape and the * or : of a character length have a card that says what they mean (the
 * meanings are in style.css). The row opens, as fumadocs' TypeTable rows do, to a panel with the doc (the children,
 * Markdown), the declaration, the intent in words and the attributes each beside its meaning (the text of their
 * cards, for the keyboard and screen readers), the shape in words, a character type's length (that of a * or a : in
 * words, from style.css) and the condition. A row with nothing for its panel to say (no doc, declaration, shape,
 * condition, * or : length, intent in words, or attribute with a term) is a plain row, which does not open: a type, a
 * result, an intent of its own and attributes without a term are all in its cells. In a narrow table the row keeps
 * the name and the intent, and the panel shows the type and the shape too: both are drawn, and the stylesheet shows
 * the one that fits.
 */
export function FortranArg({
  name, type, dims, codims, intent, optional, value, attrs, cond, result, decl, refs, children,
}) {
  const t = text(type);
  let d = text(dims);
  let cd = text(codims);
  if (d && !d.startsWith('(')) d = `(${d})`;
  if (cd && !cd.startsWith('[')) cd = `[${cd}]`;
  // The type is drawn twice, in its cell and in the copy for a narrow table: a new element each time, as a server
  // renders an element it meets twice only once, and the hover cards of both copies would then share one id. The
  // shape and the pills are new elements for each place too.
  const r = refsOf(refs);
  const res = on(result);
  const typeEl = () => (t ? h('span', { className: 'fdf-arg-type' }, ...typeRuns(t, r, res)) : null);
  const shapeEl = () => (d || cd
    ? h('code', { className: 'fdf-arg-shape' },
      d ? h('span', { className: 'fdf-arg-dims' }, d) : null,
      cd ? h('span', { className: 'fdf-arg-codims' }, cd) : null)
    : null);

  // The pills name their term, which gives them a card. A flag in the panel has the term on the meaning beside it.
  const i = text(intent);
  const key = i.toLowerCase().replace(/[\s_]+/g, '');
  const known = Object.hasOwn(INTENTS, key) ? INTENTS[key] : null;
  const intentEl = res
    ? h('span', { className: 'fdf-intent fdf-intent-result', 'data-term': 'result' }, 'result')
    : !i ? null : known
      ? h('span', { className: `fdf-intent fdf-intent-${key}`, 'data-term': `intent-${key}` },
        h('span', { className: 'fdf-intent-arrow', 'aria-hidden': 'true' }, known.arrow), ' ', key)
      : h('span', { className: 'fdf-intent' }, i);

  const flags = [];
  const seen = new Set();
  for (const f of [on(optional) && 'optional', on(value) && 'value', ...splitAttrs(text(attrs))]) {
    if (!f || seen.has(f.toLowerCase())) continue;
    seen.add(f.toLowerCase());
    const [term, arg] = termOf(f);
    flags.push({ f, term, arg });
  }
  const flag = ({ f, term, arg }, card) => h('span', { className: 'fdf-flag', ...termed(card && term, arg) }, f);

  const c = text(cond);
  const condEl = c ? h('span', { className: 'fdf-cond', ...termed('when', c) }, 'when ', h('code', null, c)) : null;
  const words = shapeWords(d, cd, seen);
  // a character type's length: assumed (*) and deferred (:) by their terms, whose meanings style.css writes in, any
  // other as written, none the default of 1
  const len = lengthOf(t);
  const lenTerm = len ? lengthTerm(len.spec, res) : '';
  const dc = text(decl);
  const doc = filled(children) ? children : null;

  // the cells, in column order; an empty one still holds its place in the grid
  const none = h('span', { className: 'fdf-arg-none', 'aria-hidden': 'true' }, '—');
  const cells = spaced([
    h('span', { className: 'fdf-col-name' }, h('code', { className: 'fdf-arg-name' }, text(name))),
    h('span', { className: 'fdf-col-type' }, typeEl()),
    h('span', { className: 'fdf-col-shape', ...termed(words && 'shape', words) }, shapeEl() ?? none),
    h('span', { className: 'fdf-col-intent' }, intentEl),
    h('span', { className: 'fdf-col-attrs' }, ...spaced([...flags.map((x) => flag(x, true)), condEl])),
  ]);

  // An intent, or an attribute with a term, is said in words in the panel: without it, the keyboard and screen readers,
  // which get no hover card, would never hear what the pill means.
  if (!doc && !dc && !words && !c && !lenTerm && !(known && !res) && !flags.some((x) => x.term)) {
    // nothing to open to: a plain row, and for a narrow table a line with what its hidden cells hold
    const alt = spaced([typeEl(), shapeEl(), ...flags.map((x) => flag(x, true))]);
    return h('div', { className: 'fdf-arg fdf-arg-plain' },
      h('div', { className: 'fdf-arg-row not-prose' }, ...cells),
      alt.length ? h('div', { className: 'fdf-arg-alt not-prose' }, ...alt) : null);
  }

  const field = (label, content, narrow, props = null) => h('div', {
    className: cx('fdf-arg-field', narrow && 'fdf-arg-narrow'),
  }, h('dt', null, label), h('dd', props, ...content));
  // the length as written, or for a * or a : nothing: style.css writes in the meaning of the term, as for the intent
  const length = !len || lenTerm ? null : len.spec
    ? h('span', { className: 'fdf-arg-type' }, ...typeRuns(len.spec, r))
    : '1, the default';
  // What the intent, the attributes and a * or : length mean, which style.css writes in by the term: the intent's
  // meaning and the length's name them, an attribute's stands beside its pill
  const fields = [
    // the type, which a narrow table hides
    t && field('Type', [typeEl()], true),
    dc && field('Declaration', [h('code', { className: 'fdf-arg-decl' }, dc)]),
    known && !res && field('Intent', [], false, { 'data-term': `intent-${key}` }),
    flags.length && field('Attributes', [h('dl', { className: 'fdf-arg-terms' },
      ...flags.flatMap((x) => [h('dt', null, flag(x, false)), h('dd', termed(x.term, x.arg))]))]),
    (d || cd) && field('Shape', spaced([h('span', { className: 'fdf-arg-narrow' }, shapeEl()), words]), !words),
    len && field('Length', length ? [length] : [], false, lenTerm ? { 'data-term': lenTerm } : null),
    c && field('Exists when', [h('code', null, c)]),
  ].filter(Boolean);

  // A reader may open a row before React has hydrated the page: the open attribute the server's markup lacked is
  // theirs, not a mismatch to warn about. Likewise for the source blocks and the graphs.
  return h('details', { className: cx('fdf-arg', c && 'fdf-arg-conditional'), suppressHydrationWarning: true },
    h('summary', { className: 'fdf-arg-row not-prose' }, ...cells, chevron()),
    h('div', { className: 'fdf-arg-panel' },
      doc ? h('div', { className: 'fdf-arg-doc' }, doc) : null,
      fields.length ? h('dl', { className: 'fdf-arg-fields not-prose' }, ...fields) : null));
}

/**
 * A name that links to `href` and carries a hover card: `title` in code, then `detail` and a muted `note`. The card
 * is CSS: it shows while the name is hovered or has focus. It sits inside the name, so that a click on it follows the
 * link and, in a row, does not open or close the row. Without a link the name is a button that does nothing, which the
 * keyboard reaches and which shows the card while it has focus. For screen readers the card describes the name
 * (aria-describedby) and has no text of its own (aria-hidden), so that a row is not read with the card in it. The card
 * is not prose, so that a name in running text does not give its title the look of inline code.
 */
export function FortranRef({ href, title, detail, note, children }) {
  // before any return: a hook runs on every render
  const id = useId();
  if (!filled(children)) return null;
  const link = safeHref(href);
  const parts = spaced([
    text(title) ? h('code', { className: 'fdf-ref-title' }, text(title)) : null,
    text(detail) ? h('span', { className: 'fdf-ref-detail' }, text(detail)) : null,
    text(note) ? h('span', { className: 'fdf-ref-note' }, text(note)) : null,
  ]);
  const card = parts.length
    ? h('span', { className: 'fdf-ref-card not-prose', role: 'tooltip', 'aria-hidden': 'true', id }, ...parts)
    : null;
  // the name's own text is set as code, apart from the card beside it, which keeps the font of the text around the name
  const label = h('span', { className: 'fdf-ref-text' }, children);
  const described = card ? { 'aria-describedby': id } : {};
  const name = link
    ? h('a', { className: 'fdf-ref-name', href: link, ...described }, label, card)
    : card
      ? h('button', { className: 'fdf-ref-name', type: 'button', ...described }, label, card)
      : h('span', { className: 'fdf-ref-name' }, label);
  return h('span', { className: 'fdf-ref' }, name);
}

// What a source link is called: its host's name, or its host
function hostOf(link) {
  try {
    const host = new URL(link).hostname.replace(/^www\./, '');
    return HOSTS[host] ?? host;
  } catch {
    // a path on the site itself
    return 'Open';
  }
}

/**
 * Where an entity is defined, as a header in the manner of mkdocstrings: "Source code in <file>", its lines, and a
 * link to them (`href`). With children (the generated code block) it is a block that opens to the code; without, it
 * is the header alone, all of it a link when there is one.
 */
export function FortranSource({ file, line, lineEnd, href, children }) {
  const f = text(file);
  const link = safeHref(href);
  // neither a file nor a link: nothing to point at
  if (!f && !link) return null;
  const start = positive(line);
  const end = positive(lineEnd);
  const lines = !start ? '' : end > start ? `lines ${start}–${end}` : `line ${start}`;
  const spelt = !start ? '' : end > start ? `lines ${start} to ${end}` : `line ${start}`;
  const title = [f, spelt].filter(Boolean).join(', ') || undefined;
  const label = h('span', { className: 'fdf-source-title' },
    ...(f ? ['Source code in ', h('code', null, f)] : ['Source code']));
  const range = lines ? h('span', { className: 'fdf-source-lines' }, lines) : null;
  const host = (tag, props) => h(tag, { className: 'fdf-source-link', ...props }, hostOf(link), ' ', arrow());

  if (filled(children)) {
    // the link is a real one inside the summary: following it does not open the block. It and the chevron are one
    // group, which wraps as a whole when the line is full, so that the chevron never stands alone. Its title says
    // what "GitHub" alone does not: the file and the lines it opens.
    const end = h('span', { className: 'fdf-source-end' }, link ? host('a', { href: link, title }) : null, chevron());
    return h('details', { className: 'fdf-source', suppressHydrationWarning: true },
      h('summary', { className: 'fdf-source-head not-prose' }, ...spaced([label, range, end])),
      h('div', { className: 'fdf-source-body' }, children));
  }
  // all of the header a link: its text names the file and the lines already, and a title would have screen readers
  // say them twice
  const head = spaced([label, range, link ? host('span', {}) : null]);
  return h('div', { className: 'fdf-source not-prose' }, link
    ? h('a', { className: 'fdf-source-head', href: link }, ...head)
    : h('div', { className: 'fdf-source-head' }, ...head));
}

/**
 * A diagram (the site draws the ```mermaid block inside): a card with the title, if any, as a small label or, when
 * `collapsed`, a block titled by it ("Graph" without one) that starts closed. Nothing without a diagram. The diagram is
 * not prose: fumadocs' link style would underline the label of every node that links, and set it in a heavier weight
 * than it was laid out for.
 */
export function FortranGraph({ title, collapsed, children }) {
  if (!filled(children)) return null;
  const t = text(title);
  const label = (s) => h('span', { className: 'fdf-graph-title' }, s);
  const body = h('div', { className: 'fdf-graph-body not-prose' }, children);
  if (on(collapsed)) {
    return h('details', { className: 'fdf-graph', suppressHydrationWarning: true },
      h('summary', { className: 'fdf-graph-head not-prose' }, label(t || 'Graph'), chevron()),
      body);
  }
  return h('figure', { className: 'fdf-graph' },
    t ? h('figcaption', { className: 'fdf-graph-head not-prose' }, label(t)) : null,
    body);
}

/**
 * fumadocs' table of contents with a letter for each entity's kind: `kinds` maps anchors (without '#') to kinds, as
 * the generated frontmatter's fortran.toc does. Returns a new array; the items it has no kind for stay as they are.
 */
export function fortranToc(toc, kinds) {
  if (!kinds || typeof kinds !== 'object' || !Array.isArray(toc)) return toc;
  const kindOf = (anchor) => {
    if (Object.hasOwn(kinds, anchor)) return kinds[anchor];
    try {
      const plain = decodeURIComponent(anchor);
      return Object.hasOwn(kinds, plain) ? kinds[plain] : undefined;
    } catch {
      return undefined;
    }
  };
  return toc.map((item) => {
    const url = typeof item?.url === 'string' ? item.url : '';
    const kind = text(kindOf(url.slice(url.indexOf('#') + 1))).toLowerCase();
    if (!Object.hasOwn(LETTERS, kind)) return item;
    return {
      ...item,
      title: h('span', { className: 'fdf-toc' },
        h('span', { className: `fdf-toc-kind fdf-toc-${kind}`, 'aria-hidden': 'true' }, LETTERS[kind]), ' ',
        h('span', { className: 'fdf-toc-name' }, item.title)),
    };
  });
}

/** The components, to spread into getMDXComponents(). */
export const fortranComponents = {
  FortranBadges, FortranBadge, FortranArgs, FortranArg, FortranRef, FortranSource, FortranGraph,
};
