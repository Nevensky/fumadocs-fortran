// fumadocs-fortran/mermaid: the Mermaid component, which draws a ```mermaid block as SVG with Pele where the page
// renders, on the server for a Fumadocs site's MDX pages, so no script reaches the browser. fumadocs-core's
// remarkMdxMermaid (withFortran's `graphs`) turns each block into <Mermaid chart="…" />. It needs pele, which the site
// installs. Like the components of fumadocs-fortran/react: no state, effects or context and no 'use client'.

import { createElement as h, useId } from 'react';
import { render } from 'pele';

// the links of a diagram's nodes that go to a page of the site: an href attribute whose value starts with one /
const SITE_LINK = /(<a\b[^>]*?\shref=")(\/(?!\/)[^"]*)"/g;

const withLinks = (svg, href) => (typeof href === 'function'
  ? svg.replace(SITE_LINK, (_, start, link) => `${start}${escapeAttr(href(link))}"`)
  : svg);

const escapeAttr = (s) => String(s).replace(/&(?!(?:[a-z]+|#\d+|#x[\da-f]+);)/gi, '&amp;').replace(/"/g, '&quot;')
  .replace(/</g, '&lt;');

/**
 * A diagram, in a block that scrolls when it is wider than the column. `href` rewrites the links of its nodes that go
 * to a page of the site, such as for the base path it is served under. `narrow`, a width in pixels, draws a second
 * layout of at most that width, which shows where the column is under 600px wide. A diagram Pele cannot draw shows as
 * its code, rather than failing the page.
 */
export function Mermaid({ chart, href, narrow }) {
  // before any return: a hook runs on every render
  const id = useId();
  const code = typeof chart === 'string' ? chart : String(chart ?? '');
  try {
    const wide = render(code, { idPrefix: id });
    const max = Number(narrow);
    const small = max > 0 ? render(code, { idPrefix: `${id}narrow`, maxWidth: max }) : null;
    // not-prose: prose's link style would underline the labels of the nodes that link
    if (!small || small.width >= wide.width) {
      return h('div', {
        className: 'fdf-mermaid not-prose', dangerouslySetInnerHTML: { __html: withLinks(wide.svg, href) },
      });
    }
    return h('div', { className: 'fdf-mermaid fdf-mermaid-two not-prose' },
      h('div', { className: 'fdf-mermaid-wide', dangerouslySetInnerHTML: { __html: withLinks(wide.svg, href) } }),
      h('div', { className: 'fdf-mermaid-narrow', dangerouslySetInnerHTML: { __html: withLinks(small.svg, href) } }));
  } catch {
    return h('figure', { className: 'fdf-mermaid-code not-prose' },
      h('figcaption', null, 'Mermaid'),
      h('pre', null, h('code', null, code)));
  }
}
