// Shiki ignores a grammar whose name is already loaded. Ours have names of their own and carry the names of Shiki's
// bundled Fortran grammars as aliases, which Shiki resolves before names: so whichever loads first, every Fortran
// language id highlights with our grammars. Checked on Shiki itself, and through fumadocs' rehypeCode, whose
// highlighter is shared by the whole process (each order in a process of its own).
import { spawnSync } from 'node:child_process';
import path from 'node:path';
import { createHighlighter, createJavaScriptRegexEngine } from 'shiki';
import { fortranLanguages } from '../../shiki/index.js';
import { bundled, scoped, HERE, THEMES } from './helpers.mjs';

const FREE_IDS = ['fortran', 'fortran-free-form', 'f90', 'f95', 'f03', 'f08', 'f18', 'f23', 'fpp', 'fypp'];
const FIXED_IDS = ['fortran-fixed', 'fortran-fixed-form', 'f', 'for', 'f77', 'ftn'];
const PROBE = { free: '!$omp parallel\n', fixed: 'C$OMP PARALLEL\n' };

/** Whether `id` highlights with our grammars: its directive line is a directive, not a comment. */
function ours(hl, id) {
  const code = FIXED_IDS.includes(id) ? PROBE.fixed : PROBE.free;
  return scoped(hl, code, id)[0].some((t) => t.scopes.includes('meta.directive.openmp.fortran'));
}

export default async function ({ ok, eq }) {
  const [freeForm, fixedForm] = [await bundled('fortran-free-form'), await bundled('fortran-fixed-form')];
  const [free, fixed, directives, fypp] = fortranLanguages;
  const engine = createJavaScriptRegexEngine();
  const make = (langs) => createHighlighter({ langs, themes: THEMES, engine });

  const orders = {
    'ours, then the bundled grammars': async () => make([...fortranLanguages, ...freeForm, ...fixedForm]),
    'the bundled grammars, then ours': async () => make([...freeForm, ...fixedForm, ...fortranLanguages]),
    'the bundled grammars loaded first, ours later': async () => {
      const hl = await make(['fortran-free-form', 'fortran-fixed-form']);
      await hl.loadLanguage(...fortranLanguages);
      return hl;
    },
    'ours loaded first, the bundled grammars later, by name and as objects': async () => {
      const hl = await make(fortranLanguages);
      await hl.loadLanguage('fortran-fixed-form', 'f90', 'f77');
      await hl.loadLanguage(...fixedForm);
      return hl;
    },
    'injections first': async () => make([directives, fypp, free, fixed]),
    'injections last, after the bundled grammars': async () => {
      const hl = await make([free, fixed, ...fixedForm]);
      await hl.loadLanguage(directives, fypp);
      return hl;
    },
  };
  // the control: with Shiki's grammars only, the probe must fail
  {
    const hl = await make([...freeForm, ...fixedForm]);
    ok(!ours(hl, 'f90') && !ours(hl, 'f77'), 'Shiki, its own grammars only: the probe tells them from ours');
    hl.dispose();
  }
  for (const [order, create] of Object.entries(orders)) {
    const hl = await create();
    const lost = [...FREE_IDS, ...FIXED_IDS].filter((id) => !ours(hl, id));
    eq(lost, [], `Shiki, ${order}: language ids that do not reach our grammars`);
    ok(scoped(hl, 'x = ${k}$\n', 'fypp')[0].some((t) => t.scopes.includes('meta.embedded.inline.fypp')), `Shiki, ${order}: fypp`);
    hl.dispose();
  }

  // fumadocs: FUMADOCS_CORE lists the packages to try (default fumadocs-core); missing ones are skipped
  const packages = (process.env.FUMADOCS_CORE ?? 'fumadocs-core').split(/[\s,]+/).filter(Boolean);
  for (const pkg of packages) {
    try {
      await import(`${pkg}/mdx-plugins/rehype-code`);
    } catch {
      console.log(`  (skipped: ${pkg} is not installed)`);
      continue;
    }
    for (const scenario of ['control', 'plugin-first', 'bundled-first', 'interleaved']) {
      const run = spawnSync(process.execPath, [path.join(HERE, 'fumadocs-order.mjs'), pkg, scenario], { encoding: 'utf8' });
      if (run.status !== 0) {
        ok(false, `${pkg}, ${scenario}: ${run.stderr.trim().split('\n').slice(-3).join(' | ')}`);
        continue;
      }
      const result = JSON.parse(run.stdout);
      if (scenario === 'control') eq(result.lost.length, result.blocks, `${pkg} ${result.version}: without the pack, no fence reaches our grammars`);
      else eq(result.lost, [], `${pkg} ${result.version}, ${scenario}: fences that do not reach our grammars`);
      ok(result.blocks > 0, `${pkg}, ${scenario}: blocks were highlighted`);
    }
  }
}
