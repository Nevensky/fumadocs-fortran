// The generated files are up to date and consistent; the grammars' names, scopes and aliases; the package API.
import fs from 'node:fs';
import path from 'node:path';
import { build } from '../../scripts/build-grammars.mjs';
import * as generated from '../../shiki/grammars.js';
import { fortranLanguages, getFortranLanguages, fortranRehypeCode, transformerFortranNotation, transformerFortranDirectives } from '../../shiki/index.js';

const SHIKI = path.join(path.dirname(new URL(import.meta.url).pathname), '..', '..', 'shiki');

export default async function ({ ok, eq }) {
  // what scripts/build-grammars.mjs would write is what shiki/ holds
  const files = build();
  for (const [file, text] of Object.entries(files)) {
    const have = fs.existsSync(path.join(SHIKI, file)) ? fs.readFileSync(path.join(SHIKI, file), 'utf8') : null;
    ok(have === text, `shiki/${file} is out of date: run node scripts/build-grammars.mjs`);
  }
  // grammars.js holds the same grammars as the JSON files
  for (const [name, file] of [['free', 'fortran.json'], ['fixed', 'fortran-fixed.json'], ['directives', 'fortran-directives.json'], ['fypp', 'fortran-fypp.json']]) {
    const { $comment, ...json } = JSON.parse(fs.readFileSync(path.join(SHIKI, file), 'utf8'));
    eq(JSON.stringify(generated[name]), JSON.stringify(json), `grammars.js ${name} = ${file}`);
    ok(!JSON.stringify(json).includes('invalid'), `${file}: no invalid scopes`);
  }
  const notice = fs.readFileSync(path.join(SHIKI, 'NOTICE'), 'utf8');
  ok(notice.includes('Copyright (c) 2017-2022 The Fortran Programming Language') && notice.includes('Anthony Fu'), 'NOTICE keeps both MIT notices');

  // names, scopes, aliases
  const [free, fixed, directives, fypp] = fortranLanguages;
  eq([free.name, free.scopeName], ['fortran', 'source.fortran.free.fd'], 'free form');
  eq(free.aliases, ['fortran-free-form', 'f90', 'f95', 'f03', 'f08', 'f18', 'f23', 'fpp', 'fypp'], 'free-form aliases');
  eq([fixed.name, fixed.scopeName, fixed.embeddedLangs], ['fortran-fixed', 'source.fortran.fixed.fd', ['fortran']], 'fixed form');
  eq(fixed.aliases, ['fortran-fixed-form', 'f', 'for', 'f77', 'ftn'], 'fixed-form aliases');
  eq([directives.name, directives.scopeName], ['fortran-directives', 'source.fortran.directives.fd'], 'directives');
  eq([fypp.name, fypp.scopeName], ['fortran-fypp', 'source.fortran.fypp.fd'], 'fypp');
  // the injections come in through the base grammars' own injections, not as injection grammars of their own
  ok(!('injectTo' in directives) && !('injectTo' in fypp), 'no injectTo');
  const includes = (g) => Object.values(g.injections).flatMap((i) => i.patterns.map((p) => p.include));
  ok(includes(free).includes('source.fortran.directives.fd') && includes(free).includes('source.fortran.fypp.fd'), 'free form brings both in');
  ok(includes(fixed).includes('source.fortran.directives.fd#lines') && !includes(fixed).some((i) => i?.startsWith('source.fortran.fypp')), 'fixed form brings the directives in');
  eq([free.embeddedLangsLazy, fixed.embeddedLangsLazy], [['fortran-directives', 'fortran-fypp'], ['fortran-directives']], 'reloaded when they load later');
  ok(!JSON.stringify(fixed).includes('"source.fortran.free"'), 'the fixed form includes our free form only');
  ok(Object.isFrozen(free) && Object.isFrozen(fixed), 'the grammars are frozen');

  // getFortranLanguages
  eq(getFortranLanguages().map((l) => l.name), ['fortran', 'fortran-fixed', 'fortran-directives', 'fortran-fypp'], 'defaults');
  eq(getFortranLanguages({ directives: false, fypp: false }).map((l) => l.name), ['fortran', 'fortran-fixed'], 'without injections');
  ok(getFortranLanguages()[1] === fixed, 'column 72 is the bundled grammar');
  const wide = getFortranLanguages({ fixedLineLength: 132 })[1];
  ok(wide.repository['line-end-comment'].begin.includes('{132}') && wide.name === 'fortran-fixed', 'column 132');
  ok(getFortranLanguages({ fixedLineLength: 132 })[1] === wide, 'variants are reused');
  ok(!JSON.stringify(getFortranLanguages({ fixedLineLength: false })[1].injections).includes('#line-end-comment'), 'no column limit');
  ok(JSON.stringify(getFortranLanguages({ fixedLineLength: false })[1].injections).includes('source.fortran.directives.fd#lines'), 'no column limit, still directives');
  ok(fixed.repository['line-end-comment'].begin.includes('{72}'), 'the default grammar is left alone');
  for (const bad of [0, -1, 72.5, '72', null]) {
    let threw = false;
    try {
      getFortranLanguages({ fixedLineLength: bad });
    } catch {
      threw = true;
    }
    ok(threw, `fixedLineLength ${JSON.stringify(bad)} is refused`);
  }

  // fortranRehypeCode
  const base = { themes: { light: 'github-light', dark: 'github-dark' }, defaultColor: false, langs: ['python'], transformers: [{ name: 'site' }] };
  const options = fortranRehypeCode(base);
  eq(options.themes, base.themes, 'base options are kept');
  eq(options.langs.map((l) => (typeof l === 'string' ? l : l.name)), ['python', 'fortran', 'fortran-fixed', 'fortran-directives', 'fortran-fypp'], 'langs');
  eq(options.transformers.map((t) => t.name), ['site', 'fumadocs-fortran:notation', 'fumadocs-fortran:directives'], 'transformers');
  ok(!('langAlias' in options), 'no langAlias');
  eq(base.langs, ['python'], 'base is not changed');
  eq(fortranRehypeCode().langs.length, 4, 'no base');
  ok(fortranRehypeCode({}, { fixedLineLength: 132 }).langs[1] === wide, 'options reach the grammars');
  eq([transformerFortranNotation().name, transformerFortranDirectives().name], ['fumadocs-fortran:notation', 'fumadocs-fortran:directives'], 'transformer names');
}
