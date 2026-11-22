// Compiler directives: OpenMP, OpenACC, CUDA Fortran and vendor sentinels. The reader finds them; this module names the
// construct (`parallel do`, `declare target`, `end parallel`) and keeps the clauses as text. The word lists cover
// OpenMP 6.1 and OpenACC 3.4; the HPC registry (registry/) gives the full lists and their meaning.

/** Sentinel → directive family. `$` is OpenMP conditional compilation (`!$ code`), not a directive. */
export const FAMILY = { omp: 'omp', ompx: 'omp', acc: 'acc', cuf: 'cuf', $: 'cond' };

const OMP_FIRST = new Set([
  'parallel', 'do', 'simd', 'sections', 'section', 'single', 'workshare', 'task', 'taskloop', 'taskwait', 'taskyield',
  'taskgroup', 'target', 'teams', 'distribute', 'loop', 'masked', 'master', 'declare', 'critical', 'atomic', 'barrier',
  'flush', 'ordered', 'threadprivate', 'groupprivate', 'cancel', 'cancellation', 'requires', 'scope', 'metadirective',
  'begin', 'assumes', 'assume', 'allocate', 'allocators', 'nothing', 'error', 'interop', 'dispatch', 'depobj', 'scan',
  'tile', 'unroll', 'interchange', 'reverse', 'fuse', 'split', 'stripe', 'workdistribute', 'taskgraph', 'coexecute',
]);
// words that may follow another word of a combined or composite construct
const OMP_NEXT = new Set([
  'parallel', 'do', 'simd', 'sections', 'workshare', 'taskloop', 'teams', 'distribute', 'loop', 'masked', 'master',
  'target', 'single', 'workdistribute',
]);
const OMP_AFTER = {
  target: new Set(['data', 'enter', 'exit', 'update', 'parallel', 'teams', 'simd', 'loop']),
  enter: new Set(['data']),
  exit: new Set(['data']),
  declare: new Set(['simd', 'target', 'reduction', 'mapper', 'variant', 'induction']),
  cancellation: new Set(['point']),
  begin: new Set(['declare', 'assumes', 'metadirective']),
};
// constructs that stand alone: no other construct word follows them
const OMP_ALONE = new Set([
  'atomic', 'critical', 'barrier', 'flush', 'ordered', 'threadprivate', 'groupprivate', 'requires', 'scope', 'nothing',
  'error', 'scan', 'depobj', 'interop', 'dispatch', 'taskwait', 'taskyield', 'taskgroup', 'section', 'single', 'cancel',
  'allocate', 'allocators', 'assume', 'assumes', 'metadirective', 'tile', 'unroll', 'interchange', 'reverse', 'fuse',
  'split', 'stripe', 'taskgraph', 'point', 'data', 'update', 'simd', 'reduction', 'mapper', 'variant', 'induction',
]);

const ACC_FIRST = new Set([
  'parallel', 'kernels', 'serial', 'loop', 'data', 'enter', 'exit', 'host_data', 'atomic', 'cache', 'declare', 'update',
  'wait', 'routine', 'init', 'shutdown', 'set',
]);
const ACC_AFTER = {
  parallel: new Set(['loop']),
  kernels: new Set(['loop']),
  serial: new Set(['loop']),
  enter: new Set(['data']),
  exit: new Set(['data']),
};

/**
 * Names the construct of a directive.
 * @param {string} sentinel `omp`, `acc`, `cuf`, `$`, or a vendor sentinel such as `dir`
 * @param {string} text the directive after its sentinel, continuation lines joined
 * @returns {{ family: string, construct: string, end: boolean, clauses: string }}
 */
export function parseDirective(sentinel, text) {
  const family = FAMILY[sentinel] ?? 'vendor';
  if (family === 'cond' || family === 'vendor') return { family, construct: family === 'vendor' ? sentinel : '', end: false, clauses: text.trim() };
  const lead = text.length - text.trimStart().length;
  const lower = text.slice(lead).toLowerCase();
  const words = [];
  let i = 0, end = false;
  const re = /[a-z_]+/y;
  const take = () => {
    while (lower[i] === ' ' || lower[i] === '\t' || lower[i] === ',') i++;
    re.lastIndex = i;
    const m = re.exec(lower);
    return m ? m[0] : null;
  };
  let w = take();
  if (w === 'end') { end = true; i += 3; w = take(); }
  if (family === 'cuf') {
    const m = /^(kernel( do)?)/.exec(lower.slice(i));
    if (m) { words.push(m[1]); i += m[1].length; }
  } else if (family === 'omp') {
    while (w) {
      // OpenMP 6 also spells directive names with underscores: declare_simd, target_data
      const first = w.split('_')[0];
      const prev = words[words.length - 1];
      const ok = !prev ? OMP_FIRST.has(first) : OMP_AFTER[prev]?.has(first) || (OMP_NEXT.has(first) && OMP_NEXT.has(prev));
      if (!ok) break;
      for (const p of w.split('_')) words.push(p);
      i += w.length;
      const last = words[words.length - 1];
      if (lower[i] === '(' || (OMP_ALONE.has(last) && !OMP_AFTER[last])) break;
      w = take();
    }
  } else {
    while (w) {
      const prev = words[words.length - 1];
      const ok = !prev ? ACC_FIRST.has(w) : ACC_AFTER[prev]?.has(w);
      if (!ok) break;
      words.push(w);
      i += w.length;
      if (lower[i] === '(') break;
      w = take();
    }
  }
  return { family, construct: words.join(' '), end, clauses: text.slice(lead + i).trim() };
}

/** Constructs that open a region closed by an `end` directive (loop constructs may also end with their loop). */
export function opensRegion(d) {
  if (d.end || !d.construct) return false;
  if (d.family === 'omp') {
    return !/^(barrier|flush|taskwait|taskyield|threadprivate|groupprivate|requires|scan|depobj|interop|error|nothing|cancel|cancellation point|declare (simd|reduction|mapper|variant|induction)|target (enter|exit) data|target update|allocate|section)$/.test(d.construct);
  }
  if (d.family === 'acc') return !/^(routine|wait|init|shutdown|set|update|cache|declare|(enter|exit) data)$/.test(d.construct);
  return false;
}
