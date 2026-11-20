// Something left open (a string, a directive or its parenthesis, a fypp expression or directive) must not colour the
// rest of the file: the lines after it tokenise as they do when the offending line is blank. (An unclosed parenthesis
// in code does carry on to the next ), as upstream: a fixed-form call continues on the next line without an &.)
import { highlighter, scoped } from './helpers.mjs';

// [lang, code with the offending line marked by »]
const CASES = [
  ['fortran', "program p\n» print *, 'no closing quote\n  x = 1\n  y = f(x) ! note\nend program p\n"],
  ['fortran', 'program p\n» s = "no closing quote\n  x = 1\n  y = f(x) ! note\nend program p\n'],
  ['fortran', 'program p\n» !$omp parallel do private(i, &\n  x = 1\n  y = f(x) ! note\nend program p\n'],
  ['fortran', 'program p\n» !$omp parallel do private(i\n  x = 1\n  y = f(x) ! note\nend program p\n'],
  ['fortran', 'program p\n» !$acc data copy(a(1:n)\n  x = 1\n  y = f(x) ! note\nend program p\n'],
  ['fortran', 'program p\n» !$omp parallel ! unclosed "comment\n  x = 1\n  y = f(x) ! note\nend program p\n'],
  ['fortran', 'program p\n» !dir$ attributes align(64 :: a\n  x = 1\n  y = f(x) ! note\nend program p\n'],
  ['fortran', 'module m\n» typeof(x :: y\n  integer :: x = 1\n  real :: y ! note\nend module m\n'],
  ['fypp', 'program p\n» y = ${broken\n  x = 1\n  y = f(x) ! note\nend program p\n'],
  ['fypp', 'program p\n» y = @{broken(\n  x = 1\n  y = f(x) ! note\nend program p\n'],
  ['fypp', "program p\n» #:if defined('A') &\n  x = 1\n  y = f(x) ! note\nend program p\n"],
  ['fypp', 'program p\n» $:"no closing quote\n  x = 1\n  y = f(x) ! note\nend program p\n'],
  ['f77', "      PROGRAM P\n»      PRINT *, 'NO CLOSING QUOTE\n      X = 1\n      Y = F(X) ! NOTE\n      END\n"],
  ['f77', '      PROGRAM P\n»C$OMP PARALLEL DO PRIVATE(I\n      X = 1\n      Y = F(X) ! NOTE\n      END\n'],
];

const strip = (lines) => lines.map((l) => l.map((t) => `${t.text}|${t.scopes.join(' ')}`).join('\n'));

export default async function ({ eq }) {
  const hl = await highlighter('js');
  for (const [lang, marked] of CASES) {
    const lines = marked.split('\n');
    const at = lines.findIndex((l) => l.startsWith('»'));
    const code = lines.map((l, i) => (i === at ? l.slice(1) : l)).join('\n');
    const blank = lines.map((l, i) => (i === at ? '' : l)).join('\n');
    const got = strip(scoped(hl, code, lang)).slice(at + 1);
    const want = strip(scoped(hl, blank, lang)).slice(at + 1);
    eq(got, want, `${lang}: the lines after \`${lines[at].slice(1).trim()}\``);
  }
}
