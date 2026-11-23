import 'server-only';
import defaultMdxComponents from 'fumadocs-ui/mdx';
import { Accordion, Accordions } from 'fumadocs-ui/components/accordion';
import { File, Files, Folder } from 'fumadocs-ui/components/files';
import { Step, Steps } from 'fumadocs-ui/components/steps';
import { Tab, Tabs } from 'fumadocs-ui/components/tabs';
import { TypeTable } from 'fumadocs-ui/components/type-table';
import type { MDXComponents } from 'mdx/types';
import { createFortranComponents } from 'fumadocs-fortran/react';
import { Mermaid } from 'fumadocs-fortran/mermaid';
import { siteHref } from '@/lib/shared';

// fumadocs-fortran's components and its Mermaid, with their links to the site's pages as next/link writes them
// (siteHref): the base path the site is served under (GitHub Pages) and, in the static export, a page's trailing
// slash, without which a hover card's link to an anchor of the page being read reloads the page. Plain <a>s, which
// next/link never sees; Markdown links go through next/link. Server only, as the trailing slash depends on
// DOCS_EXPORT, which the browser's bundle does not have.
const fortranMdxComponents = createFortranComponents({ href: siteHref });

export function getMDXComponents(components?: MDXComponents) {
  return {
    ...defaultMdxComponents,
    Accordion,
    Accordions,
    File,
    Files,
    Folder,
    Step,
    Steps,
    Tab,
    Tabs,
    TypeTable,
    // ```mermaid blocks, which remarkMdxMermaid (withFortran's graphs) turns into <Mermaid chart="…" />: the API
    // reference's graphs and the pages' own diagrams, drawn by Pele at build time, with a second layout for phones
    Mermaid: (props: { chart: string }) => <Mermaid {...props} href={siteHref} narrow={320} />,
    // FortranBadges, FortranBadge, FortranArgs, FortranArg, FortranRef, FortranSource and FortranGraph, which the
    // generated pages use
    ...fortranMdxComponents,
    ...components,
  } satisfies MDXComponents;
}

export const useMDXComponents = getMDXComponents;

declare global {
  type MDXProvidedComponents = ReturnType<typeof getMDXComponents>;
}
