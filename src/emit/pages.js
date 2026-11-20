// From the IR to fumadocs pages: one MDX page per module, submodule and program, pages for external procedures
// (grouped by \ingroup, else by file), an overview page, and meta.json for the sidebar. Each entity gets a `###`
// heading with an explicit ID and no sub-headings, so fumadocs' <include>page.mdx#id</include> embeds exactly one.

import path from 'node:path';
import { renderDoc } from '../docs/index.js';
import { splitTop } from '../parse/text.js';
import { buildGraphs } from './graphs.js';
import { INTRINSIC_MODULES } from './kinds.js';
import { attr, decodeText, escapeText, inlineCode, plainText, yamlString } from './mdx.js';

/**
 * @typedef {object} PageOptions
 * @property {string} [baseUrl] the URL of the output folder (default /docs/api)
 * @property {string} [title] the overview page's title (default "API reference")
 * @property {string} [description] the overview page's description
 * @property {string[]} [display] which access levels to show (default public, protected; FORD's default)
 * @property {{ url: string, rev?: string, root?: string }} [repo] links each entity to its lines: url like
 *   https://github.com/org/code, rev a branch, tag or commit, root the IR's root relative to the repository
 * @property {string} [sourceRoot] shown before file paths (default: nothing)
 * @property {'katex'|'code'} [math] 'katex' (default) writes $…$ for remark-math; 'code' shows maths as code, for a
 *   site without remark-math
 * @property {boolean} [defaultOpen] the output folder starts open in the sidebar
 * @property {(file: string) => string|null} [include] reads FORD's {!file!} includes (generate reads them relative to
 *   the project root, and only from under it); without it they are dropped
 * @property {Record<string, string>} [aliases] FORD's |name| aliases; a name not here stays as written
 * @property {(file: string) => string|null} [readSource] reads a source file, by its path in the IR (relative to the
 *   project root), for the source blocks. generate reads the files the IR lists (the sources and the files they
 *   include) wherever they lie, and any other file (one a #line marker names) only from under the root. Without it,
 *   entities only link to their lines
 * @property {'embed'|'link'} [source] 'embed' (the default when readSource is given) puts each procedure's, type's,
 *   interface's, variable's and enum's lines in a collapsible block under it; 'link' only links to them
 * @property {number} [sourceMaxLines] the most lines an entity may span for its source to be embedded (default 400)
 * @property {boolean | GraphPageOptions} [graphs] the graphs, as ```mermaid blocks for remarkMdxMermaid (default on):
 *   each unit's dependencies, each type's inheritance, each procedure's and generic's calls, and the overview's
 *   modules; false leaves them out
 */

/**
 * @typedef {object} GraphPageOptions
 * @property {number} [depth] how far uses and callees are followed (default 2)
 * @property {number} [maxNodes] the most nodes a graph draws (default 40; below 2 counts as 2), and the most units
 *   the overview draws (default 80)
 * @property {(name: string) => string|null} [classify] the library a routine called by name is from, by its
 *   lower-case name: 'blas', 'lapack', 'scalapack', 'mpi' and so on, or null when unknown
 */

const OPS = { '+': 'plus', '-': 'minus', '*': 'times', '/': 'divide', '**': 'power', '//': 'concat', '==': 'eq', '/=': 'ne', '<': 'lt', '<=': 'le', '>': 'gt', '>=': 'ge' };
const HPC_MODULES = {
  mpi: 'mpi', mpi_f08: 'mpi', mpif: 'mpi', omp_lib: 'omp', omp_lib_kinds: 'omp', openacc: 'acc',
  // CUDA Fortran and the NVIDIA libraries' Fortran modules
  cudafor: 'cuda', cublas: 'cuda', cufft: 'cuda', curand: 'cuda', cusparse: 'cuda', cusolverdn: 'cuda',
};
const ATTR_PREFIX = new Set(['pure', 'impure', 'elemental', 'recursive', 'non_recursive', 'simple']);
// units have pages of their own, too long for a source block
const UNITS = new Set(['module', 'submodule', 'program', 'blockdata']);
// a kind or type name that can link: an identifier, not `8`, `kind(1d0)` or `*`
const IDENT = /^[A-Za-z][A-Za-z0-9_]*$/;
// the intrinsic types whose kind may be a named constant
const KINDED = new Set(['integer', 'real', 'complex', 'logical', 'character']);
// control characters other than tab, which a source block drops
const CONTROLS = /[\u0000-\u0008\u000B-\u001F\u007F-\u009F]/g;

/** The anchor of an entity on its page: lower-case name; operators get fixed slugs. */
export function anchorOf(e) {
  const n = (e.name || '').toLowerCase();
  let m = /^operator\s*\(\s*(.+?)\s*\)$/.exec(n);
  if (m) return `operator-${OPS[m[1]] ?? m[1].replace(/\./g, '').replace(/[^a-z0-9]+/g, '-')}`;
  if (/^assignment\s*\(/.test(n)) return 'assignment';
  m = /^(read|write)\s*\(\s*(\w+)\s*\)$/.exec(n);
  if (m) return `${m[1]}-${m[2]}`;
  if (!n) return `${e.kind}-${(e.id.split(':@')[1] ?? '1').replace(/\D.*$/, '')}`;
  return n.replace(/[^a-z0-9_]+/g, '-');
}

/**
 * Builds the page model.
 * @param {import('../../types/index.d.ts').FortranIR} ir
 * @param {PageOptions} [opts]
 * @returns {{ pages: Array<{ path: string, url: string, title: string, mdx: string }>, metas: Array<{ path: string, data: object }> }}
 */
export function buildPages(ir, opts = {}) {
  const base = (opts.baseUrl ?? '/docs/api').replace(/\/$/, '');
  const display = new Set(opts.display ?? ['public', 'protected']);
  const E = ir.entities;
  const all = Object.values(E);
  const children = (e) => (e.children ?? []).map((id) => E[id]).filter(Boolean);
  // the interface bodies of separate module procedures by lower-case name, in the IR's order (findInterface)
  let separateBodies = null;
  // a separate module procedure has the access of the interface body that declares it
  const accessOf = (e) => e.access ?? (e.scope === 'separate' ? findInterface(e)?.access : undefined);
  const shown = (e) => {
    // a procedure's internal procedures have no access of their own: they are shown where their host is
    const host = e.kind === 'procedure' && e.scope === 'internal' ? E[e.parent] : null;
    if (host?.kind === 'procedure') return shown(host);
    const a = accessOf(e);
    return !a || display.has(a);
  };

  // ---- pages and where each entity lives
  const plan = [];
  const used = new Set();
  const slug = (name, kind) => {
    let s = (name || kind).toLowerCase().replace(/[^a-z0-9_]+/g, '-');
    if (s === 'index') s = `${kind}-index`;
    if (used.has(s)) s = `${s}-${kind}`;
    let k = 2;
    while (used.has(s)) s = `${s}-${k++}`;
    used.add(s);
    return s;
  };
  const units = all.filter((e) => !e.parent && e.kind !== 'procedure');
  const RANK = { module: 0, submodule: 1, program: 2, blockdata: 3 };
  units.sort((a, b) => (RANK[a.kind] ?? 9) - (RANK[b.kind] ?? 9) || a.name.localeCompare(b.name));
  for (const u of units) plan.push({ unit: u, slug: slug(u.name || (u.kind === 'program' ? 'main' : u.kind), u.kind) });
  // external procedures: by \ingroup, else by file
  const groups = new Map();
  for (const e of all) {
    if (e.parent || e.kind !== 'procedure') continue;
    const group = renderDoc(e.doc?.blocks, { name: e.name }).group ?? path.basename(e.file).replace(/\.[^.]+$/, '');
    if (!groups.has(group)) groups.set(group, []);
    groups.get(group).push(e);
  }
  for (const [group, list] of [...groups].sort((a, b) => a[0].localeCompare(b[0]))) {
    list.sort((a, b) => a.name.localeCompare(b.name));
    plan.push({ group, procs: list, slug: slug(group, 'procedures') });
  }

  // ---- the resolver: every entity that gets a heading, by lower-case name (hidden ones are not linked to)
  const where = new Map(); // id -> url
  const index = new Map(); // lower-case name -> [{ url, page, kind, id }]
  const addName = (name, url, page, kind, id) => {
    if (!name) return;
    const k = name.toLowerCase();
    if (!index.has(k)) index.set(k, []);
    index.get(k).push({ url, page, kind, id });
  };
  const add = (e, url, page) => {
    where.set(e.id, url);
    addName(e.name, url, page, e.kind, e.id);
  };
  // ---- anchors: each headed entity's, unique on its page. The first entity in page order keeps the plain anchor
  // (#point for the type, #point-interface for a generic interface of the same name), and the section headings keep
  // theirs; a second entity of the same kind is numbered.
  const anchorFor = new Map();
  const SECTION_SLUGS = ['types', 'interfaces', 'procedures', 'internal-procedures', 'variables', 'enumerations'];
  const headed = (p) => {
    if (!p.unit) return p.procs;
    const kids = children(p.unit);
    return [
      ...kids.filter((c) => c.kind === 'type' && shown(c)),
      ...kids.filter((c) => c.kind === 'interface').flatMap((i) => (i.ikind === 'abstract' || i.ikind === 'explicit'
        ? children(i).filter((b) => b.kind === 'procedure' && shown(b)) : shown(i) ? [i] : [])),
      ...kids.filter((c) => c.kind === 'procedure' && c.scope !== 'internal' && shown(c)),
      ...kids.filter((c) => c.kind === 'procedure' && c.scope === 'internal'),
      ...kids.filter((c) => c.kind === 'variable' && shown(c)),
      ...kids.filter((c) => c.kind === 'enum'),
    ];
  };
  for (const p of plan) {
    const taken = new Map(SECTION_SLUGS.map((s) => [s, 'section']));
    for (const e of headed(p)) {
      const b = anchorOf(e);
      let a = b;
      if (taken.has(a) && taken.get(a) !== e.kind) a = `${b}-${e.kind}`;
      for (let k = 2; taken.has(a); k++) a = `${b}-${k}`;
      taken.set(a, e.kind);
      anchorFor.set(e.id, a);
    }
  }
  const anchor = (e) => anchorFor.get(e.id) ?? anchorOf(e);

  for (const p of plan) {
    const pageUrl = `${base}/${p.slug}`;
    p.url = pageUrl;
    const onPage = (e) => add(e, `${pageUrl}#${anchor(e)}`, pageUrl);
    if (p.unit) {
      add(p.unit, pageUrl, pageUrl);
      for (const c of children(p.unit)) {
        if (c.kind === 'interface' && (c.ikind === 'abstract' || c.ikind === 'explicit')) {
          for (const b of children(c)) if (shown(b)) onPage(b);
        } else if (c.kind === 'enum') {
          // an enum's enumerators are module names: they link to the enum
          onPage(c);
          for (const x of c.enumerators) if (!x.access || display.has(x.access)) addName(x.name, `${pageUrl}#${anchor(c)}`, pageUrl, 'enumerator', c.id);
        } else if (shown(c)) onPage(c);
      }
    } else for (const e of p.procs) onPage(e);
  }
  let current = '';
  const pick = (hits) => (hits.find((h) => h.page === current) ?? hits[0]).url;
  // [[name]] and [[name:child]]: the child is looked for among the children of `name` only
  const resolve = (name, child) => {
    const hits = index.get(String(name).toLowerCase()) ?? [];
    if (child) {
      const want = String(child).toLowerCase();
      for (const h of hits) {
        const c = children(E[h.id] ?? {}).find((x) => x.name?.toLowerCase() === want);
        // a component or a binding has no heading of its own: its type's anchor stands for it
        if (c) return where.get(c.id) ?? h.url;
      }
    }
    return hits.length ? pick(hits) : null;
  };

  // ---- graphs, drawn per entity when its section is written. A node links to the entity's heading; a generic's
  // interface body and a type-bound procedure are documented under their generic's and their type's, and a
  // procedure's internal procedures in its own entry.
  const graphUrl = (e) => {
    if (where.has(e.id)) return where.get(e.id);
    const p = E[e.parent];
    const under = e.kind === 'binding'
      || (e.kind === 'procedure' && ((e.scope === 'interface' && p?.kind === 'interface')
        || (e.scope === 'internal' && p?.kind === 'procedure')));
    return (under && p && where.get(p.id)) || null;
  };
  const graphOpts = opts.graphs && typeof opts.graphs === 'object' ? opts.graphs : {};
  const graphs = opts.graphs === false ? null : buildGraphs(ir, {
    url: graphUrl, shown, classify: graphOpts.classify, depth: graphOpts.depth, maxNodes: graphOpts.maxNodes,
  });
  /** A graph card around a ```mermaid block, open or collapsed; nothing when there is no graph. */
  const graphCard = (title, mermaid, collapsed = false) => {
    if (!mermaid) return '';
    let f = '```';
    while (mermaid.includes(f)) f += '`';
    const tag = `<FortranGraph${attr('title', title)}${attr('collapsed', collapsed)}>`;
    return `${tag}\n\n${f}mermaid\n${mermaid}\n${f}\n\n</FortranGraph>`;
  };

  // ---- scopes: where a kind name or a derived type named in a declaration comes from, for the rows' refs
  const lc = (s) => String(s ?? '').toLowerCase();
  const modules = new Map();
  const submodules = new Map();
  for (const e of all) {
    if (e.parent) continue;
    if (e.kind === 'module' && !modules.has(lc(e.name))) modules.set(lc(e.name), e);
    const key = `${lc(e.ancestor)}:${lc(e.name)}`;
    if (e.kind === 'submodule' && !submodules.has(key)) submodules.set(key, e);
  }
  // an entity, its hosts and its unit; after a submodule, its parent submodules and its module, whose names it sees
  const scopeChain = (e) => {
    const chain = [];
    const seen = new Set();
    let x = e;
    while (x && !seen.has(x.id)) {
      seen.add(x.id);
      chain.push(x);
      if (x.parent) x = E[x.parent];
      else if (x.kind === 'submodule') {
        const parentSub = x.parentSubmodule && submodules.get(`${lc(x.ancestor)}:${lc(x.parentSubmodule)}`);
        x = parentSub || modules.get(lc(x.ancestor));
      } else x = null;
    }
    return chain;
  };
  const declaredIn = (unit, key, want) => children(unit)
    .find((c) => lc(c.name) === key && c.kind === (want === 'type' ? 'type' : 'variable'));
  // a name the use statements of x give: a project entity (followed through the modules that pass it on), a name of
  // an intrinsic module, a module outside the project that is known to give it, or null
  const fromUses = (x, key, want, seen) => {
    for (const u of x.uses ?? []) {
      const mod = lc(u.module);
      let item;
      if (u.only) {
        item = u.only.find((i) => lc(i.local ?? i.name) === key);
        if (!item) continue;
      } else {
        item = u.renames?.find((i) => lc(i.local ?? i.name) === key);
        // a name renamed here is not visible under its own name as well
        if (!item && u.renames?.some((i) => i.local && lc(i.name) === key)) continue;
      }
      const remote = item ? lc(item.name) : key;
      const project = u.nature === 'intrinsic' ? undefined : modules.get(mod);
      if (project) {
        // modules that use each other: each is asked for a name once
        const visit = `${project.id}\0${remote}`;
        if (seen.has(visit)) continue;
        seen.add(visit);
        const d = declaredIn(project, remote, want);
        if (d && accessOf(d) !== 'private') return { entity: d };
        const r = d ? null : fromUses(project, remote, want, seen);
        if (r) return r;
      } else if (u.nature !== 'non_intrinsic' && Object.hasOwn(INTRINSIC_MODULES, mod)) {
        if (item || Object.hasOwn(INTRINSIC_MODULES[mod].names, remote)) {
          return { intrinsic: mod, name: item?.name ?? remote, renamed: !!item?.local, use: u, at: x };
        }
      } else if (item) return { outside: mod };
    }
    return null;
  };
  const lookupName = (name, want, scope) => {
    const key = lc(name);
    for (const x of scopeChain(scope)) {
      // a component's kind may be a kind parameter of its type
      if (want === 'kind' && x.kind === 'type') {
        const p = x.params?.find((q) => lc(q.name) === key);
        if (p) return { param: p };
      }
      if (x.kind === 'module' || x.kind === 'submodule') {
        const d = declaredIn(x, key, want);
        if (d) return { entity: d };
      }
      const r = fromUses(x, key, want, new Set());
      if (r) return r;
    }
    return null;
  };
  // hover text is plain text: a doc's summary without its markup
  const summaries = new WeakMap();
  const summaryOf = (x) => {
    if (!summaries.has(x)) {
      const how = { resolve, name: x.name, math: opts.math, include: opts.include, aliases: opts.aliases };
      const s = x.doc?.blocks?.length ? plainText(renderDoc(x.doc.blocks, how).summary) : '';
      summaries.set(x, s ? clip(s, 200) : '');
    }
    return summaries.get(x);
  };
  const withDetail = (ref, detail) => (detail ? { ...ref, detail } : ref);
  const entityRef = (e) => {
    const href = where.get(e.id);
    if (!href) return null;
    return withDetail({ href, title: clip(e.kind === 'type' ? typeDecl(e) : varDecl(e), 100) }, summaryOf(e));
  };
  const intrinsicRef = (written, hit) => {
    const mod = INTRINSIC_MODULES[hit.intrinsic];
    const key = lc(hit.name);
    const meaning = Object.hasOwn(mod.names, key) ? mod.names[key] : null;
    return {
      href: mod.url,
      title: lc(written) === key ? written : `${written} ⇒ ${hit.name}`,
      detail: meaning ?? `A named constant of the intrinsic module ${hit.intrinsic}`,
      note: `${hit.renamed ? 'Renamed in' : 'From'} the use statement at ${shownPath(hit.at.file)}:${hit.use.line}`,
    };
  };
  const refCache = new Map();
  // the card for a kind name or a derived type: 1. an entity with a heading, 2. a name of an intrinsic module,
  // 3. nothing. A name the scope does not explain (declared where the model does not look) is looked up by name.
  const refOf = (name, want, scope) => {
    const key = `${want}\0${name}\0${scope?.id ?? ''}\0${current}`;
    if (refCache.has(key)) return refCache.get(key);
    const hit = scope ? lookupName(name, want, scope) : null;
    let ref = null;
    if (hit?.entity) ref = entityRef(hit.entity);
    else if (hit?.param) {
      const p = hit.param;
      const init = p.init !== undefined ? ` = ${p.init}` : '';
      const title = `${prettyType(p.type) ?? 'integer'}, ${p.attr ?? 'kind'} :: ${p.name}${init}`;
      ref = withDetail({ title }, summaryOf(p));
    } else if (hit?.intrinsic) ref = intrinsicRef(name, hit);
    else if (!hit) {
      const fits = (h) => (want === 'type' ? h.kind === 'type' : h.kind === 'variable' && E[h.id]?.parameter);
      const hits = (index.get(lc(name)) ?? []).filter(fits);
      if (hits.length) ref = entityRef(E[(hits.find((h) => h.page === current) ?? hits[0]).id]);
    }
    refCache.set(key, ref);
    return ref;
  };
  // the type a type extends, as the type's scope sees the name (use, only, renames, host association) and as the
  // inheritance graph draws it; null for a type from outside the project. A name the scope does not explain (a type a
  // program declares: lookupName reads only modules' and submodules' declarations) is looked up by name, on this page
  // first.
  const parentOf = (t) => {
    if (!t.extends) return null;
    const hit = lookupName(t.extends, 'type', t);
    if (hit) return hit.entity ?? null;
    const key = lc(t.extends);
    const hits = (index.get(key) ?? []).filter((h) => h.kind === 'type');
    if (hits.length) return E[(hits.find((h) => h.page === current) ?? hits[0]).id];
    return all.find((x) => x.kind === 'type' && lc(x.name) === key) ?? null;
  };
  // the values given to the kind parameters of a parameterised type: `dp` in class(banded_matrix(k=dp, kl=*, ku=*))
  const kindParams = (t, scope) => {
    if (!t.params || !IDENT.test(t.kind ?? '')) return [];
    const hit = lookupName(t.kind, 'type', scope);
    const type = hit?.entity ?? (hit ? null : all.find((x) => x.kind === 'type' && lc(x.name) === lc(t.kind)));
    if (!type?.params?.length) return [];
    const out = [];
    splitTop(t.params, ',').forEach((item, i) => {
      const m = /^\s*(?:([A-Za-z]\w*)\s*=(?!=))?\s*([\s\S]*?)\s*$/.exec(item);
      const p = m[1] ? type.params.find((q) => lc(q.name) === lc(m[1])) : type.params[i];
      if (p?.attr === 'kind') out.push(m[2]);
    });
    return out;
  };
  /** A row's refs: its type's kind name, or its derived type and the kinds that type is given. */
  const refsFor = (t, scope) => {
    if (!t || t.implicit) return undefined;
    const refs = {};
    const ref = (name, want) => {
      if (!IDENT.test(name) || Object.hasOwn(refs, name)) return;
      const r = refOf(name, want, scope);
      if (r) refs[name] = r;
    };
    if (t.base === 'type' || t.base === 'class') {
      if (t.kind) ref(t.kind, 'type');
      for (const k of kindParams(t, scope)) ref(k, 'kind');
    } else if (KINDED.has(t.base) && t.kind) ref(t.kind, 'kind');
    return Object.keys(refs).length ? refs : undefined;
  };

  // ---- source blocks: an entity's own lines, each file read once
  const embed = typeof opts.readSource === 'function' && opts.source !== 'link';
  // Infinity is a number too: no cap
  const cap = opts.sourceMaxLines;
  const maxLines = typeof cap === 'number' && !Number.isNaN(cap) ? cap : 400;
  const texts = new Map();
  const linesOf = (file) => {
    if (!texts.has(file)) {
      let text = null;
      try {
        text = opts.readSource(file);
      } catch {
        // unreadable: the entity links to its lines instead
      }
      // lines as the parser numbers them: a carriage return alone ends no line (CONTROLS drops it)
      texts.set(file, typeof text === 'string' ? text.replace(/^\uFEFF/, '').split(/\r?\n/) : null);
    }
    return texts.get(file);
  };
  // fixed form is shown as f77; a file another includes is read in the form of the file that includes it
  const forms = new Map();
  for (const f of ir.files) if (f.form) forms.set(f.path, f.form);
  for (const f of ir.files) for (const inc of f.includes ?? []) if (f.form && !forms.has(inc)) forms.set(inc, f.form);
  const sourceBlock = (e) => {
    if (!embed || UNITS.has(e.kind) || !(e.line > 0)) return '';
    const end = e.lineEnd ?? e.line;
    if (end < e.line || end - e.line + 1 > maxLines) return '';
    const lines = linesOf(e.file);
    if (!lines || end > lines.length) return '';
    const code = lines.slice(e.line - 1, end).map((l) => l.replace(CONTROLS, '')).join('\n');
    if (!code.trim()) return '';
    let f = '```';
    while (code.includes(f)) f += '`';
    return `${f}${forms.get(e.file) === 'fixed' ? 'f77' : 'f90'} lineNumbers=${e.line}\n${code}\n${f}`;
  };

  // ---- rendering helpers
  let seq = 0;
  const docOf = (x, name) => renderDoc(x?.doc?.blocks, { resolve, name, math: opts.math, ns: `n${++seq}`, include: opts.include, aliases: opts.aliases });
  const repoHref = (e) => {
    if (!opts.repo?.url) return undefined;
    const file = [opts.repo.root, e.file].filter(Boolean).join('/').replace(/\/+/g, '/');
    const lines = e.lineEnd && e.lineEnd !== e.line ? `#L${e.line}-L${e.lineEnd}` : `#L${e.line}`;
    return `${opts.repo.url.replace(/\/$/, '')}/blob/${opts.repo.rev ?? 'main'}/${file}${lines}`;
  };
  function shownPath(file) {
    return [opts.sourceRoot, file].filter(Boolean).join('/');
  }
  const source = (e) => {
    const lines = attr('line', e.line) + (e.lineEnd && e.lineEnd !== e.line ? attr('lineEnd', e.lineEnd) : '');
    const tag = `<FortranSource${attr('file', shownPath(e.file))}${lines}${attr('href', repoHref(e))}`;
    const code = sourceBlock(e);
    return code ? `${tag}>\n\n${code}\n\n</FortranSource>` : `${tag} />`;
  };
  const badges = (list) => (list.length ? `<FortranBadges>\n${list.map((b) => `<FortranBadge${attr('kind', b.kind)}${attr('label', b.label)}${attr('conditional', b.conditional)}${attr('title', b.title)} />`).join('\n')}\n</FortranBadges>` : '');
  const link = (name) => {
    const url = resolve(name);
    return url ? `[${inlineCode(name)}](${url})` : inlineCode(name);
  };
  // subroutine or function; a separate module procedure written `module procedure` is what its interface says
  const procKind = (e) => {
    const proc = e.proc === 'procedure' ? findInterface(e)?.proc : e.proc;
    return proc === 'function' ? 'function' : 'subroutine';
  };
  // what a headed entity is, in the words of the table of contents' letters
  const kindWord = (e) => {
    if (e.kind === 'procedure') return procKind(e);
    if (e.kind === 'variable') return e.parameter ? 'parameter' : 'variable';
    return e.kind;
  };

  const pages = [];
  for (const p of plan) {
    current = p.url;
    seq = 0;
    const body = p.unit ? unitPage(p.unit) : groupPage(p);
    const title = p.unit ? p.unit.name || 'main program' : p.group;
    const desc = p.unit ? plainText(docOf(p.unit, p.unit.name).summary)
      : p.procs.length === 1 ? plainText(docOf(p.procs[0], p.procs[0].name).summary) || `The external procedure ${p.procs[0].name}`
        : `External procedures: ${p.procs.map((e) => e.name).join(', ')}`;
    const origin = [...new Set((p.unit ? [p.unit] : p.procs).map((e) => e.file))].join(', ');
    const toc = headed(p).map((e) => [anchor(e), kindWord(e)]);
    const note = `{/* Generated by fumadocs-fortran from ${origin.replace(/\*\//g, '* /')}. Do not edit. */}`;
    pages.push({
      path: `${p.slug}.mdx`,
      url: p.url,
      title,
      mdx: `${frontMatter(title, desc, p.unit ? p.unit.kind : 'procedures', toc)}\n${note}\n\n${body.trim()}\n`,
    });
  }
  current = `${base}`;
  pages.unshift({ path: 'index.mdx', url: base, title: opts.title ?? 'API reference', mdx: overviewPage() });

  const sep = (t) => `---${t}---`;
  const sectionOf = (kinds, label) => {
    const list = plan.filter((p) => (p.unit ? kinds.includes(p.unit.kind) : kinds.includes('procedures')));
    return list.length ? [sep(label), ...list.map((p) => p.slug)] : [];
  };
  const metas = [{
    path: 'meta.json',
    data: {
      title: opts.title ?? 'API reference',
      ...(opts.defaultOpen ? { defaultOpen: true } : {}),
      pages: ['index', ...sectionOf(['module'], 'Modules'), ...sectionOf(['submodule'], 'Submodules'), ...sectionOf(['program'], 'Programs'), ...sectionOf(['blockdata'], 'Block data'), ...sectionOf(['procedures'], 'Procedures')],
    },
  }];
  return { pages, metas };

  // ------------------------------------------------------------ page bodies

  function overviewPage() {
    const card = (p) => {
      const summary = p.unit ? plainText(docOf(p.unit, p.unit.name).summary) : `${p.procs.length} external procedure${p.procs.length > 1 ? 's' : ''}: ${p.procs.map((e) => e.name).join(', ')}`;
      const title = p.unit ? p.unit.name || 'main program' : p.group;
      // the card is a link: its text is a JS string, not Markdown, so that no autolink nests in it
      return `<Card${attr('title', title)}${attr('href', p.url)}>\n{${JSON.stringify(summary || p.unit?.kind || '')}}\n</Card>`;
    };
    const parts = [];
    for (const [kinds, label] of [[['module'], 'Modules'], [['submodule'], 'Submodules'], [['program'], 'Programs'], [['blockdata'], 'Block data'], [['procedures'], 'Procedures']]) {
      const list = plan.filter((p) => (p.unit ? kinds.includes(p.unit.kind) : kinds.includes('procedures')));
      if (list.length) parts.push(`## ${label}\n\n<Cards>\n${list.map(card).join('\n')}\n</Cards>`);
    }
    const overview = graphCard('', graphs?.overview());
    if (overview) parts.push(`## Dependencies\n\n${overview}`);
    const files = ir.files.filter((f) => !f.skipped);
    const lines = files.reduce((n, f) => n + (f.lines ?? 0), 0);
    const intro = opts.description ?? `Generated by fumadocs-fortran from ${files.length} source file${files.length === 1 ? '' : 's'} (${lines.toLocaleString('en-GB')} lines).`;
    return `---\ntitle: ${yamlString(opts.title ?? 'API reference')}\ndescription: ${yamlString(plainText(intro))}\n---\n\n{/* Generated by fumadocs-fortran. Do not edit. */}\n\n${parts.join('\n\n')}\n`;
  }

  function unitPage(u) {
    const out = [];
    const kids = children(u);
    out.push(badges([{ kind: u.kind }, ...rollup(u)]));
    const doc = docOf(u, u.name);
    // the page's description already shows the summary under the title; a plain summary is not repeated
    let body = doc.body;
    // (only when the description holds the whole summary: it is cut at 300 characters, and has no markup)
    if (doc.summary && doc.summary.length <= 300 && body.startsWith(doc.summary) && plainText(doc.summary) === decodeText(doc.summary).replace(/\s+/g, ' ').trim()) {
      body = body.slice(doc.summary.length).trim();
    }
    if (body) out.push(body);
    if (u.kind === 'submodule') out.push(`Submodule of ${link(u.ancestor)}${u.parentSubmodule ? `, a descendant of ${link(u.parentSubmodule)}` : ''}.`);
    const uses = usesLine(u);
    if (uses) out.push(uses);
    if (u.calls?.length) out.push(callsLine(u));
    out.push(source(u));
    if (graphs) {
      out.push(graphCard('Dependencies', graphs.dependencies(u)));
      if (u.kind === 'program') out.push(graphCard('Call graph', graphs.calls(u), true));
    }
    const types = kids.filter((c) => c.kind === 'type' && shown(c));
    const ifaces = kids.filter((c) => c.kind === 'interface');
    const procs = kids.filter((c) => c.kind === 'procedure' && c.scope !== 'internal' && shown(c));
    const internals = kids.filter((c) => c.kind === 'procedure' && c.scope === 'internal');
    const vars = kids.filter((c) => c.kind === 'variable' && shown(c));
    const enums = kids.filter((c) => c.kind === 'enum');
    if (types.length) out.push('## Types', ...types.map(typeSection));
    const ifaceSections = ifaces.flatMap(interfaceSections).filter(Boolean);
    if (ifaceSections.length) out.push('## Interfaces', ...ifaceSections);
    if (procs.length) out.push('## Procedures', ...procs.map((e) => procSection(e)));
    if (internals.length) out.push(u.kind === 'program' ? '## Procedures' : '## Internal procedures', ...internals.map((e) => procSection(e)));
    if (vars.length) out.push('## Variables', ...vars.map(varSection));
    if (enums.length) out.push('## Enumerations', ...enums.map(enumSection));
    return out.filter(Boolean).join('\n\n');
  }

  function groupPage(p) {
    const out = [];
    out.push(`External procedure${p.procs.length > 1 ? 's' : ''} from ${[...new Set(p.procs.map((e) => inlineCode(e.file)))].join(', ')}.`);
    out.push(...p.procs.map((e) => procSection(e)));
    return out.join('\n\n');
  }

  // ------------------------------------------------------------ sections

  function heading(e, text = e.name) {
    return `### ${escapeHeading(text)} [#${anchor(e)}]`;
  }

  function procSection(e, opt = {}) {
    const out = [heading(e)];
    out.push(fence(procSignature(e, opt)));
    out.push(badges(procBadges(e, opt)));
    const doc = docOf(e, e.name);
    // a separate module procedure takes its arguments and docs from its interface
    const iface = e.scope === 'separate' ? findInterface(e) : null;
    const args = e.args ?? iface?.args ?? [];
    const idoc = iface ? docOf(iface, iface.name) : null;
    // a doc written above an abstract or explicit interface block goes first, as FORD shows it
    if (opt.block) {
      const bdoc = docOf(opt.block, opt.block.name);
      if (bdoc.body) out.push(bdoc.body);
    }
    if (doc.body) out.push(doc.body);
    else if (idoc?.body) out.push(idoc.body);
    if (iface) {
      const block = E[iface.parent];
      const mod = E[block?.parent];
      out.push(`Implements ${inlineCode(iface.name)}, declared in ${block?.name ? `the interface ${link(block.name)} of ` : ''}${mod ? link(mod.name) : 'its module'}.`);
    }
    // argument docs: the procedure's own, else its interface's (by name), else \param
    const inherited = {};
    for (const a of iface?.args ?? []) {
      const d = docOf(a, a.name).body;
      if (d) inherited[a.name.toLowerCase()] = d;
    }
    // arguments taken from the interface are declared in the interface's scope
    out.push(argsList(args, e.args ? e : iface ?? e, {
      params: { ...(idoc?.params ?? {}), ...inherited, ...doc.params },
      intents: { ...(idoc?.paramIntents ?? {}), ...doc.paramIntents },
      called: new Set((e.calls ?? []).map((c) => lc(c.name))),
    }));
    const result = e.result ?? iface?.result;
    if (result && e.proc !== 'subroutine') {
      out.push(argsList([result], e.result ? e : iface ?? e, { title: 'Result', returns: doc.returns, result: true }));
    } else if (doc.returns) out.push(labelled('**Returns:**', doc.returns));
    if (e.calls?.length) out.push(callsLine(e));
    const uses = usesLine(e);
    if (uses) out.push(uses);
    if (graphs) out.push(graphCard('Call graph', graphs.calls(e), true));
    out.push(source(e));
    return out.filter(Boolean).join('\n\n');
  }

  function findInterface(e) {
    if (!separateBodies) {
      separateBodies = new Map();
      for (const x of all) {
        if (x.kind !== 'procedure' || x.scope !== 'interface' || !x.separate) continue;
        const k = x.name.toLowerCase();
        if (!separateBodies.has(k)) separateBodies.set(k, []);
        separateBodies.get(k).push(x);
      }
    }
    const ancestor = E[e.parent]?.ancestor?.toLowerCase();
    return (separateBodies.get(String(e.name ?? '').toLowerCase()) ?? [])
      .find((x) => !ancestor || x.id.startsWith(`module:${ancestor}/`));
  }

  /**
   * A FortranArgs table: `columns` names the optional columns some row fills (type, shape, intent, attrs, in that
   * order), then the rows. It is written even when empty, since no `columns` means all four.
   */
  function argsTable(title, rows) {
    if (!rows.length) return '';
    const columns = [
      rows.some((r) => r.type) && 'type',
      rows.some((r) => r.dims || r.codims) && 'shape',
      rows.some((r) => r.intent || r.result) && 'intent',
      rows.some((r) => r.optional || r.value || r.attrs || r.cond) && 'attrs',
    ].filter(Boolean).join(' ');
    const head = `<FortranArgs${title === 'Arguments' ? '' : attr('title', title)} columns="${columns}">`;
    return `${head}\n${rows.map(argRow).join('\n')}\n</FortranArgs>`;
  }

  /** A row for a variable (argument, result, component or type parameter) declared in `scope`. */
  function varRow(a, scope, extra = {}) {
    return {
      name: a.name,
      type: prettyType(a.type),
      dims: a.dims ? `(${a.dims.join(',')})` : '',
      codims: a.codims ? `[${a.codims.join(',')}]` : '',
      intent: a.intent,
      optional: a.optional,
      value: a.value,
      attrs: attrsText(a),
      cond: a.cond ? prettyCond(a.cond) : '',
      decl: declOf(a),
      refs: refsFor(a.type, scope),
      ...extra,
    };
  }

  /** `called`: the lower-case names the procedure CALLs, which name dummy subroutines among its arguments. */
  function argsList(args, scope, opts = {}) {
    const { params = {}, title = 'Arguments', returns, intents = {}, result = false, called } = opts;
    if (!args?.length) return '';
    return argsTable(title, args.map((a) => {
      const key = a.name.toLowerCase();
      let doc = docOf(a, a.name).body || (Object.hasOwn(params, key) ? params[key] : '') || '';
      if (returns && !doc) doc = returns;
      // F77 code declares no INTENT: Doxygen's \param[in] says it (the declaration stays as written)
      const intent = a.intent ?? (Object.hasOwn(intents, key) ? intents[key] : undefined);
      // a dummy argument the procedure CALLs is a subroutine, which has no type: not the one the implicit rules give
      const sub = !!a.type?.implicit && !!called?.has(key);
      return varRow(sub ? { ...a, type: null } : a, scope, { intent, result, doc });
    }));
  }

  /** A type-bound procedure's row: its target as the type, its flags as attributes, its statement as the decl. */
  function bindingRow(x, doc = '') {
    const flags = [
      x.deferred && 'deferred', x.nopass && 'nopass', typeof x.pass === 'string' && `pass(${x.pass})`,
      x.pass === true && 'pass', x.nonOverridable && 'non_overridable', x.access === 'private' && 'private',
    ].filter(Boolean);
    const generic = x.binding === 'generic';
    const head = generic ? 'generic' : x.iface ? `procedure(${x.iface})` : 'procedure';
    const target = generic ? ` => ${x.procedures.join(', ')}` : x.impl ? ` => ${x.impl}` : '';
    const type = generic ? `generic${target}` : x.iface ? head : x.impl ? `=> ${x.impl}` : 'procedure';
    const decl = `${[head, ...flags].join(', ')} :: ${x.name}${target}`;
    return { name: x.name, type, attrs: flags.join(', '), decl, doc };
  }

  function typeSection(t) {
    const out = [heading(t)];
    const params = t.params ?? [];
    out.push(fence(typeDecl(t)));
    const b = [{ kind: 'type' }];
    if (t.abstract) b.push({ kind: 'abstract' });
    if (t.bind !== undefined) b.push({ kind: 'bindc', label: 'bind(C)' });
    if (t.access === 'private') b.push({ kind: 'private' });
    if (t.cond) b.push({ kind: 'cpp', conditional: prettyCond(t.cond), label: 'conditional' });
    out.push(badges(b));
    const doc = docOf(t, t.name);
    if (doc.body) out.push(doc.body);
    if (t.extends) {
      // the name as the type statement writes it, linked to the heading of the type it names
      const parent = parentOf(t);
      const url = parent && where.get(parent.id);
      out.push(`Extends ${url ? `[${inlineCode(t.extends)}](${url})` : inlineCode(t.extends)}.`);
    }
    if (params.length) {
      // the row shows "kind, default dp"; the declaration says it as Fortran
      out.push(argsTable('Type parameters', params.map((p) => {
        const attrs = [[p.attr, p.init !== undefined && `default ${p.init}`].filter(Boolean).join(', ')];
        const decl = declOf({ ...p, attrs: p.attr ? [p.attr] : [] });
        return varRow({ ...p, attrs, init: undefined }, t, { decl, doc: docOf(p, p.name).body });
      })));
    }
    const comps = children(t).filter((c) => c.kind === 'component' && shown(c));
    const component = (c) => varRow(c, t, { decl: componentDecl(c), doc: docOf(c, c.name).body });
    if (comps.length) out.push(argsTable('Components', comps.map(component)));
    const binds = children(t).filter((c) => c.kind === 'binding' && shown(c));
    if (binds.length) {
      out.push(argsTable('Type-bound procedures', binds.map((x) => {
        const d = docOf(x, x.name).body;
        const impl = x.binding === 'generic' ? x.procedures : [x.impl ?? (x.iface ? x.iface : x.name)];
        const links = impl.map((n) => resolve(n) ? `[${inlineCode(n)}](${resolve(n)})` : null).filter(Boolean);
        const by = links.length ? `${x.deferred ? 'Interface' : 'Implemented by'} ${links.join(', ')}.` : '';
        return bindingRow(x, [d, by].filter(Boolean).join('\n\n'));
      })));
    }
    out.push(...inherited(t));
    if (t.finals?.length) out.push(`**Final:** ${t.finals.map(link).join(', ')}`);
    if (graphs) out.push(graphCard('Inheritance', graphs.inheritance(t), true));
    out.push(source(t));
    return out.filter(Boolean).join('\n\n');
  }

  /**
   * What a type inherits: for each ancestor up the extends chain (each parent found in the scope of the type that
   * extends it), its components and type-bound procedures that no nearer type declares again (an overriding binding,
   * such as matvec, hides its parent's).
   */
  function inherited(t) {
    const out = [];
    const declared = new Set(children(t).map((c) => c.name.toLowerCase()));
    const seen = new Set([t.id]);
    for (let parent = parentOf(t); parent && !seen.has(parent.id); parent = parentOf(parent)) {
      seen.add(parent.id);
      const members = children(parent).filter((c) => (c.kind === 'component' || c.kind === 'binding') && shown(c) && !declared.has(c.name.toLowerCase()));
      // a member's names are read in the scope of the type that declares it
      const row = (c) => (c.kind === 'component' ? varRow(c, parent, { decl: componentDecl(c) }) : bindingRow(c));
      if (members.length) out.push(argsTable(`Inherited from ${parent.name}`, members.map(row)));
      for (const c of members) declared.add(c.name.toLowerCase());
    }
    return out;
  }

  function interfaceSections(i) {
    const bodies = children(i).filter((b) => b.kind === 'procedure');
    // abstract and explicit interfaces declare procedures: each body is an entry of its own
    if (i.ikind === 'abstract' || i.ikind === 'explicit') {
      // a doc written above the interface block goes with its first procedure, when that has none of its own
      return bodies.filter(shown).map((b) => procSection(b, { interface: i.ikind, block: i }));
    }
    if (!shown(i)) return [];
    const out = [heading(i)];
    const lines = [`interface ${i.name}`];
    for (const b of bodies) lines.push(`  ${procSignature(b, {}).split('\n')[0]}`);
    if (i.procedures?.length) lines.push(`  module procedure ${i.procedures.join(', ')}`);
    lines.push('end interface');
    out.push(fence(i.statement ? `generic :: ${i.name} => ${i.procedures.join(', ')}` : lines.join('\n')));
    const b = [{ kind: 'interface', label: { generic: 'generic interface', operator: 'operator', assignment: 'assignment', dtio: 'defined I/O' }[i.ikind] ?? 'interface' }];
    if (i.access === 'private') b.push({ kind: 'private' });
    out.push(badges(b));
    const doc = docOf(i, i.name);
    if (doc.body) out.push(doc.body);
    if (i.procedures?.length) out.push(`**Specific procedures:** ${i.procedures.map(link).join(', ')}`);
    for (const body of bodies) {
      const d = docOf(body, body.name);
      const sig = procSignature(body, {}).split('\n')[0].replace(/^module /, '');
      out.push(labelled(`**${escapeText(body.name)}**`, d.body, ':'));
      out.push(argsList(body.args, body, { params: d.params, title: `Arguments of ${sig.replace(/\s+/g, ' ')}` }));
      if (body.result && body.proc === 'function') {
        out.push(argsList([body.result], body, { title: `Result of ${body.name}`, returns: d.returns, result: true }));
      }
    }
    if (graphs) out.push(graphCard('Call graph', graphs.calls(i), true));
    out.push(source(i));
    return [out.filter(Boolean).join('\n\n')];
  }

  function varSection(v) {
    const out = [heading(v)];
    out.push(fence(varDecl(v)));
    const b = [];
    if (v.parameter) b.push({ kind: 'parameter', label: 'parameter' });
    if (v.access === 'private') b.push({ kind: 'private' });
    if (v.cond) b.push({ kind: 'cpp', label: 'conditional', conditional: prettyCond(v.cond) });
    out.push(badges(b));
    const doc = docOf(v, v.name);
    if (doc.body) out.push(doc.body);
    out.push(source(v));
    return out.filter(Boolean).join('\n\n');
  }

  function enumSection(en) {
    // an unnamed enum (enum, bind(c)) is titled by its enumerators
    const out = [heading(en, en.name || en.enumerators.map((x) => x.name).join(', ') || 'enumeration')];
    const names = en.enumerators.map((x) => `${x.name}${x.init !== undefined ? ` = ${x.init}` : ''}`).join(', ');
    out.push(fence(en.enumeration ? `enumeration type :: ${en.name}\n  enumerator :: ${names}\nend enumeration type` : `enum${en.bind ? `, bind(${en.bind})` : ''}${en.name ? ` :: ${en.name}` : ''}\n  enumerator :: ${names}\nend enum`));
    const doc = docOf(en, en.name);
    if (doc.body) out.push(doc.body);
    const rows = en.enumerators.filter((x) => !x.access || display.has(x.access)).map((x) => ({
      name: x.name,
      attrs: [x.init !== undefined && `= ${x.init}`, x.access === 'private' && 'private'].filter(Boolean).join(', '),
      decl: `enumerator :: ${x.name}${x.init !== undefined ? ` = ${x.init}` : ''}`,
      doc: docOf(x, x.name).body,
    }));
    if (rows.length) out.push(argsTable('Enumerators', rows));
    out.push(source(en));
    return out.filter(Boolean).join('\n\n');
  }

  // ------------------------------------------------------------ signatures, badges, lines

  function procSignature(e, opt) {
    const prefix = (e.prefix ?? []).filter((p) => p !== 'module');
    const isModule = e.scope === 'separate' || (e.scope === 'interface' && e.separate);
    if (e.proc === 'procedure') return `module procedure ${e.name}`;
    const rtype = e.proc === 'function' && e.result?.typeInHeader ? [prettyType(e.result.type)] : [];
    const words = [...(isModule ? ['module'] : []), ...prefix, ...rtype, e.proc, e.name].join(' ');
    const args = (e.args ?? []).map((a) => a.name).join(', ');
    const res = e.proc === 'function' && e.result && e.result.name.toLowerCase() !== e.name.toLowerCase() ? ` result(${e.result.name})` : '';
    const bind = e.bind !== undefined ? ` bind(${(e.bind || 'c').replace(/,(?!\s)/g, ', ')})` : '';
    const sig = `${words}(${args})${res}${bind}`;
    if (opt.interface === 'abstract') return `abstract interface\n  ${sig}\nend interface`;
    if (opt.interface === 'explicit') return `interface\n  ${sig}\nend interface`;
    return sig;
  }

  function procBadges(e, opt = {}) {
    const b = [{ kind: procKind(e) }];
    if (e.scope === 'interface') b.push({ kind: 'interface', label: opt.interface === 'abstract' ? 'abstract interface' : e.separate ? 'module interface' : 'interface' });
    if (e.scope === 'separate') b.push({ kind: 'submodule', label: 'separate module procedure' });
    for (const p of e.prefix ?? []) if (ATTR_PREFIX.has(p)) b.push({ kind: p.replace('_', '-') });
    if (e.bind !== undefined) b.push({ kind: 'bindc', label: 'bind(C)' });
    if (accessOf(e) === 'private') b.push({ kind: 'private' });
    if (e.cond) b.push({ kind: 'cpp', label: 'conditional', conditional: prettyCond(e.cond) });
    return [...b, ...hpcBadges(e)];
  }

  /** What a caller needs to know about HPC use, from the directives, calls and coarrays the parser found. */
  function hpcBadges(e) {
    const b = [];
    const dirs = (e.hpc?.directives ?? []).filter((d) => !d.end);
    const when = (items) => {
      const conds = items.map((x) => (x.cond ? prettyCond(x.cond) : ''));
      return conds.every((c) => c && c === conds[0]) ? conds[0] : undefined;
    };
    const omp = dirs.filter((d) => d.family === 'omp');
    const offload = omp.filter((d) => /\btarget\b/.test(d.construct));
    const regions = omp.filter((d) => /\b(parallel|teams)\b/.test(d.construct) && !/\btarget\b/.test(d.construct));
    if (regions.length) b.push({ kind: 'omp', label: 'OpenMP parallel region', conditional: when(regions), title: regions.map((d) => d.construct).join('; ') });
    else if (omp.length > offload.length) b.push({ kind: 'omp', label: 'OpenMP', conditional: when(omp), title: omp.map((d) => d.construct).join('; ') });
    if (offload.length) b.push({ kind: 'offload', label: 'OpenMP offload', conditional: when(offload), title: offload.map((d) => d.construct).join('; ') });
    const acc = dirs.filter((d) => d.family === 'acc');
    if (acc.length) b.push({ kind: 'acc', label: acc.every((d) => d.construct === 'routine') ? 'OpenACC routine' : 'OpenACC', conditional: when(acc), title: acc.map((d) => d.construct).join('; ') });
    if (dirs.some((d) => d.family === 'cuf')) b.push({ kind: 'cuda', label: 'CUDA Fortran' });
    const mpi = (e.calls ?? []).filter((c) => /^mpi_/i.test(c.name));
    if (mpi.length) b.push({ kind: 'mpi', label: 'MPI', conditional: when(mpi), title: [...new Set(mpi.map((c) => c.name))].join(', ') });
    if (e.hpc?.coarray) b.push({ kind: 'coarray', label: 'coarrays' });
    return b;
  }

  /** A unit's badges: the HPC use of its procedures, and the HPC modules it uses. */
  function rollup(u) {
    const seen = new Map();
    const note = (b) => {
      const prev = seen.get(b.kind);
      if (!prev) seen.set(b.kind, { ...b, title: undefined, label: { omp: 'OpenMP', acc: 'OpenACC' }[b.kind] ?? b.label });
      else if (prev.conditional !== b.conditional) prev.conditional = undefined;
    };
    const visit = (e) => {
      for (const b of hpcBadges(e)) note(b);
      for (const c of children(e)) if (c.kind === 'procedure' || c.kind === 'interface') visit(c);
    };
    visit(u);
    for (const use of u.uses ?? []) {
      const mod = use.module.toLowerCase();
      const k = Object.hasOwn(HPC_MODULES, mod) ? HPC_MODULES[mod] : undefined;
      if (k) note({ kind: k, label: { mpi: 'MPI', omp: 'OpenMP', acc: 'OpenACC', cuda: 'CUDA Fortran' }[k], conditional: use.cond ? prettyCond(use.cond) : undefined });
    }
    return [...seen.values()];
  }

  function usesLine(e) {
    if (!e.uses?.length) return '';
    const items = e.uses.map((u) => {
      const only = u.only?.map((x) => inlineCode(x.local ? `${x.local} => ${x.name}` : x.name)).join(', ');
      const target = resolve(u.module) ? `[${inlineCode(u.module)}](${resolve(u.module)})` : inlineCode(u.module);
      return `${target}${only ? ` (${only})` : ''}${u.cond ? ` when ${escapeText(prettyCond(u.cond))}` : ''}`;
    });
    return `**Uses:** ${items.join('; ')}`;
  }

  function callsLine(e) {
    const seen = new Map();
    for (const c of e.calls) {
      const k = c.name.toLowerCase();
      if (!seen.has(k)) seen.set(k, { name: c.name, conds: new Set() });
      seen.get(k).conds.add(c.cond ? prettyCond(c.cond) : '');
    }
    const items = [...seen.values()].map((c) => {
      const cond = c.conds.size === 1 && !c.conds.has('') ? ` when ${escapeText([...c.conds][0])}` : '';
      return `${link(c.name)}${cond}`;
    });
    return `**Calls:** ${items.join(', ')}`;
  }
}

/** At most n characters (code points, so a surrogate pair is never split), cut at a word when one is near. */
function clip(s, n = 300) {
  const cps = Array.from(s);
  if (cps.length <= n) return s;
  const cut = cps.slice(0, n).join('');
  const sp = cut.lastIndexOf(' ');
  return `${sp > n / 2 ? cut.slice(0, sp) : cut}…`;
}

/**
 * The front matter: the title, the description, and `fortran` for the site: the page's kind and what each heading's
 * anchor is (`toc`, for the kind letters in the table of contents). Every string is a double-quoted YAML scalar.
 */
function frontMatter(title, desc, kind, toc) {
  const entries = toc.length ? `\n${toc.map(([a, k]) => `    ${yamlString(a)}: ${yamlString(k)}`).join('\n')}` : ' {}';
  const description = desc ? `description: ${yamlString(clip(desc))}\n` : '';
  const fortran = `fortran:\n  kind: ${yamlString(kind)}\n  toc:${entries}\n`;
  return `---\ntitle: ${yamlString(title)}\n${description}${fortran}---\n`;
}

/**
 * A bold label and a doc body: on one line only when the body starts as a paragraph. A Callout, a fence, a $$ block,
 * a list, a quote, a table or other block after a label would be read as text, its closing line opening a block
 * that runs to the end of the page.
 */
function labelled(label, body, colon = '') {
  if (!body) return label;
  const [first, second = ''] = body.split('\n');
  const block = /^[ \t]*(<|`{3,}|~{3,}|\$\$|[-*+][ \t]|\d+[.)][ \t]|>|\||#|([-*_])[ \t]*\2[ \t]*\2)/.test(first)
    || /^[ \t]*\|?[ \t]*:?-+:?[ \t]*(\|[ \t]*:?-+:?[ \t]*)+\|?[ \t]*$/.test(second);
  return block ? `${label}\n\n${body}` : `${label}${colon} ${body}`;
}

/** A type as written, with a blank after each top-level comma: `class(banded_matrix(k=dp, kl=*, ku=*))`. */
export function prettyType(t) {
  if (!t) return undefined;
  return t.text.replace(/,(?!\s)/g, ', ') + (t.implicit ? ' (implicit)' : '');
}

/** `defined(USE_MPI)` reads as USE_MPI, `!defined(X)` as "not X". */
export function prettyCond(terms) {
  return terms.map((t) => t.replace(/^defined\((\w+)\)$/, '$1').replace(/^!defined\((\w+)\)$/, 'not $1')).join(' and ');
}

function attrsText(a, forDecl = false) {
  const list = [...(a.attrs ?? [])];
  if (!forDecl && a.init !== undefined) list.push(`${a.pointerInit ? '=>' : '='} ${a.init}`);
  return list.join(', ');
}

/**
 * A variable's declaration as Fortran: the type, intent, optional, value and the other attributes, then the name with
 * its dimensions, codimensions and initial value: `real(dp), intent(in), optional :: x(:)`. A type the implicit rules
 * give is written out, with a comment that says so. Empty when nothing is declared.
 */
function declOf(a, extra = []) {
  const implicit = !!a.type?.implicit;
  const parts = [
    prettyType(implicit ? { ...a.type, implicit: false } : a.type), a.intent && `intent(${a.intent})`,
    a.optional && 'optional', a.value && 'value', ...(a.attrs ?? []), ...extra,
  ].filter(Boolean);
  if (!parts.length) return '';
  return `${parts.join(', ')} :: ${entityText(a)}${implicit ? ' ! implicitly typed' : ''}`;
}

/** A declared name with its dimensions, codimensions and initial value: `x(:,:)[*] = 0`. */
function entityText(v) {
  const init = v.init !== undefined ? ` ${v.pointerInit ? '=>' : '='} ${v.init}` : '';
  return `${v.name}${v.dims ? `(${v.dims.join(',')})` : ''}${v.codims ? `[${v.codims.join(',')}]` : ''}${init}`;
}

/** A component's declaration: a private one says so. */
function componentDecl(c) {
  return declOf(c, [c.access === 'private' && 'private']);
}

/** A derived type's statement: `type, extends(abstract_matrix) :: dense_matrix`. */
function typeDecl(t) {
  const bind = t.bind !== undefined && `bind(${t.bind || 'c'})`;
  const attrs = ['type', t.abstract && 'abstract', t.extends && `extends(${t.extends})`, bind].filter(Boolean);
  const params = t.params?.length ? `(${t.params.map((p) => p.name).join(', ')})` : '';
  return `${attrs.join(', ')} :: ${t.name}${params}`;
}

/** A module variable's declaration: `integer, parameter :: max_order = 64`. */
function varDecl(v) {
  const attrs = [prettyType(v.type) ?? 'real', v.parameter && 'parameter', attrsText(v, true)].filter(Boolean);
  return `${attrs.join(', ')} :: ${entityText(v)}`;
}

/** One FortranArg: the props as today, then result, decl and refs (an object, as a JS expression). */
function argRow(r) {
  const props = attr('name', r.name) + attr('type', r.type) + attr('dims', r.dims) + attr('codims', r.codims)
    + attr('intent', r.intent) + attr('optional', !!r.optional) + attr('value', !!r.value) + attr('attrs', r.attrs)
    + attr('cond', r.cond) + attr('result', !!r.result) + attr('decl', r.decl)
    + (r.refs ? ` refs={${JSON.stringify(r.refs)}}` : '');
  return r.doc ? `<FortranArg${props}>\n\n${r.doc}\n\n</FortranArg>` : `<FortranArg${props} />`;
}

function fence(code) {
  let f = '```';
  while (code.includes(f)) f += '`';
  return `${f}f90\n${code}\n${f}`;
}

function escapeHeading(s) {
  return escapeText(s);
}
