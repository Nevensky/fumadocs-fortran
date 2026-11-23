// fumadocs-fortran/source: a loader plugin for fumadocs-core's loader(), which gives the generated pages the letter of
// each entry's kind in their table of contents and the kind of each page in the sidebar:
//
//   export const source = loader({ baseUrl: '/docs', source: docs.toFumadocsSource(), plugins: [fortranPlugin()] });
//
// Both read the `fortran` field of a generated page's frontmatter, which the collection's schema must keep
// (fortranPageSchema of fumadocs-fortran/mdx).

import { createElement as h } from 'react';
import { fortranToc } from '../react/index.js';

// The kinds of generated page, with their letters in the sidebar, as the table of contents writes the first three
const PAGE_LETTERS = { module: 'mod', submodule: 'smod', program: 'prog', blockdata: 'bd', procedures: 'proc' };

const isObject = (v) => v !== null && typeof v === 'object';

// Marks the page data whose table of contents has its letters: a symbol of the registry, as a loader made again (the
// development server reloading lib/source.ts) may get the same data, and the letters must not be added twice
const LETTERED = Symbol.for('fumadocs-fortran.toc');

/**
 * Wraps the `toc` of a page's data so that it comes with the letters. fumadocs-mdx defines it as a getter that runs
 * the compiled page when first read, so it is wrapped, not set: read lazily, once. An async collection's page has its
 * table of contents in what load() resolves to, which is wrapped the same way.
 */
function withLetters(data, kinds) {
  if (data[LETTERED] || !Object.isExtensible(data)) return;
  Object.defineProperty(data, LETTERED, { value: true });
  const own = Object.getOwnPropertyDescriptor(data, 'toc');
  if (own) {
    if (!own.configurable && !own.writable) return;
    const read = own.get ? () => own.get.call(data) : () => own.value;
    let value;
    let ready = false;
    Object.defineProperty(data, 'toc', {
      configurable: true,
      enumerable: own.enumerable ?? true,
      get() {
        if (!ready) {
          value = fortranToc(read(), kinds);
          ready = true;
        }
        return value;
      },
      set(v) {
        value = v;
        ready = true;
      },
    });
    return;
  }
  if (typeof data.load === 'function') {
    const load = data.load;
    let loading;
    data.load = function loadWithLetters(...args) {
      loading ??= Promise.resolve(load.apply(this, args)).then((loaded) => {
        if (isObject(loaded)) withLetters(loaded, kinds);
        return loaded;
      });
      return loading;
    };
  }
}

/**
 * The plugin. `toc: false` leaves the tables of contents as they are, and `sidebar: false` the sidebar. It runs before
 * the site's other plugins (enforce: 'pre'), and gives a page a sidebar icon only when it has none, so an icon plugin
 * such as lucideIconsPlugin leaves the letters be.
 */
export function fortranPlugin({ toc = true, sidebar = true } = {}) {
  const plugin = { name: 'fumadocs-fortran', enforce: 'pre' };
  if (toc) {
    plugin.transformStorage = ({ storage }) => {
      for (const path of storage.getFiles()) {
        const file = storage.read(path);
        const kinds = file?.format === 'page' && isObject(file.data) ? file.data.fortran?.toc : undefined;
        if (isObject(kinds)) withLetters(file.data, kinds);
      }
    };
  }
  if (sidebar) {
    plugin.transformPageTree = {
      file(node, filePath) {
        if (!filePath || node.icon !== undefined) return node;
        const file = this.storage?.read(filePath);
        const kind = file?.format === 'page' ? file.data?.fortran?.kind : undefined;
        if (typeof kind !== 'string' || !Object.hasOwn(PAGE_LETTERS, kind)) return node;
        node.icon = h('span', { className: `fdf-nav-kind fdf-nav-${kind}`, 'aria-hidden': 'true' }, PAGE_LETTERS[kind]);
        return node;
      },
    };
  }
  return plugin;
}
