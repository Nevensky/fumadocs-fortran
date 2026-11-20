// The React components (./react), rendered with react-dom/server, and style.css. React is not a dependency of the
// package: the rendering checks run where react and react-dom can be imported, and are skipped, with one line, where
// they cannot. The source and stylesheet checks run either way.
import fs from 'node:fs';

const read = (rel) => fs.readFileSync(new URL(rel, import.meta.url), 'utf8');
const NAMES = ['FortranBadges', 'FortranBadge', 'FortranArgs', 'FortranArg', 'FortranSource', 'fortranComponents'];
const HPC = ['omp', 'acc', 'offload', 'mpi', 'coarray', 'cuda', 'blas', 'lapack', 'scalapack', 'cpp'];

// Splits at the commas outside brackets: selector lists, and :where(p, ul) within them
const splitTop = (s) => {
  const out = [];
  let depth = 0, cur = '';
  for (const c of s) {
    if (c === '(' || c === '[') depth++;
    else if (c === ')' || c === ']') depth--;
    else if (c === ',' && !depth) { out.push(cur.trim()); cur = ''; continue; }
    cur += c;
  }
  return [...out, cur.trim()].filter(Boolean);
};
// The style rules of a stylesheet, [selectors, declarations], those inside @container and @media included
const rulesOf = (css) => {
  const rules = [];
  const walk = (text) => {
    for (let i = 0, open; (open = text.indexOf('{', i)) >= 0;) {
      let j = open + 1;
      for (let depth = 1; depth; j++) depth += text[j] === '{' ? 1 : text[j] === '}' ? -1 : 0;
      const head = text.slice(i, open).trim();
      if (head.startsWith('@')) walk(text.slice(open + 1, j - 1));
      else rules.push([splitTop(head), text.slice(open + 1, j - 1).split(';').map((d) => d.trim()).filter(Boolean)]);
      i = j;
    }
  };
  walk(css.replace(/\/\*[\s\S]*?\*\//g, ''));
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
  .replace(/<\/?(?:div|p|dl|dt|dd)\b[^>]*>/g, ' ')
  .replace(/<[^>]*>/g, '')
  .replace(/&(amp|lt|gt|quot|#x27|#39);/g, (m, e) => ENT[e])
  .replace(/\s+/g, ' ')
  .trim();
const classesOf = (html) => (/^<\w+ class="([^"]*)"/.exec(html)?.[1] ?? '').split(' ').filter(Boolean);
const titleOf = (html) => /^<\w+[^>]*? title="([^"]*)"/.exec(html)?.[1];

export default async function ({ ok, eq }) {
  // ---------------------------------------------------------------- source rules: one set for server and client
  const src = read('../react/index.js');
  const dts = read('../types/react.d.ts');
  ok(!/^\s*['"]use client['"]/m.test(src), "react/index.js has no 'use client'");
  eq([...src.matchAll(/^import\b[^'"]*['"]([^'"]+)['"]/gm)].map((m) => m[1]), ['react'], 'react/index.js imports react and nothing else');
  ok(!/\buse[A-Z]\w*\s*\(/.test(src), 'react/index.js calls no hooks');
  const exported = [...src.matchAll(/^export (?:function|const) (\w+)/gm)].map((m) => m[1]);
  eq(exported, NAMES, 'react/index.js exports the five components and fortranComponents');
  eq([...dts.matchAll(/^export declare (?:function|const) (\w+)/gm)].map((m) => m[1]), NAMES, 'types/react.d.ts declares the same names');
  for (const [iface, fn] of [['FortranBadgeProps', 'FortranBadge'], ['FortranArgsProps', 'FortranArgs'], ['FortranArgProps', 'FortranArg'], ['FortranSourceProps', 'FortranSource']]) {
    const declared = [...(new RegExp(`interface ${iface} \\{([\\s\\S]*?)\\n\\}`).exec(dts)?.[1] ?? '').matchAll(/^\s*(\w+)\??:/gm)].map((m) => m[1]).sort();
    const destructured = (new RegExp(`function ${fn}\\(\\{([^}]*)\\}`).exec(src)?.[1] ?? '').split(',').map((s) => s.trim().split(/\s*=/)[0]).filter(Boolean).sort();
    eq(declared, destructured, `${iface} has the props ${fn} reads`);
  }

  // ---------------------------------------------------------------- style.css: nothing outside the components
  const css = read('../style.css');
  const rules = rulesOf(css);
  // the token blocks sit in :where(), so that a site's own :root rule wins whatever the stylesheet order
  const ROOT = ':where(:root)', DARK = ':where(.dark)';
  const tokens = (sel, decls) => (sel === ROOT || sel === DARK) && decls.every((d) => d.startsWith('--fdf-'));
  eq(rules.flatMap(([sels, decls]) => sels.filter((s) => !s.startsWith('.fdf-') && !tokens(s, decls))), [],
    'style.css styles only .fdf-* classes, and sets only --fdf-* variables on :where(:root) and :where(.dark)');
  // colours come from fumadocs' variables, which .dark switches, or from the tokens, which it adjusts: a literal
  // colour elsewhere would stay the same in dark mode
  const literal = /#[0-9a-f]{3,8}\b|\b(?:rgba?|hsla?|hwb|lab|lch|oklab|oklch|color)\(|\b(?:white|black)\b/i;
  const value = (d) => withoutFallbacks(d.slice(d.indexOf(':') + 1));
  eq(rules.filter(([sels]) => !sels.every((s) => s === ROOT || s === DARK))
    .flatMap(([sels, decls]) => decls.filter((d) => literal.test(value(d))).map((d) => `${sels.join(', ')} { ${d} }`)), [],
    'outside the tokens, colours are variables (literals only as var() fallbacks)');
  const darkTokens = rules.filter(([sels]) => sels.includes(DARK)).flatMap(([, decls]) => decls.map((d) => d.split(':')[0]));
  ok(['--fdf-text-mix', '--fdf-text-share', '--fdf-fill-share'].every((t) => darkTokens.includes(t)), '.dark adjusts how text and fills are made from the tones');
  eq(HPC.filter((k) => !rules.some(([sels, decls]) => sels.includes(`.fdf-kind-${k}`) && decls.includes(`--fdf-c: var(--fdf-${k})`))), [],
    'each HPC kind takes its colour from its token');

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
  const { FortranBadges, FortranBadge, FortranArgs, FortranArg, FortranSource, fortranComponents } = mod;

  // React's warnings (keys, invalid props) go to console.error: none may appear. A failing check's own line (FAIL,
  // from run.mjs) passes through.
  const warnings = [];
  const error = console.error;
  console.error = (...a) => (a[0] === 'FAIL' ? error(...a) : warnings.push(a.join(' ')));
  try {
    eq(Object.keys(mod).sort(), [...NAMES].sort(), 'the module exports exactly the declared names');
    eq(Object.keys(fortranComponents), NAMES.slice(0, 5), 'fortranComponents has the five components');
    ok(NAMES.slice(0, 5).every((n) => fortranComponents[n] === mod[n]), 'fortranComponents holds the exported functions');

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
    eq(['mpi', 'blas', 'lapack', 'scalapack', 'cpp', 'bindc'].map((kind) => titleOf(badge({ kind }))),
      ['Message Passing Interface', 'Basic Linear Algebra Subprograms', 'Linear Algebra Package',
        'Scalable Linear Algebra Package, for distributed memory', 'C preprocessor', 'Interoperable with C'],
      'abbreviated labels carry their expansion as a title');
    eq(['module', 'omp', 'acc', 'pure'].map((kind) => titleOf(badge({ kind }))), [undefined, undefined, undefined, undefined], 'labels that are not abbreviated have no title');
    eq(titleOf(badge({ kind: 'mpi', title: 'MPI collective: every rank calls it' })), 'MPI collective: every rank calls it', 'title replaces the default');

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
    ok(quoted.includes('>&lt;b&gt;&quot;q&quot; &amp; {y}&lt;/b&gt;</span>') && titleOf(quoted) === '&quot;t&quot; &lt;&amp;&gt;', 'quotes, angle brackets, ampersands and braces in a label and a title are text');
    eq([badge({}), badge({ kind: ' ', label: '' })], ['', ''], 'no kind, label or condition: no pill at all');
    eq(textOf(badge({ conditional: 'HAVE_X' })), 'when HAVE_X', 'a condition alone still shows');

    const row = render(h(FortranBadges, null,
      h(FortranBadge, { kind: 'module' }), ' ', h(FortranBadge, { kind: 'omp' }), null,
      h(FortranBadge, { kind: 'mpi', conditional: 'USE_MPI' })));
    ok(row.startsWith('<div class="fdf-badges not-prose"><span class="fdf-badge'), 'FortranBadges: a div of badges');
    eq(textOf(row), 'module OpenMP MPI when USE_MPI', 'badges are read apart: one space between each');
    eq(render(h(FortranBadges, null)), '<div class="fdf-badges not-prose"></div>', 'an empty row');

    // ---- argument lists
    const list = render(h(FortranArgs, null, h(FortranArg, { name: 'x' })));
    ok(list.startsWith('<div class="fdf-args"><p class="fdf-args-title not-prose">Arguments</p><dl class="fdf-args-list"><div class="fdf-arg">'), 'FortranArgs: the title, then a definition list');
    ok(render(h(FortranArgs, { title: 'Components' })).includes('>Components</p>'), 'a title of its own');
    ok(!render(h(FortranArgs, { title: '' })).includes('fdf-args-title'), 'an empty title is left out');

    const arg = (props, ...children) => render(h(FortranArg, props, ...children));
    const x = arg({ name: 'x', type: 'real(dp)', dims: '(:)', intent: 'in' }, h('p', null, 'local slice of the vector'));
    ok(x.startsWith('<div class="fdf-arg"><dt class="fdf-arg-head not-prose"><code class="fdf-arg-name">x</code>'), 'the name, in code');
    ok(x.includes('<code class="fdf-arg-type">real(dp)<span class="fdf-arg-dims">(:)</span></code>'), 'the type with its dimensions');
    ok(x.includes('<dd class="fdf-arg-doc"><p>local slice of the vector</p></dd>'), 'the doc below, in a dd');
    eq(textOf(x), 'x real(dp)(:) → in local slice of the vector', 'the row reads name, type, intent, doc');

    const intent = (i) => {
      const out = arg({ name: 'a', intent: i });
      const m = /<span class="(fdf-intent[^"]*)" title="([^"]*)"><span class="fdf-intent-arrow" aria-hidden="true">([^<]*)<\/span> (\w+)<\/span>/.exec(out);
      return m ? [m[1], m[2], m[3], m[4]] : out;
    };
    eq(intent('in'), ['fdf-intent fdf-intent-in', 'intent(in): read, not changed', '→', 'in'], 'intent(in): text, arrow and title');
    eq(intent('out'), ['fdf-intent fdf-intent-out', 'intent(out): undefined on entry, set by the procedure', '←', 'out'], 'intent(out)');
    eq(intent('inout'), ['fdf-intent fdf-intent-inout', 'intent(inout): read, and may be changed', '↔\uFE0E', 'inout'], 'intent(inout)');
    eq(intent('In Out'), intent('inout'), "'In Out' is inout");
    const arrows = ['in', 'out', 'inout'].map((i) => intent(i)[2]);
    ok(new Set(arrows).size === 3, 'the three intents have different arrows, not only different colours');
    ok(arg({ name: 'a', intent: 'none' }).includes('<span class="fdf-intent" title="intent(none)">none</span>'), 'another intent is shown as written, without an arrow');
    ok(!arg({ name: 'a' }).includes('fdf-intent'), 'no intent, no marker');

    const info = arg({ name: 'info', type: 'integer', intent: 'out', optional: true, value: true, attrs: 'target, bind(c, name="f"), Optional' });
    eq([...info.matchAll(/<span class="fdf-flag">([^<]*)<\/span>/g)].map((m) => m[1]), ['optional', 'value', 'target', 'bind(c, name=&quot;f&quot;)'],
      'flags: optional, value, then attrs split at top-level commas, without repeats');
    eq(textOf(arg({ name: 'n', optional: 'true', value: 'false' })), 'n optional', "MDX's 'true' and 'false' strings read as booleans");

    const comm = arg({ name: 'comm', type: 'type(MPI_Comm)', intent: 'in', cond: 'USE_MPI' }, h('p', null, 'communicator'));
    ok(comm.startsWith('<div class="fdf-arg fdf-arg-conditional">'), 'a conditional row is marked');
    ok(comm.includes('<span class="fdf-cond">when <code>USE_MPI</code></span>'), 'the condition: "when", then the condition in code');
    eq(textOf(comm), 'comm type(MPI_Comm) → in when USE_MPI communicator', 'condition after intent');

    const total = arg({ name: 'total', type: 'real(dp)', codims: '*', intent: 'out' });
    ok(total.includes('<code class="fdf-arg-type">real(dp)<span class="fdf-arg-codims">[*]</span></code>'), 'codimensions, with brackets added');
    ok(arg({ name: 'a', type: 'real', dims: ':,:' }).includes('<span class="fdf-arg-dims">(:,:)</span>'), 'dimensions get their parentheses');
    ok(arg({ name: 'p' }).endsWith('<dd class="fdf-arg-doc"></dd></div>'), 'without a doc the dd is empty (a dl needs one per group)');
    ok(!arg({ name: 'p' }).includes('fdf-arg-type'), 'without a type, no type');
    eq(arg({ name: 'p', type: '', dims: ' ', intent: '', attrs: '', cond: '', optional: false }),
      '<div class="fdf-arg"><dt class="fdf-arg-head not-prose"><code class="fdf-arg-name">p</code></dt><dd class="fdf-arg-doc"></dd></div>',
      'a name alone: no empty signature, and nothing for empty props');
    ok(arg({ name: 'w' }, ' \n').endsWith('<dd class="fdf-arg-doc"></dd></div>'), 'a doc of whitespace alone leaves the dd empty, so it is hidden');
    ok(arg({ name: 'w' }, h('em', null, 'a'), ' ', h('em', null, 'b')).includes('<dd class="fdf-arg-doc"><em>a</em> <em>b</em></dd>'), 'a space between words of the doc is kept');
    ok(arg({ name: '<n>', type: 'character(len=*), "q"', attrs: "'&'", cond: 'A<B' }).includes('<code class="fdf-arg-name">&lt;n&gt;</code> <span class="fdf-arg-sig"><code class="fdf-arg-type">character(len=*), &quot;q&quot;</code> <span class="fdf-flag">&#x27;&amp;&#x27;</span> <span class="fdf-cond">when <code>A&lt;B</code></span></span>'),
      'a name, type, flag and condition with markup characters are text');

    const all = render(h(FortranArgs, { title: 'Result' },
      h(FortranArg, { name: 'nrm', type: 'real(dp)' }, h('p', null, 'the global 2-norm'))));
    eq(textOf(all), 'Result nrm real(dp) the global 2-norm', 'a whole list reads in order');

    // MDX hands over its children as one static array (jsxs), with no keys: no warnings, and nothing in between
    const { jsx, jsxs } = await import('react/jsx-runtime');
    const mdx = render(jsxs(FortranArgs, { children: [jsx(FortranArg, { name: 'a', children: jsx('p', { children: 'one' }) }), jsx(FortranArg, { name: 'b' })] }))
      + render(jsxs(FortranBadges, { children: [jsx(FortranBadge, { kind: 'omp' }), jsx(FortranBadge, { kind: 'acc' })] }));
    ok(mdx.includes('</dd></div><div class="fdf-arg"><dt') && textOf(mdx) === 'Arguments a one b OpenMP OpenACC', 'MDX-style children render in order');

    // ---- source line
    const where = (props) => render(h(FortranSource, props));
    const full = where({ file: 'examples/modern/src/modern_ford.F90', line: 3, lineEnd: 227, href: 'https://github.com/o/r/blob/main/x.F90#L3-L227' });
    eq(full, '<p class="fdf-source not-prose">Defined in <a class="fdf-source-link" href="https://github.com/o/r/blob/main/x.F90#L3-L227" title="examples/modern/src/modern_ford.F90, lines 3 to 227"><code>examples/<wbr/>modern/<wbr/>src/<wbr/>modern_ford.F90:3–227</code></a></p>',
      'FortranSource: "Defined in file:line–lineEnd", linked, with the lines spelt out in the title and breaks after slashes');
    eq(textOf(where({ file: 'a.f90', line: 5 })), 'Defined in a.f90:5', 'one line');
    eq(textOf(where({ file: 'a.f90', line: 5, lineEnd: 5 })), 'Defined in a.f90:5', 'a range of one line is one line');
    eq(textOf(where({ file: 'a.f90', line: '7', lineEnd: '9' })), 'Defined in a.f90:7–9', 'numbers written as strings');
    ok(!where({ file: 'a.f90', line: 5 }).includes('<a '), 'no href, no link');
    ok(where({ file: 'a.f90', line: 5 }).includes('<span title="a.f90, line 5"><code>a.f90:5</code></span>'), 'unlinked, still with its title');
    eq(where({ file: 'a.f90' }), '<p class="fdf-source not-prose">Defined in <code>a.f90</code></p>', 'no line: the file alone, with no empty wrapper');
    eq([where({}), where({ file: ' ', line: 4 })], ['', ''], 'neither a file nor a link: nothing, not a bare "Defined in"');
    eq(titleOf(where({ href: 'https://example.org/a.f90#L4-L8', line: 4, lineEnd: 8 }).replace(/^<p[^>]*>Defined in /, '')), 'lines 4 to 8', 'a link without a file: the title gives the lines alone');
    ok(where({ file: 'a"b<c>&.f90', line: 1, href: 'https://e.org/?a=1&b="2"' }).includes('href="https://e.org/?a=1&amp;b=&quot;2&quot;" title="a&quot;b&lt;c&gt;&amp;.f90, line 1"><code>a&quot;b&lt;c&gt;&amp;.f90:1</code>'), 'the file and the link are escaped');

    // ---- style.css and the markup agree: what is drawn is styled (bar the hooks), what is styled is drawn
    const gallery = render(h('div', null,
      h(FortranBadges, null, ...Object.keys(LABELS).map((kind) => h(FortranBadge, { kind })), h(FortranBadge, { kind: 'mpi', conditional: 'X' })),
      h(FortranArgs, null, ...['in', 'out', 'inout', 'other'].map((i) => h(FortranArg, { name: 'a', type: 'real', dims: ':', codims: '*', intent: i, optional: true, cond: 'X' }, 'doc'))),
      h(FortranSource, { file: 'a.f90', line: 1, href: 'https://example.org' })));
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
  } finally {
    console.error = error;
  }
  eq(warnings, [], 'React printed no warnings');
}
