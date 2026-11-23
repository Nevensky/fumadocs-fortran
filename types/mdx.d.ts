// fumadocs-fortran/mdx. Typed without fumadocs' and unified's types, so that it fits any version of them: the options
// are those of fumadocs-mdx's applyMdxPreset, and the schema a Standard Schema, as fumadocs-mdx takes a collection's.

import type { FortranFrontmatter } from './index.js';
import type { FortranLanguageOptions } from './shiki.js';

/** What withFortran adds to the site's options: maths and graphs, which the pages can have, and the grammars'. */
export interface FortranMdxOptions {
  /**
   * Maths: the default exports of remark-math and rehype-katex, which the site installs, for the $…$ and $$…$$ of the
   * pages. KaTeX runs before fumadocs' code blocks, with katexMacros under the macros of the site's own options (as
   * `rehypeKatex: [rehypeKatex, { macros }]`, or a rehype-katex in the site's own rehypePlugins, which moves first).
   */
  math?: { remarkMath: Pluggable; rehypeKatex: Pluggable };
  /**
   * Graphs: fumadocs-core's remarkMdxMermaid, which turns each ```mermaid block into `<Mermaid chart="…" />`, so the
   * site registers the Mermaid component of fumadocs-fortran/mermaid. Default false.
   */
  graphs?: boolean;
  /**
   * The options of the Fortran grammars in the code blocks, as getFortranLanguages takes them: `fixedLineLength: 132`
   * for fixed form compiled with -ffixed-line-length-132, and the directives and fypp switched off. Default: theirs.
   */
  grammars?: FortranLanguageOptions;
}

/**
 * The MDX options for fumadocs-mdx's applyMdxPreset (a collection's mdxOptions) or defineConfig's mdxOptions: the
 * site's own options, with the Fortran grammars and transformers added to fumadocs' code blocks (rehypeCodeOptions,
 * on fumadocs' defaults), the components' text, rather than their tags, in the search records (the filterElement of
 * remarkStructureOptions), and, on request, maths and graphs.
 */
export declare function withFortran<T extends object = {}>(options?: T & FortranMdxOptions): MdxOptions<T>;

/**
 * A page schema that validates as `base` does and keeps the `fortran` field of the generated pages, which a schema
 * such as fumadocs' pageSchema drops: `schema: fortranPageSchema(pageSchema)`. `base` is any Standard Schema (Zod,
 * Valibot, ArkType, …); extend it first, as the result is no Zod schema.
 */
export declare function fortranPageSchema<S extends StandardSchema<any, any>>(base: S): PageSchema<S>;

/** A remark or rehype plugin, or a plugin with its options. */
type Pluggable = ((...args: any[]) => any) | [(...args: any[]) => any, ...any[]];

/** The site's options with withFortran's: those it sets, typed loosely, as applyMdxPreset takes them. */
type MdxOptions<T> = Omit<T, 'math' | 'graphs' | 'grammars'> & {
  remarkPlugins?: any;
  rehypePlugins?: any;
  rehypeCodeOptions?: any;
  remarkStructureOptions?: any;
};

/** A Standard Schema (https://standardschema.dev), as fumadocs-mdx takes a collection's schema. */
interface StandardSchema<Input, Output> {
  readonly '~standard': {
    readonly version: 1;
    readonly vendor: string;
    readonly validate: (value: unknown) => SchemaResult<Output> | Promise<SchemaResult<Output>>;
    readonly types?: { readonly input: Input; readonly output: Output } | undefined;
  };
}

type SchemaResult<Output> =
  | { readonly value: Output; readonly issues?: undefined }
  | {
    readonly issues: ReadonlyArray<{
      readonly message: string;
      readonly path?: ReadonlyArray<PropertyKey | { readonly key: PropertyKey }> | undefined;
    }>;
  };

/** The schema with the `fortran` field: what the page data has. */
type PageSchema<S> = S extends StandardSchema<infer I, infer O>
  ? StandardSchema<I & { fortran?: FortranFrontmatter }, O & { fortran?: FortranFrontmatter }>
  : never;

// only what is exported above is public
export {};
