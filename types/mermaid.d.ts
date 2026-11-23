import type { ReactElement } from 'react';

export interface MermaidProps {
  /** The diagram, as Mermaid writes it: the ```mermaid block's text, which remarkMdxMermaid passes. */
  chart: string;
  /**
   * Rewrites each link of the diagram's nodes that goes to a page of the site (a path that starts with one /), such
   * as for the base path the site is served under; the other links stay as they are.
   */
  href?: (link: string) => string;
  /**
   * A second layout, of at most this many pixels across, which shows where the column is under 600px wide, for phones.
   * Default: none, one layout.
   */
  narrow?: number;
}

/**
 * A ```mermaid block drawn as SVG by Pele (which the site installs) where the page renders, in fumadocs' fonts and
 * colours; a diagram Pele cannot draw shows as its code. Register it as `Mermaid` among the MDX components.
 */
export declare function Mermaid(props: MermaidProps): ReactElement;
