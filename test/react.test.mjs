// The React components (./react), rendered with react-dom/server, and style.css. React is not a dependency of the
// package: the rendering checks run where react and react-dom can be imported, and are skipped, with one line, where
// they cannot. The source and stylesheet checks run either way.
import fs from 'node:fs';

const read = (rel) => fs.readFileSync(new URL(rel, import.meta.url), 'utf8');
const COMPONENTS = ['FortranBadges', 'FortranBadge', 'FortranArgs', 'FortranArg', 'FortranRef', 'FortranSource', 'FortranGraph'];
const NAMES = [...COMPONENTS, 'fortranToc', 'fortranComponents'];
const HPC = ['omp', 'acc', 'offload', 'mpi', 'coarray', 'cuda', 'blas', 'lapack', 'scalapack', 'cpp'];
const COLUMNS = ['type', 'shape', 'intent', 'attrs'];
const KINDS = { module: 'mod', submodule: 'smod', program: 'prog', type: 't', interface: 'i', subroutine: 's', function: 'f', variable: 'v', parameter: 'p', enum: 'e' };
// the Mermaid classes the graphs give their nodes (fdfFocus and fdfAbstract change the border only)
const GRAPH = ['fdfModule', 'fdfSubmodule', 'fdfProgram', 'fdfProcedure', 'fdfGeneric', 'fdfType', 'fdfIntrinsic', 'fdfExternal', 'fdfMpi', 'fdfOmp', 'fdfAcc', 'fdfCuda', 'fdfCoarray', 'fdfBlas', 'fdfLapack', 'fdfScalapack'];

// Splits at the commas outside brackets: selector lists, and :where(p, ul) within them. A selector wrapped over lines
// reads as one line.
const splitTop = (s) => {
  const out = [];
  let depth = 0, cur = '';
  for (const c of s) {
    if (c === '(' || c === '[') depth++;
    else if (c === ')' || c === ']') depth--;
    else if (c === ',' && !depth) { out.push(cur); cur = ''; continue; }
    cur += c;
  }
  return [...out, cur].map((x) => x.replace(/\s+/g, ' ').trim()).filter(Boolean);
};
// The style rules of a stylesheet, [selectors, declarations, at-rule], those inside @container and @media included
const rulesOf = (css) => {
  const rules = [];
  const walk = (text, at) => {
    for (let i = 0, open; (open = text.indexOf('{', i)) >= 0;) {
      let j = open + 1;
      for (let depth = 1; depth; j++) depth += text[j] === '{' ? 1 : text[j] === '}' ? -1 : 0;
      const head = text.slice(i, open).trim();
      if (head.startsWith('@')) walk(text.slice(open + 1, j - 1), head);
      else rules.push([splitTop(head), text.slice(open + 1, j - 1).split(';').map((d) => d.trim()).filter(Boolean), at]);
      i = j;
    }
  };
  walk(css.replace(/\/\*[\s\S]*?\*\//g, ''), '');
  return rules;
};
// A value without the fallbacks of its var()s, which only serve pages without fumadocs' variables
const withoutFallbacks = (v) => {
  let out = '';
  for (let i = 0; i < v.length; i++) {
    if (!v.startsWith('var(', i)) { out += v[i]; continue; }
    let j = i + 4;
    for (let depth = 1; depth; j++) depth += v[j] === '(' ? 1 : v[j] === ')' ? -1 : 0;
    out += `var(${v.slice(i + 4, j - 1).split(',')[0]})`;
    i = j - 1;
  }
  return out;
};

// Text of rendered markup, as a reader gets it: blocks apart, inline elements run together unless spaced
const ENT = { amp: '&', lt: '<', gt: '>', quot: '"', '#x27': "'", '#39': "'" };
const textOf = (html) => html
  .replace(/<\/?(?:div|p|dl|dt|dd|details|summary|figure|figcaption)\b[^>]*>/g, ' ')
  .replace(/<[^>]*>/g, '')
  .replace(/&(amp|lt|gt|quot|#x27|#39);/g, (m, e) => ENT[e])
  .replace(/\s+/g, ' ')
  .trim();
const classesOf = (html) => (/^<\w+ class="([^"]*)"/.exec(html)?.[1] ?? '').split(' ').filter(Boolean);
// What is inside the first element whose opening tag starts with `open` (its tags balanced), or null. React escapes
// '>' in attribute values, so the first '>' ends the tag.
const inner = (html, open) => {
  const at = html.indexOf(open);
  if (at < 0) return null;
  const tag = /^<(\w+)/.exec(open)[1];
  const re = new RegExp(`<(/?)${tag}\\b[^>]*>`, 'g');
  re.lastIndex = at;
  for (let depth = 0, m; (m = re.exec(html));) {
    depth += m[1] ? -1 : 1;
    if (!depth) return html.slice(html.indexOf('>', at) + 1, m.index);
  }
  return null;
};
// The markup without the elements whose opening tags start with `open`
const without = (html, open) => {
  for (let at; (at = html.indexOf(open)) >= 0;) {
    const tag = /^<(\w+)/.exec(open)[1];
    html = html.slice(0, at) + html.slice(html.indexOf('>', at) + 1 + inner(html, open).length + tag.length + 3);
  }
  return html;
};
// What a wide table shows: no copies for a narrow one, and no hover cards
const wide = (html) => [
  '<div class="fdf-arg-field fdf-arg-narrow">', '<span class="fdf-arg-narrow">', '<div class="fdf-arg-alt not-prose">',
  '<span class="fdf-ref-card not-prose"',
].reduce(without, html);
// useId's ids, which depend on the React version and the place in the tree, as ID; the checks of hover cards match
// each card's id with its name's aria-describedby
const unid = (html) => html.replace(/ (id|aria-describedby)="[^"]*"/g, ' $1="ID"');
// [aria-describedby of each name, id of the card inside it]
const described = (html) => [...html.matchAll(/<(?:a|button) class="fdf-ref-name"[^>]*? aria-describedby="([^"]*)"><span class="fdf-ref-text">(?:(?!<\/?span)[\s\S])*<\/span><span class="fdf-ref-card not-prose" role="tooltip" aria-hidden="true" id="([^"]*)">/g)]
  .map((m) => [m[1], m[2]]);
// How many tab stops the markup has: links, buttons, summaries, form fields and anything with a tabindex
const stops = (html) => (html.match(/<(?:a|button|summary|input|select|textarea)\b|tabindex=/g) ?? []).length;
const rowOf = (html) => inner(html, '<summary class="fdf-arg-row not-prose">') ?? inner(html, '<div class="fdf-arg-row not-prose">');
const cellOf = (html, col) => inner(rowOf(html) ?? '', `<span class="fdf-col-${col}"`);
// The panel's fields: [label, value, narrow only, the value's attributes]
const fieldsOf = (html) => [...(inner(html, '<div class="fdf-arg-panel">') ?? '').matchAll(/<div class="fdf-arg-field( fdf-arg-narrow)?"><dt>([^<]*)<\/dt><dd([^>]*)>([\s\S]*?)<\/dd><\/div>/g)]
  .map((m) => [m[2], m[4], !!m[1], m[3].trim()]);
// The data-term and data-arg of each element that has them, in order: [tag and class, term, argument]
const termsOf = (html) => [...html.matchAll(/<(\w+)(?: class="([^"]*)")? data-term="([^"]*)"(?: data-arg="([^"]*)")?/g)]
  .map((m) => [m[2] ? `${m[1]}.${m[2].split(' ')[0]}` : m[1], m[3], m[4]]);
// The terms of an opened row's Attributes list: [the pill's text, term, argument]
const listOf = (html) => [...(inner(html, '<dl class="fdf-arg-terms">') ?? '').matchAll(/<dt><span class="fdf-flag">([^<]*)<\/span><\/dt><dd(?: data-term="([^"]*)")?(?: data-arg="([^"]*)")?><\/dd>/g)]
  .map((m) => [m[1], m[2], m[3]]);
// What the meanings in style.css say: their strings run together, with {arg} for data-arg
const said = (value) => [...value.matchAll(/"([^"]*)"|'([^']*)'|attr\(data-arg\)/g)].map((m) => m[1] ?? m[2] ?? '{arg}').join('');
// The terms the components write, and so the meanings style.css has: the kinds of badge with a label of their own and
// those the generator adds, the kinds its labels make, the intents, the attributes, the shape and the lengths
// (a conditional badge without its condition, which a page may write by hand, has a meaning of its own)
const BADGE_TERMS = ['module', 'submodule', 'program', 'subroutine', 'function', 'type', 'interface', 'omp', 'acc', 'offload',
  'mpi', 'coarray', 'cuda', 'blas', 'lapack', 'scalapack', 'cpp', 'bindc', 'pure', 'elemental', 'recursive', 'abstract',
  'deferred', 'private', 'public', 'deprecated', 'blockdata', 'impure', 'non-recursive', 'simple', 'parameter',
  'generic-interface', 'operator-interface', 'assignment-interface', 'dtio-interface', 'abstract-interface',
  'module-interface', 'separate-procedure', 'omp-parallel', 'acc-routine', 'conditional', 'conditional+arg', 'when+arg'];
const PILL_TERMS = ['intent-in', 'intent-out', 'intent-inout', 'result', 'allocatable', 'pointer', 'target', 'contiguous',
  'optional', 'value', 'save', 'volatile', 'asynchronous', 'protected', 'external', 'intrinsic', 'bind', 'nopass', 'pass',
  'pass+arg', 'non_overridable', 'kind', 'len', 'default+arg', 'init+arg', 'pointer-init+arg', 'device', 'managed', 'pinned',
  'rank+arg', 'shape+arg', 'assumed-length', 'assumed-length-result', 'deferred-length'];

export default async function ({ ok, eq }) {
  // ---------------------------------------------------------------- source rules: one set for server and client
  const src = read('../react/index.js');
  const dts = read('../types/react.d.ts');
  ok(!/^\s*['"]use client['"]/m.test(src), "react/index.js has no 'use client'");
  eq([...src.matchAll(/^import\b[^'"]*['"]([^'"]+)['"]/gm)].map((m) => m[1]), ['react'], 'react/index.js imports react and nothing else');
  // no state, effects or context, which server components do not have; useId, which they have, ties a card to its name
  eq([...new Set([...src.matchAll(/\buse[A-Z]\w*(?=\s*\()/g)].map((m) => m[0]))], ['useId'], 'react/index.js calls no hook but useId: no state, effects or context');
  // U+FE0E keeps ↔ a text glyph; written out, it is invisible, and an editor can drop it unseen
  ok(src.includes("arrow: '↔\\uFE0E'") && !src.includes(String.fromCharCode(0xfe0e)), 'the variation selector after ↔ is written as an escape');
  const exported = [...src.matchAll(/^export (?:function|const) (\w+)/gm)].map((m) => m[1]);
  eq(exported, NAMES, 'react/index.js exports the seven components, fortranToc and fortranComponents');
  eq([...dts.matchAll(/^export declare (?:function|const) (\w+)/gm)].map((m) => m[1]), NAMES, 'types/react.d.ts declares the same names');
  for (const fn of COMPONENTS.slice(1)) {
    const iface = `${fn}Props`;
    const declared = [...(new RegExp(`interface ${iface} \\{([\\s\\S]*?)\\n\\}`).exec(dts)?.[1] ?? '').matchAll(/^\s*(\w+)\??:/gm)].map((m) => m[1]).sort();
    const destructured = (new RegExp(`function ${fn}\\(\\{([^}]*)\\}`).exec(src)?.[1] ?? '').split(',').map((s) => s.trim().split(/\s*=/)[0]).filter(Boolean).sort();
    ok(declared.length > 0, `${iface} is declared`);
    eq(declared, destructured, `${iface} has the props ${fn} reads`);
  }
  // A site's rule for a term beats style.css's, whose meanings have no specificity, wherever the site's CSS comes, if it
  // has some and is in no @layer: a :where() rule of the site's only ties with them, and a layered one loses.
  ok(!/:where\(\[data-term/.test(dts) && /`\[data-term='hdf5'\] \{ --fdf-mean: "HDF5: …"; \}`/.test(dts) && /outside any @layer/.test(dts),
    "types/react.d.ts shows a site's meaning as a [data-term] rule outside any @layer, which wins whichever stylesheet comes first");
  // the meanings are written once, in style.css: an opened row's Length line takes the meaning of its * or : from there,
  // and its Type parameter line that of a type parameter's kind or len
  eq([...src.matchAll(/(['"`])((?:(?!\1)[^\n\\])*(?:actual argument|allocated or assigned|preprocessor condition|kind type parameter|length type parameter)(?:(?!\1)[^\n\\])*)\1/g)].map((m) => m[2]), [],
    'react/index.js holds no meaning in its strings');

  // ---------------------------------------------------------------- style.css: nothing outside the components
  const css = read('../style.css');
  const rules = rulesOf(css);
  const decl = (sel, prop) => rules.filter(([sels]) => sels.includes(sel)).flatMap(([, decls]) => decls).filter((d) => d.split(':')[0].trim() === prop).map((d) => d.slice(d.indexOf(':') + 1).trim());
  // the token blocks sit in :where(), so that a site's own :root rule wins whatever the stylesheet order
  const ROOT = ':where(:root)', DARK = ':where(.dark)';
  const tokens = (sel, decls) => (sel === ROOT || sel === DARK) && decls.every((d) => d.startsWith('--fdf-'));
  // Pele's graph nodes carry the Mermaid class names the graphs give them (fdfModule, …)
  const pele = (s) => /^\.pele \.pele-node(?:\.fdf[A-Z]\w*|:is\(\.fdf[A-Z])/.test(s);
  // Pele's own variables, on the diagrams inside a FortranGraph, and with no specificity, as the tokens
  const PELE = ':where(.fdf-graph .pele)';
  const peleVars = (sel, decls) => sel === PELE && decls.every((d) => d.startsWith('--pele-'));
  // the meanings of the terms the components write (data-term), with no specificity either, so that a site's own
  // words win: --fdf-mean and nothing else
  const MEANING = /^:where\((\[data-term='[\w-]+'\](?:\[data-arg\])?(?:, \[data-term='[\w-]+'\](?:\[data-arg\])?)*)\)$/;
  const meaningRule = (sel, decls) => MEANING.test(sel) && decls.length === 1 && decls[0].startsWith('--fdf-mean:');
  // the line a badge with a condition adds to its meaning, in :where() too, so that a site's [data-term] rule rewords it
  const ALSO = ":where(.fdf-badge-conditional[data-arg]:not([data-term='when'], [data-term='conditional']))";
  const alsoRule = (sel, decls) => sel === ALSO && decls.length === 1 && decls[0].startsWith('--fdf-also:');
  // Without anchor positioning the card of a FortranRef in running text, such as a "Calls:" line, is placed against its
  // paragraph, which is the one thing of the page's own that the stylesheet styles: it positions it, and only there
  const FALLBACK = '@supports not ((anchor-scope: all) and (position-try-fallbacks: flip-inline))';
  const PARA = 'p:has(> .fdf-ref)';
  const paraRule = (sel, decls, at) => at === FALLBACK
    && ((sel === PARA && decls.join() === 'position: relative') || /^p:has\(> \.fdf-ref\) > \.fdf-ref(?: \.fdf-[\w-]+)*$/.test(sel));
  eq(rules.flatMap(([sels, decls, at]) => sels.filter((s) => !s.startsWith('.fdf-') && !pele(s) && !tokens(s, decls) && !peleVars(s, decls) && !meaningRule(s, decls)
    && !alsoRule(s, decls) && !paraRule(s, decls, at))), [],
    'style.css styles only .fdf-* classes and the fdf classes of graph nodes, sets only --fdf-* variables on :where(:root) and :where(.dark), only --pele-* variables on the graphs\' diagrams, only --fdf-mean on the terms and --fdf-also on a conditional badge, and, without anchor positioning, positions a paragraph that holds a FortranRef');
  // Without these Pele draws its edges, arrowheads and edge labels for a light page whatever the theme: on a dark card
  // its #1f1f1f arrows were at 1.1:1, and its labels sat in white boxes. They are fumadocs' variables, as the docs site's
  // own mapping (docs/app/global.css) has them, through the shared values for the mono font and the border.
  eq(Object.fromEntries(rules.filter(([sels]) => sels.includes(PELE)).flatMap(([, decls]) => decls).map((d) => [d.split(':')[0], withoutFallbacks(d.slice(d.indexOf(':') + 1).trim())])), {
    '--pele-font': 'var(--font-sans)', '--pele-font-mono': 'var(--fdf-mono)', '--pele-bg': 'var(--color-fd-background)',
    '--pele-fg': 'var(--color-fd-foreground)', '--pele-muted': 'var(--color-fd-muted-foreground)', '--pele-line': 'var(--color-fd-muted-foreground)',
    '--pele-surface': 'var(--color-fd-card)', '--pele-surface-alt': 'var(--color-fd-secondary)', '--pele-border': 'var(--fdf-line)',
    '--pele-accent': 'var(--color-fd-primary)',
  }, 'a graph drawn by Pele takes fumadocs\' fonts and colours, lines and labels included');
  eq(['--fdf-mono', '--fdf-line'].map((v) => decl('.fdf-graph', v).length), [1, 1], 'the graph sets the shared values its diagram takes');
  // colours come from fumadocs' variables, which .dark switches, or from the tokens, which it adjusts: a literal
  // colour elsewhere would stay the same in dark mode
  const literal = /#[0-9a-f]{3,8}\b|\b(?:rgba?|hsla?|hwb|lab|lch|oklab|oklch|color)\(|\b(?:white|black)\b/i;
  const value = (d) => withoutFallbacks(d.slice(d.indexOf(':') + 1));
  eq(rules.filter(([sels]) => !sels.every((s) => s === ROOT || s === DARK))
    .flatMap(([sels, decls]) => decls.filter((d) => literal.test(value(d))).map((d) => `${sels.join(', ')} { ${d} }`)), [],
    'outside the tokens, colours are variables (literals only as var() fallbacks)');
  const darkTokens = rules.filter(([sels]) => sels.includes(DARK)).flatMap(([, decls]) => decls.map((d) => d.split(':')[0]));
  ok(['--fdf-text-mix', '--fdf-text-share', '--fdf-fill-share'].every((t) => darkTokens.includes(t)), '.dark adjusts how text and fills are made from the tones');
  ok(['--fdf-shadow-sm', '--fdf-shadow-md'].every((t) => darkTokens.includes(t)), '.dark has shadows of its own');
  eq(HPC.filter((k) => !rules.some(([sels, decls]) => sels.includes(`.fdf-kind-${k}`) && decls.includes(`--fdf-c: var(--fdf-${k})`))), [],
    'each HPC kind takes its colour from its token');

  // the pills look as they did: the user's choice
  eq(['.fdf-badge', '.fdf-intent', '.fdf-flag', '.fdf-cond'].map((s) => decl(s, 'border-radius')), Array(4).fill(['0.625rem']), 'pills keep their shape');
  eq(['in', 'out', 'inout'].map((i) => decl(`.fdf-intent-${i}`, '--fdf-c')[0]), ['var(--fdf-in)', 'var(--fdf-out)', 'var(--fdf-inout)'], 'intent pills keep their tones');
  eq([decl('.fdf-cond', 'border-style'), decl('.fdf-intent', 'white-space')], [['dashed'], ['normal', 'nowrap']], 'conditions stay dashed, and an intent stays with its arrow');
  eq(decl('.fdf-badge-hpc', 'color'), ['color-mix(in oklab, var(--fdf-c) var(--fdf-text-share), var(--fdf-text-mix))'], 'pill text is still mixed from its tone');

  // the kinds: a token each, for the letters of the table of contents and the graph nodes
  const rootTokens = rules.filter(([sels]) => sels.includes(ROOT)).flatMap(([, decls]) => decls.map((d) => d.split(':')[0]));
  eq(Object.keys(KINDS).filter((k) => !rootTokens.includes(`--fdf-k-${k}`)), [], 'a --fdf-k-<kind> token for each kind');
  eq(Object.keys(KINDS).filter((k) => decl(`.fdf-toc-${k}`, '--fdf-c')[0] !== `var(--fdf-k-${k})`), [], 'each TOC letter takes its kind token');
  eq(decl('.fdf-toc-kind', 'color'), ['color-mix(in oklab, var(--fdf-c) var(--fdf-text-share), var(--fdf-text-mix))'], 'TOC letters mix their tone as pill text does');

  // graph nodes: a tone for each class, the shapes and labels coloured with !important (Pele writes them inline)
  eq(GRAPH.filter((c) => !rules.some(([sels, decls]) => sels.some((s) => s.startsWith(`.pele .pele-node.${c}`)) && decls.some((d) => d.startsWith('--fdf-c:')))), [],
    'each graph class has a tone');
  const SHAPES = ':is(rect, path, polygon, circle, ellipse)';
  const shapes = rules.find(([sels]) => sels.some((s) => s.startsWith('.pele .pele-node:is(') && s.endsWith(SHAPES)));
  ok(shapes && GRAPH.every((c) => shapes[0][0].includes(`.${c}`)) && ['fill', 'stroke'].every((p) => shapes[1].some((d) => d.startsWith(`${p}:`) && d.endsWith('!important'))),
    'the node shapes of every class: fill and stroke from the tone, !important');
  // A node that links is drawn <g class="pele-node … fdfModule clickable"><a href="…"><rect …/>
  // <text class="pele-label" …/></a></g>: its shapes are the node's grandchildren, and a rule that takes them as
  // children (> :is(rect, …)) leaves the node in its fixed light tone under a label mixed for the dark theme, about
  // 1:1 in contrast
  const shapeSels = rules.flatMap(([sels]) => sels).filter((s) => s.startsWith('.pele ') && s.endsWith(SHAPES));
  eq([shapeSels.length, shapeSels.filter((s) => !s.endsWith(` ${SHAPES}`) || s.endsWith(`> ${SHAPES}`))], [3, []],
    'the shape rules (tone, subject, dashes) reach the shapes of a node that links, inside its <a>');
  const labels = rules.find(([sels]) => sels.some((s) => s.startsWith('.pele .pele-node:is(') && s.includes('.pele-label')));
  ok(labels && GRAPH.every((c) => labels[0][0].includes(`.${c}`)) && labels[1].some((d) => /^fill: color-mix\(.*var\(--fdf-text-mix\)\) !important$/.test(d)), 'node labels are mixed for contrast');
  ok(rules.some(([sels, decls]) => sels.some((s) => s.startsWith('.pele .pele-node.fdfFocus')) && decls.some((d) => d.startsWith('stroke-width'))), 'the subject has a heavier border');
  ok(rules.some(([sels, decls]) => sels.some((s) => s.includes('.fdfAbstract') && s.includes('.fdfExternal')) && decls.some((d) => d.startsWith('stroke-dasharray'))), 'abstract and external nodes are dashed');

  // the table: every column's width set on the table, emptied when the column is left out, its cells then not drawn
  const template = decl('.fdf-arg-row', 'grid-template-columns');
  eq(template[0]?.replace(/\s+/g, ' '), 'var(--fdf-col-name) var(--fdf-col-type) var(--fdf-col-shape) var(--fdf-col-intent) var(--fdf-col-attrs) minmax(1rem, auto)',
    'the rows take their tracks from the table');
  // without a column of fr width (a table of names alone, as enumerators without values make, or of names and intents)
  // a fixed 1rem track would put the chevron just after the last column, not at the right edge
  ok(template[0]?.endsWith(' minmax(1rem, auto)') && decl('.fdf-arg-row > .fdf-chevron', 'justify-self')[0] === 'end',
    'the chevron\'s track takes the width no column claims, and the chevron keeps to its end');
  ok(rules.some(([sels]) => sels.includes('.fdf-args-head') && sels.includes('.fdf-arg-row')), 'the header has the rows\' tracks');
  for (const c of COLUMNS) {
    const off = `.fdf-args:not([data-columns~='${c}'])`;
    ok(rules.some(([sels, decls]) => sels.includes(off) && decls.includes(`--fdf-col-${c}:`)), `a table without ${c} empties its width`);
    ok(rules.some(([sels, decls]) => sels.includes(`${off} .fdf-arg-row > .fdf-col-${c}`) && decls.includes('display: none')), `and does not draw its cells`);
  }
  ok(decl('.fdf-args', 'container')[0] === 'fdf-args / inline-size', 'the table is a container');
  const narrowRules = rules.filter(([, , at]) => at === '@container fdf-args (max-width: 34rem)');
  ok(narrowRules.some(([sels, decls]) => sels.includes('.fdf-arg-row > :is(.fdf-col-type, .fdf-col-shape, .fdf-col-attrs)') && decls.includes('display: none')), 'a narrow table hides the type, shape and attributes cells');
  ok(narrowRules.some(([sels, decls]) => sels.includes('.fdf-arg .fdf-arg-field.fdf-arg-narrow') && decls.includes('display: grid')), 'and shows their copies in the panel');
  eq(narrowRules.find(([sels]) => sels.includes('.fdf-arg-row'))?.[1], ['grid-template-columns: minmax(0, 1fr) var(--fdf-col-intent) 1rem'], 'a narrow row: name, intent, chevron');
  ok(rules.some(([sels, decls, at]) => !at && sels.includes('.fdf-arg .fdf-arg-narrow') && decls.includes('display: none')), 'the copies are hidden outside the narrow layout');
  ok(rules.some(([sels, decls]) => sels.includes('.fdf-arg[open]') && decls.some((d) => d.startsWith('border-color'))), 'an open row has a border');
  // a card sits in its row's summary, and floats over the rows below: the pointer on it is not on the row
  eq(rules.filter(([sels, decls]) => sels.some((s) => s.startsWith('.fdf-arg > summary:hover')) && decls.some((d) => d.startsWith('background-color'))).map(([sels]) => sels),
    [['.fdf-arg > summary:hover:not(:has(.fdf-ref-card:hover))']], 'a row is tinted under the pointer, but not while the pointer is on one of its cards');

  // print: a closed row printed only its name and type, so the docs of every argument were missing on paper
  const print = rules.filter(([, , at]) => at === '@media print');
  ok(print.some(([sels, decls]) => sels.includes('.fdf-arg::details-content') && decls.includes('content-visibility: visible') && decls.includes('display: block')),
    'a printed row shows its panel: the doc and the declaration');
  ok(print.some(([sels, decls]) => sels.includes('.fdf-arg:not(.fdf-arg-plain)') && decls.some((d) => d.startsWith('border-color'))), 'and looks as an open row does');
  ok(print.some(([sels, decls]) => sels.includes('.fdf-chevron') && decls.includes('display: none')), 'paper has no chevrons');
  eq(print.flatMap(([sels]) => sels).filter((s) => /\.fdf-(?:source|graph)/.test(s)), [], 'source blocks and graphs print as they are on screen');
  // a card is fixed to the screen where anchor positioning places it: the card of a name that had the focus printed
  // on 16 of solver_kernels' 21 pages. The rule outweighs the ones that show a card (a class, a state and a class).
  const SHOWN = '.fdf-ref-name:is(:hover, :focus) > .fdf-ref-card';
  ok(print.some(([sels, decls]) => sels.includes('.fdf-ref-card') && sels.includes(SHOWN) && decls.includes('display: none')),
    'paper has no hover cards, not even that of the name with the focus');

  // right to left: the bidi algorithm reordered the code (real(dp), allocatable :: a(:,:) as (:,:)real(dp), allocatable
  // :: a, and => dense_matvec as dense_matvec <=)
  const LTR = ['.fdf-arg-name', '.fdf-arg-shape', '.fdf-arg-decl', '.fdf-flag', '.fdf-when code', '.fdf-cond code', '.fdf-arg-field > dd > code', '.fdf-ref-text', '.fdf-ref-title', '.fdf-source-title code', '.fdf-toc-name'];
  eq(LTR.filter((s) => decl(s, 'direction')[0] !== 'ltr' || decl(s, 'unicode-bidi')[0] !== 'isolate'), [],
    'names (in rows, hover cards and the table of contents), shapes, declarations, flags, conditions, card titles and file paths read left to right, set apart from a right-to-left page');
  // a type is set apart in the direction of its first letter, always a Fortran keyword's: direction: ltr would pass to
  // its hover cards, which then opened past the table's edge on a right-to-left page
  eq([decl('.fdf-arg-type', 'unicode-bidi'), decl('.fdf-arg-type', 'direction')], [['plaintext'], []], 'a type reads left to right, and its cards keep the page\'s direction');
  eq(['.fdf-ref-detail', '.fdf-ref-note'].map((s) => decl(s, 'unicode-bidi')), [['plaintext'], ['plaintext']], 'a card\'s lines of text read in the direction of their own words');

  // hover cards: CSS only, never cut off by the table, and no wider than a phone's screen
  eq(decl('.fdf-ref-card', 'max-width'), ['min(18rem, calc(100vw - 2rem))'], 'a card is at most 18rem wide, and fits a phone');
  // a narrow table's panel field starts 34px in from a phone's edge (page gutter, table and panel padding), so a card
  // anchored there at 100vw - 2rem ran 2px off a 320px screen
  eq(['.fdf-arg-field .fdf-ref-card', '.fdf-arg-alt .fdf-ref-card'].map((s) => decl(s, 'max-width')), Array(2).fill(['min(18rem, 100%)']),
    'a card anchored to a panel field, or to a plain row\'s line, keeps to its width');
  eq([decl('.fdf-ref-card', 'position'), decl('.fdf-ref-card', 'visibility')], [['absolute'], ['hidden']], 'a card floats, hidden');
  // the card is inside the name: a link, which a click on the card follows, or a button
  ok(rules.some(([sels, decls]) => sels.includes('.fdf-ref-name:hover > .fdf-ref-card') && sels.includes('.fdf-ref-name:focus > .fdf-ref-card') && decls.includes('visibility: visible')), 'and shows while its name is hovered or has the focus');
  // a name without a link is a button, set as the text around it, its own text in code; the card keeps the font around
  // the name, and nothing names a font for it
  ok(['margin: 0', 'padding: 0', 'border: 0', 'background: none', 'color: inherit', 'font: inherit', 'appearance: none'].every((d) => rules.some(([sels, decls]) => sels.includes('.fdf-ref-name:is(button)') && decls.includes(d))),
    'a name that is a button looks like the text around it');
  eq([decl('.fdf-ref-text', 'font-family'), decl('.fdf-ref-name', 'font-family'), decl('.fdf-ref-card', 'font-family')], [['var(--fdf-mono)'], [], []], 'the name is code, and its card takes the font around it');
  // fumadocs' prose fades a hovered link (a:not([data-card]):hover { opacity: 80% }): with the card inside its link, a
  // card in running text faded with it, and the text under the card showed through
  eq(decl('.fdf-ref-name:is(:hover, :focus)', 'opacity'), ['1'],
    'a card stays opaque whatever the page does to a hovered link');
  // With anchor positioning a card is placed against its name and the screen: a card that ran past the screen's right
  // edge (by 21px at 590px, from a name late in its type) opens to the left of its name instead. Without it, the
  // rules above hold.
  const ANCHOR = '@supports (anchor-scope: all) and (position-try-fallbacks: flip-inline)';
  const anchored = (sel, prop) => rules.filter(([sels, , at]) => at === ANCHOR && sels.includes(sel)).flatMap(([, decls]) => decls)
    .filter((d) => d.split(':')[0].trim() === prop).map((d) => d.slice(d.indexOf(':') + 1).replace(/\s+/g, ' ').trim());
  const CARD_SEL = '.fdf-ref-name > .fdf-ref-card';
  eq([anchored('.fdf-ref', 'anchor-scope'), anchored('.fdf-ref-name', 'anchor-name'), anchored(CARD_SEL, 'position-anchor')], [['--fdf-ref'], ['--fdf-ref'], ['--fdf-ref']],
    'each card is anchored to its own name');
  eq(['position', 'position-area', 'max-width'].map((p) => anchored(CARD_SEL, p)), [['fixed'], ['block-end span-inline-end'], ['min(18rem, calc(100vw - 2rem))']],
    'below its name from its start, fixed, as the screen is what it must fit, and no wider than the screen');
  ok(anchored(CARD_SEL, 'position-try-fallbacks')[0]?.startsWith('flip-inline, flip-block'), 'it opens to the left of its name where it would run past the right edge, and above it at the screen\'s foot');
  ok(/@position-try --fdf-ref-across \{[^}]*position-area: block-end span-all;[^}]*justify-self: center;/.test(css) && anchored(CARD_SEL, 'position-try-fallbacks')[0]?.includes('--fdf-ref-across'),
    'and across the screen where neither side holds it');
  // a hidden card is not drawn at all, so that each is placed afresh as it shows (Chrome keeps a hidden card's last
  // placement, chosen while its name was far down the page), and a page of thousands of names places one card
  eq([anchored(CARD_SEL, 'display'), anchored('.fdf-ref-name:hover > .fdf-ref-card', 'display'), anchored('.fdf-ref-name:focus > .fdf-ref-card', 'display')], [['none'], ['flex'], ['flex']],
    'a card is drawn only while it shows');
  ok(anchored(CARD_SEL, 'transition')[0]?.includes('display 0.15s allow-discrete'), 'and fades before it goes, so that the pointer can still cross into it');
  eq([decl('.fdf-ref-card', 'position')[0], decl('.fdf-ref-card', 'top')[0], decl('.fdf-ref-card', 'inset-inline-start')[0]], ['absolute', 'calc(100% + 0.25rem)', '0'],
    'without anchor positioning the card is placed as before');
  const upward = ['fdf-args', 'fdf-arg', 'fdf-arg-row', 'fdf-col-type', 'fdf-arg-type', 'fdf-arg-panel', 'fdf-arg-fields', 'fdf-arg-field', 'fdf-arg-alt', 'fdf-ref', 'fdf-ref-name',
    'fdf-col-shape', 'fdf-col-intent', 'fdf-col-attrs', 'fdf-badges', 'fdf-badge', 'fdf-intent', 'fdf-flag', 'fdf-cond', 'fdf-len', 'fdf-type-param'];
  eq(rules.flatMap(([sels, decls]) => sels.filter((s) => upward.some((c) => new RegExp(`\\.${c}(?![\\w-])[^ >+~]*$`).test(s)))
    .flatMap((s) => decls.filter((d) => /^(?:overflow(?:-x|-y)?|contain|content-visibility)\s*:/.test(d) && !/:\s*visible$/.test(d)).map((d) => `${s} { ${d} }`))), [],
  'nothing on the way up from a hover card or the card of a pill clips it');

  // ---- what pills, badges, shapes and lengths mean: written once, in style.css, and shown in a card on hover
  const meanings = new Map();
  for (const [sels, decls] of rules) {
    for (const s of sels) {
      const m = MEANING.exec(s);
      if (m) for (const t of m[1].matchAll(/\[data-term='([\w-]+)'\](\[data-arg\])?/g)) meanings.set(t[1] + (t[2] ? '+arg' : ''), said(decls[0]));
    }
  }
  eq([...BADGE_TERMS, ...PILL_TERMS].filter((t) => !meanings.has(t)), [], 'every term the components write has a meaning');
  eq([...meanings.keys()].filter((t) => !BADGE_TERMS.includes(t) && !PILL_TERMS.includes(t)), [], 'and only those');
  eq([...meanings].filter(([, m]) => !m || m.length > 120 || /[\n;{}]/.test(m.replace(/\{arg\}/g, ''))).map(([t]) => t), [], 'each meaning is one line of at most 120 characters');
  const mean = (t) => meanings.get(t) ?? '';
  // the subtle ones
  ok(/lost on entry/.test(mean('intent-out')) && /deallocated/.test(mean('intent-out')), "intent(out): the caller's value is lost on entry, and an allocatable is deallocated");
  ok(/binding/.test(mean('deferred')) && /not abstract/.test(mean('deferred')) && !/shape/.test(mean('deferred')), 'deferred: a binding that each extension that is not abstract implements, not a deferred shape');
  // The * of a dummy argument takes its length from the actual argument; that of a function's result (obsolescent) from
  // where the function is called, which declares the length of its name. A deferred length is set by allocate, by
  // assignment or pointer assignment, or by argument association (F2023 7.2). The code comes in brackets: run into the
  // colon, "len=:" read as "len=::", Fortran's separator.
  eq([mean('assumed-length'), mean('assumed-length-result'), mean('deferred-length')], ['Assumed length (len=*): taken from the actual argument',
    "Assumed length (len=*), obsolescent: the length declared for the function's name where it is called",
    'Deferred length (len=:): set by allocate, assignment or pointer assignment, or from the actual argument'],
  "the * and the : of a character length, and the * of a function's result, which no actual argument gives");
  eq([...meanings].filter(([, m]) => /len=[*:]:/.test(m)).map(([t]) => t), [], 'no meaning runs code into its colon');
  eq([mean('pass+arg'), mean('default+arg'), mean('shape+arg')], ['The object it is invoked through is passed as its argument {arg}',
    'Takes the value {arg} when a declaration of the type does not give one', '{arg}'], 'pass(self) names self, default dp says dp, and a shape says its words');
  ok(mean('when+arg').includes('{arg}') && mean('conditional+arg') === mean('when+arg'), 'a condition says itself');
  // a hand-written <FortranBadge kind="cpp" label="conditional" /> has no condition to name
  ok(!meanings.has('when') && /preprocessor condition/.test(mean('conditional')) && !mean('conditional').includes('{arg}'),
    'a conditional badge without its condition says so, rather than "the preprocessor condition  holds"');
  ok(/copy/.test(mean('value')) && /not reach the caller/.test(mean('value')), 'value: a copy, whose changes do not reach the caller');
  ok(/outside its module/.test(mean('protected')) && /where it points/.test(mean('protected')), 'protected: read-only outside its module, a pointer\'s association too');
  // a submodule reaches its ancestor module's entities by host association (F2023 8.5.2, 8.5.15): private ones, and it
  // may change a protected one
  ok(['private', 'protected'].every((t) => /\bmodule and its submodules\b/.test(mean(t))), "private and protected: the module's submodules see and change it too");
  // RANK(n) (Fortran 2023, 8.5.17): assumed shape, deferred with allocatable or pointer, and a scalar for 0; n may be a
  // named constant
  ok(/RANK clause/.test(mean('rank+arg')) && /Fortran 2023/.test(mean('rank+arg')) && /assumed shape/.test(mean('rank+arg'))
    && /deferred/.test(mean('rank+arg')) && /0 is a scalar/.test(mean('rank+arg')), 'rank(2): the rank the RANK clause gives, assumed or deferred shape, and 0 a scalar');
  // the project writes British -ise: normalised, factorisation, finalisers (size and its kin are not -ize words)
  eq([...meanings].filter(([, m]) => /(?<!s)iz(?:e[ds]?|ing|ations?)\b/i.test(m)).map(([t]) => t), [], 'the meanings are spelt -ise: initialised, initialisation');
  ok(/element order/.test(mean('impure')) && /scalars/.test(mean('elemental')) && /pure/i.test(mean('elemental')), 'elemental: written for scalars, pure unless impure, which goes in element order');
  ok(/cannot override/.test(mean('non_overridable')) && /strides/.test(mean('contiguous')) && /pending/.test(mean('asynchronous')) && /C/.test(mean('bindc')),
    'non_overridable, contiguous, asynchronous and bind(C)');
  // kind and len are the terms of the word in a type parameter's type (integer, kind) and of a hand-written pill alike:
  // each says what that kind of type parameter is, a kind one fixed when compiling, a length one free to vary at run time
  ok(/^A kind type parameter: /.test(mean('kind')) && /compil/.test(mean('kind')) && /^A length type parameter: /.test(mean('len')) && /run time/.test(mean('len')),
    'kind and len say what a kind and a length type parameter are');
  eq(['in', 'out', 'inout'].map((i) => mean(`intent-${i}`).split(':')[0]), ['intent(in)', 'intent(out)', 'intent(inout)'], 'an intent\'s meaning names it, so that an opened row can say it alone');
  // the pill is on arguments and components: an allocatable argument is not freed when the procedure returns, only an
  // unsaved local variable is, and deallocate frees any of them
  ok(!/automatic/.test(mean('allocatable')) && /deallocate/.test(mean('allocatable')) && /local one/.test(mean('allocatable')),
    'allocatable: freed by deallocate, and a local one on return too, not "automatically", which an argument is not');
  // the badge stands for any OpenMP target directive: declare target and target data run no work on the device
  ok(/target directives/.test(mean('offload')) && /code and data/.test(mean('offload')) && !/^Offloads work/.test(mean('offload')),
    'offload: OpenMP target directives, for code and data on an accelerator');

  // the cards: the ::after of what they explain, drawn while it is hovered, in the look of a hover card
  const CARD_ON = ['.fdf-badge[data-term]:not(:has(> .fdf-badge-note)):hover::after', '.fdf-intent[data-term]:hover::after', '.fdf-flag[data-term]:hover::after',
    '.fdf-cond[data-term]:hover::after', '.fdf-col-shape[data-term]:hover::after', '.fdf-len[data-term]:hover::after', '.fdf-type-param[data-term]:hover::after'];
  const NOTE = '.fdf-badge:hover > .fdf-badge-note';
  const CARDS = [...CARD_ON, NOTE];
  const LOOK = ['position', 'top', 'inset-inline-start', 'z-index', 'box-sizing', 'max-width', 'padding', 'border', 'border-radius', 'background-color', 'color', 'box-shadow',
    'font-size', 'font-weight', 'line-height', 'text-align'];
  eq(CARDS.map((s) => LOOK.map((p) => decl(s, p)[0])), CARDS.map(() => LOOK.map((p) => decl('.fdf-ref-card', p)[0])), 'a card looks as a hover card does');
  ok(CARDS.every((s) => decl(s, 'pointer-events')[0] === 'none'), 'the pointer passes through a card: it covers nothing it could click');
  // a card keeps the page's direction, from which it opens, and its text takes the direction of its own words, as a
  // hover card's lines do: a meaning a site gives in a right-to-left script reads as one on any page
  eq([CARDS.map((s) => decl(s, 'unicode-bidi')[0]), CARDS.map((s) => decl(s, 'direction')[0])], [CARDS.map(() => 'plaintext'), CARDS.map(() => undefined)],
    'a card is not set left to right, and its text reads in the direction of its words');
  const contentAt = (at) => rules.filter(([sels, , a]) => a === at && CARD_ON.every((s) => sels.includes(s)) && sels.includes(`${NOTE}::before`))
    .flatMap(([, decls]) => decls).filter((d) => d.startsWith('content:'));
  eq(contentAt(''), ["content: var(--fdf-mean) var(--fdf-also, '')"], "a card says the meaning, then a badge's condition");
  // screen readers would read a card into the name of its row: an opened row says the same
  eq(contentAt("@supports (content: '' / '')"), ["content: var(--fdf-mean) var(--fdf-also, '') / ''"], 'and has no text for screen readers, where browsers allow');
  const shows = rules.filter(([, decls]) => decls.some((d) => d.startsWith('content:') && d.includes('var(--fdf-mean)'))).flatMap(([sels]) => sels);
  eq([...new Set(shows.filter((s) => !s.includes(':hover')))], ['.fdf-arg-field > dd[data-term]::after', '.fdf-arg-terms > dd::after'],
    'a card shows only on hover; an opened row says the meanings of its intent and its attributes always');
  eq(decl('.fdf-arg-terms > dd::after', 'content'), ['var(--fdf-mean)'], 'and there screen readers read them');
  // in :where(), as the meanings are: a site's [data-term='mpi'][data-arg] rule rewords it, whichever stylesheet comes first
  eq(decl(ALSO, '--fdf-also').map(said), ['\\A Only when the preprocessor condition {arg} holds'],
    "a badge with a condition says it on a line of its own, unless the condition is the badge's own term");
  eq([decl('.fdf-badge-note', 'clip-path'), decl('.fdf-badge-note', 'display'), decl('.fdf-badge-note', 'visibility')], [['inset(50%)'], [], []],
    "a badge's note is hidden from the eye, not from screen readers, until its card shows");
  eq([anchored('.fdf-flag[data-term]:hover', 'anchor-name'), anchored('.fdf-flag[data-term]', 'anchor-name')], [['--fdf-tip'], []],
    'with anchor positioning only what is hovered is an anchor, one name for every card on the page');
  eq(['.fdf-len[data-term]:hover', '.fdf-type-param[data-term]:hover'].map((s) => anchored(s, 'anchor-name')), [['--fdf-tip'], ['--fdf-tip']],
    "and so is a length's * or a type parameter's kind while it is hovered");
  eq(['position', 'position-anchor', 'position-area'].map((p) => CARDS.map((s) => anchored(s, p)[0])),
    [CARDS.map(() => 'fixed'), CARDS.map(() => '--fdf-tip'), CARDS.map(() => 'block-end span-inline-end')], 'and a card is placed as a hover card is');
  ok(CARDS.every((s) => anchored(s, 'position-try-fallbacks')[0] === anchored(CARD_SEL, 'position-try-fallbacks')[0]), 'and flips as a hover card does');
  ok(rules.some(([sels, decls, at]) => at === FALLBACK && sels.includes('.fdf-arg-row > :is(.fdf-col-intent, .fdf-col-attrs) > [data-term]:hover::after')
    && decls.includes('inset-inline-start: auto') && decls.includes('inset-inline-end: 0')), 'without it, a card in the last columns opens towards the table');
  // A flag is set left to right (its code reads so on any page), and its card with it, so that there inline-end is the
  // right: on a right-to-left page, whose last columns are on the left, the card ran off the screen's left edge.
  // :dir() reads the page's direction, which direction: ltr does not change.
  ok(rules.some(([sels, decls, at]) => at === FALLBACK && sels.length === 1 && sels[0] === '.fdf-arg-row > .fdf-col-attrs > .fdf-flag[data-term]:dir(rtl):hover::after'
    && decls.includes('inset-inline-start: 0') && decls.includes('inset-inline-end: auto')), "and a flag's card does so on a right-to-left page too");
  const fallback = (sel, prop) => rules.filter(([sels, , at]) => at === FALLBACK && sels.includes(sel)).flatMap(([, decls]) => decls)
    .filter((d) => d.split(':')[0].trim() === prop).map((d) => d.slice(d.indexOf(':') + 1).trim());
  // a card in a panel's field starts at the field's edge, as a hover card there does
  eq([fallback('.fdf-arg-field .fdf-len', 'position'), fallback('.fdf-arg-field .fdf-len[data-term]:hover::after', 'max-width')], [['static'], ['min(18rem, 100%)']],
    "and a length's card in a panel's field starts at the field's edge and keeps to its width");
  // as does that of a type parameter's kind or len in a narrow table's copy of the type
  eq([fallback('.fdf-arg-field .fdf-type-param', 'position'), fallback('.fdf-arg-field .fdf-type-param[data-term]:hover::after', 'max-width')], [['static'], ['min(18rem, 100%)']],
    "and so does the card of a type parameter's kind or len in a panel's field");
  // A badge's card ran past a phone's edge from a badge late in its row (by 128px at 375px), and fumadocs' layout clips
  // what runs past it (overflow-x: clip): it starts at the row's edge, and keeps to the row's width.
  eq([fallback('.fdf-badges', 'position'), fallback('.fdf-badges > .fdf-badge', 'position'), fallback(`.fdf-badges > ${CARD_ON[0]}`, 'max-width'),
    fallback(`.fdf-badges > ${NOTE}`, 'max-width')], [['relative'], ['static'], ['min(18rem, 100%)'], ['min(18rem, 100%)']],
  "and a badge's card, its note's too, starts at its row's edge and keeps to the row's width");
  // So does the card of a FortranRef in running text, as a "Calls:" line's dgemv (87px past the edge), at its
  // paragraph's. All three rules name :has(), so that a browser without it keeps the name positioned.
  eq([fallback(PARA, 'position'), fallback(`${PARA} > .fdf-ref`, 'position'), fallback(`${PARA} > .fdf-ref .fdf-ref-card`, 'max-width')],
    [['relative'], ['static'], ['min(18rem, 100%)']], 'and a FortranRef\'s card in running text starts at its paragraph\'s edge and keeps to its width');
  // The shown state, outside any at-rule (decl() reads print, hover: none and @supports too). The suite passed with each
  // card, note or list hidden, a card one character wide, or the pills not positioned.
  const screen = (sel, prop) => rules.filter(([sels, , at]) => !at && sels.includes(sel)).flatMap(([, decls]) => decls)
    .filter((d) => d.split(':')[0].trim() === prop).map((d) => d.slice(d.indexOf(':') + 1).trim()).at(-1);
  eq(CARD_ON.map((s) => ['display', 'width', 'white-space'].map((p) => screen(s, p))), CARD_ON.map(() => ['block', 'max-content', 'pre-line']),
    'a card is drawn while what it explains is hovered, as wide as its text up to its width, and its \\A starts a line');
  eq(['display', 'clip-path', 'height', 'overflow', 'width', 'white-space'].map((p) => screen(NOTE, p)), ['flex', 'none', 'auto', 'visible', 'max-content', 'pre-line'],
    "a badge's note shows as its card while the badge is hovered: unclipped, as tall as its text");
  eq(CARDS.map((s) => rules.filter(([sels, , at]) => at !== '@starting-style' && sels.includes(s)).flatMap(([, decls]) => decls).filter((d) => /^(?:visibility|opacity)\s*:/.test(d))),
    CARDS.map(() => []), 'nothing makes a shown card invisible but its fade');
  eq(['.fdf-badge', '.fdf-intent', '.fdf-flag', '.fdf-cond', '.fdf-col-shape', '.fdf-len', '.fdf-type-param'].map((s) => screen(s, 'position')), Array(7).fill('relative'),
    "each pill, shape, length and type parameter's word is its card's containing block");
  eq(screen('.fdf-arg-terms', 'display'), 'grid', 'an opened row lists its attributes beside their meanings');
  eq(rules.filter(([sels, decls, at]) => at !== '@media print' && sels.some((s) => /\.fdf-arg-terms(?: > d[td](?:::after)?)?$|\.fdf-arg-field > dd\[data-term\]::after$/.test(s))
    && decls.some((d) => /^(?:display:\s*none|visibility:\s*hidden|opacity:\s*0|content-visibility:\s*hidden)\b/.test(d))).map(([sels]) => sels.join(', ')), [],
  'and nothing hides the list, or the meanings in it and in the Intent and Length lines, which are what the keyboard and screen readers get');
  ok(print.some(([sels, decls]) => CARDS.every((s) => sels.includes(s)) && decls.includes('display: none')), 'paper has no cards');
  // A phone keeps a tapped element hovered: a tap on a pill in a row opens the row, which lists what the pill means,
  // and would leave the pill's card over the panel it opened. A badge, and a plain row's result pill, which open
  // nothing, keep theirs.
  ok(rules.some(([sels, decls, at]) => at === '@media (hover: none)' && sels.length === 1 && sels[0] === '.fdf-arg > summary [data-term]:hover::after'
    && decls.includes('display: none')), 'a screen without hover draws no card for a pill in a row that opens');
  ok(rules.some(([sels, decls, at]) => at === '@media (prefers-reduced-motion: reduce)' && CARDS.every((s) => sels.includes(s)) && decls.includes('transition: none')),
    'and a card does not fade in for those who ask for less motion');
  eq([decl('.fdf-arg-row > .fdf-col-shape', 'justify-self'), decl('.fdf-len > code', 'font-family')], [['start'], ['var(--fdf-mono)']],
    "the shape's cell is as wide as the shape, and the * of character(*) is code, apart from its card");
  // the kind of integer, kind: code too, apart from its card, and marked as the * is, by a dotted line and the help cursor
  const MARK = ['text-decoration', 'text-decoration-color', 'text-underline-offset', 'cursor'];
  eq([decl('.fdf-type-param > code', 'font-family'), MARK.map((p) => screen('.fdf-type-param', p))], [['var(--fdf-mono)'], MARK.map((p) => screen('.fdf-len', p))],
    "a type parameter's kind or len is code, apart from its card, and has the * of character(*)'s dotted line and cursor");
  ok(MARK.every((p) => screen('.fdf-len', p)) && screen('.fdf-len', 'text-decoration').includes('dotted'), 'which are a dotted underline and the help cursor');

  // ---------------------------------------------------------------- rendering
  let React, server;
  try {
    React = await import('react');
    server = await import('react-dom/server');
  } catch {
    console.log('React checks skipped: react and react-dom are not installed');
    return;
  }
  const render = server.renderToStaticMarkup ?? server.default.renderToStaticMarkup;
  const h = React.createElement ?? React.default.createElement;
  const mod = await import('../react/index.js');
  const { FortranBadges, FortranBadge, FortranArgs, FortranArg, FortranRef, FortranSource, FortranGraph, fortranToc, fortranComponents } = mod;

  // React's warnings (keys, invalid props) go to console.error: none may appear. A failing check's own line (FAIL,
  // from run.mjs) passes through.
  const warnings = [];
  const error = console.error;
  console.error = (...a) => (a[0] === 'FAIL' ? error(...a) : warnings.push(a.join(' ')));
  try {
    eq(Object.keys(mod).sort(), [...NAMES].sort(), 'the module exports exactly the declared names');
    eq(Object.keys(fortranComponents), COMPONENTS, 'fortranComponents has the seven components');
    ok(COMPONENTS.every((n) => fortranComponents[n] === mod[n]), 'fortranComponents holds the exported functions');

    // ---- badges
    const badge = (props) => render(h(FortranBadge, props));
    const LABELS = {
      module: 'module', submodule: 'submodule', program: 'program', subroutine: 'subroutine', function: 'function',
      type: 'type', interface: 'interface', omp: 'OpenMP', acc: 'OpenACC', offload: 'offload', mpi: 'MPI',
      coarray: 'coarray', cuda: 'CUDA Fortran', blas: 'BLAS', lapack: 'LAPACK', scalapack: 'ScaLAPACK', cpp: 'cpp',
      bindc: 'bind(C)', pure: 'pure', elemental: 'elemental', recursive: 'recursive', abstract: 'abstract',
      deferred: 'deferred', private: 'private', public: 'public', deprecated: 'deprecated',
    };
    const ENTITY = ['module', 'submodule', 'program', 'subroutine', 'function', 'type', 'interface'];
    for (const [kind, label] of Object.entries(LABELS)) {
      const out = badge({ kind });
      const cls = classesOf(out);
      const group = HPC.includes(kind) ? 'fdf-badge-hpc' : ENTITY.includes(kind) ? 'fdf-badge-entity' : null;
      ok(out.startsWith('<span ') && textOf(out) === label, `${kind}: a span labelled ${label}`);
      eq(cls, ['fdf-badge', group, `fdf-kind-${kind}`, 'not-prose'].filter(Boolean), `${kind}: classes`);
    }
    // what a badge means is in style.css, by its term: its kind, or the kind that some labels make
    eq(Object.keys(LABELS).map((kind) => termsOf(badge({ kind })).map(([, term, a]) => [term, a])), Object.keys(LABELS).map((kind) => [[kind, undefined]]),
      'a badge names its kind as its term');
    eq([['interface', 'generic interface'], ['interface', 'operator'], ['interface', 'assignment'], ['interface', 'defined I/O'], ['interface', 'abstract interface'],
      ['interface', 'module interface'], ['interface', 'interface'], ['submodule', 'separate module procedure'], ['omp', 'OpenMP parallel region'], ['omp', 'OpenMP'],
      ['acc', 'OpenACC routine'], ['cpp', 'conditional'], ['non-recursive'], ['Pure', 'PURE'], ['omp', 'OpenMP tasks'], ['interface', 'constructor']]
      .map(([kind, label]) => termsOf(badge({ kind, label }))[0]?.[1]),
    ['generic-interface', 'operator-interface', 'assignment-interface', 'dtio-interface', 'abstract-interface', 'module-interface', 'interface',
      'separate-procedure', 'omp-parallel', 'omp', 'acc-routine', 'conditional', 'non-recursive', 'pure', 'omp', 'interface'],
    "the labels the generator gives some kinds make terms of their own; any other label keeps the kind's");
    eq([badge({ kind: 'mpi', conditional: 'USE_MPI' }), badge({ conditional: 'HAVE_X' }), badge({ kind: 'cpp', label: 'conditional', conditional: 'A' })].map((b) => termsOf(b)),
      [[['span.fdf-badge', 'mpi', 'USE_MPI']], [['span.fdf-badge', 'when', 'HAVE_X']], [['span.fdf-badge', 'conditional', 'A']]],
      "a badge's argument is its condition, and a condition alone is the condition's term");
    eq(termsOf(badge({ kind: 'Block Data!' })), [['span.fdf-badge', 'block-data', undefined]], 'another kind is a term too, which shows no card unless a site gives it a meaning');
    eq(['constructor', 'toString'].map((kind) => [textOf(badge({ kind })), termsOf(badge({ kind }))[0]?.[1]]), [['constructor', 'constructor'], ['toString', 'tostring']],
      'a kind named like a property of every object is another kind');
    ok([...Object.keys(LABELS).map((kind) => badge({ kind })), badge({ kind: 'mpi', title: 'x' }), badge({ kind: 'mpi', conditional: 'X' })].every((b) => !/ title=/.test(b)),
      'no badge has a native tooltip, which would cover its card');
    // the title: text in the badge, after the label, hidden from the eye until the card shows, and read with the badge
    const noted = badge({ kind: 'mpi', conditional: 'USE_MPI', title: 'MPI_Allreduce, MPI_Bcast' });
    eq(noted, '<span class="fdf-badge fdf-badge-hpc fdf-kind-mpi fdf-badge-conditional not-prose" data-term="mpi" data-arg="USE_MPI">MPI '
      + '<span class="fdf-badge-note" data-arg="USE_MPI">MPI_Allreduce, MPI_Bcast</span> <span class="fdf-when">when <code>USE_MPI</code></span></span>',
    "a title is the note in the badge's card, with the condition for a browser that reads data-arg there");
    eq(textOf(noted), 'MPI MPI_Allreduce, MPI_Bcast when USE_MPI', 'screen readers read the note with the badge, once');
    eq(badge({ kind: 'omp', label: 'OpenMP parallel region', title: 'parallel do' }),
      '<span class="fdf-badge fdf-badge-hpc fdf-kind-omp not-prose" data-term="omp-parallel">OpenMP parallel region <span class="fdf-badge-note">parallel do</span></span>',
      'a note without a condition');

    const mpi = badge({ kind: 'mpi', conditional: 'USE_MPI' });
    eq(textOf(mpi), 'MPI when USE_MPI', 'a conditional badge says "when <condition>"');
    eq(classesOf(mpi), ['fdf-badge', 'fdf-badge-hpc', 'fdf-kind-mpi', 'fdf-badge-conditional', 'not-prose'], 'a conditional badge is marked dashed');
    ok(mpi.includes('<span class="fdf-when">when <code>USE_MPI</code></span>'), 'the condition is code inside the "when" part');
    eq(textOf(badge({ kind: 'omp', label: 'OpenMP parallel region' })), 'OpenMP parallel region', 'label replaces the default');
    eq(textOf(badge({ kind: 'OMP' })), 'OpenMP', 'kinds are matched without regard to case');

    const odd = badge({ kind: 'Block Data!' });
    eq([textOf(odd), classesOf(odd)], ['Block Data!', ['fdf-badge', 'fdf-kind-block-data', 'not-prose']], 'another kind: shown as written, neutral, a safe class');
    ok(!classesOf(badge({ kind: 'hpc' })).includes('fdf-badge-hpc'), 'a kind named like a group class does not join the group');
    eq(textOf(badge({ kind: 'cpp', conditional: 'defined(A) && B > 1' })), 'cpp when defined(A) && B > 1', 'a condition with operators is escaped, not markup');
    ok(badge({ kind: 'cpp', conditional: 'A < B' }).includes('A &lt; B'), 'markup in a condition is escaped');
    const quoted = badge({ kind: 'x', label: '<b>"q" & {y}</b>', title: '"t" <&>' });
    ok(quoted.includes('>&lt;b&gt;&quot;q&quot; &amp; {y}&lt;/b&gt; <span class="fdf-badge-note">&quot;t&quot; &lt;&amp;&gt;</span></span>'),
      'quotes, angle brackets, ampersands and braces in a label and a title are text');
    eq([badge({}), badge({ kind: ' ', label: '' })], ['', ''], 'no kind, label or condition: no pill at all');
    eq(textOf(badge({ conditional: 'HAVE_X' })), 'when HAVE_X', 'a condition alone still shows');

    const row = render(h(FortranBadges, null,
      h(FortranBadge, { kind: 'module' }), ' ', h(FortranBadge, { kind: 'omp' }), null,
      h(FortranBadge, { kind: 'mpi', conditional: 'USE_MPI' })));
    ok(row.startsWith('<div class="fdf-badges not-prose"><span class="fdf-badge'), 'FortranBadges: a div of badges');
    eq(textOf(row), 'module OpenMP MPI when USE_MPI', 'badges are read apart: one space between each');
    eq(render(h(FortranBadges, null)), '<div class="fdf-badges not-prose"></div>', 'an empty row');

    // ---- the table
    const HEAD = '<div class="fdf-args-head not-prose" aria-hidden="true">';
    const list = render(h(FortranArgs, null, h(FortranArg, { name: 'x' })));
    ok(list.startsWith(`<div class="fdf-args" data-columns="type shape intent attrs"><p class="fdf-args-title not-prose">Arguments</p>${HEAD}<span class="fdf-col-name">Name</span> <span class="fdf-col-type">Type</span> <span class="fdf-col-shape">Shape</span> <span class="fdf-col-intent">Intent</span> <span class="fdf-col-attrs">Attributes</span></div><div class="fdf-arg fdf-arg-plain">`),
      'FortranArgs: a card with the title, a header row of every column by default, then the rows');
    const cols = (columns) => {
      const out = render(h(FortranArgs, { columns }));
      return [/data-columns="([^"]*)"/.exec(out)?.[1], textOf(inner(out, HEAD) ?? '')];
    };
    eq(cols('attrs type'), ['type attrs', 'Name Type Attributes'], 'columns: only those named, in table order, and their headings');
    eq(cols(''), ['', 'Name'], 'no columns: the name alone');
    eq(cols('Type, INTENT bogus'), ['type intent', 'Name Type Intent'], 'columns separated by commas, in any case; unknown names are ignored');
    ok(render(h(FortranArgs, { title: 'Components' })).includes('>Components</p>'), 'a title of its own');
    ok(!render(h(FortranArgs, { title: '' })).includes('fdf-args-title'), 'an empty title is left out');

    // ---- a row that opens
    const arg = (props, ...children) => render(h(FortranArg, props, ...children));
    // a name in a type that links and carries a hover card
    const DP = { href: '/docs/api/kinds#dp', title: 'integer, parameter :: dp = kind(1d0)', detail: 'Double precision', note: 'From kinds.f90:3' };
    const CHEVRON = '<svg class="fdf-chevron" viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="m6 9 6 6 6-6"></path></svg>';
    const x = arg({ name: 'x', type: 'real(dp)', dims: '(:)', intent: 'in', decl: 'real(dp), intent(in) :: x(:)' }, h('p', null, 'local slice of the vector'));
    eq(x, '<details class="fdf-arg"><summary class="fdf-arg-row not-prose">'
      + '<span class="fdf-col-name"><code class="fdf-arg-name">x</code></span> '
      + '<span class="fdf-col-type"><span class="fdf-arg-type"><code>real(dp)</code></span></span> '
      + '<span class="fdf-col-shape" data-term="shape" data-arg="rank 1, assumed shape"><code class="fdf-arg-shape"><span class="fdf-arg-dims">(:)</span></code></span> '
      + '<span class="fdf-col-intent"><span class="fdf-intent fdf-intent-in" data-term="intent-in"><span class="fdf-intent-arrow" aria-hidden="true">→</span> in</span></span> '
      + `<span class="fdf-col-attrs"></span>${CHEVRON}</summary>`
      + '<div class="fdf-arg-panel"><div class="fdf-arg-doc"><p>local slice of the vector</p></div><dl class="fdf-arg-fields not-prose">'
      + '<div class="fdf-arg-field fdf-arg-narrow"><dt>Type</dt><dd><span class="fdf-arg-type"><code>real(dp)</code></span></dd></div>'
      + '<div class="fdf-arg-field"><dt>Declaration</dt><dd><code class="fdf-arg-decl">real(dp), intent(in) :: x(:)</code></dd></div>'
      + '<div class="fdf-arg-field"><dt>Intent</dt><dd data-term="intent-in"></dd></div>'
      + '<div class="fdf-arg-field"><dt>Shape</dt><dd><span class="fdf-arg-narrow"><code class="fdf-arg-shape"><span class="fdf-arg-dims">(:)</span></code></span> rank 1, assumed shape</dd></div>'
      + '</dl></div></details>',
    'FortranArg: a details row of cells and a chevron, opening to the doc, the declaration, the intent in words (style.css writes them in) and the shape in words; the shape and the intent name their terms, for their cards');
    eq(textOf(wide(x)), 'x real(dp) (:) → in local slice of the vector Declaration real(dp), intent(in) :: x(:) Intent Shape rank 1, assumed shape', 'the row reads name, type, shape, intent, then its panel');

    const intent = (i) => {
      const out = arg({ name: 'a', intent: i });
      const m = /<span class="(fdf-intent[^"]*)" data-term="([^"]*)"><span class="fdf-intent-arrow" aria-hidden="true">([^<]*)<\/span> (\w+)<\/span>/.exec(out);
      return m ? [m[1], m[2], m[3], m[4]] : out;
    };
    eq(intent('in'), ['fdf-intent fdf-intent-in', 'intent-in', '→', 'in'], 'intent(in): text, arrow and term');
    eq(intent('out'), ['fdf-intent fdf-intent-out', 'intent-out', '←', 'out'], 'intent(out)');
    eq(intent('inout'), ['fdf-intent fdf-intent-inout', 'intent-inout', '↔\uFE0E', 'inout'], 'intent(inout)');
    eq(intent('In Out'), intent('inout'), "'In Out' is inout");
    const arrows = ['in', 'out', 'inout'].map((i) => intent(i)[2]);
    ok(new Set(arrows).size === 3, 'the three intents have different arrows, not only different colours');
    eq(cellOf(arg({ name: 'a', intent: 'none' }), 'intent'), '<span class="fdf-intent">none</span>', 'another intent is shown as written, with no arrow and no card');
    eq(['constructor', 'toString', '__proto__'].map((i) => cellOf(arg({ name: 'a', intent: i }), 'intent')),
      ['constructor', 'toString', '__proto__'].map((i) => `<span class="fdf-intent">${i}</span>`), 'an intent named like a property of every object is another intent');
    ok(!arg({ name: 'a' }).includes('fdf-intent'), 'no intent, no marker');
    const res = arg({ name: 'nrm', type: 'real(dp)', result: true, intent: 'out' });
    eq(cellOf(res, 'intent'), '<span class="fdf-intent fdf-intent-result" data-term="result">result</span>', 'a result: a neutral "result" pill, in place of any intent');
    eq(cellOf(arg({ name: 'r', result: 'true' }), 'intent'), cellOf(res, 'intent'), "MDX's 'true' makes a result");
    ok([x, res, arg({ name: 'a', intent: 'out', attrs: 'allocatable', cond: 'X', decl: 'd' })].every((out) => !/ title=/.test(out)),
      'no pill has a native tooltip, which would cover its card');

    const info = arg({ name: 'info', type: 'integer', intent: 'out', optional: true, value: true, attrs: 'target, bind(c, name="f"), Optional' });
    eq([...cellOf(info, 'attrs').matchAll(/<span class="fdf-flag"[^>]*>([^<]*)<\/span>/g)].map((m) => m[1]), ['optional', 'value', 'target', 'bind(c, name=&quot;f&quot;)'],
      'flags: optional, value, then attrs split at top-level commas, without repeats');
    eq(termsOf(cellOf(info, 'attrs')), [['span.fdf-flag', 'optional', undefined], ['span.fdf-flag', 'value', undefined], ['span.fdf-flag', 'target', undefined],
      ['span.fdf-flag', 'bind', 'c, name=&quot;f&quot;']], 'each flag names its term, for its card');
    const flagTerms = (attrs) => termsOf(cellOf(arg({ name: 'a', attrs }), 'attrs')).map(([, term, a]) => (a === undefined ? term : `${term} ${a}`));
    eq(flagTerms("ALLOCATABLE, pass( self ), pass, nopass, non_overridable, default dp, = 0.5_dp, => null(), Contiguous, kind, len, rank(2), '&'"),
      ['allocatable', 'pass self', 'pass', 'nopass', 'non_overridable', 'default dp', 'init 0.5_dp', 'pointer-init null()', 'contiguous', 'kind', 'len', 'rank 2'],
      "a flag's term: its keyword in lower case and what its brackets hold, or the value of default, = and =>; other text has none");
    // => alone is no initialisation to '>' ("Initialised to > where it is declared")
    eq(['=>', '=0', '=>null()'].map((attrs) => flagTerms(attrs)), [[], ['init 0'], ['pointer-init null()']], 'a bare => has no term; = and => without a space do');
    eq(textOf(rowOf(arg({ name: 'n', optional: 'true', value: 'false' }))), 'n — optional', "MDX's 'true' and 'false' strings read as booleans");

    const comm = arg({ name: 'comm', type: 'type(MPI_Comm)', intent: 'in', cond: 'USE_MPI' }, h('p', null, 'communicator'));
    ok(comm.startsWith('<details class="fdf-arg fdf-arg-conditional">'), 'a conditional row is marked');
    eq(cellOf(comm, 'attrs'), '<span class="fdf-cond" data-term="when" data-arg="USE_MPI">when <code>USE_MPI</code></span>',
      'the condition: "when", then the condition in code, with the attributes; its card says what it means');
    eq(textOf(wide(comm)), 'comm type(MPI_Comm) — → in when USE_MPI communicator Intent Exists when USE_MPI', 'condition after intent, and in the panel');

    const total = arg({ name: 'total', type: 'real(dp)', codims: '*', intent: 'out' });
    eq(cellOf(total, 'shape'), '<code class="fdf-arg-shape"><span class="fdf-arg-codims">[*]</span></code>', 'codimensions, with brackets added, in the shape column');
    eq(cellOf(arg({ name: 'a', type: 'real', dims: ':,:' }), 'shape'), '<code class="fdf-arg-shape"><span class="fdf-arg-dims">(:,:)</span></code>', 'dimensions get their parentheses');
    eq(cellOf(arg({ name: 'a', type: 'real', dims: '(n)', codims: '[2,*]' }), 'shape'), '<code class="fdf-arg-shape"><span class="fdf-arg-dims">(n)</span><span class="fdf-arg-codims">[2,*]</span></code>', 'dimensions, then codimensions');
    eq(cellOf(arg({ name: 'p' }), 'shape'), '<span class="fdf-arg-none" aria-hidden="true">—</span>', 'no shape: a muted dash, which screen readers skip');
    // the shape keeps its brackets, and its cell has a card with its words
    const shapeTerm = (props) => termsOf(rowOf(arg({ name: 'a', ...props }))).filter(([el]) => el === 'span.fdf-col-shape');
    eq([shapeTerm({ dims: '(lda,*)' }), shapeTerm({ dims: ':,:', attrs: 'allocatable' }), shapeTerm({ codims: '*' }), shapeTerm({})],
      [[['span.fdf-col-shape', 'shape', 'rank 2, assumed size']], [['span.fdf-col-shape', 'shape', 'rank 2, deferred shape']], [['span.fdf-col-shape', 'shape', 'coarray']], []],
      "a shape's card says it in the words of the opened row; no shape, no card");

    // the shape in words
    const shape = (dims, codims, attrs) => fieldsOf(arg({ name: 'a', dims, codims, attrs })).find(([label]) => label === 'Shape')?.[1].replace(/^<span class="fdf-arg-narrow">[\s\S]*?<\/code><\/span> /, '');
    eq([shape('(:,:)'), shape('(n)'), shape('(0:n, 3)'), shape('(:)', '', 'allocatable'), shape('(:,:)', '', 'contiguous, pointer'), shape('(2:)'),
      shape('(lda,*)'), shape('(*)'), shape('(1:*)'), shape('(..)'), shape('(*)', '', 'parameter'), shape('(:, n)')],
    ['rank 2, assumed shape', 'rank 1, explicit shape', 'rank 2, explicit shape', 'rank 1, deferred shape', 'rank 2, deferred shape', 'rank 1, assumed shape',
      'rank 2, assumed size', 'rank 1, assumed size', 'rank 1, assumed size', 'assumed rank', 'rank 1, implied shape', 'rank 2'],
    'the shape in words: rank, then assumed, explicit, deferred (allocatable or pointer), assumed size or implied; assumed rank');
    eq([shape('', '[*]'), shape('(:)', '[:]', 'allocatable'), shape('(n)', '[2,*]'), shape('(size(a, 1), 2)')],
      ['coarray', 'rank 1, deferred shape; coarray', 'rank 1, explicit shape; coarray, corank 2', 'rank 2, explicit shape'],
      'codimensions make a coarray; commas inside a bound do not count');
    eq(fieldsOf(arg({ name: 'a', dims: '(:)' })).map(([label, , narrow]) => [label, narrow]), [['Shape', false]], 'the shape opens a row: its words show in any width, the dimensions only in a narrow table');

    // the fields, in order; the type only for a narrow table
    const all = arg({ name: 'w', type: 'real', dims: '(:)', intent: 'inout', attrs: 'target, pass(self), default dp, foo', cond: 'X', decl: 'real, intent(inout), target :: w(:)' }, 'doc');
    eq(fieldsOf(all).map(([label, , narrow]) => [label, narrow]), [['Type', true], ['Declaration', false], ['Intent', false], ['Attributes', false], ['Shape', false], ['Exists when', false]],
      'the panel: the type (narrow tables), the declaration, the intent, the attributes, the shape and the condition');
    eq(fieldsOf(all).find(([label]) => label === 'Exists when')[1], '<code>X</code>', 'the condition, as code');
    eq(fieldsOf(all).find(([label]) => label === 'Intent')?.slice(1), ['', false, 'data-term="intent-inout"'], 'the intent in words, which style.css writes in by its term (its meaning names it)');
    eq(listOf(all), [['target', 'target', undefined], ['pass(self)', 'pass', 'self'], ['default dp', 'default', 'dp'], ['foo', 'foo', undefined]],
      'the attributes, each beside its meaning (style.css writes it in by the term), without the condition, which has its own field');
    ok(!/<dt><span class="fdf-flag" data-term/.test(all), "a flag in the panel has no card: its meaning is beside it");
    eq(['in', 'out', 'inout', 'none'].map((i) => fieldsOf(arg({ name: 'a', intent: i, decl: 'd' })).find(([label]) => label === 'Intent')?.[3]),
      ['data-term="intent-in"', 'data-term="intent-out"', 'data-term="intent-inout"', undefined], 'each intent in words; another intent has none');
    // only a page written by hand, or code that declares an intent for a result (which compilers reject), gives a result
    // an intent: the intent column says result, and so does the panel
    ok([arg({ name: 'r', result: true, intent: 'out', decl: 'd' }), arg({ name: 'r', result: 'true', intent: 'in', decl: 'd' })]
      .every((out) => !fieldsOf(out).some(([label]) => label === 'Intent')), 'a result has no intent, even when given one');
    ok(inner(all, '<div class="fdf-arg-doc">') === 'doc', 'the doc first, unlabelled, as in TypeTable');
    eq(fieldsOf(arg({ name: 'd', decl: 'integer :: d = 1 ! "q" <&>' })), [['Declaration', '<code class="fdf-arg-decl">integer :: d = 1 ! &quot;q&quot; &lt;&amp;&gt;</code>', false, '']], 'a declaration alone opens a row; it is text');

    // ---- the length of a character type: its * or : has a card, and an opened row says it in words
    // (the Length line's value, or, where style.css writes it in, the term it names)
    const lengthOf = (type, refs) => {
      const f = fieldsOf(arg({ name: 'c', type, refs, decl: 'd' })).find(([label]) => label === 'Length');
      return f && (f[3] && !f[1] ? f[3] : f[1]);
    };
    // the words of the * and the :, which are their cards' meanings: style.css writes them in by the term, once
    const ASSUMED = 'data-term="assumed-length"';
    const DEFERRED = 'data-term="deferred-length"';
    eq(['character(*)', 'character(len=*)', 'CHARACTER*(*)', 'character * ( * )', 'character(kind=ck, len=*)', 'character(len=:, kind=ck)', 'character(:)',
      'character(10)', 'character*8', 'character(len=n_max)', 'character', 'character(kind=c_char)', 'character(ck)', 'character(10, kind=ck)'].map((t) => lengthOf(t)),
    [ASSUMED, ASSUMED, ASSUMED, ASSUMED, ASSUMED, DEFERRED, DEFERRED, '<span class="fdf-arg-type"><code>10</code></span>', '<span class="fdf-arg-type"><code>8</code></span>',
      '<span class="fdf-arg-type"><code>n_max</code></span>', '1, the default', '1, the default', '<span class="fdf-arg-type"><code>ck</code></span>',
      '<span class="fdf-arg-type"><code>10</code></span>'],
    'the length: assumed (*) and deferred (:) in words, any other as written, none 1; len=, or the first item without a keyword, or what follows character*');
    // Fortran's keywords are in any case: QE writes CHARACTER(LEN=*), and a case-sensitive LEN= showed "LEN=*" as the
    // length with no card, and an upper-case KIND= as the length
    eq(['CHARACTER(LEN=*)', 'Character(Len=:)', 'CHARACTER(LEN=N)', 'CHARACTER(KIND=CK, LEN=*)', 'CHARACTER(KIND=C_CHAR)'].map((t) => lengthOf(t)),
      [ASSUMED, DEFERRED, '<span class="fdf-arg-type"><code>N</code></span>', ASSUMED, '1, the default'], 'LEN= and KIND= in upper or mixed case');
    eq(['real(dp)', 'class(*)', 'type(character_t)', 'character_t', 'complex(kind=dp)'].map((t) => lengthOf(t)), Array(5).fill(undefined), 'only a character type has a length, and class(*) is not one');
    ok(/<a class="fdf-ref-name" href="\/x#n_max"/.test(lengthOf('character(len=n_max)', { n_max: { href: '/x#n_max', title: 'integer, parameter :: n_max = 64' } })), 'a name in the length links, as in the type');
    eq(fieldsOf(arg({ name: 'c', type: 'character(*)', decl: 'd' })).find(([label]) => label === 'Length'), ['Length', '', false, ASSUMED],
      "the Length line of a * or : is its card's meaning, which style.css writes in: one wording, which a site's rule for the term rewords in both");
    const glyph = (type) => termsOf(cellOf(arg({ name: 'c', type, decl: 'd' }), 'type'));
    eq(['character(*)', 'character(len=:)', 'character*(*)', 'character(10)', 'class(*)', 'character(len=n)', 'CHARACTER(LEN=*)', 'Character(Len=:)'].map(glyph),
      [[['span.fdf-len', 'assumed-length', undefined]], [['span.fdf-len', 'deferred-length', undefined]], [['span.fdf-len', 'assumed-length', undefined]], [], [], [],
        [['span.fdf-len', 'assumed-length', undefined]], [['span.fdf-len', 'deferred-length', undefined]]],
      'the * or : of a length is a span with a card; nothing else in a type is');
    // The * of a function's result (character(*) function f, obsolescent) takes the length that the caller declares for
    // the function's name: no actual argument gives it. The : of a result is set as any deferred length is.
    const resultLength = (type) => {
      const out = arg({ name: 'f', type, result: true, decl: 'd' });
      const f = fieldsOf(out);
      return [termsOf(cellOf(out, 'type')).map(([, term]) => term), f.find(([label]) => label === 'Length')?.[3],
        termsOf(f.find(([label]) => label === 'Type')?.[1] ?? '').map(([, term]) => term)];
    };
    const OF_RESULT = [['assumed-length-result'], 'data-term="assumed-length-result"', ['assumed-length-result']];
    eq(['character(*)', 'CHARACTER*(*)', 'character(len=*)', 'character(kind=ck, len=*)', 'character(:)'].map(resultLength),
      [OF_RESULT, OF_RESULT, OF_RESULT, OF_RESULT, [['deferred-length'], DEFERRED, ['deferred-length']]],
      "a function's result of assumed length: its * (in the cell and in a narrow table's copy) and its Length line say where its length comes from");
    // a length after the selector counts: character(len=10)*20 is read as 20 (the generator writes character(len=20))
    eq([lengthOf('character(len=10)*20'), lengthOf('character(kind=ck) * (n)'), lengthOf('character(len=10)*(*)'), glyph('character(len=10)*(*)')],
      ['<span class="fdf-arg-type"><code>20</code></span>', '<span class="fdf-arg-type"><code>n</code></span>', ASSUMED, [['span.fdf-len', 'assumed-length', undefined]]],
      "a length written after the name, as the type's text has it, is the one that counts");
    const cut = unid(cellOf(arg({ name: 'c', type: 'character(kind=ck, len=*)', refs: { ck: DP }, decl: 'd' }), 'type'));
    eq(cut.replace(/<span class="fdf-ref">[\s\S]*?<\/a><\/span>/, 'REF'), '<span class="fdf-arg-type"><code>character(kind=</code>REF<code>, len=</code><span class="fdf-len" data-term="assumed-length"><code>*</code></span><code>)</code></span>',
      'the code is cut around the names that link and around the *, in order, the * code inside its span');
    eq(textOf(wide(`<p>${cut}</p>`)), 'character(kind=ck, len=*)', 'and the type reads as written');
    eq(fieldsOf(arg({ name: 'c', type: 'character(:)', decl: 'd' })).find(([label]) => label === 'Type')?.[1], '<span class="fdf-arg-type"><code>character(</code><span class="fdf-len" data-term="deferred-length"><code>:</code></span><code>)</code></span>',
      "the type's copy for a narrow table has the card too");
    eq([arg({ name: 'c', type: 'character(*)' }), arg({ name: 'c', type: 'character(:)' }), arg({ name: 'c', type: 'character(10)' })].map((out) => out.includes('fdf-arg-plain')),
      [false, false, true], 'an assumed or a deferred length opens a row, to say it in words; a length as written does not');

    // ---- a type parameter's kind or len. The generator writes `integer, kind :: k = dp` as the type "integer, kind" and
    // one pill, "default dp": the word kind or len has a card that says what such a parameter is, as the * of
    // character(*) has, and an opened row says it in words, as its Length line says a * or a :. Before, nothing in the
    // row explained the word: only a hand-written attrs="kind" pill had the meaning.
    const KIND = arg({ name: 'k', type: 'integer, kind', attrs: 'default dp', decl: 'integer, kind :: k = dp' }, h('p', null, 'The kind of the entries.'));
    eq(cellOf(KIND, 'type'), '<span class="fdf-arg-type"><code>integer, </code><span class="fdf-type-param" data-term="kind"><code>kind</code></span></span>',
      "the kind of a type parameter's type is a span that names its term, the code cut around it, as the * of character(*) is");
    eq(fieldsOf(KIND).map(([label, , narrow, props]) => [label, narrow, props]),
      [['Type', true, ''], ['Declaration', false, ''], ['Type parameter', false, 'data-term="kind"'], ['Attributes', false, '']],
      "an opened row says what the kind means on a line of its own, which style.css writes in by the term, before the default's meaning");
    eq(fieldsOf(KIND).find(([label]) => label === 'Type')?.[1], cellOf(KIND, 'type'), "the type's copy for a narrow table has the card too");
    eq(textOf(wide(KIND)), 'k integer, kind — default dp The kind of the entries. Declaration integer, kind :: k = dp Type parameter Attributes default dp',
      'the row reads its name, type and default, then its panel, the Type parameter line before the attributes');
    eq([stops(KIND), / title=/.test(KIND)], [1, false], "the word is no tab stop and has no native tooltip: a row is one stop, its summary");
    // the declaration's form: an integer type, then kind or len, in any case and spacing, a kind selector before it
    const param = (type, refs) => termsOf(cellOf(arg({ name: 'k', type, refs, decl: 'd' }), 'type')).filter(([el]) => el === 'span.fdf-type-param').map(([, term]) => term);
    eq(['integer, kind', 'integer, len', 'INTEGER, LEN', 'Integer(int8), Kind', 'integer(kind=int8), len', 'integer,kind', 'integer , len', 'integer*8, kind'].map((t) => param(t)),
      [['kind'], ['len'], ['len'], ['kind'], ['len'], ['kind'], ['len'], ['kind']], 'integer, kind and integer, len, whatever the case, the blanks or the kind of the integer');
    // a kind selector's kind=, a binding's generic => kind, len and character(len=*) are not a type parameter's word
    eq(['integer', 'integer(kind=4)', 'real(kind=dp)', 'type(matrix(kind=dp, len=3))', 'generic => kind, len', 'integer, parameter', 'real, kind', 'kind', 'character(len=*)']
      .map((t) => param(t)), Array(9).fill([]), 'no other type has the word');
    // nor does a longer word, kind or len with more to it, a second attribute after it, or a name that only starts as
    // integer does: the word is the whole of the one item after an integer type
    eq(['integer, kindx', 'integer, kind=4', 'integer, len(3)', 'integer, kind, public', 'integer2, len'].map((t) => param(t)), Array(5).fill([]),
      'only kind or len alone after an integer type is the word');
    eq(textOf(cellOf(arg({ name: 'k', type: 'INTEGER , LEN', decl: 'd' }), 'type')), 'INTEGER , LEN', 'and the type reads as written');
    // a kind name in the type still links: the code is cut around both, in order
    const I8 = { href: '/docs/api/kinds#i8', title: 'integer, parameter :: i8 = int64' };
    eq(unid(cellOf(arg({ name: 'k', type: 'integer(i8), kind', refs: { i8: I8 }, decl: 'd' }), 'type')).replace(/<span class="fdf-ref">[\s\S]*?<\/a><\/span>/, 'REF'),
      '<span class="fdf-arg-type"><code>integer(</code>REF<code>), </code><span class="fdf-type-param" data-term="kind"><code>kind</code></span></span>',
      "a name that links and the type parameter's word, each cut out of the code");
    // a name in refs spelt as the word does not take it: the word is the type parameter's, drawn once
    const named = cellOf(arg({ name: 'k', type: 'integer(kind), kind', refs: { kind: I8 }, decl: 'd' }), 'type');
    eq([textOf(wide(`<p>${named}</p>`)), (named.match(/class="fdf-ref"/g) ?? []).length, param('integer(kind), kind', { kind: I8 })], ['integer(kind), kind', 1, ['kind']],
      "a name spelt kind links where it is a name, and the type parameter's word stays the word");
    // a type parameter's type alone opens the row, to say what the word means for the keyboard and screen readers
    const lone = arg({ name: 'n', type: 'integer, len' });
    eq([lone.startsWith('<details class="fdf-arg">'), fieldsOf(lone).map(([label, , narrow, props]) => [label, narrow, props]), stops(lone), / title=/.test(lone)],
      [true, [['Type', true, ''], ['Type parameter', false, 'data-term="len"']], 1, false], 'a type parameter with nothing else to say opens a row, to say what len means');
    // a page written by hand, as the generator wrote it before, keeps its pill, its card and its line in the list
    const old = arg({ name: 'k', type: 'integer', attrs: 'kind, default dp', decl: 'integer, kind :: k = dp' });
    eq([termsOf(cellOf(old, 'attrs')), listOf(old), fieldsOf(old).map(([label]) => label)],
      [[['span.fdf-flag', 'kind', undefined], ['span.fdf-flag', 'default', 'dp']], [['kind', 'kind', undefined], ['default dp', 'default', 'dp']], ['Type', 'Declaration', 'Attributes']],
      'a hand-written attrs="kind" is a pill with the same term, beside its meaning in the opened row, and no Type parameter line');

    // ---- an intent and attributes open a row: its panel says what they mean for the keyboard and screen readers, who
    // get no hover card (the docs' own <FortranArg name="info" type="integer" intent="out" /> said it to no one)
    const info2 = arg({ name: 'info', type: 'integer', intent: 'out', optional: true });
    eq([info2.startsWith('<details class="fdf-arg">'), fieldsOf(info2).map(([label, , narrow, props]) => [label, narrow, props]), listOf(info2)],
      [true, [['Type', true, ''], ['Intent', false, 'data-term="intent-out"'], ['Attributes', false, '']], [['optional', 'optional', undefined]]],
      'a type, an intent and a flag alone: a row that opens to the intent in words and the flag beside its meaning');
    eq([arg({ name: 'x', intent: 'in' }), arg({ name: 'x', type: 'real', attrs: 'target' }), arg({ name: 'x', attrs: 'rank(2)' })].map((out) => fieldsOf(out).map(([label]) => label)),
      [['Intent'], ['Type', 'Attributes'], ['Attributes']], 'an intent alone, or an attribute with a term, opens a row');
    // a term is not only a keyword's: = 0, => null() and default dp have theirs (init, pointer-init, default), as
    // types/react.d.ts says of the rows that open
    eq(['= 0', '=> null()', 'default dp'].map((attrs) => listOf(arg({ name: 'x', attrs }))), [[['= 0', 'init', '0']], [['=&gt; null()', 'pointer-init', 'null()']], [['default dp', 'default', 'dp']]],
      'an initial value or a default alone opens a row too, to say what it means');
    eq(listOf(arg({ name: 'a', type: 'real', attrs: 'rank(2), allocatable' })), [['rank(2)', 'rank', '2'], ['allocatable', 'allocatable', undefined]],
      'a RANK clause is a flag with its term and its rank, which its meaning says');

    // ---- plain rows: nothing to open to
    const p = arg({ name: 'p', type: '', dims: ' ', intent: '', attrs: '', cond: '', decl: ' ', optional: false });
    eq(p, '<div class="fdf-arg fdf-arg-plain"><div class="fdf-arg-row not-prose"><span class="fdf-col-name"><code class="fdf-arg-name">p</code></span> <span class="fdf-col-type"></span> <span class="fdf-col-shape"><span class="fdf-arg-none" aria-hidden="true">—</span></span> <span class="fdf-col-intent"></span> <span class="fdf-col-attrs"></span></div></div>',
      'a name alone: a plain row, its empty cells keeping their places, nothing for empty props');
    ok(!arg({ name: 'w' }, ' \n').includes('<details'), 'a doc of whitespace alone opens nothing');
    const plain = arg({ name: 'n', type: 'integer', intent: 'none', attrs: "'&'" });
    ok(!plain.includes('<details') && !plain.includes('fdf-chevron') && !plain.includes('fdf-arg-panel'), 'a type, an intent of its own and a flag without a term: no panel, no chevron');
    eq(inner(plain, '<div class="fdf-arg-alt not-prose">'), '<span class="fdf-arg-type"><code>integer</code></span> <span class="fdf-flag">&#x27;&amp;&#x27;</span>',
      'and a line for a narrow table with the type and the flag');
    // the result pill's meaning is the table's title (Result), which an opened row would not add to
    eq([arg({ name: 'r', type: 'real', result: true }), arg({ name: 'r', type: 'real', result: true, intent: 'out' }), arg({ name: 'n', type: 'integer' })]
      .map((out) => out.startsWith('<div class="fdf-arg fdf-arg-plain">')), [true, true, true], 'a result, or a type, alone is a plain row');
    ok(arg({ name: 'w' }, h('em', null, 'a'), ' ', h('em', null, 'b')).includes('<div class="fdf-arg-doc"><em>a</em> <em>b</em></div>'), 'a space between words of the doc is kept');
    eq(rowOf(arg({ name: '<n>', type: 'character(len=*), "q"', attrs: "'&'", cond: 'A<B' })),
      '<span class="fdf-col-name"><code class="fdf-arg-name">&lt;n&gt;</code></span> <span class="fdf-col-type"><span class="fdf-arg-type"><code>character(len=</code>'
      + '<span class="fdf-len" data-term="assumed-length"><code>*</code></span><code>), &quot;q&quot;</code></span></span> '
      + '<span class="fdf-col-shape"><span class="fdf-arg-none" aria-hidden="true">—</span></span> <span class="fdf-col-intent"></span> '
      + `<span class="fdf-col-attrs"><span class="fdf-flag">&#x27;&amp;&#x27;</span> <span class="fdf-cond" data-term="when" data-arg="A&lt;B">when <code>A&lt;B</code></span></span>${CHEVRON}`,
    'a name, type, flag and condition with markup characters are text');
    // a <wbr> is a space to Chrome's accessibility tree, so screen readers would read max_ iter_ count; a long name,
    // type or path breaks where it must instead (overflow-wrap: anywhere)
    const long = arg({ name: 'max_iter_count', type: 'type(MPI_Comm), dimension(n_procs)', refs: { mpi_comm: DP }, decl: 'd' })
      + render(h(FortranSource, { file: 'examples/modern/src/modern_ford.F90', line: 1, href: 'https://example.org' }));
    ok(!long.includes('<wbr') && long.includes('<code class="fdf-arg-name">max_iter_count</code>') && long.includes('<code>examples/modern/src/modern_ford.F90</code>'),
      'names, types and file paths are drawn whole, with no break opportunities in them');
    eq(['.fdf-arg-name', '.fdf-arg-type', '.fdf-source-title'].map((s) => decl(s, 'overflow-wrap')), Array(3).fill(['anywhere']), 'and a long one still breaks rather than run out of its cell');

    // ---- refs: names in the type that link and carry a hover card
    const typed = (type, refs) => cellOf(arg({ name: 'a', type, refs, decl: 'x' }), 'type');
    const CARD = '<span class="fdf-ref-card not-prose" role="tooltip" aria-hidden="true" id="ID"><code class="fdf-ref-title">integer, parameter :: dp = kind(1d0)</code> <span class="fdf-ref-detail">Double precision</span> <span class="fdf-ref-note">From kinds.f90:3</span></span>';
    eq(unid(typed('real(dp)', { dp: DP })), `<span class="fdf-arg-type"><code>real(</code><span class="fdf-ref"><a class="fdf-ref-name" href="/docs/api/kinds#dp" aria-describedby="ID"><span class="fdf-ref-text">dp</span>${CARD}</a></span><code>)</code></span>`,
      'a known name in the type: a link with its card, the code cut around it');
    eq(typed('REAL(KIND=Dp)', { dP: DP }).match(/<span class="fdf-ref-text">([^<]*)<\/span>/)?.[1], 'Dp', 'names match in any case, and keep the spelling of the type');
    eq(['real(dp2)', 'real(x_dp)', 'real(2dp)', 'type(dpx)'].map((t) => typed(t, { dp: DP }).includes('fdf-ref')), [false, false, false, false], 'only whole words');
    const two = typed('type(banded_matrix(k=dp, n=dp))', { dp: DP, banded_matrix: { title: 'type :: banded_matrix', href: '/x#banded_matrix' } });
    eq([...two.matchAll(/<a class="fdf-ref-name" href="([^"]*)"[^>]*><span class="fdf-ref-text">([^<]*)<\/span>/g)].map((m) => `${m[2]} ${m[1]}`), ['banded_matrix /x#banded_matrix', 'dp /docs/api/kinds#dp', 'dp /docs/api/kinds#dp'], 'every occurrence of every name');
    eq(textOf(wide(`<p>${two}</p>`)), 'type(banded_matrix(k=dp, n=dp))', 'the type reads as written');
    eq(unid(typed('real(dp)', JSON.stringify({ dp: DP }))), unid(typed('real(dp)', { dp: DP })), 'refs as JSON text');
    eq([typed('real(dp)', '{not json'), typed('real(dp)', ['dp']), typed('real(dp)', { dp: null })], Array(3).fill('<span class="fdf-arg-type"><code>real(dp)</code></span>'), 'refs that are not an object of objects are ignored');
    const narrowType = fieldsOf(arg({ name: 'a', type: 'real(dp)', refs: { dp: DP }, decl: 'x' })).find(([label]) => label === 'Type');
    ok(narrowType?.[2] && narrowType[1].includes('<a class="fdf-ref-name" href="/docs/api/kinds#dp" aria-describedby="') && narrowType[1].includes('<span class="fdf-ref-text">dp</span>'), 'the narrow copy of the type has the refs too');
    // every card on a page has an id of its own, which its name, and only its name, points at: here a row's two names,
    // and their copies in the panel
    const pairs = described(arg({ name: 'a', type: 'type(banded_matrix(k=dp))', refs: { dp: DP, banded_matrix: { title: 'type :: banded_matrix' } }, decl: 'x' }));
    ok(pairs.length === 4 && pairs.every(([by, id]) => by && by === id) && new Set(pairs.map(([id]) => id)).size === 4, 'each name is described by its own card');
    // A server (React Server Components) renders an element it meets twice only once: when the cell and its narrow copy
    // shared the type's FortranRef elements, both copies' cards got one id. Every FortranRef element is met once.
    const refsIn = (node, out = []) => {
      if (Array.isArray(node)) node.forEach((n) => refsIn(n, out));
      else if (node?.props) {
        if (node.type === FortranRef) out.push(node);
        refsIn(node.props.children, out);
      }
      return out;
    };
    const met = [FortranArg({ name: 'a', type: 'real(dp)', refs: { dp: DP }, decl: 'x' }), FortranArg({ name: 'a', type: 'real(dp)', refs: { dp: DP } })].map((el) => refsIn(el));
    eq(met.map((els) => [els.length, new Set(els).size]), [[2, 2], [2, 2]], 'the type\'s cell and its narrow copy (in a panel, or in a plain row\'s line) are elements of their own');

    // ---- FortranRef
    const ref = (props, ...children) => render(h(FortranRef, props, ...children));
    // the card inside the name: a click on it follows the link, and in a row it neither opens nor closes the row; it
    // describes the name for screen readers and is hidden from them as text, so that a row is not read with it
    eq(unid(ref(DP, 'dp')), `<span class="fdf-ref"><a class="fdf-ref-name" href="/docs/api/kinds#dp" aria-describedby="ID"><span class="fdf-ref-text">dp</span>${CARD}</a></span>`, 'FortranRef: the name as a link, its card inside it');
    eq(described(ref(DP, 'dp')).length, 1, 'the link is described by its card');
    eq(unid(ref({ title: 'dp ⇒ real64' }, 'dp')), '<span class="fdf-ref"><button class="fdf-ref-name" type="button" aria-describedby="ID"><span class="fdf-ref-text">dp</span><span class="fdf-ref-card not-prose" role="tooltip" aria-hidden="true" id="ID"><code class="fdf-ref-title">dp ⇒ real64</code></span></button></span>',
      'without a link the name is a button that does nothing, which the keyboard reaches and which a click in a row leaves be');
    eq(described(ref({ title: 'dp ⇒ real64' }, 'dp')).length, 1, 'the button is described by its card');
    eq(ref({ title: '' }, 'dp'), '<span class="fdf-ref"><span class="fdf-ref-name"><span class="fdf-ref-text">dp</span></span></span>', 'with nothing for a card, neither a card nor a focus stop');
    eq(unid(ref({ href: 'javascript:alert(1)', title: 't' }, 'dp')), unid(ref({ title: 't' }, 'dp')), 'a script URL is not a link');
    eq(ref({ href: 'https://gcc.gnu.org/onlinedocs/gfortran/ISO_005fFORTRAN_005fENV.html', title: 't' }, 'dp').match(/href="([^"]*)"/)?.[1], 'https://gcc.gnu.org/onlinedocs/gfortran/ISO_005fFORTRAN_005fENV.html', 'a web link is kept');
    eq([ref({ title: 't' }), ref({ title: 't' }, ' ')], ['', ''], 'no name: nothing');
    ok(unid(ref({ title: '<b>"t"</b> & u', note: '{n}' }, '<x>')).includes('<span class="fdf-ref-text">&lt;x&gt;</span><span class="fdf-ref-card not-prose" role="tooltip" aria-hidden="true" id="ID"><code class="fdf-ref-title">&lt;b&gt;&quot;t&quot;&lt;/b&gt; &amp; u</code> <span class="fdf-ref-note">{n}</span>'), 'the name and the card are text');
    // a FortranRef in a paragraph sits in fumadocs' prose, whose inline code style (border, fill, padding) would land on
    // the card's title
    const inText = /<span class="([^"]*)" role="tooltip"/.exec(render(h('p', null, 'a ', h(FortranRef, DP, 'dp'), ' b')))?.[1].split(' ');
    ok(inText?.includes('fdf-ref-card') && inText.includes('not-prose'), 'the card is not prose, wherever the name stands');

    // MDX hands over its children as one static array (jsxs), with no keys: no warnings, and nothing in between
    const { jsx, jsxs } = await import('react/jsx-runtime');
    const mdx = render(jsxs(FortranArgs, { columns: 'type', children: [jsx(FortranArg, { name: 'a', type: 'integer', children: jsx('p', { children: 'one' }) }), jsx(FortranArg, { name: 'b' })] }))
      + render(jsxs(FortranBadges, { children: [jsx(FortranBadge, { kind: 'omp' }), jsx(FortranBadge, { kind: 'acc' })] }))
      + render(jsxs(FortranSource, { file: 'a.f90', line: 1, children: [jsx('pre', { children: 'x' }), '\n'] }));
    ok(mdx.includes('</details><div class="fdf-arg fdf-arg-plain">') && textOf(wide(mdx)) === 'Arguments Name Type a integer — one b — OpenMP OpenACC Source code in a.f90 line 1 x', 'MDX-style children render in order');

    // ---- the source block
    const where = (props, ...children) => render(h(FortranSource, props, ...children));
    const GH = 'https://github.com/o/r/blob/main/x.F90#L3-L227';
    const ICON = '<svg class="fdf-icon" viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M7 7h10v10"></path><path d="M7 17 17 7"></path></svg>';
    const block = where({ file: 'examples/modern/src/modern_ford.F90', line: 3, lineEnd: 227, href: GH }, h('pre', null, 'module m'));
    eq(block, '<details class="fdf-source"><summary class="fdf-source-head not-prose">'
      + '<span class="fdf-source-title">Source code in <code>examples/modern/src/modern_ford.F90</code></span> '
      + '<span class="fdf-source-lines">lines 3–227</span> '
      + `<span class="fdf-source-end"><a class="fdf-source-link" href="${GH}" title="examples/modern/src/modern_ford.F90, lines 3 to 227">GitHub ${ICON}</a>${CHEVRON}</span></summary>`
      + '<div class="fdf-source-body"><pre>module m</pre></div></details>',
    'FortranSource with code: a block, closed, headed "Source code in <file>" with its lines, a link (titled with what "GitHub" does not say) and a chevron');
    ok(!block.includes('Defined in') && !where({ file: 'a.f90', line: 1 }).includes('Defined in'), 'no "Defined in" any more');
    const head = where({ file: 'examples/modern/src/modern_ford.F90', line: 3, lineEnd: 227, href: GH });
    // the link's text names the file and the lines: a title saying them again is read twice by screen readers
    eq(head, `<div class="fdf-source not-prose"><a class="fdf-source-head" href="${GH}">`
      + '<span class="fdf-source-title">Source code in <code>examples/modern/src/modern_ford.F90</code></span> '
      + `<span class="fdf-source-lines">lines 3–227</span> <span class="fdf-source-link">GitHub ${ICON}</span></a></div>`,
    'without code: the same header, all of it the link, with no title');
    eq(textOf(where({ file: 'a.f90', line: 5 })), 'Source code in a.f90 line 5', 'one line');
    eq(textOf(where({ file: 'a.f90', line: 5, lineEnd: 5 })), 'Source code in a.f90 line 5', 'a range of one line is one line');
    eq(textOf(where({ file: 'a.f90', line: '7', lineEnd: '9' })), 'Source code in a.f90 lines 7–9', 'numbers written as strings');
    eq(where({ file: 'a.f90' }), '<div class="fdf-source not-prose"><div class="fdf-source-head"><span class="fdf-source-title">Source code in <code>a.f90</code></span></div></div>', 'no line and no link: the file alone');
    ok(!where({ file: 'a.f90', line: 5 }, h('pre', null, 'x')).includes('<a '), 'no href, no link');
    eq([where({}), where({ file: ' ', line: 4 })], ['', ''], 'neither a file nor a link: nothing');
    eq(textOf(where({ href: 'https://example.org/a.f90#L4-L8', line: 4, lineEnd: 8 })), 'Source code lines 4–8 example.org', 'a link without a file');
    eq(['https://gitlab.com/o/r/-/blob/main/a.f90', 'https://www.github.com/o/r', 'https://git.example.org/a.f90', '/files/a.f90'].map((href) => textOf(where({ file: 'a.f90', href })).replace('Source code in a.f90 ', '')),
      ['GitLab', 'GitHub', 'git.example.org', 'Open'], 'the link is named after its host');
    ok(!where({ file: 'a.f90', line: 1 }, ' \n').includes('<details'), 'children of whitespace alone: the header alone');
    ok(where({ file: 'a"b<c>&.f90', line: 1, href: 'https://e.org/?a=1&b="2"' }, 'x').includes('<span class="fdf-source-title">Source code in <code>a&quot;b&lt;c&gt;&amp;.f90</code></span> <span class="fdf-source-lines">line 1</span> <span class="fdf-source-end"><a class="fdf-source-link" href="https://e.org/?a=1&amp;b=&quot;2&quot;" title="a&quot;b&lt;c&gt;&amp;.f90, line 1">'), 'the file and the link are escaped');

    // ---- graphs
    const graph = (props, ...children) => render(h(FortranGraph, props, ...children));
    eq(graph({ title: 'Calls' }, h('div', null, 'svg')), '<figure class="fdf-graph"><figcaption class="fdf-graph-head not-prose"><span class="fdf-graph-title">Calls</span></figcaption><div class="fdf-graph-body not-prose"><div>svg</div></div></figure>',
      'FortranGraph: an open card, its title a small label');
    eq(graph({ title: 'Dependencies', collapsed: true }, h('div', null, 'svg')), `<details class="fdf-graph"><summary class="fdf-graph-head not-prose"><span class="fdf-graph-title">Dependencies</span>${CHEVRON}</summary><div class="fdf-graph-body not-prose"><div>svg</div></div></details>`,
      'collapsed: a block that starts closed, titled by the title');
    eq(graph({ title: 'G', collapsed: 'true' }, 'x').startsWith('<details'), true, "MDX's 'true' collapses");
    eq([graph({ title: '' }, 'x'), graph({ collapsed: true }, 'x')].map(textOf), ['x', 'Graph x'], 'no title: no label, or "Graph" on a block');
    // the generator writes the overview's graph without a title, so the types must not ask for one
    eq(graph({}, 'x'), '<figure class="fdf-graph"><div class="fdf-graph-body not-prose">x</div></figure>', 'a graph without a title: a card with no caption');
    ok(/\binterface FortranGraphProps \{[^}]*\n\s*title\?: string;/.test(dts), 'FortranGraphProps: the title is optional');

    // A reader may open a row, a source block or a graph before React hydrates the page; the open attribute the server's
    // markup lacked is not a mismatch for React to warn about
    const hydrating = [
      FortranArg({ name: 'a', decl: 'integer :: a' }), FortranSource({ file: 'a.f90', line: 1, children: 'code' }),
      FortranGraph({ title: 'g', collapsed: true, children: 'd' }),
    ];
    eq(hydrating.map((el) => [el.type, el.props.suppressHydrationWarning]), Array(3).fill(['details', true]), 'rows, source blocks and collapsed graphs do not warn when opened before hydration');
    eq([graph({ title: 'G' }), graph({ title: 'G', collapsed: true }, '\n')], ['', ''], 'no diagram: nothing');
    // Pele draws a node that links as an SVG <a>, which fumadocs' prose would underline and set in its link weight
    ok([graph({ title: 'G' }, 'd'), graph({ title: 'G', collapsed: true }, 'd')].every((out) => out.includes('<div class="fdf-graph-body not-prose">d</div>')),
      'the diagram is not prose, open or collapsed');

    // ---- the table of contents
    const toc = Object.keys(KINDS).map((k, i) => ({ title: `e${i}`, url: `#a${i}`, depth: 3 }));
    const kinds = Object.fromEntries(Object.keys(KINDS).map((k, i) => [`a${i}`, k]));
    const marked = fortranToc(toc, kinds);
    eq(marked.map((item) => render(item.title)), Object.entries(KINDS).map(([k, letter], i) => `<span class="fdf-toc"><span class="fdf-toc-kind fdf-toc-${k}" aria-hidden="true">${letter}</span> <span class="fdf-toc-name">e${i}</span></span>`),
      'fortranToc: a letter for each kind, before the title');
    eq(marked.map(({ url, depth }) => [url, depth]), toc.map(({ url, depth }) => [url, depth]), 'urls and depths unchanged');
    ok(toc.every((item, i) => item.title === `e${i}`) && marked !== toc, 'a new array; the given one is untouched');
    const rest = [{ title: 'Types', url: '#types', depth: 2 }, { title: 'x', url: '#x', depth: 3 }, { title: 'c', url: '#constructor', depth: 3 }];
    const kept = fortranToc(rest, { x: 'block data' });
    ok(kept.every((item, i) => item === rest[i]), 'an item without a kind, or with a kind that has no letter, is returned as it is');
    ok(fortranToc(rest, undefined) === rest && fortranToc(rest, null) === rest, 'no kinds: the toc itself');
    eq(fortranToc([{ title: 'a', url: '/docs/x#caf%C3%A9', depth: 3 }, { title: 'b', url: 'plain', depth: 3 }], { 'café': 'function', plain: 'type' }).map((item) => render(item.title)),
      ['<span class="fdf-toc"><span class="fdf-toc-kind fdf-toc-function" aria-hidden="true">f</span> <span class="fdf-toc-name">a</span></span>', '<span class="fdf-toc"><span class="fdf-toc-kind fdf-toc-type" aria-hidden="true">t</span> <span class="fdf-toc-name">b</span></span>'],
      'anchors after a path, percent-encoded, or without a #');
    eq(render(fortranToc([{ title: h('code', null, 'solve'), url: '#s', depth: 3 }], { s: 'Subroutine' })[0].title), '<span class="fdf-toc"><span class="fdf-toc-kind fdf-toc-subroutine" aria-hidden="true">s</span> <span class="fdf-toc-name"><code>solve</code></span></span>', 'a title that is markup, and a kind in any case');

    // ---- style.css and the markup agree: what is drawn is styled (bar the hooks), what is styled is drawn
    const gallery = render(h('div', null,
      h(FortranBadges, null, ...Object.keys(LABELS).map((kind) => h(FortranBadge, { kind })), h(FortranBadge, { kind: 'mpi', conditional: 'X' }),
        ...['impure', 'non-recursive', 'simple', 'blockdata'].map((kind) => h(FortranBadge, { kind })), h(FortranBadge, { kind: 'parameter', label: 'parameter' }),
        ...['generic interface', 'operator', 'assignment', 'defined I/O', 'abstract interface', 'module interface'].map((label) => h(FortranBadge, { kind: 'interface', label })),
        h(FortranBadge, { kind: 'submodule', label: 'separate module procedure' }), h(FortranBadge, { kind: 'omp', label: 'OpenMP parallel region', title: 'parallel do' }),
        h(FortranBadge, { kind: 'acc', label: 'OpenACC routine' }), h(FortranBadge, { kind: 'cpp', label: 'conditional', conditional: 'Y' }), h(FortranBadge, { conditional: 'Z' }),
        h(FortranBadge, { kind: 'cpp', label: 'conditional' })),
      h(FortranArgs, null,
        ...['in', 'out', 'inout', 'other'].map((i) => h(FortranArg, { name: 'a', type: 'real(dp)', dims: ':', codims: '*', intent: i, optional: true, cond: 'X', decl: 'd', refs: { dp: DP } }, 'doc')),
        h(FortranArg, { name: 'r', type: 'real', result: true }), h(FortranArg, { name: 'p' }), h(FortranArg, { name: 'f', type: 'character(*)', result: true }),
        h(FortranArg, {
          name: 's', type: 'character(len=*)', intent: 'in', decl: 'd',
          attrs: 'allocatable, pointer, target, contiguous, value, save, volatile, asynchronous, protected, external, intrinsic, bind(c), nopass, pass, pass(self), non_overridable, kind, len, default dp, = 0, => null(), device, managed, pinned, rank(2)',
        }),
        h(FortranArg, { name: 't', type: 'character(:)', attrs: 'deferred, private, public, parameter' }),
        h(FortranArg, { name: 'k', type: 'integer, kind', attrs: 'default dp' }), h(FortranArg, { name: 'n', type: 'integer, len' })),
      h(FortranRef, { title: 't' }, 'n'),
      h(FortranSource, { file: 'a.f90', line: 1, href: 'https://example.org' }), h(FortranSource, { file: 'a.f90', line: 1, href: 'https://example.org' }, 'code'),
      h(FortranGraph, { title: 'g' }, 'd'), h(FortranGraph, { title: 'g', collapsed: true }, 'd'),
      ...fortranToc(toc, kinds).map((item) => item.title)));
    const drawn = new Set([...gallery.matchAll(/class="([^"]*)"/g)].flatMap((m) => m[1].split(' ')).filter((c) => c.startsWith('fdf-')));
    // directive lines in code blocks are drawn by transformerFortranDirectives (./shiki), with the line classes it adds
    const { transformerFortranDirectives } = await import('../shiki/index.js');
    for (const source of ['!$omp parallel', '!$acc kernels', '!$cuf kernel do', '!dir$ ivdep']) {
      const addClassToHast = (node, cls) => [cls].flat().forEach((c) => drawn.add(c));
      const code = { children: [{ type: 'element', tagName: 'span', properties: {}, children: [] }] };
      transformerFortranDirectives().code.call({ options: { lang: 'fortran' }, source, addClassToHast }, code);
    }
    const styled = new Set(rules.flatMap(([sels]) => sels.flatMap((s) => [...s.matchAll(/\.(fdf-[\w-]+)/g)].map((m) => m[1]))));
    const hook = (c) => c === 'fdf-arg-conditional' || c === 'fdf-intent-arrow' || (c.startsWith('fdf-kind-') && !HPC.includes(c.slice(9)));
    eq([...drawn].filter((c) => !styled.has(c) && !hook(c)), [], 'every class the components draw is styled, apart from the hooks');
    eq([...styled].filter((c) => !drawn.has(c)), [], 'every class style.css styles is drawn');
    // the terms: every one the components write has a meaning, every meaning is for one they write, and none is in the
    // markup
    const written = termsOf(gallery).map(([, term, a]) => (a !== undefined && meanings.has(`${term}+arg`) ? `${term}+arg` : term));
    eq([...new Set(written)].filter((t) => !meanings.has(t)), [], 'every term the components write for what the generator gives has a meaning in style.css');
    eq([...meanings.keys()].filter((t) => !written.includes(t)), [], 'and every meaning is for a term they write');
    eq([...meanings.values()].map((m) => m.split('{arg}')[0]).filter((m) => m.length > 8 && gallery.includes(m.slice(0, 40))), [],
      'no meaning is written into the markup: a page of thousands of pills holds each once, in style.css');
    eq([...gallery.matchAll(/<\w+ class="([^"]*)"[^>]*? title="/g)].map((m) => m[1]), ['fdf-source-link'],
      "no pill or badge has a native tooltip on top of its card: the one title left is a source link's");
    // no new tab stops: a row is one, its summary; pills, shapes, lengths, type parameters' words and badges are none
    eq([stops(arg({ name: 's', type: 'character(len=*)', dims: ':', intent: 'in', attrs: 'allocatable, pass(self)', cond: 'X', decl: 'd' }, 'doc')),
      stops(render(h(FortranBadges, null, h(FortranBadge, { kind: 'mpi', conditional: 'X', title: 'MPI_Bcast' }), h(FortranBadge, { kind: 'pure' })))),
      stops(arg({ name: 'k', type: 'integer, kind', attrs: 'default dp', decl: 'd' }, 'doc'))], [1, 0, 1],
    "no pill, shape, length, type parameter's word or badge is a tab stop");
  } finally {
    console.error = error;
  }
  eq(warnings, [], 'React printed no warnings');
}
