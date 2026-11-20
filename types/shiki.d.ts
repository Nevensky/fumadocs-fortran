// fumadocs-fortran/shiki. Typed loosely, so that it fits any Shiki and fumadocs version without depending on their
// types: the grammars are Shiki LanguageRegistrations, the transformers ShikiTransformers.

/** A grammar as Shiki registers it. */
export interface FortranLanguage {
  name: string;
  scopeName: string;
  displayName?: string;
  aliases?: string[];
  embeddedLangs?: string[];
  embeddedLangsLazy?: string[];
  patterns: any[];
  repository: Record<string, any>;
  injections?: Record<string, any>;
  [key: string]: any;
}

export interface FortranLanguageOptions {
  /**
   * Where fixed-form lines end: 72 (the default), 132, or false for no limit. Text after it is a comment, as compilers
   * ignore it (sequence numbers in columns 73 to 80).
   */
  fixedLineLength?: number | false;
  /** Highlight OpenMP, OpenACC, CUDA Fortran and compiler directives, and !$ lines (default true). */
  directives?: boolean;
  /** Highlight fypp's directives and ${…}$ (default true). */
  fypp?: boolean;
}

/** A Shiki transformer. */
export interface FortranTransformer {
  name: string;
  [hook: string]: any;
}

/**
 * The grammars, with the defaults of getFortranLanguages(): free form (`fortran`, also `fortran-free-form`, `f90` to
 * `f23`, `fpp` and `fypp`), fixed form (`fortran-fixed`, also `fortran-fixed-form`, `f`, `for`, `f77` and `ftn`),
 * and the directive and fypp grammars they bring in. Load them together.
 */
export const fortranLanguages: FortranLanguage[];

/** The grammars with other options, for `createHighlighter({ langs })` and the like. */
export function getFortranLanguages(options?: FortranLanguageOptions): FortranLanguage[];

/**
 * Options for fumadocs' rehypeCode, for fumadocs-mdx's `applyMdxPreset({ rehypeCodeOptions })`: `base` with the
 * grammars added to its `langs` and the two transformers to its `transformers`. Pass `rehypeCodeDefaultOptions` (from
 * fumadocs-core/mdx-plugins) or your own options as `base`, since rehypeCode replaces its default transformers with
 * the ones given.
 */
export function fortranRehypeCode<T extends object = {}>(
  base?: T,
  options?: FortranLanguageOptions,
): WithoutKeys<T, 'langs' | 'transformers'> & { langs: any[]; transformers: any[] };

/**
 * Omit for each member of a union: fumadocs' RehypeCodeOptions is one (a single theme or several), and a plain Omit
 * keeps only the keys its members share, which leaves out `theme` and `themes`.
 */
type WithoutKeys<T, K extends PropertyKey> = T extends unknown ? Omit<T, K> : never;

/**
 * fumadocs' code notations in Fortran comments: `! [!code highlight]`, `[!code focus]`, `[!code ++]`, `[!code --]`
 * and `[!code word:name]`, each with an optional `:n`, and `C`, `c` or `*` comment lines in fixed form. Shiki's own
 * notation transformers do not know `!` comments.
 */
export function transformerFortranNotation(): FortranTransformer;

/**
 * Marks directive lines for a stylesheet: the line gets `className` (default `fdf-directive`), the HPC tone of
 * fumadocs-fortran's style.css (`fdf-kind-omp`, `fdf-kind-acc` or `fdf-kind-cuda`) and `data-directive` (`openmp`,
 * `openacc`, `cuf`, `conditional` for `!$` and `!@cuf` lines, or `compiler` for `!dir$` and its kin).
 */
export function transformerFortranDirectives(options?: { className?: string }): FortranTransformer;

// only what is exported above is public (without this, a declaration file exports WithoutKeys too)
export {};
