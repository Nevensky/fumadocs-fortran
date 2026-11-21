// Type declarations for fumadocs-fortran (hand-written; the package is plain JavaScript).

/** The intermediate model's version. Readers refuse a major version they do not know. */
export declare const IR_VERSION: string;

/** File extensions read by default, without the dot. */
export declare const EXTENSIONS: string[];

export interface ExtractOptions {
  /** The project folder; paths in the model are relative to it. Default: the current folder. */
  root?: string;
  /** Files and folders to read. Default: the root. */
  sources?: string[];
  /** Globs, relative to the root, of files and folders to skip. */
  exclude?: string[];
  /** File extensions to read, without dots. Default: {@link EXTENSIONS}. */
  extensions?: string[];
  cpp?: {
    /** Macros, as `-D` would define them: `{ _OPENMP: 1, USE_MPI: true, 'F(x)': 'x' }`. */
    macros?: Record<string, string | number | boolean>;
    /** Folders searched for `#include` and Fortran `include` files, after the including file's own folder. */
    includeDirs?: string[];
    /** Keep every `#if` branch instead of evaluating them (FORD's behaviour without preprocessing). */
    keepAllBranches?: boolean;
  };
  /** Read every file in one source form. */
  form?: 'free' | 'fixed';
  /** Extensions read as fixed form (FORD's `fixed_extensions`). */
  fixedExtensions?: string[];
  /** Extensions read as free form. */
  freeExtensions?: string[];
  /** Fixed-form line length: 72 (default), 132, or 0 for no limit. */
  fixedLength?: number;
  /** Doc-comment marks; an empty string switches one off. */
  marks?: Partial<Marks>;
}

export interface Marks {
  /** `!!` by default: documents the item before it. */
  docmark: string;
  /** `!>` by default: documents the item after it. */
  predocmark: string;
  /** `!*` by default: like docmark, and absorbs the plain comment lines that follow. */
  docmarkAlt: string;
  /** `!|` by default: like predocmark, and absorbs the plain comment lines that follow. */
  predocmarkAlt: string;
  /** `!<` by default (Doxygen): documents the item before it. */
  postmark: string;
}

export declare const DEFAULT_MARKS: Marks;

/** Reads every source and returns the model. */
export declare function extract(options?: ExtractOptions): Promise<FortranIR>;

/** Reads the given files and returns the model. `read` replaces reading from disk (for sources held in memory). */
export declare function extractFiles(files: string[], options?: ExtractOptions, read?: (file: string) => string): FortranIR;

/** Parses one in-memory source; `path` names it (default `input.f90`) and decides its form. */
export declare function parseSource(text: string, options?: ExtractOptions & { path?: string }): FortranIR;

/** Lists the Fortran sources under the given files and folders. */
export declare function discover(paths: string[], options?: { root?: string; extensions?: string[]; exclude?: string[] }): string[];

/** Reads a source as UTF-8, or Latin-1 when it is not valid UTF-8. */
export declare function readText(file: string): string;

/** Decides the source form from the text. */
export declare function detectForm(text: string, fallback?: 'free' | 'fixed'): 'free' | 'fixed';

/** The form an extension implies, or null when the text must decide (`.F`, `.fpp`). */
export declare function formFromPath(path: string, options?: { fixedExtensions?: string[]; freeExtensions?: string[] }): 'free' | 'fixed' | null;

/** The form of one file: the configured form, the extension's, or the text's. */
export declare function resolveForm(path: string, text: string, options?: { form?: 'free' | 'fixed'; fixedExtensions?: string[]; freeExtensions?: string[] }): 'free' | 'fixed';

/** Evaluates an integer constant expression of the C preprocessor. */
export declare function evaluate(expression: string): number;

/** Names the construct of a compiler directive. */
export declare function parseDirective(sentinel: string, text: string): { family: string; construct: string; end: boolean; clauses: string };

// ---------------------------------------------------------------- docs and pages

/** An entity's documentation, rendered as MDX-safe Markdown. */
export interface RenderedDoc {
  style: 'ford' | 'doxygen' | 'lapack' | 'none';
  /** The first paragraph. */
  summary: string;
  /** The whole documentation, summary included. */
  body: string;
  /** Argument docs from Doxygen's \param, by lower-case name. */
  params: Record<string, string>;
  /** The intents \param[in|out|in,out] states, by lower-case name. */
  paramIntents: Record<string, 'in' | 'out' | 'inout'>;
  /** The "X is DOUBLE PRECISION array, …" lines of LAPACK argument docs. */
  paramTypes: Record<string, string>;
  returns?: string;
  meta: Record<string, string>;
  /** Doxygen's \ingroup. */
  group?: string;
  deprecated?: boolean;
}

/** Renders the raw doc blocks of one entity in the style they were written in (FORD, Doxygen or LAPACK). */
export declare function renderDoc(blocks: DocBlock[] | undefined, options?: { resolve?: (name: string, child?: string) => string | null; style?: 'ford' | 'doxygen' | 'lapack'; name?: string; math?: 'katex' | 'code' }): RenderedDoc;

export interface PageOptions {
  /** The URL of the output folder. Default: `/docs/api`. */
  baseUrl?: string;
  /** The overview page's title. Default: "API reference". */
  title?: string;
  /** The overview page's description. */
  description?: string;
  /** The access levels to show. Default: public and protected, as FORD. */
  display?: Array<'public' | 'protected' | 'private'>;
  /** Links each entity to its lines: `url` like https://github.com/org/code, `rev` a branch, tag or commit, `root` the IR's root inside the repository. */
  repo?: { url: string; rev?: string; root?: string };
  /** Shown before file paths. */
  sourceRoot?: string;
  /** `katex` (default) writes $…$ for remark-math; `code` shows maths as code, for a site without remark-math. */
  math?: 'katex' | 'code';
  /** The output folder starts open in the sidebar. */
  defaultOpen?: boolean;
  /**
   * Reads FORD's `{!file!}` includes (`generate` reads them relative to the project root, and only from under it);
   * without it they are dropped.
   */
  include?: (file: string) => string | null;
  /** FORD's `|name|` aliases; a name not here stays as written. */
  aliases?: Record<string, string>;
  /**
   * Reads a source file, by its path in the model (relative to the project root), for the source blocks. `generate`
   * reads the files the model lists (the sources and the files they include) wherever they lie, and any other file
   * (one a `#line` marker names) only from under the root. Without it, entities only link to their lines.
   */
  readSource?: (file: string) => string | null;
  /**
   * `embed` (the default when `readSource` is given): each procedure, type, interface, variable and enum shows its
   * source lines in a collapsible block under it; `link`: only a link to them. Modules, submodules and programs only
   * ever link.
   */
  source?: 'embed' | 'link';
  /** The most lines an entity may span for its source to be embedded. Default: 400. */
  sourceMaxLines?: number;
  /**
   * The graphs, as ```` ```mermaid ```` blocks for fumadocs' `remarkMdxMermaid` (default on): each unit's
   * dependencies, each type's inheritance, each procedure's and generic's calls, and the overview's modules. `false`
   * leaves them out; an object sets how far they go and names the libraries of routines called by name. Without a
   * `classify`, the HPC registry's is used: BLAS (first), LAPACK, ScaLAPACK (with PBLAS, BLACS, its tools and REDIST),
   * MPI, OpenMP and OpenACC. A `classify` replaces it. A routine the project defines is the project's either way.
   */
  graphs?: boolean | Pick<GraphOptions, 'depth' | 'maxNodes' | 'classify'>;
}

export interface GraphOptions {
  /** The entity's page URL with its anchor; null for an entity without a heading (its node is not linked). */
  url?: (entity: Entity) => string | null;
  /**
   * The access filter: what it hides is not drawn, except what a page names anyway (a shown generic's specifics, a
   * shown binding's implementation, a type's ancestors). Default: every entity.
   */
  shown?: (entity: Entity) => boolean;
  /**
   * The library a routine called by name is from, by its lower-case name: a class such as `fdfLapack`, or a family
   * word such as `lapack`, `scalapack`, `blas` or `mpi`; null when the name is not known. It is asked only for names
   * the project does not define. MPI, OpenMP, OpenACC, CUDA (names starting with cuda, cublas, cufft, curand, cusparse
   * or cusolver), coarray collectives and BLAS are recognised without it; `buildPages` passes the HPC registry's, which
   * knows LAPACK and ScaLAPACK too, unless its `graphs` option gives one.
   */
  classify?: (name: string) => string | null;
  /**
   * The most nodes a graph draws, the "… N more" node included (default 40; below 2 counts as 2, the subject and
   * "… N more"); for the overview, the most units (default 80).
   */
  maxNodes?: number;
  /** How far uses and callees are followed (default 2). */
  depth?: number;
}

/** Mermaid flowchart source (without a fence) for one IR's graphs; each method returns null when there is no graph. */
export interface FortranGraphs {
  /** What a unit uses (to `depth`), the units that use it, and its submodules and parents. */
  dependencies(unit: Entity | string): string | null;
  /** The types a type extends, up to the root, and those that extend it. */
  inheritance(type: Entity | string): string | null;
  /** A procedure's callees (to `depth`) and callers; also a program's callees and a generic's specifics. */
  calls(procedure: Entity | string): string | null;
  /** Every module, submodule and program, and the HPC libraries they use; null past `maxNodes` units. */
  overview(): string | null;
}

/** The graphs of an IR, as Mermaid flowcharts whose node classes `fumadocs-fortran/style.css` colours. */
export declare function buildGraphs(ir: FortranIR, options?: GraphOptions): FortranGraphs;

export interface GeneratedPage {
  /** Relative to the output folder. */
  path: string;
  url: string;
  title: string;
  mdx: string;
}

/** The `fortran` field of a generated page's front matter (the overview page has none). */
export interface FortranFrontmatter {
  /** The unit's kind, or `procedures` for a page of external procedures. */
  kind: 'module' | 'submodule' | 'program' | 'blockdata' | 'procedures';
  /** What each `###` heading is, by its anchor (without `#`): for `fortranToc()` from `fumadocs-fortran/react`. */
  toc: Record<string, 'type' | 'interface' | 'subroutine' | 'function' | 'variable' | 'parameter' | 'enum'>;
}

/**
 * Builds the pages and sidebar files for an IR.
 *
 * Names from the HPC libraries carry hover cards from the package's registry (`registry/`, read the first time a
 * page needs it; when it cannot be read, the names are shown without cards, and the graphs colour only what names
 * tell, as `GraphOptions.classify` lists, leaving LAPACK and ScaLAPACK grey):
 * - in "Calls:" lines, a library subroutine the project does not define (no procedure, generic interface or variable
 *   of the name, shown or not, no dummy argument in scope, and no procedure pointer the caller declares through which
 *   every call of the name goes, `Call.local`; an explicit interface that only describes the routine, when it has no
 *   heading to link to, does not count) is a `FortranRef` with a title such as
 *   `subroutine MPI_Allreduce (MPI)`, the registry's summary where it has one, and a link where there is one: Netlib
 *   for BLAS, LAPACK and ScaLAPACK (Intel oneMKL's pages when the code uses MKL's modules: lapack95, blas95,
 *   f95_precision, mkl_*), Open MPI 5.0's manual (its development manual for a procedure 5.0 lacks), the OpenMP 5.2
 *   specification (a later one for a routine 5.2 lacks), the OpenACC 3.4 specification, and fortran-lang.org for an
 *   intrinsic subroutine (gfortran's manual for random_init and split; tokenize and MPI's predefined callbacks have
 *   no page, and their cards no href). A routine renamed by a use statement is looked up by its own name.
 *   A CALL of a function's name, or of an intrinsic's name that another module's use statement gives, is some other
 *   subroutine and has no card; the project's procedures keep their links;
 * - in argument, result and component rows, mpi_f08's derived types (`type(MPI_Comm)`, `MPI_Status`, …) and omp_lib's
 *   kinds (`integer(omp_lock_kind)`) have cards when the declaration's scope sees the module (use, only, renames, host
 *   association, and through the project's modules; `use, intrinsic :: omp_lib` too, as gfortran keeps its OpenMP
 *   modules with the intrinsic ones): the registry's line on the name, the MPI 5.0 standard or the
 *   OpenMP specification, and the use statement it comes from. A project entity of the name wins; `use mpi`, whose
 *   handles are integers, gives none.
 *
 * A type parameter's row reads as its declaration: the type `integer, kind` (or `integer, len`) and one attribute,
 * `default dp`, for `integer, kind :: k = dp`.
 */
export declare function buildPages(ir: FortranIR, options?: PageOptions): { pages: GeneratedPage[]; metas: Array<{ path: string; data: { title: string; pages: string[] } }> };

/** Writes pages into a content folder; a manifest lets later runs delete only their own stale files. */
export declare function writePages(result: { pages: GeneratedPage[]; metas: Array<{ path: string; data: object }> }, outDir: string): { written: string[]; changed: string[]; removed: string[] };

/**
 * Reads the sources, builds the pages and writes them into `out`. Without `readSource`, the source blocks are read from
 * the files the model lists (the sources and the files they include) wherever they lie, and from any other file only
 * under the root; without `include`, FORD's `{!file!}` includes are read from under the root only.
 */
export declare function generate(options: ExtractOptions & PageOptions & { out: string }): Promise<{ ir: FortranIR; pages: GeneratedPage[]; written: string[]; changed: string[]; removed: string[] }>;

/** The anchor of an entity on its page: its lower-case name; operators get fixed slugs such as `operator-plus`. */
export declare function anchorOf(entity: Pick<Entity, 'name' | 'kind' | 'id'>): string;

/** A type as written, with a blank after each top-level comma. */
export declare function prettyType(type: FortranType | null | undefined): string | undefined;

/** cpp conditions as words: `defined(USE_MPI)` reads as USE_MPI. */
export declare function prettyCond(conditions: string[]): string;

/** KaTeX macros for the commands Fortran docs write that KaTeX lacks, and TeX that KaTeX renders. */
export { katexMacros, normaliseTex } from './math.js';

/** Escapes plain text (Doxygen and LAPACK prose) for MDX. */
export declare function escapeText(text: string): string;

/** Makes Markdown safe for MDX while keeping it Markdown. */
export declare function safeMarkdown(markdown: string): string;

// ---------------------------------------------------------------- the model

export interface FortranIR {
  irVersion: string;
  generator: { name: string; version: string };
  options?: { macros?: Record<string, string | number | boolean>; keepAllBranches?: boolean };
  files: SourceFile[];
  /** Every entity under its ID, in source order. */
  entities: Record<string, Entity>;
  diagnostics: Diagnostic[];
}

export interface SourceFile {
  path: string;
  form?: 'free' | 'fixed';
  lines?: number;
  /** The file has preprocessor directives. */
  cpp?: boolean;
  includes?: string[];
  /** Lines in `#if` branches that are switched off. */
  inactiveLines?: number;
  /** Why the file was not parsed, such as `fypp`. */
  skipped?: string;
  directives?: Directive[];
}

export interface Diagnostic {
  code: string;
  severity: 'error' | 'warning' | 'info';
  file: string;
  line: number;
  message: string;
}

export type EntityKind =
  | 'module' | 'submodule' | 'program' | 'blockdata' | 'procedure' | 'interface' | 'type' | 'component' | 'binding'
  | 'variable' | 'enum';

export interface FortranType {
  /** integer, real, complex, logical, character, double precision, double complex, byte, type, class, procedure, typeof, classof */
  base: string;
  /** The kind as written (`dp`, `c_int`, `8`), or the derived type, or the procedure's interface. */
  kind: string | null;
  /** The character length (`*`, `:`, `10`), the one written after the name when there is one. */
  len: string | null;
  /** The type parameters of a parameterised derived type: `k=dp,kl=*` in `class(banded_matrix(k=dp,kl=*))`. */
  params?: string;
  /**
   * The type specification as written, without blanks: `real(dp)`, `character(len=*)`. A length written after the
   * name is the type's, written as Fortran would declare the entity alone: after the type for `character` and
   * `character*…` (`character*(*)` for `character :: a*(*)`, `character*(n)`, `character*10`, and `character*16` for
   * `character*8 :: e*16`), and in the selector, with its kind, for a type that has one (`character(len=20)` for
   * `character(len=10) :: d*20`, `character(len=n,kind=ucs4)` for `character(kind=ucs4) :: d*(n)`).
   */
  text: string;
  /** Typed by the implicit rules, not declared. */
  implicit?: boolean;
}

export interface DocBlock {
  /** Which way the block points: it documents the item after it (`!>`) or before it (`!!`, `!<`). */
  dir: 'before' | 'after';
  line: number;
  /** The last line, when the block spans more than one (lines cpp removed may lie inside it). */
  end?: number;
  /** The comment lines after their mark, unprocessed. */
  lines: string[];
  /** A comment trailing the statement on its own line. */
  inline?: boolean;
}

export interface Doc {
  blocks: DocBlock[];
}

export interface Variable {
  name: string;
  type?: FortranType | null;
  intent?: 'in' | 'out' | 'inout';
  optional?: boolean;
  value?: boolean;
  dims?: string[];
  codims?: string[];
  init?: string;
  pointerInit?: boolean;
  /** Other attributes as written: pointer, allocatable, target, contiguous, … */
  attrs?: string[];
  /** The cpp conditions it sits under, when they differ from its procedure's. */
  cond?: string[];
  doc?: Doc;
}

export interface Use {
  module: string;
  line: number;
  nature?: 'intrinsic' | 'non_intrinsic';
  only?: Array<{ name: string; local?: string }>;
  renames?: Array<{ name: string; local?: string }>;
  cond?: string[];
}

export interface Call {
  name: string;
  line: number;
  cond?: string[];
  /**
   * The call goes through a procedure pointer the caller declares: in a BLOCK construct, in its own specification part
   * or in its host's (`procedure(i), pointer :: dgemm`, or POINTER with EXTERNAL, `procedure(i)` or an interface
   * body). It calls the project's target, not the routine of that name, so it gets no library card and the call graph
   * draws nothing for it.
   */
  local?: true;
}

export interface Directive {
  /** omp, acc, cuf, cond (an OpenMP `!$` line), or vendor */
  family: string;
  /** `parallel do`, `declare target`, `routine`, … */
  construct: string;
  line: number;
  lineEnd?: number;
  end?: boolean;
  clauses?: string;
  sentinel?: string;
  cond?: string[];
}

export interface Entity {
  id: string;
  kind: EntityKind;
  /** As spelled in the source; empty for unnamed interfaces, enums and main programs. */
  name: string;
  parent?: string;
  children?: string[];
  file: string;
  line: number;
  lineEnd?: number;
  /** The cpp conditions it sits under, such as `defined(USE_MPI)`. */
  cond?: string[];
  access?: 'public' | 'private';
  doc?: Doc;

  // procedures
  proc?: 'subroutine' | 'function' | 'procedure';
  /** external, module, internal, interface (an interface body), or separate (a separate module procedure) */
  scope?: 'external' | 'module' | 'internal' | 'interface' | 'separate';
  prefix?: string[];
  bind?: string;
  /** Absent for a separate module procedure that takes its arguments from its interface. */
  args?: Variable[];
  result?: Variable;
  separate?: boolean;
  uses?: Use[];
  calls?: Call[];
  /**
   * Names referenced with parentheses that are not local arrays: candidate procedure references. A reference through
   * components, such as a type-bound function's `a%b%f(…)`, is kept as its path, `a%b%f`.
   */
  refs?: string[];
  hpc?: { directives?: Directive[]; coarray?: boolean };
  commons?: Array<{ name: string; members: string[]; line: number }>;
  namelists?: Array<{ name: string; members: string[]; line: number }>;

  // interfaces
  ikind?: 'generic' | 'operator' | 'assignment' | 'dtio' | 'abstract' | 'explicit';
  procedures?: string[];

  // types
  extends?: string;
  abstract?: boolean;
  params?: Array<Variable & { attr?: 'kind' | 'len' }>;
  finals?: string[];
  sequence?: boolean;

  // bindings
  binding?: 'procedure' | 'generic';
  impl?: string;
  iface?: string;
  deferred?: boolean;
  nopass?: boolean;
  pass?: string | true;

  // submodules
  ancestor?: string;
  parentSubmodule?: string;

  // variables and components
  type?: FortranType | null;
  dims?: string[];
  codims?: string[];
  init?: string;
  parameter?: boolean;
  attrs?: string[];

  // enums
  enumerators?: Array<{ name: string; init?: string; access?: 'public' | 'private'; doc?: Doc }>;
}
