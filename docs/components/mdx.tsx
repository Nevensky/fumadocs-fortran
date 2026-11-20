import defaultMdxComponents from 'fumadocs-ui/mdx';
import { Accordion, Accordions } from 'fumadocs-ui/components/accordion';
import { File, Files, Folder } from 'fumadocs-ui/components/files';
import { Step, Steps } from 'fumadocs-ui/components/steps';
import { Tab, Tabs } from 'fumadocs-ui/components/tabs';
import { TypeTable } from 'fumadocs-ui/components/type-table';
import type { MDXComponents } from 'mdx/types';
import { fortranMdxComponents } from '@/components/mdx/fortran';
import { Mermaid } from '@/components/mdx/mermaid';

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
    // ```mermaid blocks, which remarkMdxMermaid turns into <Mermaid chart="…" /> (the API reference's graphs)
    Mermaid,
    // FortranBadges, FortranBadge, FortranArgs, FortranArg, FortranRef, FortranSource and FortranGraph, which the
    // generated pages use, with their links to the site as next/link writes them (base path, the export's slash)
    ...fortranMdxComponents,
    ...components,
  } satisfies MDXComponents;
}

export const useMDXComponents = getMDXComponents;

declare global {
  type MDXProvidedComponents = ReturnType<typeof getMDXComponents>;
}
