import 'server-only';
import { useId } from 'react';
import { CodeBlock, Pre } from 'fumadocs-ui/components/codeblock';
import { render } from 'pele';
import { siteHref } from '@/lib/shared';

/**
 * A ```mermaid block (the API reference's dependency, call and inheritance graphs), drawn as SVG at build time by
 * Pele: no client JavaScript, and colours that are CSS variables, so a diagram follows the light and dark themes.
 * fumadocs-fortran's style.css maps Pele's variables to fumadocs' colours for the generated graphs and colours their
 * kinds of node; global.css does the mapping for the diagrams written in pages. A diagram Pele cannot draw is shown as
 * its code, rather than failing the page's build.
 */
export function Mermaid({ chart }: { chart: string }) {
  const id = useId();
  try {
    const wide = render(chart, { idPrefix: id });
    // a second layout for phones; the container query shows the one that fits
    const narrow = render(chart, { idPrefix: `${id}narrow`, maxWidth: 320 });
    // not-prose: prose's link styles would underline the labels of the nodes that link
    if (narrow.width >= wide.width) {
      return <div className="docs-mermaid not-prose" dangerouslySetInnerHTML={{ __html: withSiteLinks(wide.svg) }} />;
    }
    return (
      <div className="docs-mermaid not-prose @container">
        <div className="@max-[600px]:hidden" dangerouslySetInnerHTML={{ __html: withSiteLinks(wide.svg) }} />
        <div className="@min-[600px]:hidden" dangerouslySetInnerHTML={{ __html: withSiteLinks(narrow.svg) }} />
      </div>
    );
  } catch {
    return (
      <CodeBlock title="Mermaid">
        <Pre>{chart}</Pre>
      </CodeBlock>
    );
  }
}

// Pele writes a diagram's click links as plain hrefs, which next/link never sees, so they get here what next/link would
// give them: the base path the site is served under (GitHub Pages) and, in the static export, a page's trailing slash.
function withSiteLinks(svg: string) {
  return svg.replace(/(<a\b[^>]*?\shref=")([^"]*)"/g, (_, start: string, href: string) => `${start}${siteHref(href)}"`);
}
