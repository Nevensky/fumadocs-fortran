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
  /** The character length (`*`, `:`, `10`). */
  len: string | null;
  /** The type parameters of a parameterised derived type: `k=dp,kl=*` in `class(banded_matrix(k=dp,kl=*))`. */
  params?: string;
  /** The type specification as written, without blanks: `real(dp)`, `character(len=*)`. */
  text: string;
  /** Typed by the implicit rules, not declared. */
  implicit?: boolean;
}

export interface DocBlock {
  /** Which way the block points: it documents the item after it (`!>`) or before it (`!!`, `!<`). */
  dir: 'before' | 'after';
  line: number;
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
  /** Names referenced with parentheses that are not local arrays: candidate procedure references. */
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
