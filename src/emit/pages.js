// From the IR to fumadocs pages: one MDX page per module, submodule and program, pages for external procedures
// (grouped by \ingroup, else by file), an overview page, and meta.json for the sidebar. Each entity gets a `###`
// heading with an explicit ID and no sub-headings, so fumadocs' <include>page.mdx#id</include> embeds exactly one.

import path from 'node:path';
import { renderDoc } from '../docs/index.js';
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
 *   the project root); without it they are dropped
 * @property {Record<string, string>} [aliases] FORD's |name| aliases; a name not here stays as written
 */

const OPS = { '+': 'plus', '-': 'minus', '*': 'times', '/': 'divide', '**': 'power', '//': 'concat', '==': 'eq', '/=': 'ne', '<': 'lt', '<=': 'le', '>': 'gt', '>=': 'ge' };
const HPC_MODULES = { mpi: 'mpi', mpi_f08: 'mpi', mpif: 'mpi', omp_lib: 'omp', omp_lib_kinds: 'omp', openacc: 'acc', cudafor: 'cuda', cublas: 'cuda' };
const ATTR_PREFIX = new Set(['pure', 'impure', 'elemental', 'recursive', 'non_recursive', 'simple']);

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
  // a separate module procedure has the access of the interface body that declares it
  const accessOf = (e) => e.access ?? (e.scope === 'separate' ? findInterface(e)?.access : undefined);
  const shown = (e) => {
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

  // ---- rendering helpers
  let seq = 0;
  const docOf = (x, name) => renderDoc(x?.doc?.blocks, { resolve, name, math: opts.math, ns: `n${++seq}`, include: opts.include, aliases: opts.aliases });
  const repoHref = (e) => {
    if (!opts.repo?.url) return undefined;
    const file = [opts.repo.root, e.file].filter(Boolean).join('/').replace(/\/+/g, '/');
    const lines = e.lineEnd && e.lineEnd !== e.line ? `#L${e.line}-L${e.lineEnd}` : `#L${e.line}`;
    return `${opts.repo.url.replace(/\/$/, '')}/blob/${opts.repo.rev ?? 'main'}/${file}${lines}`;
  };
  const source = (e) => `<FortranSource${attr('file', [opts.sourceRoot, e.file].filter(Boolean).join('/'))}${attr('line', e.line)}${e.lineEnd && e.lineEnd !== e.line ? attr('lineEnd', e.lineEnd) : ''}${attr('href', repoHref(e))} />`;
  const badges = (list) => (list.length ? `<FortranBadges>\n${list.map((b) => `<FortranBadge${attr('kind', b.kind)}${attr('label', b.label)}${attr('conditional', b.conditional)}${attr('title', b.title)} />`).join('\n')}\n</FortranBadges>` : '');
  const link = (name) => {
    const url = resolve(name);
    return url ? `[${inlineCode(name)}](${url})` : inlineCode(name);
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
    pages.push({
      path: `${p.slug}.mdx`,
      url: p.url,
      title,
      mdx: `---\ntitle: ${yamlString(title)}\n${desc ? `description: ${yamlString(clip(desc))}\n` : ''}---\n\n{/* Generated by fumadocs-fortran from ${origin.replace(/\*\//g, '* /')}. Do not edit. */}\n\n${body.trim()}\n`,
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
    out.push(argsList(args, { ...(idoc?.params ?? {}), ...inherited, ...doc.params }, 'Arguments', undefined, { ...(idoc?.paramIntents ?? {}), ...doc.paramIntents }));
    const result = e.result ?? iface?.result;
    if (result && e.proc !== 'subroutine') out.push(argsList([result], {}, 'Result', doc.returns));
    else if (doc.returns) out.push(labelled('**Returns:**', doc.returns));
    if (e.calls?.length) out.push(callsLine(e));
    const uses = usesLine(e);
    if (uses) out.push(uses);
    out.push(source(e));
    return out.filter(Boolean).join('\n\n');
  }

  function findInterface(e) {
    const sub = E[e.parent];
    const ancestor = sub?.ancestor?.toLowerCase();
    return all.find((x) => x.kind === 'procedure' && x.scope === 'interface' && x.separate && x.name.toLowerCase() === e.name.toLowerCase()
      && (!ancestor || x.id.startsWith(`module:${ancestor}/`)));
  }

  function argsList(args, params = {}, title, returns, intents = {}) {
    if (!args?.length) return '';
    const rows = args.map((a) => {
      const own = docOf(a, a.name);
      const key = a.name.toLowerCase();
      let doc = own.body || (Object.hasOwn(params, key) ? params[key] : '') || '';
      if (returns && !doc) doc = returns;
      // F77 code declares no INTENT: Doxygen's \param[in] says it
      const intent = a.intent ?? (Object.hasOwn(intents, key) ? intents[key] : undefined);
      const props = attr('name', a.name) + attr('type', prettyType(a.type)) + attr('dims', a.dims ? `(${a.dims.join(',')})` : '')
        + attr('codims', a.codims ? `[${a.codims.join(',')}]` : '') + attr('intent', intent) + attr('optional', !!a.optional)
        + attr('value', !!a.value) + attr('attrs', attrsText(a)) + attr('cond', a.cond ? prettyCond(a.cond) : '');
      return doc ? `<FortranArg${props}>\n\n${doc}\n\n</FortranArg>` : `<FortranArg${props} />`;
    });
    return `<FortranArgs${title === 'Arguments' ? '' : attr('title', title)}>\n${rows.join('\n')}\n</FortranArgs>`;
  }

  function typeSection(t) {
    const out = [heading(t)];
    const attrs = [t.abstract && 'abstract', t.extends && `extends(${t.extends})`, t.bind !== undefined && `bind(${t.bind || 'c'})`].filter(Boolean);
    const params = t.params ?? [];
    out.push(fence(`type${attrs.length ? `, ${attrs.join(', ')}` : ''} :: ${t.name}${params.length ? `(${params.map((p) => p.name).join(', ')})` : ''}`));
    const b = [{ kind: 'type' }];
    if (t.abstract) b.push({ kind: 'abstract' });
    if (t.bind !== undefined) b.push({ kind: 'bindc', label: 'bind(C)' });
    if (t.access === 'private') b.push({ kind: 'private' });
    if (t.cond) b.push({ kind: 'cpp', conditional: prettyCond(t.cond), label: 'conditional' });
    out.push(badges(b));
    const doc = docOf(t, t.name);
    if (doc.body) out.push(doc.body);
    if (t.extends) out.push(`Extends ${link(t.extends)}.`);
    if (params.length) out.push(argsList(params.map((p) => ({ ...p, attrs: [[p.attr, p.init !== undefined && `default ${p.init}`].filter(Boolean).join(', ')], init: undefined })), {}, 'Type parameters'));
    const comps = children(t).filter((c) => c.kind === 'component' && shown(c));
    if (comps.length) out.push(argsList(comps, {}, 'Components'));
    const binds = children(t).filter((c) => c.kind === 'binding' && shown(c));
    if (binds.length) {
      const rows = binds.map((x) => {
        const target = x.binding === 'generic' ? `generic => ${x.procedures.join(', ')}` : x.iface ? `procedure(${x.iface})` : x.impl ? `=> ${x.impl}` : 'procedure';
        const flags = [x.deferred && 'deferred', x.nopass && 'nopass', typeof x.pass === 'string' && `pass(${x.pass})`, x.pass === true && 'pass', x.nonOverridable && 'non_overridable', x.access === 'private' && 'private'].filter(Boolean).join(', ');
        const d = docOf(x, x.name).body;
        const impl = x.binding === 'generic' ? x.procedures : [x.impl ?? (x.iface ? x.iface : x.name)];
        const links = impl.map((n) => resolve(n) ? `[${inlineCode(n)}](${resolve(n)})` : null).filter(Boolean);
        const text = [d, links.length ? `${x.deferred ? 'Interface' : 'Implemented by'} ${links.join(', ')}.` : ''].filter(Boolean).join('\n\n');
        const props = attr('name', x.name) + attr('type', target) + attr('attrs', flags);
        return text ? `<FortranArg${props}>\n\n${text}\n\n</FortranArg>` : `<FortranArg${props} />`;
      });
      out.push(`<FortranArgs title="Type-bound procedures">\n${rows.join('\n')}\n</FortranArgs>`);
    }
    out.push(...inherited(t));
    if (t.finals?.length) out.push(`**Final:** ${t.finals.map(link).join(', ')}`);
    out.push(source(t));
    return out.filter(Boolean).join('\n\n');
  }

  /**
   * What a type inherits: for each ancestor up the extends chain, its components and type-bound procedures that no
   * nearer type declares again (an overriding binding, such as matvec, hides its parent's).
   */
  function inherited(t) {
    const out = [];
    const declared = new Set(children(t).map((c) => c.name.toLowerCase()));
    const seen = new Set([t.id]);
    let name = t.extends;
    while (name) {
      const hit = (index.get(name.toLowerCase()) ?? []).find((h) => h.kind === 'type');
      const parent = hit ? E[hit.id] : all.find((x) => x.kind === 'type' && x.name.toLowerCase() === name.toLowerCase());
      if (!parent || seen.has(parent.id)) break;
      seen.add(parent.id);
      const members = children(parent).filter((c) => (c.kind === 'component' || c.kind === 'binding') && shown(c) && !declared.has(c.name.toLowerCase()));
      if (members.length) {
        const rows = members.map((c) => {
          if (c.kind === 'component') {
            return `<FortranArg${attr('name', c.name)}${attr('type', prettyType(c.type))}${attr('dims', c.dims ? `(${c.dims.join(',')})` : '')}${attr('codims', c.codims ? `[${c.codims.join(',')}]` : '')}${attr('attrs', attrsText(c))}${attr('cond', c.cond ? prettyCond(c.cond) : '')} />`;
          }
          const target = c.binding === 'generic' ? `generic => ${c.procedures.join(', ')}` : c.iface ? `procedure(${c.iface})` : c.impl ? `=> ${c.impl}` : 'procedure';
          const flags = [c.deferred && 'deferred', c.nopass && 'nopass', typeof c.pass === 'string' && `pass(${c.pass})`, c.access === 'private' && 'private'].filter(Boolean).join(', ');
          return `<FortranArg${attr('name', c.name)}${attr('type', target)}${attr('attrs', flags)} />`;
        });
        out.push(`<FortranArgs${attr('title', `Inherited from ${parent.name}`)}>\n${rows.join('\n')}\n</FortranArgs>`);
      }
      for (const c of members) declared.add(c.name.toLowerCase());
      name = parent.extends;
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
      out.push(argsList(body.args, d.params, `Arguments of ${sig.replace(/\s+/g, ' ')}`));
      if (body.result && body.proc === 'function') out.push(argsList([body.result], {}, `Result of ${body.name}`, d.returns));
    }
    out.push(source(i));
    return [out.filter(Boolean).join('\n\n')];
  }

  function varSection(v) {
    const out = [heading(v)];
    const attrs = attrsText(v, true);
    out.push(fence(`${prettyType(v.type) ?? 'real'}${v.parameter ? ', parameter' : ''}${attrs ? `, ${attrs}` : ''} :: ${v.name}${v.dims ? `(${v.dims.join(',')})` : ''}${v.codims ? `[${v.codims.join(',')}]` : ''}${v.init !== undefined ? ` ${v.pointerInit ? '=>' : '='} ${v.init}` : ''}`));
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
    const rows = en.enumerators.filter((x) => !x.access || display.has(x.access)).map((x) => {
      const d = docOf(x, x.name).body;
      const props = attr('name', x.name) + attr('attrs', [x.init !== undefined && `= ${x.init}`, x.access === 'private' && 'private'].filter(Boolean).join(', '));
      return d ? `<FortranArg${props}>\n\n${d}\n\n</FortranArg>` : `<FortranArg${props} />`;
    });
    if (rows.length) out.push(`<FortranArgs title="Enumerators">\n${rows.join('\n')}\n</FortranArgs>`);
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
    const b = [{ kind: e.proc === 'function' ? 'function' : 'subroutine' }];
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

function fence(code) {
  let f = '```';
  while (code.includes(f)) f += '`';
  return `${f}f90\n${code}\n${f}`;
}

function escapeHeading(s) {
  return escapeText(s);
}
