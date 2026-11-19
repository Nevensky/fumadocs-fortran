// The intermediate representation (IR): every documented entity under a stable ID, the files read, and diagnostics.
//
// IDs are lower-case paths of kind-tagged segments, such as module:json_value_module/type:json_core/binding:add_by_path.
// They hold no line numbers, so they survive edits. Unnamed interfaces and enums are numbered within their parent
// (`interface:@1`); external procedures that clash across files take an `@path` suffix, and clashes within one parent
// (two cpp branches defining the same name) a `~2` suffix.

export const IR_VERSION = '1.0-draft';

const SEG = { blockdata: 'blockdata' };

function segment(e, ordinals) {
  const lc = (e.name || '').toLowerCase();
  if (e.kind === 'submodule') return `submodule:${(e.ancestor || '').toLowerCase()}:${lc}`;
  if (lc) return `${SEG[e.kind] ?? e.kind}:${lc}`;
  const n = (ordinals.get(e.kind) ?? 0) + 1;
  ordinals.set(e.kind, n);
  return `${e.kind}:@${n}`;
}

const SKIP = new Set(['kind', 'name', 'parent', 'file', 'line', 'lineEnd', 'cond', 'access', 'accessAttr', 'doc', 'children']);

/**
 * Assembles the IR from parsed files.
 * @param {Array<{ info: object, roots: object[], conds: { get(id: number): string[] } }>} units one per source file
 * @param {{ rel(index: number): string, diagnostics: object[], generator: object, options?: object }} ctx
 */
export function buildIR(units, ctx) {
  // top-level IDs: a name defined in more than one file takes the file as a suffix
  const seen = new Map();
  const tops = [];
  for (const u of units) {
    const ordinals = new Map();
    for (const r of u.roots) {
      const seg = segment(r, ordinals);
      tops.push({ u, r, seg });
      const files = seen.get(seg) ?? new Set();
      files.add(r.file);
      seen.set(seg, files);
    }
  }
  const entities = {};
  const used = new Set();
  const unique = (id) => {
    if (!used.has(id)) { used.add(id); return id; }
    let k = 2;
    while (used.has(`${id}~${k}`)) k++;
    used.add(`${id}~${k}`);
    return `${id}~${k}`;
  };
  const walk = (e, id, parentId, u) => {
    const out = { id, kind: e.kind, name: e.name };
    if (parentId) out.parent = parentId;
    out.file = ctx.rel(e.file);
    out.line = e.line;
    if (e.lineEnd !== e.line) out.lineEnd = e.lineEnd;
    if (e.cond) out.cond = u.conds.get(e.cond);
    if (e.access) out.access = e.access;
    for (const k of Object.keys(e)) {
      if (SKIP.has(k)) continue;
      const v = e[k];
      if (v === undefined) continue;
      out[k] = convert(k, v, u);
    }
    if (e.doc) out.doc = { blocks: e.doc };
    entities[id] = out;
    if (e.children.length) {
      const ordinals = new Map();
      out.children = e.children.map((c) => {
        const cid = unique(`${id}/${segment(c, ordinals)}`);
        walk(c, cid, id, u);
        return cid;
      });
    }
  };
  for (const { u, r, seg } of tops) {
    const id = seen.get(seg).size > 1 ? `${seg}@${ctx.rel(r.file)}` : seg;
    walk(r, unique(id), null, u);
  }
  return {
    irVersion: IR_VERSION,
    generator: ctx.generator,
    ...(ctx.options ? { options: ctx.options } : {}),
    files: units.map((u) => u.info),
    entities,
    diagnostics: ctx.diagnostics.map((d) => ({ ...d, file: typeof d.file === 'number' ? ctx.rel(d.file) : d.file })),
  };
}

function convert(key, v, u) {
  const cond = (c) => (c ? u.conds.get(c) : undefined);
  const item = (x) => {
    if (!x || typeof x !== 'object') return x;
    const out = { ...x };
    if (typeof x.cond === 'number') out.cond = cond(x.cond);
    if (out.cond === undefined) delete out.cond;
    if (x.doc) out.doc = { blocks: x.doc };
    delete out.accessAttr;
    return out;
  };
  switch (key) {
    case 'args': case 'params': case 'enumerators': case 'uses': case 'calls':
      return v.map(item);
    case 'result':
      return item(v);
    case 'hpc': {
      const out = { ...v };
      if (v.directives) out.directives = v.directives.map(item);
      return out;
    }
    default:
      return v;
  }
}
