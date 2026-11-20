import type { ReactElement, ReactNode } from 'react';

/**
 * Badge kinds with a label of their own. Kinds of entity are filled; HPC models and libraries (omp to cpp) have a
 * colour each, set by the `--fdf-<kind>` variables in style.css; the rest are neutral.
 *
 * On hover a badge, an attribute, an intent, a condition, a shape and the * or : of a character length say what they
 * mean, in a card: the components name the term (data-term, with data-arg for what goes with it, such as self in
 * pass(self)), and style.css has the meanings, once for the page. A term it has no meaning for shows no card; a site
 * gives one, in its own words or language, as `:where([data-term='hdf5']) { --fdf-mean: "HDF5: …"; }`.
 */
export type FortranBadgeKind =
  | 'module' | 'submodule' | 'program' | 'subroutine' | 'function' | 'type' | 'interface'
  | 'omp' | 'acc' | 'offload' | 'mpi' | 'coarray' | 'cuda' | 'blas' | 'lapack' | 'scalapack' | 'cpp'
  | 'bindc' | 'pure' | 'elemental' | 'recursive' | 'abstract' | 'deferred' | 'private' | 'public' | 'deprecated';

export interface FortranBadgeProps {
  /**
   * A kind above, or any other string, which is shown as written in the neutral style. It is the badge's term, which
   * has a meaning in style.css for the kinds above and for impure, non-recursive, simple, parameter and blockdata.
   */
  kind: FortranBadgeKind | (string & {});
  /**
   * Replaces the kind's label, such as 'OpenMP parallel region' for omp. Some labels make a term of their own: those
   * of an interface (generic interface, operator, assignment, defined I/O, abstract interface, module interface),
   * 'separate module procedure' for submodule, 'OpenMP parallel region', 'OpenACC routine', and 'conditional' for cpp.
   */
  label?: string;
  /** A cpp condition, such as 'USE_MPI': the badge is dashed and adds "when USE_MPI", which its card explains. */
  conditional?: string;
  /**
   * More about the badge, such as the routines or the constructs it stands for: shown in its card under the meaning,
   * and read by screen readers with the badge. It is not a native tooltip.
   */
  title?: string;
}

/** The optional columns of an argument table, drawn in this order. */
export type FortranArgsColumn = 'type' | 'shape' | 'intent' | 'attrs';

export interface FortranArgsProps {
  /** The table's title. Default 'Arguments'; an empty string leaves it out. */
  title?: string;
  /**
   * The optional columns to show, space-separated, from 'type shape intent attrs' (drawn in that order whatever the
   * order here); the name column and the expander are always there. Default: all four. The generator passes only the
   * columns that some row fills.
   */
  columns?: string;
  /** FortranArg rows. */
  children?: ReactNode;
}

/** Where a name in a FortranArg's type links, and what its hover card says. */
export interface FortranRefTarget {
  href?: string;
  /** The card's first line, in code: 'integer, parameter :: dp = …', 'dp ⇒ real64'. */
  title: string;
  /** A line of plain text under it, such as the entity's doc summary. */
  detail?: string;
  /** A muted line last, such as where the name was renamed. */
  note?: string;
}

export interface FortranArgProps {
  name: string;
  /**
   * The type, as declared: 'real(dp)', 'type(MPI_Comm)', 'character(*)'. The * or : of a character length has a card,
   * and an opened row says the length: assumed, deferred, or as written.
   */
  type?: string;
  /**
   * Dimensions, shown in the shape column: '(:,:)'. Brackets are added when missing. The shape's card, and the opened
   * row, say it in words: 'rank 2, assumed shape'.
   */
  dims?: string;
  /** Codimensions: '[*]'. Brackets are added when missing. */
  codims?: string;
  /**
   * Shown as → in, ← out and ↔ inout, with a card that says what each means, as an opened row does; 'in out' reads as
   * inout, and any other value is shown as written.
   */
  intent?: 'in' | 'out' | 'inout' | (string & {});
  optional?: boolean;
  value?: boolean;
  /**
   * Other attributes, comma-separated: 'allocatable, target'. Each is a flag with a card that says what it means, as
   * an opened row does beside it; its term is its keyword (pass for pass(self)), and default, init and pointer-init
   * for 'default dp', '= 0' and '=> null()'.
   */
  attrs?: string;
  /** The cpp condition the row exists under, shown dashed as "when <cond>" and in the panel as "Exists when". */
  cond?: string;
  /** A function's result: the intent column shows a neutral "result" pill. */
  result?: boolean;
  /** The whole declaration as Fortran, shown in the panel: 'real(dp), intent(in), optional :: x(:)'. */
  decl?: string;
  /**
   * Names in `type` that link and carry a hover card, by identifier: every whole-word occurrence, in any case, of a
   * key becomes a FortranRef. `{ dp: { href: '/docs/api/kinds#dp', title: 'integer, parameter :: dp = …' } }`
   */
  refs?: Record<string, FortranRefTarget>;
  /** The row's doc, as Markdown, shown in the panel the row opens to. */
  children?: ReactNode;
}

export interface FortranRefProps {
  /**
   * Where the name links. The card sits inside the link, so a click on it follows the link; without one the name is a
   * button that does nothing, which the keyboard reaches and which shows the card while it has focus.
   */
  href?: string;
  /** The card's first line, in code. */
  title: string;
  /** A line of plain text under the title. */
  detail?: string;
  /** A muted line last. */
  note?: string;
  /** The name. */
  children?: ReactNode;
}

export interface FortranSourceProps {
  /** The file, relative to the project. */
  file: string;
  line: number;
  lineEnd?: number;
  /** Where the lines can be read, such as the file on GitHub with a #L3-L227 fragment. */
  href?: string;
  /** The code, as a code block: the source block opens to it. Without it, the header alone. */
  children?: ReactNode;
}

export interface FortranGraphProps {
  /**
   * The diagram's title: a small label on the card, or the summary of a collapsed block. Without it an open card has
   * no caption (as the generated overview of a project), and a collapsed block says "Graph".
   */
  title?: string;
  /** A block that starts closed, rather than an open card. */
  collapsed?: boolean;
  /** One diagram, such as a ```mermaid block the site draws. */
  children?: ReactNode;
}

/** The kinds fortranToc gives a letter: mod, smod, prog, t, i, s, f, v, p and e. */
export type FortranTocKind =
  | 'module' | 'submodule' | 'program' | 'type' | 'interface' | 'subroutine' | 'function' | 'variable' | 'parameter'
  | 'enum';

/** An item of fumadocs' table of contents. */
export interface FortranTocItem {
  title: ReactNode;
  url: string;
  depth?: number;
}

/** A wrapping row of badges. */
export declare function FortranBadges(props: { children?: ReactNode }): ReactElement;
/** A small pill for a kind, an HPC model or library, or an attribute; nothing without a kind, label or condition. */
export declare function FortranBadge(props: FortranBadgeProps): ReactElement | null;
/** A table of FortranArg rows in the manner of fumadocs' TypeTable: a title, a header row, then the rows. */
export declare function FortranArgs(props: FortranArgsProps): ReactElement;
/**
 * One row (an argument, component, binding or result), which opens to its doc, declaration, intent and attributes in
 * words, shape, length and condition.
 */
export declare function FortranArg(props: FortranArgProps): ReactElement;
/** A name with a link and a hover card; nothing without a name. */
export declare function FortranRef(props: FortranRefProps): ReactElement | null;
/**
 * "Source code in <file>", its lines and a link: a block that opens to the code given as children, or the header
 * alone; nothing without file or href.
 */
export declare function FortranSource(props: FortranSourceProps): ReactElement | null;
/** A diagram, open or collapsed, with an optional title; nothing without a diagram. */
export declare function FortranGraph(props: FortranGraphProps): ReactElement | null;
/**
 * fumadocs' table of contents with a letter for each entity's kind. `kinds` maps anchors (without '#') to kinds, as a
 * generated page's frontmatter `fortran.toc` does; returns a new array, and `toc` itself when `kinds` is undefined.
 */
export declare function fortranToc<T extends FortranTocItem>(
  toc: T[],
  kinds?: Readonly<Record<string, FortranTocKind | (string & {})>> | null,
): Array<Omit<T, 'title'> & { title: ReactNode }>;
/** The components, to spread into getMDXComponents(). */
export declare const fortranComponents: {
  FortranBadges: typeof FortranBadges;
  FortranBadge: typeof FortranBadge;
  FortranArgs: typeof FortranArgs;
  FortranArg: typeof FortranArg;
  FortranRef: typeof FortranRef;
  FortranSource: typeof FortranSource;
  FortranGraph: typeof FortranGraph;
};
