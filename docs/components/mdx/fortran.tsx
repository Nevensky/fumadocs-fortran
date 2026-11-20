import 'server-only';
import type { ComponentProps } from 'react';
import {
  FortranArg,
  FortranRef,
  FortranSource,
  fortranComponents,
  type FortranArgProps,
} from 'fumadocs-fortran/react';
import { siteHref } from '@/lib/shared';

/**
 * fumadocs-fortran's components, for this site's MDX. Their links are plain <a>s, which next/link never sees, so the
 * links among them that stay on the site get here what next/link would give them (siteHref): the base path the site
 * is served under (GitHub Pages) and, in the static export, a page's trailing slash, without which a hover card's link
 * to an anchor of the page being read reloads the page. mermaid.tsx does the same for the graphs' links; Markdown
 * links go through next/link. Server only, as siteHref reads the build's environment.
 */
export const fortranMdxComponents = {
  ...fortranComponents,
  FortranArg: (props: ComponentProps<typeof FortranArg>) => <FortranArg {...props} refs={siteRefs(props.refs)} />,
  FortranRef: (props: ComponentProps<typeof FortranRef>) => <FortranRef {...props} href={siteHref(props.href)} />,
  FortranSource: (props: ComponentProps<typeof FortranSource>) => (
    <FortranSource {...props} href={siteHref(props.href)} />
  ),
};

/** A row's refs with siteHref's links: an object, as generated, or JSON text, which FortranArg reads too. */
function siteRefs(refs: unknown): FortranArgProps['refs'] {
  let r = refs;
  if (typeof r === 'string') {
    try {
      r = JSON.parse(r);
    } catch {
      // FortranArg ignores text that is not JSON as well
      return undefined;
    }
  }
  if (!r || typeof r !== 'object' || Array.isArray(r)) return undefined;
  return Object.fromEntries(
    Object.entries(r).map(([name, ref]) => [
      name,
      ref && typeof ref === 'object' && typeof ref.href === 'string' ? { ...ref, href: siteHref(ref.href) } : ref,
    ]),
  );
}
