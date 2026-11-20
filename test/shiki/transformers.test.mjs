// transformerFortranNotation() and transformerFortranDirectives(), on Shiki's codeToHast.
import { transformerFortranNotation, transformerFortranDirectives } from '../../shiki/index.js';
import { highlighter } from './helpers.mjs';

const textOf = (n) => (n.type === 'text' ? n.value : (n.children ?? []).map(textOf).join(''));
const classes = (n) => [n.properties?.class ?? []].flat().join(' ').split(/\s+/).filter(Boolean);

export default async function ({ ok, eq }) {
  const hl = await highlighter('js');
  const render = (code, lang = 'fortran', transformers = [transformerFortranNotation(), transformerFortranDirectives()]) => {
    // as fumadocs does, the code block's final newline is not a line
    const root = hl.codeToHast(code.replace(/\n$/, ''), { lang, themes: { light: 'github-light', dark: 'github-dark' }, defaultColor: false, transformers });
    const pre = root.children[0];
    const lines = pre.children[0].children.filter((c) => c.type === 'element');
    return { pre, lines, text: lines.map(textOf), lineClasses: lines.map((l) => classes(l).filter((c) => c !== 'line')) };
  };

  // ---- notations
  {
    const r = render('x = 1 ! [!code highlight]\ny = 2\n! [!code ++]\nz = 3\nw = 4 ! [!code --]\n');
    eq(r.text, ['x = 1', 'y = 2', 'z = 3', 'w = 4'], 'notations and comment lines left empty are removed');
    eq(r.lineClasses, [['highlighted'], [], ['diff', 'add'], ['diff', 'remove']], 'line classes');
    ok(classes(r.pre).includes('has-highlighted') && classes(r.pre).includes('has-diff'), 'pre classes');
  }
  {
    const r = render('! [!code focus:2]\na = 1\nb = 2\nc = 3\n');
    eq(r.lineClasses, [['focused'], ['focused'], []], ':2 marks two lines');
    ok(classes(r.pre).includes('has-focused'), 'has-focused');
  }
  {
    const r = render("! [!code word:dgemm]\ncall dgemm('N')\ncall sgemm('N')\ncall dgemm('T')\n");
    const words = r.lines.flatMap((l) => l.children.filter((s) => classes(s).includes('highlighted-word')).map(textOf));
    eq(words, ['dgemm', 'dgemm'], 'a word to the end of the block');
    eq(r.text[0], "call dgemm('N')", 'the word notation line is removed');
  }
  {
    const r = render('! [!code word:x:1]\nx = x + 1\nx = 2\n');
    eq(r.lines.map((l) => l.children.filter((s) => classes(s).includes('highlighted-word')).length), [2, 0], 'word:x:1 marks one line');
  }
  eq(render('y = f(x) ! returns y [!code hl]\n').text, ['y = f(x) ! returns y'], 'a comment keeps its own text');
  eq(render('!$omp parallel ! [!code highlight]\n').text, ['!$omp parallel'], 'a notation after a directive');
  eq(render('x = 1 ! [!code highlight] [!code ++]\n').lineClasses, [['highlighted', 'diff', 'add']], 'two notations in one comment');
  eq(render("print *, '[!code highlight]'\n").text, ["print *, '[!code highlight]'"], 'not in a string');
  eq(render("print *, 'it''s' ! [!code hl]\n").lineClasses, [['highlighted']], 'a doubled quote inside a string');
  {
    const r = render('C [!code highlight]\n      X = 1\n* [!code --]\n      Y = 2 ! [!code ++]\n', 'f77');
    eq(r.text, ['      X = 1', '      Y = 2'], 'fixed form: C and * comment lines');
    eq(r.lineClasses, [['highlighted'], ['diff', 'remove', 'add']], 'fixed form: classes');
  }
  eq(render('call c(x) ! [!code highlight]\n', 'f').lineClasses, [['highlighted']], 'fixed form: ! comments');
  eq(render('x = 1\n! [!code highlight]\n').text, ['x = 1'], 'a notation with no line after it marks nothing');
  {
    await hl.loadLanguage('python');
    const py = hl.codeToHast('x = 1  # [!code highlight]\n', { lang: 'python', theme: 'github-light', transformers: [transformerFortranNotation()] });
    ok(textOf(py).includes('[!code highlight]'), 'other languages are left to the transformers that know them');
  }

  // ---- directive lines
  {
    const code = [
      'subroutine s',
      '  !$omp parallel do',
      '  !$OMP END PARALLEL DO',
      '  !$acc kernels',
      '  !$ n = omp_get_max_threads()',
      '  !dir$ ivdep',
      '  !$cuf kernel do <<<*,*>>>',
      '  !@cuf call sync()',
      '  x = 1 ! !$omp is a comment here',
      '  !!$omp parallel',
      'end subroutine s',
    ].join('\n');
    const r = render(code);
    eq(r.lineClasses, [
      [],
      ['fdf-directive', 'fdf-kind-omp'],
      ['fdf-directive', 'fdf-kind-omp'],
      ['fdf-directive', 'fdf-kind-acc'],
      ['fdf-directive', 'fdf-kind-omp'],
      ['fdf-directive'],
      ['fdf-directive', 'fdf-kind-cuda'],
      ['fdf-directive', 'fdf-kind-cuda'],
      [],
      [],
      [],
    ], 'free form: line classes');
    eq(r.lines.map((l) => l.properties['data-directive'] ?? null), [null, 'openmp', 'openmp', 'openacc', 'conditional', 'compiler', 'cuf', 'conditional', null, null, null], 'data-directive');
  }
  {
    const r = render('C$OMP PARALLEL DO\n*$OMP& PRIVATE(I)\nc$acc kernels\nC$    CALL F()\nCDIR$ IVDEP\nC     PLAIN\n      X = 1\n', 'f77');
    eq(r.lines.map((l) => l.properties['data-directive'] ?? null), ['openmp', 'openmp', 'openacc', 'conditional', 'compiler', null, null], 'fixed form: data-directive');
  }
  eq(render('!$omp parallel\n', 'fortran', [transformerFortranDirectives({ className: 'omp-line' })]).lineClasses, [['omp-line', 'fdf-kind-omp']], 'className');
  {
    const sh = hl.codeToHast('!$omp parallel\n', { lang: 'text', theme: 'github-light', transformers: [transformerFortranDirectives()] });
    ok(!JSON.stringify(sh).includes('fdf-directive'), 'not in other languages');
  }
  // both transformers together: lines removed by the notation transformer do not shift the directive classes
  eq(render('! [!code ++]\n!$omp parallel\nx = 1\n').lineClasses, [['diff', 'add', 'fdf-directive', 'fdf-kind-omp'], []], 'with notations');
}
