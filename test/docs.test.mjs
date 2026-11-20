// The doc-comment engine and the MDX safety layer.
import { renderDoc } from '../src/docs/index.js';
import { buildPages, parseSource } from '../src/index.js';
import { escapeText, safeMarkdown, attr, inlineCode, plainText, codeLang } from '../src/emit/mdx.js';

const block = (text, dir = 'after') => [{ dir, line: 1, lines: text.split('\n').map((l) => ` ${l}`) }];
// the nodes of an MDX syntax tree that pass a test, in document order
const nodesOf = (tree, test) => {
  const out = [];
  const walk = (n) => {
    if (test(n)) out.push(n);
    for (const c of n.children ?? []) walk(c);
  };
  walk(tree);
  return out;
};

export default async function ({ ok, eq, out }) {
  // ---- escaping
  eq(escapeText('B(LDB,*) and A * X = B'), 'B(LDB,\\*) and A \\* X = B', 'LAPACK text is not emphasis');
  eq(escapeText('N >= 0 and x < {y}'), 'N &gt;= 0 and x &lt; \\{y\\}', 'comparisons and braces');
  eq(escapeText('# not a heading\n- not a list\n1. not a list'), '\\# not a heading\n\\- not a list\n1\\. not a list', 'line starts');
  eq(escapeText('import x from y'), '&#105;mport x from y', 'an ES import is neutralised');
  eq(safeMarkdown('a {b} `c {d}` costs $5'), 'a \\{b\\} `c {d}` costs \\$5', 'braces and dollars escaped outside code');
  eq(safeMarkdown('<div class="x" style="color:red" onclick="f()">d</div>'), '<div className="x">d</div>', 'HTML attributes as JSX, unsafe ones dropped');
  eq(safeMarkdown('x<br>y <!-- hidden --> <https://x.org> a < b'), 'x<br />y  [https://x.org](https://x.org) a &lt; b', 'HTML normalised');
  eq(safeMarkdown('# Title\ntext'), '**Title**\ntext', 'headings become bold paragraphs');
  eq(safeMarkdown('text\n\n    code line\n\nmore'), 'text\n\n```text\ncode line\n```\n\nmore', 'indented code becomes fenced');
  eq(safeMarkdown('```fortran\nx = {1}\n```'), '```f90\nx = {1}\n```', '```fortran becomes ```f90, contents untouched');
  eq(attr('type', 'character(len=*)'), ' type="character(len=*)"', 'string attribute');
  eq(attr('init', 'a "b"'), ' init={"a \\"b\\""}', 'an attribute with a quote');
  eq(attr('line', 3) + attr('optional', true) + attr('x', false), ' line={3} optional', 'number and boolean attributes');
  eq(inlineCode('a`b'), '``a`b``', 'inline code with a backtick');
  eq(plainText('**Bold** `code` [link](/x) $x^2$ a \\* b &lt;'), 'Bold code link x^2 a * b <', 'plain text');
  eq(plainText('`stdlib_linalg_lapack` wraps a_b_c and B(LDB,\\*) with *emphasis*'), 'stdlib_linalg_lapack wraps a_b_c and B(LDB,*) with emphasis', 'plain text keeps identifiers');
  eq(safeMarkdown('```fortran``` is inline code here'), '```fortran``` is inline code here', 'a line opening with inline ```code``` is not a fence');
  eq(safeMarkdown('Usage\n=====\ntext\n\nNotes\n-----'), '**Usage**\ntext\n\n**Notes**', 'setext headings become bold paragraphs');

  // ---- code blocks name languages a fumadocs site can highlight
  eq(['Python', '{.python}', '.python', '{ .python #id }', 'f#', 'none', 'output', 'fortran77', 'ftn', 'fypp', 'F08', 'math'].map((l) => codeLang(l)),
    ['python', 'python', 'python', 'python', 'f#', 'text', 'text', 'f77', 'f77', 'f90', 'f90', 'math'], 'languages Shiki knows, Fortran ones as f90 and f77');
  eq(safeMarkdown('```Python title="x.py"\nprint(1)\n```'), '```python title="x.py"\nprint(1)\n```', 'a fence keeps its meta');
  ok(renderDoc(block('\\brief Code.\n\\code{.unparsed}\nx\n\\endcode', 'before')).body.includes('```text\nx\n```'), 'Doxygen \\code{.unparsed} becomes text');

  // ---- HTML: phrasing tags pair within their paragraph, block elements stand as blocks, the rest is text
  eq(safeMarkdown('Valid when a<b and b>c holds.'), 'Valid when a&lt;b and b>c holds.', 'a comparison is not a tag');
  eq(safeMarkdown('Unclosed <b>bold and <i>it</i>.'), 'Unclosed &lt;b&gt;bold and <i>it</i>.', 'a tag that does not pair is text');
  eq(safeMarkdown('See <div>a block</div> here.'), 'See\n\n<div>a block</div>\n\nhere.', 'a block element in a paragraph stands on its own');
  eq(safeMarkdown('<table><tr><td>a<td>b</table>'), '<table><tbody><tr><td>a</td><td>b</td></tr></tbody></table>', 'left-out end tags and <tbody> added');
  eq(safeMarkdown('<ul>\n<li>one\n<li>two\n</ul>'), '<ul>\n\n<li>one </li>\n\n<li>\n\ntwo\n\n</li>\n\n</ul>', 'a list over lines');
  eq(safeMarkdown('a <td>x</td> b'), 'a x b', 'table parts outside a table are dropped, as a browser drops them');
  eq(safeMarkdown('text<p>more'), 'text\n\nmore', '<p> is a paragraph break');
  eq(safeMarkdown('<a href="https://x.org">https://x.org</a>'), '[https://x.org](https://x.org)', '<a href> becomes a Markdown link (no autolink nested in it)');
  eq(safeMarkdown(`<span title='say "hi"'>x</span>`), '<span title="say &quot;hi&quot;">x</span>', 'an attribute with a quote');
  eq(safeMarkdown('<td nowrap>'), '', 'a boolean attribute is an attribute');
  eq(safeMarkdown('<https://a.org/{u}/x>'), '[https://a.org/\\{u\\}/x](https://a.org/{u}/x)', 'an autolink with braces');
  eq(safeMarkdown('Visible.\n<!--\nTODO secret {x}\n-->\nAfter.'), 'Visible.\n\nAfter.', 'a comment over lines is dropped');
  eq(safeMarkdown('The marker <!-- starts nothing.'), 'The marker &lt;!-- starts nothing.', 'an unclosed comment is text');
  eq(safeMarkdown('![logo](|media|/logo.png) and ![](rel.png) and ![x](https://x.org/x.png)'), '*logo* and  and ![x](https://x.org/x.png)', 'an image a site cannot import is its alt text');

  // ---- import and export, headings, lists
  eq(safeMarkdown('```fortran\nimport :: dp\n```\nexport the results'), '```f90\nimport :: dp\n```\n&#101;xport the results', 'export at the start of any line is not ESM; code keeps import');
  eq(renderDoc(block('\\[ a = b \\] import x')).body, '$$\na = b\n$$\n&#105;mport x', 'nor after a display formula');
  eq(safeMarkdown('Intro.\n#\nText.\n\n## ##'), 'Intro.\n\nText.', 'an ATX heading with no text ends the paragraph');
  eq(safeMarkdown('# Interop with C#\n\n## Title ##'), '**Interop with C#**\n\n**Title**', 'closing hashes');
  {
    const t0 = Date.now();
    eq(safeMarkdown(`# ${'x'.repeat(20)}${' '.repeat(5000)}y`), `**${'x'.repeat(20)}${' '.repeat(5000)}y**`, 'a heading with a long run of blanks');
    ok(Date.now() - t0 < 500, 'is read in linear time');
  }
  eq(safeMarkdown('- a\n\n    para of a\n\n- b'), '- a\n\n    para of a\n\n- b', 'a list item continued after a blank line (FORD nests lists 4 columns a level)');
  eq(safeMarkdown('- a\n\n        code'), '- a\n\n    ```text\n    code\n    ```', 'code in a list item is 8 columns in');
  eq(safeMarkdown('```text\n@note x\n```'), '```text\n@note x\n```', 'fenced code is left alone');
  eq(safeMarkdown('Further Details\n~~~~~~~~~~~~~~~\ntext'), 'Further Details\n~~~~~~~~~~~~~~~\ntext\n~~~~~~~~~~~~~~~',
    'a fence the doc leaves open is closed by as long a run (a LAPACK-style ~~~ underline is a fence to Markdown)');
  eq(safeMarkdown('```fortran\nx = 1'), '```f90\nx = 1\n```', 'and a short one by its own run');
  eq(safeMarkdown('- a list item\n\n    ```fortran\n    a = 1'), '- a list item\n\n    ```f90\n    a = 1\n    ```',
    'and one opened in a list item inside the item, as far in as the line that opened it');
  // MDX ends a list item at a line left of its text, and a fence in the item with it: the fence closes in the item
  eq(safeMarkdown('- a list item\n\n    ```fortran\n    a = 1\n\nSee {x}.'),
    '- a list item\n\n    ```f90\n    a = 1\n    ```\n\nSee \\{x\\}.', 'before the text that ends the item, which is text');
  eq(safeMarkdown('- outer\n    - inner\n\n        ```fortran\n        a = 1\n\n    more of outer\n- next'),
    '- outer\n    - inner\n\n        ```f90\n        a = 1\n        ```\n\n    more of outer\n- next', 'in a nested list');
  eq(safeMarkdown('- item\n\n    ```fortran\n    a = 1\n```\nafter'), '- item\n\n    ```f90\n    a = 1\n    ```\nafter',
    'a closer left of the item\'s text is moved into the item');
  eq([safeMarkdown('- item\ncarried on\n\n    ```fortran\n    a = 1\nafter'), safeMarkdown('```fortran\n- x\na = 1\n```'),
    safeMarkdown('1. item\n\n  ```fortran\na = 1\n```')],
  ['- item\ncarried on\n\n    ```f90\n    a = 1\n    ```\nafter', '```f90\n- x\na = 1\n```', '1. item\n\n  ```f90\na = 1\n```'],
  'a line that carries on an item\'s paragraph keeps the item; a fence outside any item holds lines at the margin');
  ok(!renderDoc(block('Text.\n\n```text\n@note this is code\n```')).body.includes('Callout'), 'a @note in code is code');
  eq(attr('attrs', "= '&lt;'"), " attrs=\"= '&amp;lt;'\"", 'an ampersand in a quoted attribute');

  // ---- plain text
  eq(plainText('Solver &mdash; &#x2014; &#128512; &amp;mdash; &#9999999;'), 'Solver — — \u{1F600} &mdash; �', 'character references in plain text');
  eq(plainText('Don\\`t call `foo` twice[^1].'), 'Don`t call foo twice.', 'escaped backticks and footnote marks');

  // ---- URLs, entities and HTML in Doxygen text
  {
    const d = renderDoc(block('\\brief Uses LU, see https://en.wikipedia.org/wiki/LU_decomposition for details.', 'before'));
    ok(d.summary.includes('](https://en.wikipedia.org/wiki/LU_decomposition)'), 'a bare URL becomes a link, its href as written');
    const h = renderDoc(block("\\brief Returns 1 if x &lt; 0, else&nbsp;0; x<sup>2</sup><br>next, <a href='https://x.org'>here</a>.", 'before'));
    eq(h.summary, 'Returns 1 if x &lt; 0, else 0; x<sup>2</sup><br />next, [here](https://x.org).', 'Doxygen entities, phrasing tags and links');
    const c = renderDoc(block('\\brief Commands.\n\\pre x is set\n\\li first\n\\li second\n\\callgraph\nUse \\c .true. or \\b (optional).', 'before'));
    ok(c.body.includes('**Precondition:** x is set') && c.body.includes('- first\n- second') && !c.body.includes('callgraph') && c.body.includes('`.true.`'), 'Doxygen \\pre, \\li, \\callgraph and \\c .true.');
    const md = renderDoc(block('\\brief Markdown in Doxygen.\n\n```fortran\ncall solve(a, b)\n```\n- item one\n- item two\n\nThis is **important**, but A**T and B**H are not.', 'before'));
    ok(md.body.includes('```f90\ncall solve(a, b)\n```') && md.body.includes('- item one\n- item two') && md.body.includes('This is **important**, but A\\*\\*T and B\\*\\*H'), "Doxygen's Markdown: fences, lists and emphasis, but not LAPACK's exponents");
  }

  // ---- footnotes and link definitions stay with their doc
  {
    const d = renderDoc(block('First[^1] and [docs].\n\n[^1]: A note.\n\n[docs]: https://x.org'), { ns: 'n4' });
    ok(d.body.includes('First[^n4-1]') && d.body.includes('[^n4-1]: A note.') && d.body.includes('[docs][n4-docs]') && d.body.includes('[n4-docs]: https://x.org'), 'labels take the namespace');
  }
  {
    const ir = parseSource('module m\n  integer :: a\n  !! doc for a\n  !> doc for b\n  integer :: b\nend module\n', { root: out });
    const docs = (id) => ir.entities[id].doc?.blocks.map((b) => b.lines.join('|'));
    eq([docs('module:m/variable:a'), docs('module:m/variable:b')], [[' doc for a'], [' doc for b']], 'a `!>` line after a `!!` block documents the next item');
    const meta = renderDoc(block('  author: A. Person\n  version: experimental\n\nThe text.'));
    eq([meta.meta, meta.summary], [{ author: 'A. Person', version: 'experimental' }, 'The text.'], 'indented FORD metadata');
    const joined = renderDoc([{ dir: 'after', line: 3, lines: [' the vector'], inline: true }, { dir: 'after', line: 4, lines: [' of values, continued.'] }]);
    eq(joined.body, 'the vector\nof values, continued.', 'a trailing doc continued on the next line is one paragraph');
  }

  // ---- FORD
  {
    const d = renderDoc(block('author: A. Person\ndate: 2026\n\nThe module, with \\( A x = b \\).\n\n@note\nA note.\n@endnote\n\nSee [[dense_matrix]] and [[other]].'), { resolve: (n) => (n === 'dense_matrix' ? '/x#dense_matrix' : null) });
    eq(d.style, 'ford', 'FORD style');
    eq(d.meta, { author: 'A. Person', date: '2026' }, 'FORD metadata');
    ok(d.body.includes('$A x = b$'), 'FORD inline maths');
    ok(d.body.includes('<Callout type="info" title="Note">\n\nA note.\n\n</Callout>'), '@note becomes a Callout');
    ok(d.body.includes('[`dense_matrix`](/x#dense_matrix)') && d.body.includes('`other`'), '[[links]] resolve, or become code');
    eq(d.summary, 'The module, with $A x = b$.', 'summary is the first paragraph');
    ok(d.body.includes('<small>Author: A. Person · Date: 2026</small>'), 'metadata line');
  }
  {
    const d = renderDoc(block('deprecated: use solve2 instead\n\nOld solver.'));
    ok(d.deprecated && d.body.startsWith('<Callout type="warn" title="Deprecated">'), 'FORD deprecated');
    const bad = renderDoc(block('DEPRECATED: this is not metadata FORD can parse, so it stays text'));
    ok(bad.body.length > 0, 'a metadata-like line never throws the doc away');
  }

  // ---- Doxygen
  {
    const blocks = [
      { dir: 'before', line: 1, lines: [' @file x.f90', ' @brief The file.'] },
      { dir: 'before', line: 4, lines: [' @brief Eigenvalues with \\c zheevd.', ' @param[in,out] a the matrix', ' @param[out] w eigenvalues', ' @returns nothing', ' @note Careful.', ' @see zheevd', ' @author A. Person'] },
    ];
    const d = renderDoc(blocks);
    eq(d.style, 'doxygen', 'Doxygen style');
    eq(d.summary, 'Eigenvalues with `zheevd`.', 'brief, with \\c as code; the @file block is dropped');
    eq(d.params, { a: 'the matrix', w: 'eigenvalues' }, 'params');
    eq(d.paramIntents, { a: 'inout', w: 'out' }, 'param intents');
    eq(d.returns, 'nothing', 'returns');
    ok(d.body.includes('<Callout type="info" title="Note">') && d.body.includes('**See also:** `zheevd`'), 'note and see');
    eq(d.meta.author, 'A. Person', 'author');
    const blas = renderDoc(block('\\brief \\b DGEMM\n\n\\par Purpose:\n\\verbatim\n\n DGEMM  performs one of the matrix-matrix operations.\n\\endverbatim', 'before'), { name: 'DGEMM' });
    eq(blas.summary, 'DGEMM performs one of the matrix-matrix operations.', "BLAS's bare \\brief \\b NAME takes the first Purpose sentence");
  }

  // ---- LAPACK
  {
    const d = renderDoc(block([
      '\\brief <b> DGESV computes the solution to A * X = B</b>',
      '\\param[in] N',
      '\\verbatim',
      '         N is INTEGER',
      '         The order of the matrix A.  N >= 0.',
      '\\endverbatim',
      '\\param[out] INFO',
      '\\verbatim',
      '         INFO is INTEGER',
      '         = 0:  successful exit',
      '         < 0:  if INFO = -i, the i-th argument had an illegal value',
      '\\endverbatim',
      '\\ingroup gesv',
    ].join('\n'), 'before'));
    eq(d.style, 'lapack', 'LAPACK style');
    eq(d.summary, '**DGESV computes the solution to A \\* X = B**', '<b> brief, escaped');
    eq(d.params.n, 'The order of the matrix A. N &gt;= 0.', 'argument prose; a bare "N is INTEGER" line says nothing the row does not');
    eq(d.paramTypes, { n: 'INTEGER', info: 'INTEGER' }, 'argument types from "X is …"');
    ok(d.params.info.startsWith('```text\n= 0:  successful exit\n< 0:'), 'a laid-out list stays a text block');
    const cont = renderDoc(block('\\param[out] IPIV\n\\verbatim\n   IPIV is INTEGER array, dimension\n   (min(M,N))\n   The pivot indices.\n\\endverbatim', 'before'));
    eq(cont.params.ipiv, '*IPIV is INTEGER array, dimension (min(M,N)).*\n\nThe pivot indices.', 'a type line that runs on to the next line');
    const opts = renderDoc(block("\\param[in] TRANS\n\\verbatim\n   TRANS is CHARACTER*1\n   Specifies the operation:\n   = 'N':  A * X = B\n   = 'T':  A**T * X = B\n\\endverbatim", 'before'));
    ok(opts.params.trans.includes("```text\nSpecifies the operation:\n= 'N':  A * X = B\n= 'T':  A**T * X = B\n```"), 'an option list keeps its lines');
    const blas = renderDoc(block('\\brief \\b DSCAL\n\n\\par Purpose:\n\\verbatim\n\n DSCAL scales a vector by a constant.\n\\endverbatim', 'before'), { name: 'DSCAL' });
    eq([blas.summary, (blas.body.match(/DSCAL scales/g) ?? []).length], ['DSCAL scales a vector by a constant.', 1], 'a summary made from Purpose is not repeated in the body');
    eq(d.group, 'gesv', '\\ingroup');
  }

  // ---- generated pages as MDX reads them: checked where @mdx-js/mdx can be imported, skipped, with one line, where
  // it cannot (it is not a dependency of the package)
  let mdx = null;
  try {
    mdx = await import('@mdx-js/mdx');
  } catch {
    console.log('MDX checks skipped: @mdx-js/mdx is not installed');
  }
  if (mdx) {
    // argument docs that leave a fence open, at the top level and in a list item (as FORD nests lists): each fence
    // closes in its own row, and the tags after it stay tags
    const src = [
      'module fences',
      'contains',
      '  subroutine add(a, b, c)',
      '    !> the first',
      '    !>',
      '    !> ```fortran',
      '    !> a = 1',
      '    integer, intent(inout) :: a',
      '    !> the second',
      '    !>',
      '    !> - a list item',
      '    !>',
      '    !>     ```fortran',
      '    !>     b = 2',
      '    integer, intent(in) :: b',
      '    !> the third, after both',
      '    integer, intent(in) :: c',
      '  end subroutine add',
      'end module fences',
    ].join('\n');
    // a page's body; each row of it: its name, then the code blocks inside it; why it does not compile, or ''
    const bodyOf = (text, file) => {
      const page = buildPages(parseSource(text, { root: out, path: file })).pages
        .find((p) => p.path === file.replace(/\.f90$/, '.mdx')).mdx;
      return page.slice(page.indexOf('\n---\n', 4) + 5);
    };
    const rowsOf = (body) => {
      try {
        const tree = mdx.createProcessor().parse(body);
        return nodesOf(tree, (n) => n.type === 'mdxJsxFlowElement' && n.name === 'FortranArg').map((n) => [
          n.attributes.find((a) => a.name === 'name')?.value,
          ...nodesOf(n, (c) => c.type === 'code').map((c) => c.value),
        ]);
      } catch (e) {
        return e.message;
      }
    };
    const errorOf = async (body) => {
      try {
        await mdx.compile(body);
        return '';
      } catch (e) {
        return e.message;
      }
    };
    const body = bodyOf(src, 'fences.f90');
    eq(rowsOf(body), [['a', 'a = 1'], ['b', 'b = 2'], ['c']],
      'a fence a doc leaves open closes in its own row, in a list item or not');
    eq(await errorOf(body), '', 'and the page compiles');
    // a fence left open in a list item that the doc goes on after, at the margin: MDX ends the item there
    const after = bodyOf([
      'module after',
      'contains',
      '  subroutine add(a, b, c)',
      '    !> - a list item',
      '    !>',
      '    !>     ```fortran',
      '    !>     a = 1',
      '    !>',
      '    !> See also the notes.',
      '    integer, intent(inout) :: a',
      '    !> - one',
      '    !>',
      '    !>     ```fortran',
      '    !>     b = 2',
      '    !> - two',
      '    integer, intent(in) :: b',
      '    !> the third, after both',
      '    integer, intent(in) :: c',
      '  end subroutine add',
      'end module after',
    ].join('\n'), 'after.f90');
    eq(rowsOf(after), [['a', 'a = 1'], ['b', 'b = 2'], ['c']],
      'a fence left open in a list item that the doc goes on after closes in its row');
    eq(await errorOf(after), '', 'and that page compiles');
  }
}
