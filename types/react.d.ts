import type { ReactElement, ReactNode } from 'react';

/**
 * Badge kinds with a label of their own. Kinds of entity are filled; HPC models and libraries (omp to cpp) have a
 * colour each, set by the `--fdf-<kind>` variables in style.css; the rest are neutral.
 */
export type FortranBadgeKind =
  | 'module' | 'submodule' | 'program' | 'subroutine' | 'function' | 'type' | 'interface'
  | 'omp' | 'acc' | 'offload' | 'mpi' | 'coarray' | 'cuda' | 'blas' | 'lapack' | 'scalapack' | 'cpp'
  | 'bindc' | 'pure' | 'elemental' | 'recursive' | 'abstract' | 'deferred' | 'private' | 'public' | 'deprecated';

export interface FortranBadgeProps {
  /** A kind above, or any other string, which is shown as written in the neutral style. */
  kind: FortranBadgeKind | (string & {});
  /** Replaces the kind's label, such as 'OpenMP parallel region' for omp. */
  label?: string;
  /** A cpp condition, such as 'USE_MPI': the badge is dashed and adds "when USE_MPI". */
  conditional?: string;
  /** Hover text. By default a terse label's expansion (offload, MPI, BLAS, LAPACK, ScaLAPACK, cpp, bind(C)). */
  title?: string;
}

export interface FortranArgsProps {
  /** The list's title. Default 'Arguments'; an empty string leaves it out. */
  title?: string;
  /** FortranArg rows. */
  children?: ReactNode;
}

export interface FortranArgProps {
  name: string;
  /** The type, as declared: 'real(dp)', 'type(MPI_Comm)', 'character(*)'. */
  type?: string;
  /** Dimensions, shown after the type: '(:,:)'. Brackets are added when missing. */
  dims?: string;
  /** Codimensions: '[*]'. Brackets are added when missing. */
  codims?: string;
  /** Shown as → in, ← out and ↔ inout; 'in out' reads as inout, and any other value is shown as written. */
  intent?: 'in' | 'out' | 'inout' | (string & {});
  optional?: boolean;
  value?: boolean;
  /** Other attributes, comma-separated: 'allocatable, target'. Each is a flag. */
  attrs?: string;
  /** The cpp condition the argument exists under, shown dashed as "when <cond>". */
  cond?: string;
  /** The argument's doc, as Markdown. */
  children?: ReactNode;
}

export interface FortranSourceProps {
  /** The file, relative to the project. */
  file: string;
  line: number;
  lineEnd?: number;
  /** Where the lines can be read, such as the file on GitHub with a #L3-L227 fragment. */
  href?: string;
}

/** A wrapping row of badges. */
export declare function FortranBadges(props: { children?: ReactNode }): ReactElement;
/** A small pill for a kind, an HPC model or library, or an attribute; nothing without a kind, label or condition. */
export declare function FortranBadge(props: FortranBadgeProps): ReactElement | null;
/** A titled definition list of FortranArg rows. */
export declare function FortranArgs(props: FortranArgsProps): ReactElement;
/** One argument (or component, or result): a signature line, then its doc, indented. */
export declare function FortranArg(props: FortranArgProps): ReactElement;
/** A quiet "Defined in file:line–lineEnd" line, linked when href is given; nothing without file or href. */
export declare function FortranSource(props: FortranSourceProps): ReactElement | null;
/** The components, to spread into getMDXComponents(). */
export declare const fortranComponents: {
  FortranBadges: typeof FortranBadges;
  FortranBadge: typeof FortranBadge;
  FortranArgs: typeof FortranArgs;
  FortranArg: typeof FortranArg;
  FortranSource: typeof FortranSource;
};
