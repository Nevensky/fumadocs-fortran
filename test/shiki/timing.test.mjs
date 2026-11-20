// The injections (directives and fypp) may cost at most 25% more tokenising time than the base grammars, on
// representative code: a module with declarations, loops, cpp, doc comments and some directives.
import { getFortranLanguages } from '../../shiki/index.js';
import { highlighter, fixture } from './helpers.mjs';

const BUDGET = 1.25;
const RUNS = 9;

const median = (xs) => [...xs].sort((a, b) => a - b)[xs.length >> 1];

export default async function ({ ok }) {
  const code = Array(8).fill(fixture('heat.F90')).join('\n');
  const lines = code.split('\n').length;
  for (const engine of ['js', 'oniguruma']) {
    const base = await highlighter(engine, getFortranLanguages({ directives: false, fypp: false }));
    const full = await highlighter(engine, getFortranLanguages());
    const time = (hl) => {
      const t0 = performance.now();
      hl.codeToTokens(code, { lang: 'f90', theme: 'github-light' });
      return performance.now() - t0;
    };
    for (let i = 0; i < 3; i++) time(base), time(full); // compile the regexes, warm the JIT
    const without = [];
    const withInjections = [];
    for (let i = 0; i < RUNS; i++) {
      without.push(time(base));
      withInjections.push(time(full));
    }
    const ratio = median(withInjections) / median(without);
    console.log(`  ${engine}: ${lines} lines in ${median(without).toFixed(0)} ms, ${median(withInjections).toFixed(0)} ms with the injections (+${((ratio - 1) * 100).toFixed(0)}%)`);
    ok(ratio <= BUDGET, `${engine}: the injections cost ${((ratio - 1) * 100).toFixed(0)}% more tokenising time, over the ${((BUDGET - 1) * 100).toFixed(0)}% budget`);
    base.dispose();
    full.dispose();
  }
}
