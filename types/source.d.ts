// fumadocs-fortran/source. Typed without fumadocs-core's types, so that it fits any version of them: the plugin is a
// LoaderPlugin of fumadocs-core/source, for loader({ plugins }).

export interface FortranPluginOptions {
  /** Give the generated pages' tables of contents a letter for each entry's kind (default true). */
  toc?: boolean;
  /** Give the generated pages a letter for their kind in the sidebar, where they have no icon (default true). */
  sidebar?: boolean;
}

/**
 * The loader plugin: the letter of each entry's kind in the generated pages' tables of contents (t type, s subroutine,
 * f function, …), as fortranToc gives it, and the kind of each generated page in the sidebar (mod, smod, prog, bd,
 * proc). Both read the `fortran` field of a page's frontmatter, which the collection's schema keeps with
 * fortranPageSchema (fumadocs-fortran/mdx).
 */
export declare function fortranPlugin(options?: FortranPluginOptions): LoaderPlugin;

/** A loader plugin, as fumadocs-core's loader() takes it. */
interface LoaderPlugin {
  name: string;
  enforce?: 'pre' | 'post';
  transformStorage?: (context: { storage: any }) => void;
  transformPageTree?: { file?: (this: any, node: any, filePath?: string) => any };
}

// only what is exported above is public
export {};
