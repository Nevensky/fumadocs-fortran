// What fumadocs-fortran/mdx does, without fumadocs-core: mdx.js gives it fumadocs-core's plugins and defaults, and the
// tests give it stand-ins. Not an entry point of the package.

import { fortranRehypeCode } from '../shiki/index.js';
import { katexMacros } from '../src/docs/math.js';

// The elements of the generated pages' components (FortranArg, FortranBadge, FortranRef, …), whose search records
// take their text rather than their tags
const FORTRAN_ELEMENT = /^Fortran[A-Z]/;
// fumadocs-core's default for the elements a static page's records keep as tags, for a version that does not export
// it as remarkStructureDefaultOptions.filterElement
const STATIC_TAGS = /^(File|TypeTable|Callout|Card)$/;

const pluginOf = (entry) => (Array.isArray(entry) ? entry[0] : entry);
const hasPlugin = (list, plugin) => Array.isArray(list) && list.some((entry) => pluginOf(entry) === plugin);
const usable = (p) => typeof p === 'function' || (Array.isArray(p) && typeof p[0] === 'function');

/**
 * The MDX options of withFortran: `options` as fumadocs-mdx's applyMdxPreset takes them, with `math`, `graphs` and
 * `grammars`, and `plugins`, from fumadocs-core/mdx-plugins: { rehypeCode, rehypeCodeDefaultOptions, remarkMdxMermaid,
 * remarkStructure, remarkStructureDefaultOptions }.
 */
export function composeMdx(options = {}, plugins = {}) {
  if (!options || typeof options !== 'object') throw new TypeError('withFortran: options must be an object');
  const { math, graphs, grammars, ...rest } = options;
  const minimal = rest.preset === 'minimal';
  const out = { ...rest };

  // remark: maths ($…$, $$…$$) and graphs (```mermaid to <Mermaid chart="…" />), unless the list has them already
  const remark = [];
  let katex = null;
  if (math) {
    const { remarkMath, rehypeKatex } = math;
    if (!usable(remarkMath) || !usable(rehypeKatex)) {
      throw new TypeError('withFortran: math needs { remarkMath, rehypeKatex }, the default exports of remark-math and '
        + 'rehype-katex');
    }
    remark.push(remarkMath);
    // a copy of the macros, as KaTeX adds a page's \gdef to the object it is given; the site's own macros win
    const [plugin, own = {}] = Array.isArray(rehypeKatex) ? rehypeKatex : [rehypeKatex];
    katex = [plugin, { ...own, macros: { ...katexMacros, ...own.macros } }];
  }
  if (graphs) {
    if (typeof plugins.remarkMdxMermaid !== 'function') {
      throw new Error('withFortran: fumadocs-core has no remarkMdxMermaid');
    }
    remark.push(plugins.remarkMdxMermaid);
  }
  if (remark.length) out.remarkPlugins = addRemark(rest.remarkPlugins, remark, plugins, minimal);
  if (katex) out.rehypePlugins = addKatex(rest.rehypePlugins, katex, plugins, minimal);
  if (minimal) return out;

  // Fortran code blocks: the grammars and the two transformers, on fumadocs' options, as rehypeCode merges the ones it
  // is given over its defaults and would otherwise lose its own transformers
  if (rest.rehypeCodeOptions !== false) {
    out.rehypeCodeOptions = fortranRehypeCode({ ...plugins.rehypeCodeDefaultOptions, ...rest.rehypeCodeOptions },
      grammars);
  }
  // search: the components' text in the records, not their tags; the other elements as the site's filter, or
  // fumadocs' default, has them
  if (rest.remarkStructureOptions !== false) {
    const own = rest.remarkStructureOptions ?? {};
    const keep = own.filterElement ?? plugins.remarkStructureDefaultOptions?.filterElement
      ?? ((node) => STATIC_TAGS.test(node.name ?? ''));
    out.remarkStructureOptions = {
      ...own,
      filterElement: (node) => !FORTRAN_ELEMENT.test(node.name ?? '') && keep(node),
    };
  }
  return out;
}

/**
 * The remark plugins with `extra` added, those the list has left out: after the site's own, as applyMdxPreset places
 * a list, which comes before remarkStructure; into the list a function form is given, before remarkStructure.
 */
function addRemark(own, extra, plugins, minimal) {
  if (typeof own === 'function') {
    if (minimal) throw new TypeError("withFortran: with preset 'minimal', remarkPlugins must be a list");
    return (list) => {
      const add = extra.filter((p) => !hasPlugin(list, pluginOf(p)));
      const at = list.findIndex((entry) => pluginOf(entry) === plugins.remarkStructure);
      return own(at < 0 ? [...list, ...add] : [...list.slice(0, at), ...add, ...list.slice(at)]);
    };
  }
  const list = own ?? [];
  if (!Array.isArray(list)) throw new TypeError('withFortran: remarkPlugins must be a list or a function');
  return [...list, ...extra.filter((p) => !hasPlugin(list, pluginOf(p)))];
}

/**
 * The rehype plugins with rehype-katex first, before rehypeCode, so that a maths block is set by KaTeX rather than
 * highlighted as code. A list of the site's own goes where applyMdxPreset would place it, after rehypeCode, but for a
 * rehype-katex of its own, which moves to the front, its options over those of `math` and katexMacros under its
 * macros; a function form gets the list with KaTeX in it.
 */
function addKatex(own, katex, plugins, minimal) {
  if (Array.isArray(own) && hasPlugin(own, katex[0])) {
    const at = own.findIndex((entry) => pluginOf(entry) === katex[0]);
    const theirs = (Array.isArray(own[at]) ? own[at][1] : undefined) ?? {};
    katex = [katex[0], { ...katex[1], ...theirs, macros: { ...katex[1].macros, ...theirs.macros } }];
    own = [...own.slice(0, at), ...own.slice(at + 1)];
  }
  if (minimal) {
    if (typeof own === 'function') {
      throw new TypeError("withFortran: with preset 'minimal', rehypePlugins must be a list");
    }
    return [katex, ...(own ?? [])];
  }
  if (typeof own === 'function') return (list) => own(hasPlugin(list, katex[0]) ? list : [katex, ...list]);
  const mine = own ?? [];
  if (!Array.isArray(mine)) throw new TypeError('withFortran: rehypePlugins must be a list or a function');
  return (list) => {
    const at = list.findIndex((entry) => pluginOf(entry) === plugins.rehypeCode) + 1;
    return [katex, ...list.slice(0, at), ...mine, ...list.slice(at)];
  };
}

// ---------------------------------------------------------------- the page schema

const isObject = (v) => v !== null && typeof v === 'object' && !Array.isArray(v);

/** The `fortran` field of a page's frontmatter: { value }, or { issues }. */
function readFortran(data) {
  if (!isObject(data) || data.fortran === undefined) return { value: undefined };
  const f = data.fortran;
  const issue = (message, ...path) => ({ issues: [{ message, path: ['fortran', ...path] }] });
  if (!isObject(f)) return issue('Expected an object, as fumadocs-fortran writes it');
  if (f.kind !== undefined && typeof f.kind !== 'string') return issue('Expected a string', 'kind');
  if (f.toc !== undefined) {
    if (!isObject(f.toc)) return issue('Expected an object of anchors and kinds', 'toc');
    for (const [anchor, kind] of Object.entries(f.toc)) {
      if (typeof kind !== 'string') return issue('Expected a string', 'toc', anchor);
    }
  }
  return { value: f };
}

/**
 * A Standard Schema that validates as `base` does and keeps the `fortran` field, which a schema such as fumadocs'
 * pageSchema drops. `base` is a Standard Schema (Zod, Valibot, ArkType, …), or a function of fumadocs-mdx's context
 * that returns one.
 */
export function wrapSchema(base) {
  if (typeof base === 'function' && !('~standard' in base)) return (context) => wrapSchema(base(context));
  const std = base?.['~standard'];
  if (!std || typeof std.validate !== 'function') {
    throw new TypeError('fortranPageSchema: give it the schema of your pages, such as pageSchema from '
      + 'fumadocs-core/source/schema');
  }
  const merge = (result, own) => {
    if (result.issues || own.issues) return { issues: [...(result.issues ?? []), ...(own.issues ?? [])] };
    if (own.value === undefined || !isObject(result.value)) return result;
    return { value: { ...result.value, fortran: own.value } };
  };
  return {
    '~standard': {
      version: 1,
      vendor: 'fumadocs-fortran',
      validate(value, ...rest) {
        const own = readFortran(value);
        const result = std.validate(value, ...rest);
        return typeof result?.then === 'function' ? result.then((r) => merge(r, own)) : merge(result, own);
      },
    },
  };
}
