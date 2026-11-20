// fumadocs-fortran/shiki: Shiki grammars for Fortran code blocks (free and fixed form; OpenMP, OpenACC, CUDA Fortran
// and compiler directives; fypp), and transformers for fumadocs. Plain ESM without dependencies: neither Shiki nor
// fumadocs is imported, so this works with the versions the site has.
import { free, fixed, directives, fypp, compilerSentinels } from './grammars.js';

const FIXED_IDS = new Set([fixed.name, ...fixed.aliases]);
const FORTRAN_IDS = new Set([free.name, ...free.aliases, ...FIXED_IDS]);

// ---------------------------------------------------------------- languages

const variants = new Map();

/** The fixed-form grammar with its column limit at `limit` (or none, for false). */
function fixedForm(limit) {
  if (limit === 72) return fixed;
  if (!variants.has(limit)) {
    const rule = fixed.repository['line-end-comment'];
    let { injections, repository } = fixed;
    if (limit === false) {
      // the injection that holds the rule also brings in the directives: drop the rule only
      const key = Object.keys(injections).find((k) => k.startsWith('L:'));
      const patterns = injections[key].patterns.filter((p) => p.include !== '#line-end-comment');
      injections = { ...injections, [key]: { ...injections[key], patterns } };
    } else {
      repository = { ...repository, 'line-end-comment': { ...rule, begin: rule.begin.replace('{72}', `{${limit}}`) } };
    }
    variants.set(limit, Object.freeze({ ...fixed, injections, repository }));
  }
  return variants.get(limit);
}

/**
 * The grammars, for Shiki's `createHighlighter({ langs })` and fumadocs' `rehypeCode` `langs`. Load them as a set:
 * the fixed-form grammar includes the free-form one, and the injections need both.
 */
export function getFortranLanguages(options = {}) {
  const { fixedLineLength = 72, directives: withDirectives = true, fypp: withFypp = true } = options;
  if (fixedLineLength !== false && !(Number.isInteger(fixedLineLength) && fixedLineLength > 0)) {
    throw new TypeError(`fixedLineLength must be a positive integer or false, not ${fixedLineLength}`);
  }
  const langs = [free, fixedForm(fixedLineLength)];
  if (withDirectives) langs.push(directives);
  if (withFypp) langs.push(fypp);
  return langs;
}

/** The grammars with their defaults: fixed-form lines end at column 72, directives and fypp are highlighted. */
export const fortranLanguages = getFortranLanguages();

/**
 * Options for fumadocs' rehypeCode (through fumadocs-mdx's `applyMdxPreset({ rehypeCodeOptions })`): `base` with the
 * Fortran grammars added to its `langs` and the Fortran transformers to its `transformers`. Pass fumadocs'
 * `rehypeCodeDefaultOptions` (or your own options) as `base`: rehypeCode replaces its default transformers with the
 * ones given. No `langAlias` is used, since that makes fumadocs create a second highlighter.
 */
export function fortranRehypeCode(base = {}, options = {}) {
  return {
    ...base,
    langs: [...(base.langs ?? []), ...getFortranLanguages(options)],
    transformers: [...(base.transformers ?? []), transformerFortranNotation(), transformerFortranDirectives()],
  };
}

// ---------------------------------------------------------------- notations

// Shiki's notation transformers, which fumadocs uses, do not know ! comments; this one reads the same notations
// in Fortran comments and gives lines, words and the block the classes those transformers give, which fumadocs-ui
// styles. A notation alone on a comment line applies to the next line, otherwise to its own line; :n extends it
// to n lines (a word notation without :n reaches the end of the block).
const NOTATION = /\[!code (?:(highlight|hl|focus|\+\+|--)|word:((?:\\.|[^:\]])+))(?::(\d+))?\]/gi;
const CLASSES = {
  highlight: ['highlighted', 'has-highlighted'],
  hl: ['highlighted', 'has-highlighted'],
  focus: ['focused', 'has-focused'],
  '++': ['diff add', 'has-diff'],
  '--': ['diff remove', 'has-diff'],
};
const WORD_CLASS = 'highlighted-word';
const NOTATION_KEY = 'fumadocs-fortran:notation';

/** Where the line's comment starts, or -1: the first ! outside a string, or a comment line in fixed form. */
function commentStart(line, fixedForm) {
  if (fixedForm && /^[cC*dD!]/.test(line)) return 0;
  let quote = '';
  for (let i = 0; i < line.length; i++) {
    const c = line[i];
    if (quote) {
      if (c === quote) quote = line[i + 1] === quote ? (i++, quote) : '';
    } else if (c === "'" || c === '"') quote = c;
    else if (c === '!' && !(fixedForm && i === 5)) return i; // column 6 marks a continuation in fixed form
  }
  return -1;
}

/** The notations in a line's comment, and the line without them; null when there are none. */
function readNotations(line, fixedForm) {
  const at = commentStart(line, fixedForm);
  if (at < 0) return null;
  const comment = line.slice(at);
  const found = [...comment.matchAll(NOTATION)];
  if (!found.length) return null;
  const notations = found.map((m) => ({
    kind: m[1]?.toLowerCase(),
    word: m[2]?.replace(/\\(.)/g, '$1'),
    count: m[3] ? Number(m[3]) : undefined,
  }));
  // drop the notations, then a comment mark they leave empty
  let rest = (line.slice(0, at) + comment.replace(NOTATION, '')).replace(/[ \t]*!+[ \t]*$/, '').trimEnd();
  if (fixedForm && at === 0 && /^[cC*dD!][ \t]*$/.test(rest)) rest = '';
  return { rest, notations, standalone: rest.trim() === '' };
}

const textOf = (node) => (node.type === 'text' ? node.value : (node.children ?? []).map(textOf).join(''));

/** Split the line's tokens at [start, end) and give the part inside the word class, as Shiki's transformer does. */
function markRange(context, line, start, end) {
  const children = [];
  let pos = 0;
  for (const child of line.children) {
    const text = textOf(child);
    const from = pos;
    pos += text.length;
    const token = child.type === 'element' && child.children.length === 1 && child.children[0].type === 'text';
    if (!token || pos <= start || from >= end) {
      children.push(child);
      continue;
    }
    const a = Math.max(start, from) - from;
    const b = Math.min(end, pos) - from;
    const piece = (value) => ({ ...child, properties: { ...child.properties }, children: [{ type: 'text', value }] });
    if (a > 0) children.push(piece(text.slice(0, a)));
    const inside = piece(text.slice(a, b));
    context.addClassToHast(inside, WORD_CLASS);
    children.push(inside);
    if (b < text.length) children.push(piece(text.slice(b)));
  }
  line.children = children;
}

/** fumadocs' `[!code highlight]`, `[!code focus]`, `[!code ++]`, `[!code --]` and `[!code word:x]` in ! comments. */
export function transformerFortranNotation() {
  return {
    name: 'fumadocs-fortran:notation',
    preprocess(code, options) {
      if (!FORTRAN_IDS.has(options.lang) || !code.includes('[!code')) return;
      const fixedForm = FIXED_IDS.has(options.lang);
      const kept = [];
      const marks = []; // { notation, at: the index of the line in kept }
      let pending = []; // from comment lines removed, for the next line kept
      let changed = false;
      for (const line of code.split('\n')) {
        const read = readNotations(line, fixedForm);
        if (read) changed = true;
        if (read?.standalone) {
          pending.push(...read.notations);
          continue;
        }
        kept.push(read ? read.rest : line);
        for (const notation of [...pending, ...(read?.notations ?? [])]) marks.push({ notation, at: kept.length - 1 });
        pending = [];
      }
      if (!changed) return;
      this.meta[NOTATION_KEY] = marks;
      return kept.join('\n');
    },
    code(node) {
      const marks = this.meta[NOTATION_KEY];
      if (!marks) return;
      const lines = node.children.filter((c) => c.type === 'element');
      for (const { notation, at } of marks) {
        const end = Math.min(lines.length, at + (notation.count ?? (notation.word ? Infinity : 1)));
        if (notation.word) {
          const { word } = notation;
          for (let i = at; i < end; i++) {
            const text = textOf(lines[i]);
            for (let j = text.indexOf(word); j >= 0; j = text.indexOf(word, j + word.length)) markRange(this, lines[i], j, j + word.length);
          }
          continue;
        }
        const [lineClass, preClass] = CLASSES[notation.kind];
        for (let i = at; i < end; i++) this.addClassToHast(lines[i], lineClass);
        this.addClassToHast(this.pre, preClass);
      }
    },
  };
}

// ---------------------------------------------------------------- directive lines

const SENTINEL = /^(?:[cC*!]|[ \t]*!)\$(omp|ompx|acc|cuf)(?![\w$])/i;
const CONDITIONAL = /^(?:[cC*!]\$(?=[ \t\d]|$)|[ \t]*!\$(?=[ \t&]|$)|[ \t]*!@cuf(?=[ \t&]|$))/i;
const COMPILER = new RegExp(
  `^(?:[cC*!]|[ \\t]*!)(?:${compilerSentinels.map((s) => s.replace(/[$*]/g, '\\$&')).join('|')})`,
  'i',
);
const KINDS = { omp: 'openmp', ompx: 'openmp', acc: 'openacc', cuf: 'cuf' };
const TONES = { openmp: 'fdf-kind-omp', openacc: 'fdf-kind-acc', cuf: 'fdf-kind-cuda' };

/** What directive a line is (openmp, openacc, cuf, conditional for !$ and !@cuf lines, compiler), and its tone. */
function directive(line) {
  const m = SENTINEL.exec(line);
  if (m) {
    const kind = KINDS[m[1].toLowerCase()];
    return { kind, tone: TONES[kind] };
  }
  if (CONDITIONAL.test(line)) return { kind: 'conditional', tone: /^[ \t]*!@/.test(line) ? TONES.cuf : TONES.openmp };
  if (COMPILER.test(line)) return { kind: 'compiler' };
  return null;
}

/**
 * Marks directive lines, so that a stylesheet can tint them whatever the theme: the line gets `className`
 * (default `fdf-directive`), the HPC tone of fumadocs-fortran's style.css (`fdf-kind-omp`, `fdf-kind-acc`,
 * `fdf-kind-cuda`) and `data-directive` (openmp, openacc, cuf, conditional or compiler).
 */
export function transformerFortranDirectives(options = {}) {
  const { className = 'fdf-directive' } = options;
  return {
    name: 'fumadocs-fortran:directives',
    code(node) {
      if (!FORTRAN_IDS.has(this.options.lang)) return;
      const source = this.source.split('\n');
      const lines = node.children.filter((c) => c.type === 'element');
      lines.forEach((line, i) => {
        const found = directive(source[i] ?? '');
        if (!found) return;
        this.addClassToHast(line, found.tone ? [className, found.tone] : className);
        line.properties['data-directive'] = found.kind;
      });
    },
  };
}
