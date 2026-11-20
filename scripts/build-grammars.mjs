// Builds the Shiki grammar pack in shiki/ from the Fortran grammars of tm-grammars (MIT; they come from
// fortran-lang/vscode-fortran-support) and our two injection grammars.
//
//   node scripts/build-grammars.mjs           writes shiki/*.json, shiki/grammars.js and shiki/NOTICE
//   node scripts/build-grammars.mjs --check   fails when those files differ from what it would write
//
// tm-grammars is a development tool, pinned below and in CI, and never saved in package.json. To move to a newer one:
// change PIN and the version CI installs (.github/workflows/ci.yml), run this script, read the upstream diff and the
// scope snapshots (test/shiki). Every patch checks the upstream rule it edits, so a changed rule stops the build
// instead of being patched wrongly. The directive word lists are in shiki/directive-words.json.
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

const PIN = {
  'tm-grammars': '1.32.22',
  // the upstream commits tm-grammars took the grammars from
  'fortran-free-form': 'f5fbf935d709e165922b307885a6106e32624018',
  'fortran-fixed-form': '002eaa90668fd7d63cd073e8ca21b1388357ed62',
};

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const OUT = path.join(ROOT, 'shiki');

const FREE = 'source.fortran.free.fd';
const FIXED = 'source.fortran.fixed.fd';
const DIRECTIVES = 'source.fortran.directives.fd';
const FYPP = 'source.fortran.fypp.fd';

const fail = (message) => {
  throw new Error(`build-grammars: ${message}`);
};
const expect = (condition, message) => {
  if (!condition) fail(`the upstream grammar has changed (${message}); review the patch against the new rule`);
};

// ---------------------------------------------------------------- helpers

/** A repository rule, which must exist. */
function rule(grammar, key) {
  expect(grammar.repository[key], `#${key} is missing`);
  return grammar.repository[key];
}

/** Replace `from` by `to` in rule[field], which must contain it. */
function edit(object, field, from, to) {
  expect(typeof object[field] === 'string' && object[field].includes(from), `${field} no longer contains ${from}`);
  object[field] = object[field].replace(from, to);
}

/** Visit every object and array in a JSON value, parents before children. */
function walk(node, visit) {
  if (node === null || typeof node !== 'object') return;
  visit(node);
  for (const value of Object.values(node)) walk(value, visit);
}

/** Insert patterns before the include `before` in a pattern list. */
function insertBefore(patterns, before, ...added) {
  const at = patterns.findIndex((p) => p.include === before);
  expect(at >= 0, `${before} is not in the pattern list`);
  patterns.splice(at, 0, ...added);
}

const escape = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const byLength = (a, b) => b.length - a.length || a.localeCompare(b);
/** A regex alternation of words, longest first. */
const alternation = (words) => [...new Set(words)].sort(byLength).map(escape).join('|');
/** A directive name: a blank or an underscore between its words matches either. */
const directiveName = (name) => name.split(/[ _]/).map(escape).join('(?:[ \\t]+|_)');

// ---------------------------------------------------------------- upstream

function readUpstream() {
  const require = createRequire(import.meta.url);
  let freePath;
  try {
    freePath = require.resolve('tm-grammars/grammars/fortran-free-form.json');
  } catch {
    fail(`tm-grammars is not installed: npm install --no-save --no-package-lock tm-grammars@${PIN['tm-grammars']}`);
  }
  const dir = path.resolve(path.dirname(freePath), '..');
  const pkg = JSON.parse(fs.readFileSync(path.join(dir, 'package.json'), 'utf8'));
  if (pkg.version !== PIN['tm-grammars']) {
    fail(`tm-grammars ${pkg.version} is installed, but ${PIN['tm-grammars']} is pinned; install the pinned one, or move the pin`);
  }
  const index = fs.readFileSync(path.join(dir, 'index.js'), 'utf8');
  for (const name of ['fortran-free-form', 'fortran-fixed-form']) {
    // the metadata entry of each grammar names the upstream commit it was taken from
    const entry = index.slice(index.indexOf(`name: '${name}'`)).split('}')[0];
    expect(entry.includes(`sha: '${PIN[name]}'`), `${name} no longer comes from upstream commit ${PIN[name]}`);
  }
  const read = (name) => JSON.parse(fs.readFileSync(path.join(dir, 'grammars', `${name}.json`), 'utf8'));
  const notice = fs.readFileSync(path.join(dir, 'NOTICE'), 'utf8');
  const license = fs.readFileSync(path.join(dir, 'LICENSE'), 'utf8');
  return { free: read('fortran-free-form'), fixed: read('fortran-fixed-form'), notice, license };
}

// ---------------------------------------------------------------- the free-form grammar

function buildFree(upstream) {
  const g = structuredClone(upstream);
  expect(g.scopeName === 'source.fortran.free' && g.name === 'fortran-free-form', 'free-form name');

  // A unique name and scope: Shiki ignores a grammar whose name is already loaded, so the bundled grammar's names
  // become our aliases, which take precedence over names in Shiki's lookup, in whichever order they load.
  const out = {
    name: 'fortran',
    displayName: 'Fortran',
    scopeName: FREE,
    aliases: ['fortran-free-form', 'f90', 'f95', 'f03', 'f08', 'f18', 'f23', 'fpp', 'fypp'],
    fileTypes: [...g.fileTypes, 'f23', 'F23', 'fypp'],
    firstLineMatch: g.firstLineMatch,
    // Shiki recompiles this grammar when one of these is loaded after it
    embeddedLangsLazy: ['fortran-directives', 'fortran-fypp'],
    injections: {},
    patterns: g.patterns,
    repository: g.repository,
  };

  // The grammar's own injection (continuation & and cpp lines) also carries the directive and fypp grammars. A grammar
  // registered as an injection of its own (injectTo) costs another pass of the regex scanner at every token: +12% to
  // +50% each, measured on both engines. Included here, they cost a few regexes in a pass made anyway (+2% to +20%).
  // L: lets a directive in column 1 win over the comment that starts there. Directive lines (meta.directive) are
  // kept out, or the continuation rule would take a directive's final & and swallow the next line.
  const injections = Object.entries(g.injections);
  expect(injections.length === 3 && injections[0][0] === 'source.fortran.free - ( string | comment | meta.preprocessor )', 'injections');
  out.injections[`L:${FREE} - ( string | comment | meta.preprocessor | meta.directive )`] = {
    patterns: [{ include: DIRECTIVES }, { include: FYPP }, ...injections[0][1].patterns],
  };
  for (const [selector, value] of injections.slice(1)) out.injections[selector] = value;
  // fypp's ${…}$ also works in strings and comments
  out.injections[`L:${FREE} string - meta.embedded.inline.fypp, L:${FREE} comment - meta.embedded.inline.fypp`] = {
    patterns: [{ include: `${FYPP}#inline` }],
  };

  noInvalid(out);
  docComments(out);
  strings(out);
  fortran2023(out);

  // Two upstream slips. The cpp statement list includes a rule under a misspelt name, so #pragma lines were never
  // parsed. The arithmetic operators leave / uncaptured, so their scopes are off by one (** as division).
  const statements = rule(out, 'preprocessor-statements').patterns;
  const pragma = statements.find((p) => p.include === '#preprocessor-preprocessor-pragma-statement');
  expect(pragma && out.repository['preprocessor-pragma-statement'], '#preprocessor-pragma-statement');
  pragma.include = '#preprocessor-pragma-statement';
  const arithmetic = rule(out, 'arithmetic-operators');
  expect(arithmetic.captures[3]?.name === 'keyword.operator.division.fortran', '#arithmetic-operators');
  edit(arithmetic, 'match', '|/(?![/=\\\\])|', '|(/)(?![/=\\\\])|');

  return out;
}

/** No invalid.* scopes: code the grammar does not know stays plain instead of turning red. */
function noInvalid(g) {
  for (const key of ['invalid-word', 'invalid-character']) {
    rule(g, key);
    delete g.repository[key];
  }
  walk(g, (node) => {
    if (Array.isArray(node)) {
      for (let i = node.length - 1; i >= 0; i--) {
        const p = node[i];
        if (p && (p.include === '#invalid-word' || p.include === '#invalid-character')) node.splice(i, 1);
        // text after a continuation & on the same line, and after a string's continuation &
        else if (p && /^invalid\.error\.(line-cont|string-line-cont)\./.test(p.name ?? '')) node.splice(i, 1);
      }
    }
  });

  // A program unit's end: the name may differ from the one it opened with, and text after it is tokenised as usual
  // (fypp's ${…}$ in a name, for one) instead of being swallowed as an error.
  const trailing = '\\s*([^\\n!;]+)?(?=[\\n!;])';
  for (const [key, at] of [
    ['function-definition', [1, 0]],
    ['module-definition', [1]],
    ['procedure-definition', [0, 0]],
    ['program-definition', [1]],
    ['submodule-definition', [1]],
    ['subroutine-definition', [1, 0]],
  ]) {
    let r = rule(g, key);
    for (const i of at) r = r.patterns[i];
    edit(r, 'end', trailing, '');
    expect(r.endCaptures[4]?.name.startsWith('invalid.'), `${key} end`);
    delete r.endCaptures[4];
  }
  const blockData = rule(g, 'block-data-definition');
  edit(blockData, 'end', '(?:\\s*(\\S((?!\\n).)*))?', '');
  delete blockData.endCaptures[4];

  // an end name that differs from the opening one is still a name; anything else loses its scope
  const rename = {
    'invalid.error.derived-type.fortran': 'entity.name.type.fortran',
    'invalid.error.named-control-constructs.fortran.modern': 'meta.label.end.name.fortran',
  };
  walk(g, (node) => {
    if (typeof node.name !== 'string' || !node.name.startsWith('invalid.')) return;
    if (rename[node.name]) node.name = rename[node.name];
    else delete node.name;
  });
  expect(!JSON.stringify(g).includes('invalid'), 'an invalid scope is left');
}

/** Doc comments (!! and !< after an item, !> before it) get their own scope; !!$ is commented-out code, !!! a banner. */
function docComments(g) {
  const comments = rule(g, 'comments');
  expect(comments.begin === '!' && comments.name === 'comment.line.fortran', '#comments');
  g.repository.comments = {
    patterns: [
      {
        begin: '!(?:!(?![!$])|[<>])',
        beginCaptures: { 0: { name: 'punctuation.definition.comment.documentation.fortran' } },
        end: '(?=\\n)',
        name: 'comment.line.documentation.fortran',
      },
      comments,
    ],
  };
}

/**
 * A string ends at its line's end unless the line is continued with &, so a missing quote cannot colour the rest. (A
 * fixed-form string cut at column 72 and continued in column 6 of the next line now ends with its first line too.)
 */
function strings(g) {
  const patterns = rule(g, 'string-constant').patterns;
  expect(patterns.length === 2 && patterns[0].end === "'" && patterns[1].end === '"', '#string-constant');
  patterns[0].end = "'|(?=\\n)";
  patterns[1].end = '"|(?=\\n)';
}

/** Fortran 2018 and 2023 constructs the upstream grammar lacks. */
function fortran2023(g) {
  const R = g.repository;

  // enumeration type :: colour … end enumeration type. Upstream reads it as a derived type that never ends.
  const enumerator = rule(g, 'enum-block-construct').patterns[1].patterns[1];
  expect(enumerator.begin === '(?i)\\b(enumerator)\\b', '#enum-block-construct enumerator');
  R['enumeration-type-construct'] = {
    begin: '(?i)\\b(enumeration)\\s+(type)\\b',
    beginCaptures: { 1: { name: 'keyword.control.enumeration.fortran' }, 2: { name: 'keyword.control.type.fortran' } },
    end: '(?i)\\b(end\\s*enumeration\\s*type)\\b(?:\\s+([a-z]\\w*))?',
    endCaptures: { 1: { name: 'keyword.control.end-enumeration-type.fortran' }, 2: { name: 'entity.name.type.fortran' } },
    name: 'meta.enumeration-type.fortran',
    patterns: [
      {
        begin: '\\G',
        end: '(?=[\\n!;])',
        patterns: [
          { match: ',', name: 'punctuation.comma.fortran' },
          { include: '#access-attribute' },
          { match: '::', name: 'keyword.operator.double-colon.fortran' },
          { match: '(?i)\\b[a-z]\\w*\\b', name: 'entity.name.type.fortran' },
        ],
      },
      { include: '#comments' },
      structuredClone(enumerator),
      // anything else, so that an enumeration type that is never closed leaves the rest highlighted
      { include: '$base' },
    ],
  };
  insertBefore(g.patterns, '#derived-type-definition', { include: '#enumeration-type-construct' });

  // typeof(x) and classof(x) type specifiers
  R['typeof-type'] = {
    begin: '(?i)\\b(typeof|classof)\\s*(\\()',
    beginCaptures: { 1: { name: 'storage.type.typeof.fortran' }, 2: { name: 'punctuation.parentheses.left.fortran' } },
    end: '(\\))|(?=[\\n!;])',
    endCaptures: { 1: { name: 'punctuation.parentheses.right.fortran' } },
    name: 'meta.specification.type.typeof.fortran',
    patterns: [{ include: '#parentheses' }, { include: '#parentheses-common' }],
  };
  R.types.patterns.unshift({ include: '#typeof-type' });
  for (const key of ['type-specification-statements', 'derived-type-component-type-specification']) {
    edit(R[key], 'begin', '(?:character|class|complex|', '(?:character|class|classof|complex|');
    edit(R[key], 'begin', '|real|type', '|real|type|typeof');
  }

  // simple, a procedure prefix like pure
  const pure = rule(g, 'pure-attribute');
  expect(pure.match === '(?i)\\s*\\b(?:(impure)|(pure))\\b', '#pure-attribute');
  pure.match = '(?i)\\s*\\b(?:(impure)|(pure)|(simple))\\b';
  pure.captures[3] = { name: 'storage.modifier.simple.fortran' };

  // conditional expressions: ( a > 0 ? a : b ), chained with further ? and :
  R['conditional-expression'] = {
    begin: '\\?',
    beginCaptures: { 0: { name: 'keyword.operator.ternary.fortran' } },
    end: '(?=[)\\n!;])',
    patterns: [
      { match: '\\?|(?<!:):(?!:)', name: 'keyword.operator.ternary.fortran' },
      { include: '#array-constructor' },
      { include: '#parentheses' },
      { include: '#parentheses-common' },
    ],
  };
  for (const key of ['parentheses', 'parentheses-dummy-variables']) {
    insertBefore(R[key].patterns, '#parentheses-common', { include: '#conditional-expression' });
  }

  // do concurrent locality: local, local_init, shared, default(none), reduce(op: list)
  const concurrent = rule(g, 'concurrent-attribute');
  expect(concurrent.patterns.length === 1 && concurrent.patterns[0].include === '#parentheses', '#concurrent-attribute');
  concurrent.patterns.unshift({
    match: '(?i)\\b(local_init|local|shared|default|reduce)\\b(?=\\s*\\()',
    name: 'storage.modifier.locality.fortran',
  });

  // change team … end team, notify wait; stop and error stop with quiet=
  R['image-control-statement'].patterns.push(
    { match: '(?i)\\b(change\\s+team)\\b(?=\\s*\\()', name: 'keyword.control.change-team.fortran' },
    { match: '(?i)\\b(end\\s+team)\\b', name: 'keyword.control.end-team.fortran' },
    { match: '(?i)\\b(notify\\s+wait)\\b(?=\\s*\\()', name: 'keyword.control.notify-wait.fortran' },
  );
  for (const key of ['stop-statement', 'error-stop-statement']) {
    R[key].patterns.unshift({
      match: '(?i)\\b(quiet)\\s*(=)',
      captures: { 1: { name: 'variable.parameter.dummy-variable.fortran.modern' }, 2: { name: 'keyword.operator.assignment.fortran' } },
    });
  }
}

// ---------------------------------------------------------------- the fixed-form grammar

function buildFixed(upstream) {
  const g = structuredClone(upstream);
  expect(g.scopeName === 'source.fortran.fixed' && g.name === 'fortran-fixed-form', 'fixed-form name');
  // it includes the free-form grammar: point every include at ours
  const text = JSON.stringify(g).replace(/"source\.fortran\.free(#|")/g, `"${FREE}$1`);
  const patched = JSON.parse(text);

  const out = {
    name: 'fortran-fixed',
    displayName: 'Fortran (fixed form)',
    scopeName: FIXED,
    aliases: ['fortran-fixed-form', 'f', 'for', 'f77', 'ftn'],
    embeddedLangs: ['fortran'],
    embeddedLangsLazy: ['fortran-directives'],
    fileTypes: [...g.fileTypes, 'ftn', 'FTN'],
    injections: {},
    patterns: patched.patterns,
    repository: patched.repository,
  };

  // The column limit. Upstream puts the rule in an injection with ordinary priority, so any pattern that starts at
  // the same column wins and the rule never fires; L: gives it priority. It is kept out of the line-header
  // injection, which must keep losing to comment lines. Strings are cut at the limit too, as compilers do. The
  // same injection carries the directive grammar, as in free form (c$omp in column 1 must win over the comment).
  const [[selector, value], ...rest] = Object.entries(g.injections);
  expect(rest.length === 0 && selector === 'source.fortran.fixed - ( string | comment )', 'fixed-form injections');
  expect(value.patterns.length === 2 && value.patterns[1].include === '#line-end-comment', 'fixed-form injection patterns');
  out.injections[`${FIXED} - ( string | comment )`] = { patterns: [{ include: '#line-header' }] };
  out.injections[`L:${FIXED} - comment - meta.preprocessor`] = { patterns: [{ include: '#line-end-comment' }, { include: `${DIRECTIVES}#lines` }] };
  // shiki/index.js rewrites the 72 for other limits, or drops the include for none
  expect(out.repository['line-end-comment'].begin === '(?<=^.{72})(?!\\n)', '#line-end-comment');

  // the label field: no invalid scope for what is not a label, and no scope named after a grammar for a tab
  const header = out.repository['line-header'];
  expect(header.captures[4]?.name === 'invalid.error.fortran' && header.captures[3]?.name === 'source.fortran.free.fd', '#line-header');
  delete header.captures[4];
  delete header.captures[3];

  // comment lines: doc comments (*> and C> before an item, !! !< !> as in free form), and D debug lines, which
  // compilers treat as comments by default
  const comments = out.repository.comments.patterns;
  expect(comments.length === 2 && comments[0].begin === '^[*Cc]' && comments[1].begin === '^ *!', 'fixed-form #comments');
  const doc = { end: '\\n', name: 'comment.line.documentation.fortran' };
  const mark = { 0: { name: 'punctuation.definition.comment.documentation.fortran' } };
  out.repository.comments.patterns = [
    { begin: '^[*Cc]>', beginCaptures: mark, ...doc },
    { begin: '^ *!(?:!(?![!$])|[<>])', beginCaptures: mark, ...doc },
    comments[0],
    comments[1],
    { begin: '^[Dd]', end: '\\n', name: 'comment.line.debug.fortran' },
  ];

  expect(!JSON.stringify(out).includes('invalid'), 'an invalid scope is left in the fixed-form grammar');
  return out;
}

// ---------------------------------------------------------------- directives

const SCOPE = {
  sentinel: (family) => `keyword.control.directive.${family}.fortran`,
  name: (family) => `keyword.other.directive.${family}.fortran`,
  clause: (family) => `entity.other.attribute-name.clause.${family}.fortran`,
  modifier: (family) => `keyword.other.modifier.${family}.fortran`,
  line: (family) => `meta.directive.${family}.fortran`,
};

// Each line of a directive is a region that ends with the line, so a directive left open (a missing parenthesis, a
// continuation &) cannot colour what follows. The sentinel may follow blanks (free form) or sit in column 1 as
// c$omp, *$omp (fixed form); one grammar serves both forms.
const sentinel = (body) => `(?i)^(?:([c*!]${body})|[ \\t]*(!${body}))(?![\\w$])`;

function buildDirectives(words) {
  const repository = {};

  // shared pieces of a directive line
  const continuation = { name: 'keyword.operator.line-continuation.fortran' };
  const parens = (patterns) => ({
    begin: '\\(',
    beginCaptures: { 0: { name: 'punctuation.parentheses.left.fortran' } },
    end: '(\\))|(?=\\n)',
    endCaptures: { 1: { name: 'punctuation.parentheses.right.fortran' } },
    patterns,
  });
  // The directive name follows the sentinel (and a continuation &, if any), possibly with arguments of its own:
  // critical(name), routine(name), wait(1). \G anchors at the end of the sentinel only, since vscode-textmate moves
  // the anchor at the begin of a region and not after a plain match, so the name and its arguments are matched
  // together at the anchor.
  const named = (family, name, args) => [
    {
      begin: `(?i)\\G[ \\t]*(?:(&)[ \\t]*)?(${name})[ \\t]*(\\()`,
      beginCaptures: { 1: continuation, 2: { name: SCOPE.name(family) }, 3: { name: 'punctuation.parentheses.left.fortran' } },
      end: '(\\))|(?=\\n)',
      endCaptures: { 1: { name: 'punctuation.parentheses.right.fortran' } },
      patterns: [{ include: args }],
    },
    { match: `(?i)\\G[ \\t]*(?:(&)[ \\t]*)?(${name})(?![\\w$])`, captures: { 1: continuation, 2: { name: SCOPE.name(family) } } },
    { match: '\\G[ \\t]*(&)', captures: { 1: continuation } },
  ];
  repository['line-end'] = {
    patterns: [
      { match: '(&)[ \\t]*(?=!|\\n)', captures: { 1: { name: 'keyword.operator.line-continuation.fortran' } } },
      {
        begin: '!',
        beginCaptures: { 0: { name: 'punctuation.definition.comment.fortran' } },
        end: '(?=\\n)',
        name: 'comment.line.fortran',
      },
    ],
  };
  repository['values'] = {
    patterns: [
      { match: "'(?:[^'\\n]|'')*'?", name: 'string.quoted.single.fortran' },
      { match: '"(?:[^"\\n]|"")*"?', name: 'string.quoted.double.fortran' },
      { match: '(?i)\\.(?:true|false)\\.(?:_\\w+)?', name: 'constant.language.logical.fortran' },
      { match: '(?i)(?<![\\w.])(?:\\d+\\.?\\d*|\\.\\d+)(?:[de][-+]?\\d+)?(?:_\\w+)?', name: 'constant.numeric.fortran' },
      { match: '(?i)\\.(?:and|or|not|eqv|neqv|eq|ne|lt|le|gt|ge)\\.', name: 'keyword.operator.logical.fortran' },
      { match: '==|/=|<=|>=|<|>', name: 'keyword.operator.comparison.fortran' },
      { match: '\\*\\*|[-+*/]', name: 'keyword.operator.arithmetic.fortran' },
      { match: '=', name: 'keyword.operator.assignment.fortran' },
      { match: '%', name: 'keyword.operator.derived-type.fortran' },
    ],
  };

  const family = (key, w, extra = {}) => {
    const multi = w.directives.filter((d) => /[ _]/.test(d)).sort(byLength).map(directiveName);
    const single = w.directives.filter((d) => !/[ _]/.test(d));
    const combined = alternation(w.combined);
    // a directive name, matched longest first: names of several words (target_enter_data, begin declare_variant),
    // then combined constructs (target teams distribute parallel do simd), then the rest; end may come first
    const name = `(?:end[ \\t]+)?(?:${multi.join('|')}|(?:${combined})(?:[ \\t]+(?:${combined}))*|${alternation(single)})`;
    const clauses = `${alternation(w.clauses)}${extra.clausePrefix ? `|${extra.clausePrefix}\\w*` : ''}`;
    const args = `#${key}-arguments`;
    repository[`${key}-arguments`] = {
      patterns: [
        parens([{ include: args }]),
        // map(tofrom: a), schedule(dynamic, 4), default(none), linear(ref(x): 1)
        { match: `(?i)\\b(?:${alternation(w.modifiers)})\\b(?=[ \\t]*[:,()])`, name: SCOPE.modifier(key) },
        { include: `${FYPP}#inline` },
        { include: '#values' },
        { include: '#line-end' },
      ],
    };
    repository[key] = {
      begin: sentinel(extra.sentinel),
      beginCaptures: { 1: { name: SCOPE.sentinel(key) }, 2: { name: SCOPE.sentinel(key) } },
      end: '(?=\\n)',
      name: SCOPE.line(key),
      patterns: [
        { include: `${FYPP}#inline` },
        ...named(key, name, args),
        {
          begin: `(?i)\\b(${clauses})[ \\t]*(\\()`,
          beginCaptures: { 1: { name: SCOPE.clause(key) }, 2: { name: 'punctuation.parentheses.left.fortran' } },
          end: '(\\))|(?=\\n)',
          endCaptures: { 1: { name: 'punctuation.parentheses.right.fortran' } },
          patterns: [{ include: args }],
        },
        { match: `(?i)\\b(?:${clauses})\\b`, name: SCOPE.clause(key) },
        { include: '#values' },
        { include: '#line-end' },
      ],
    };
  };
  family('openmp', words.openmp, { sentinel: '\\$ompx?', clausePrefix: 'ompx_' });
  family('openacc', words.openacc, { sentinel: '\\$acc' });

  // arguments without modifiers, for the vendor directives below
  repository.arguments = { patterns: [parens([{ include: '#arguments' }]), { include: '#values' }, { include: '#line-end' }] };

  // CUDA Fortran: !$cuf kernel do(2) <<<*,*>>>
  repository.cuf = {
    begin: sentinel('\\$cuf'),
    beginCaptures: { 1: { name: SCOPE.sentinel('cuf') }, 2: { name: SCOPE.sentinel('cuf') } },
    end: '(?=\\n)',
    name: SCOPE.line('cuf'),
    patterns: [
      ...named('cuf', [...words.cuf.directives].sort(byLength).map(directiveName).join('|'), '#arguments'),
      { match: '<<<|>>>', name: 'punctuation.section.launch.fortran' },
      { include: '#arguments' },
    ],
  };

  // compiler directives: !dir$ ivdep, !DEC$ ATTRIBUTES DLLEXPORT :: name, !GCC$ unroll 4
  const vendors = alternation(words.compiler.sentinels);
  repository.compiler = {
    begin: `(?i)^(?:([c*!](?:${vendors}))|[ \\t]*(!(?:${vendors})))`,
    beginCaptures: { 1: { name: SCOPE.sentinel('compiler') }, 2: { name: SCOPE.sentinel('compiler') } },
    end: '(?=\\n)',
    name: SCOPE.line('compiler'),
    patterns: [
      ...named('compiler', '[a-z_]\\w*', '#arguments'),
      { match: '(::)([^!\\n]*)', captures: { 1: { name: 'keyword.operator.double-colon.fortran' } } },
      { match: '(?i)\\b[a-z_]\\w*\\b', name: 'entity.other.attribute-name.compiler.fortran' },
      { include: '#arguments' },
    ],
  };

  // conditional compilation: the sentinel, then ordinary Fortran (!$ in free form, !$ c$ *$ in column 1 in fixed
  // form; !@cuf for CUDA Fortran)
  const conditional = '(?i)^(?:([c*!]\\$)(?=[ \\t\\d]|$)|[ \\t]*(!\\$)(?=[ \\t&]|$)|[ \\t]*(!@cuf)(?=[ \\t&]|$))';
  repository.conditional = {
    match: conditional,
    captures: {
      1: { name: SCOPE.sentinel('conditional') },
      2: { name: SCOPE.sentinel('conditional') },
      3: { name: SCOPE.sentinel('conditional.cuf') },
    },
  };
  const families = ['openmp', 'openacc', 'cuf', 'compiler', 'conditional'];
  repository.lines = { patterns: families.map((k) => ({ include: `#${k}` })) };

  // The free-form grammar tries this grammar at every token, so it starts with a single regex: a lookahead for the
  // start of any directive line. It opens a region for one of the rules above to fill, and closes as soon as that
  // rule has ended, where \G no longer holds. The lookahead is exactly the union of the rules' starts, so a line
  // such as !$hpf, which none of them takes, stays a comment. (The fixed-form grammar includes #lines directly, from
  // the injection that also cuts lines at column 72, which must keep applying inside directives.)
  const start = (rule) => rule.begin ?? rule.match;
  const probe = families.map((k) => start(repository[k]).replace(/^\(\?i\)\^/, '').replace(/(?<!\\)\((?!\?)/g, '(?:'));
  repository.gate = {
    begin: `(?i)^(?=${probe.join('|')})`,
    end: '(?!\\G)',
    name: 'meta.directive.fortran',
    patterns: [{ include: '#lines' }],
  };

  return {
    name: 'fortran-directives',
    scopeName: DIRECTIVES,
    patterns: [{ include: '#gate' }],
    repository,
  };
}

// ---------------------------------------------------------------- fypp

function buildFypp() {
  const amp = { name: 'keyword.operator.line-continuation.fypp' };
  const directive = { name: 'keyword.control.directive.fypp' };
  const macro = { name: 'entity.name.function.macro.fypp' };
  const expression = {
    patterns: [
      { match: "'(?:[^'\\\\\\n]|\\\\.)*'?", name: 'string.quoted.single.fypp' },
      { match: '"(?:[^"\\\\\\n]|\\\\.)*"?', name: 'string.quoted.double.fypp' },
      { match: '\\b(?:True|False|None)\\b', name: 'constant.language.fypp' },
      { match: '(?i)(?<![\\w.])(?:\\d+\\.?\\d*|\\.\\d+)(?:e[-+]?\\d+)?\\b', name: 'constant.numeric.fypp' },
      { match: '\\b(?:and|or|not|in|is|if|else|for|lambda)\\b', name: 'keyword.operator.word.fypp' },
      {
        match: '\\b(?:defined|getvar|setvar|delvar|globalvar|len|range|str|int|float|enumerate|zip|list|dict|tuple|abs|min|max|sum|any|all|sorted|reversed)\\b(?=\\s*\\()',
        name: 'support.function.fypp',
      },
      { match: '==|!=|<=|>=|[-+*/%<>=]|\\*\\*|//', name: 'keyword.operator.fypp' },
    ],
  };
  // Three regexes in all, since the free-form grammar tries them at every token: comment lines (#!), directive
  // lines (#:if, $:expr, @:macro), and the inline forms (${expr}$, #{if c}#, @{macro()}@).
  return {
    name: 'fortran-fypp',
    scopeName: FYPP,
    patterns: [
      { match: '^[ \\t]*(#!).*', name: 'comment.line.fypp', captures: { 1: { name: 'punctuation.definition.comment.fypp' } } },
      {
        // a directive line, continued while the next line starts with &
        begin: '^[ \\t]*(?:(#:)[ \\t]*(\\w+)?|(\\$:)|(@:)[ \\t]*(\\w+)?)',
        beginCaptures: { 1: directive, 2: directive, 3: directive, 4: directive, 5: macro },
        end: '^(?![ \\t]*&)',
        name: 'meta.preprocessor.fypp',
        patterns: [{ match: '^[ \\t]*(&)|(&)[ \\t]*$', captures: { 1: amp, 2: amp } }, { include: '#expression' }],
      },
      { include: '#inline' },
    ],
    repository: {
      expression,
      inline: {
        begin: '([$#@])\\{',
        beginCaptures: { 0: { name: 'punctuation.section.embedded.begin.fypp' } },
        end: '\\}\\1|(?=\\n)',
        endCaptures: { 0: { name: 'punctuation.section.embedded.end.fypp' } },
        name: 'meta.embedded.inline.fypp',
        patterns: [
          { match: '(?<=#\\{)[ \\t]*(\\w+)', captures: { 1: directive } },
          { match: '(?<=@\\{)[ \\t]*(\\w+)', captures: { 1: macro } },
          { include: '#expression' },
        ],
      },
    },
  };
}

// ---------------------------------------------------------------- output

const HEADER = 'Generated by scripts/build-grammars.mjs; do not edit.';

function noticeText(upstream) {
  // tm-grammars' NOTICE carries vscode-fortran-support's licence under a "Files: fortran-…" heading
  const at = upstream.notice.indexOf('Files:   fortran-fixed-form.json, fortran-free-form.json');
  expect(at >= 0, 'NOTICE section for the Fortran grammars');
  const section = upstream.notice.slice(at).split(/\n={20,}\n/)[0].trim();
  return [
    'fumadocs-fortran/shiki: third-party notices',
    '',
    'fortran.json and fortran-fixed.json (also embedded in grammars.js) are modified copies of the Fortran grammars of',
    `fortran-lang/vscode-fortran-support, as normalised and published by tm-grammars ${PIN['tm-grammars']}:`,
    `  free form   upstream commit ${PIN['fortran-free-form']}`,
    `  fixed form  upstream commit ${PIN['fortran-fixed-form']}`,
    'scripts/build-grammars.mjs lists the modifications. The original notices follow. The modifications,',
    'fortran-directives.json and fortran-fypp.json are under the licence of fumadocs-fortran.',
    '',
    '='.repeat(100),
    'fortran-lang/vscode-fortran-support',
    section,
    '',
    '='.repeat(100),
    'tm-grammars (https://github.com/shikijs/textmate-grammars-themes)',
    '',
    upstream.license.trim(),
    '',
  ].join('\n');
}

function moduleText(grammars, words) {
  const lines = [
    `// ${HEADER}`,
    '// The grammars of shiki/*.json as a module, since importing JSON in ESM needs import attributes, which Node before',
    '// 18.20 and some bundlers lack. Each is parsed from a string, which is faster than an object literal this large.',
  ];
  for (const [name, grammar] of Object.entries(grammars)) {
    lines.push(`export const ${name} = /* @__PURE__ */ Object.freeze(JSON.parse(${JSON.stringify(JSON.stringify(grammar))}));`);
  }
  lines.push('// the compiler directive sentinels, for transformerFortranDirectives()');
  lines.push(`export const compilerSentinels = ${JSON.stringify(words.compiler.sentinels)};`);
  return `${lines.join('\n')}\n`;
}

export function build() {
  const upstream = readUpstream();
  const words = JSON.parse(fs.readFileSync(path.join(OUT, 'directive-words.json'), 'utf8'));
  const grammars = {
    free: buildFree(upstream.free),
    fixed: buildFixed(upstream.fixed),
    directives: buildDirectives(words),
    fypp: buildFypp(),
  };
  const json = (g) => `${JSON.stringify({ $comment: HEADER, ...g }, null, 2)}\n`;
  return {
    'fortran.json': json(grammars.free),
    'fortran-fixed.json': json(grammars.fixed),
    'fortran-directives.json': json(grammars.directives),
    'fortran-fypp.json': json(grammars.fypp),
    'grammars.js': moduleText(grammars, words),
    NOTICE: noticeText(upstream),
  };
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const files = build();
  if (process.argv.includes('--check')) {
    const stale = Object.entries(files).filter(([f, text]) => {
      const file = path.join(OUT, f);
      return !fs.existsSync(file) || fs.readFileSync(file, 'utf8') !== text;
    });
    for (const [f] of stale) console.error(`shiki/${f} is out of date`);
    if (stale.length) {
      console.error('run: node scripts/build-grammars.mjs');
      process.exit(1);
    }
    console.log(`shiki/: ${Object.keys(files).length} files up to date`);
  } else {
    for (const [f, text] of Object.entries(files)) fs.writeFileSync(path.join(OUT, f), text);
    console.log(`shiki/: wrote ${Object.keys(files).join(', ')}`);
  }
}
