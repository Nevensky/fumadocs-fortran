// Graphs as Mermaid flowcharts: what a unit uses and what uses it, a type's place among the types that extend one
// another, a procedure's callers and callees, and an overview of the project's units. A pure function of the IR: no
// file access, and no import of the page writer, which wires the graphs in and so may import this module.

import { BLAS_ROUTINES, INTRINSIC_PROCEDURES, INTRINSIC_SUBROUTINES } from './fortran-names.js';

const INTRINSIC_MODULES = new Set(['iso_fortran_env', 'iso_c_binding', 'ieee_arithmetic', 'ieee_exceptions',
  'ieee_features']);
// a Map, not an object: a Fortran module may well be called `constructor`
const HPC_MODULES = new Map([
  ['mpi', 'fdfMpi'], ['mpi_f08', 'fdfMpi'], ['mpif', 'fdfMpi'], ['omp_lib', 'fdfOmp'], ['omp_lib_kinds', 'fdfOmp'],
  ['openacc', 'fdfAcc'],
  // CUDA Fortran and the NVIDIA libraries' Fortran modules, whose routines the cuda… name rule also knows
  ['cudafor', 'fdfCuda'], ['cublas', 'fdfCuda'], ['cufft', 'fdfCuda'], ['curand', 'fdfCuda'], ['cusparse', 'fdfCuda'],
  ['cusolverdn', 'fdfCuda'],
]);
// intrinsic subroutines, but drawn: they are where coarray code communicates
const COARRAY_COLLECTIVES = new Set(['co_sum', 'co_min', 'co_max', 'co_reduce', 'co_broadcast']);
// the CUDA runtime and its libraries (cudaMemcpy, cublasDgemm, cufftExecZ2Z, curandCreateGenerator, cusparseCreate,
// cusolverDnDgetrf), whichever module, if any, names them
const CUDA_ROUTINE = /^cu(da|blas|fft|rand|sparse|solver)/;

const KIND_CLASS = {
  module: 'fdfModule', submodule: 'fdfSubmodule', program: 'fdfProgram', blockdata: 'fdfProgram',
  procedure: 'fdfProcedure', interface: 'fdfGeneric', binding: 'fdfGeneric', type: 'fdfType',
};
const KIND_SHAPE = {
  module: 'rect', submodule: 'subroutine', program: 'stadium', blockdata: 'stadium', procedure: 'round',
  interface: 'hexagon', binding: 'hexagon', type: 'rect',
};
const SHAPES = {
  rect: ['[', ']'], subroutine: ['[[', ']]'], stadium: ['([', '])'], round: ['(', ')'], hexagon: ['{{', '}}'],
};

// Fixed mid tones, so that a renderer without the site's CSS still reads in light and dark: fills sit about halfway
// between white and black, text is near-black on every fill (over 8:1), and borders are darker than the fills. The
// modifiers come last, so that where they set the same property as a kind, theirs wins.
const CLASS_DEFS = {
  fdfModule: 'fill:#b0a9e0,stroke:#6453a7,color:#111111',
  fdfSubmodule: 'fill:#c8a1d0,stroke:#834791,color:#111111',
  fdfProgram: 'fill:#80bfb6,stroke:#00736a,color:#111111',
  fdfProcedure: 'fill:#98b6c8,stroke:#386a86,color:#111111',
  fdfGeneric: 'fill:#b7b47e,stroke:#6d6600,color:#111111',
  fdfType: 'fill:#cfaa7f,stroke:#8a5601,color:#111111',
  fdfIntrinsic: 'fill:#acb2b9,stroke:#5b646f,color:#111111',
  fdfExternal: 'fill:#b1b1b1,stroke:#636363,color:#111111,stroke-dasharray:4 3',
  fdfMpi: 'fill:#85c19a,stroke:#057743,color:#111111',
  fdfOmp: 'fill:#88b3f2,stroke:#145ec1,color:#111111',
  fdfAcc: 'fill:#85bbc9,stroke:#016f82,color:#111111',
  fdfCuda: 'fill:#9fbd7a,stroke:#4d7002,color:#111111',
  fdfCoarray: 'fill:#e594bb,stroke:#a82571,color:#111111',
  fdfBlas: 'fill:#cbac78,stroke:#815b04,color:#111111',
  fdfLapack: 'fill:#e0a07d,stroke:#9c4700,color:#111111',
  fdfScalapack: 'fill:#eb9794,stroke:#af2934,color:#111111',
  fdfAbstract: 'stroke-dasharray:5 3',
  fdfFocus: 'stroke-width:3px',
};

// what a site's classify() may answer: a library class, or its family word in any case (lapack, ScaLAPACK, fdfMpi)
const LIBRARY_CLASSES = ['fdfIntrinsic', 'fdfExternal', 'fdfMpi', 'fdfOmp', 'fdfAcc', 'fdfCuda', 'fdfCoarray',
  'fdfBlas', 'fdfLapack', 'fdfScalapack'];
const CLASS_WORDS = new Map([['openmp', 'fdfOmp'], ['openacc', 'fdfAcc']]);
for (const c of LIBRARY_CLASSES) CLASS_WORDS.set(c.toLowerCase(), c).set(c.slice(3).toLowerCase(), c);
const normaliseClass = (c) => (typeof c === 'string' ? CLASS_WORDS.get(c.toLowerCase()) ?? null : null);

const ESCAPES = { '#': '#35;', '"': '#quot;', '<': '#lt;', '>': '#gt;', '&': '#amp;' };
/** A quoted Mermaid label: Mermaid's entity codes stand for the characters that would end or mark up the text. */
export const mermaidLabel = (s) => `"${String(s).replace(/[#"<>&]/g, (c) => ESCAPES[c])}"`;

/** cpp conditions as words (`defined(USE_MPI)` reads as USE_MPI), without those the owner itself sits under. */
function condText(cond, own) {
  const terms = (cond ?? []).filter((t) => !(own ?? []).includes(t));
  return terms.map((t) => t.replace(/^defined\((\w+)\)$/, '$1').replace(/^!defined\((\w+)\)$/, 'not $1')).join(' and ');
}

/**
 * Of several definitions of one name, the one nearest the file that names it: the same file, else the fewest folders
 * apart, else the first. LAPACK ships SRC/dgetrf.f and its variants in SRC/VARIANTS/lu/CR/dgetrf.f and others, and
 * DGESV beside the first must call that one.
 */
function nearest(list, file) {
  if (list.length < 2) return list[0];
  const from = String(file ?? '').split('/').slice(0, -1);
  let best = list[0];
  let far = Infinity;
  for (const x of list) {
    if (x.file === file) return x;
    const to = String(x.file ?? '').split('/').slice(0, -1);
    let i = 0;
    while (i < from.length && i < to.length && from[i] === to[i]) i++;
    const d = from.length + to.length - 2 * i;
    if (d < far) {
      best = x;
      far = d;
    }
  }
  return best;
}

const MORE = '\0more';

/** A graph being built: nodes by key in the order they were found, and each edge with the conditions it holds under. */
class Graph {
  constructor(direction) {
    this.direction = direction;
    this.nodes = new Map();
    this.edges = new Map();
  }

  /** Adds a node once: { key, label, shape, classes, url }; the subject also gets fdfFocus. */
  add(node, focus = false) {
    if (!this.nodes.has(node.key)) this.nodes.set(node.key, { ...node, classes: [...node.classes] });
    const n = this.nodes.get(node.key);
    if (focus && !n.classes.includes('fdfFocus')) n.classes.push('fdfFocus');
    return n;
  }

  /** An edge, solid, dotted (generic to specific) or submodule; `cond` is one occurrence's cpp condition. */
  link(from, to, style = 'solid', cond = '') {
    const k = `${from}\n${to}\n${style}`;
    if (!this.edges.has(k)) this.edges.set(k, { from, to, style, conds: new Set() });
    this.edges.get(k).conds.add(cond);
  }

  /**
   * The Mermaid source. Nodes are numbered breadth first from the subject. Past `max`, one "… N more" node stands for
   * the nodes left out (it counts towards `max`) and takes the edges that led to them. The routines from outside the
   * project go first, the farthest first: they only end paths, however many callers they have, and a graph is about
   * the project's own code. When they are not enough, the farthest of the rest go too, so that a cap keeps the nearest.
   */
  render(subject, max = Infinity) {
    let order = [...this.nodes.keys()];
    if (subject !== undefined) {
      const rank = new Map(order.map((k, i) => [k, i]));
      const near = new Map(order.map((k) => [k, []]));
      for (const e of this.edges.values()) {
        if (!near.has(e.from) || !near.has(e.to)) continue;
        near.get(e.from).push(e.to);
        near.get(e.to).push(e.from);
      }
      for (const list of near.values()) list.sort((a, b) => rank.get(a) - rank.get(b));
      const bfs = [subject];
      const seen = new Set(bfs);
      for (let i = 0; i < bfs.length; i++) {
        for (const k of near.get(bfs[i])) {
          if (seen.has(k)) continue;
          seen.add(k);
          bfs.push(k);
        }
      }
      order = [...bfs, ...order.filter((k) => !seen.has(k))];
    }
    let keep = order;
    if (order.length > max) {
      const room = Math.max(1, max - 1);
      const outside = order.filter((k) => k !== subject && this.nodes.get(k).library);
      const out = new Set(outside.slice(room - order.length));
      keep = order.filter((k) => !out.has(k)).slice(0, room);
    }
    const kept = new Set(keep);
    const nodes = keep.map((k) => this.nodes.get(k));
    const edges = [];
    const toMore = new Set();
    for (const e of this.edges.values()) {
      const a = kept.has(e.from), b = kept.has(e.to);
      if (a && b) edges.push(e);
      else if (a || b) {
        const k = a ? `${e.from}\n>` : `${e.to}\n<`;
        if (toMore.has(k)) continue;
        toMore.add(k);
        edges.push({ from: a ? e.from : MORE, to: a ? MORE : e.to, style: 'solid', conds: new Set(['']) });
      }
    }
    if (keep.length < order.length) {
      const label = `… ${order.length - keep.length} more`;
      nodes.push({ key: MORE, label, shape: 'round', classes: ['fdfExternal'] });
    }
    const id = new Map(nodes.map((n, i) => [n.key, `n${i + 1}`]));
    const used = new Set(nodes.flatMap((n) => n.classes));
    const out = [`flowchart ${this.direction}`];
    for (const [c, style] of Object.entries(CLASS_DEFS)) if (used.has(c)) out.push(`  classDef ${c} ${style}`);
    for (const n of nodes) {
      const [open, close] = SHAPES[n.shape];
      out.push(`  ${id.get(n.key)}${open}${mermaidLabel(n.label)}${close}`);
    }
    for (const e of edges) out.push(`  ${id.get(e.from)} ${arrow(e)} ${id.get(e.to)}`);
    for (const n of nodes) for (const c of n.classes) out.push(`  class ${id.get(n.key)} ${c}`);
    for (const n of nodes) if (n.url) out.push(`  click ${id.get(n.key)} href "${String(n.url).replace(/"/g, '%22')}"`);
    return out.join('\n');
  }
}

function arrow(e) {
  if (e.style === 'dotted') return '-.->';
  if (e.style === 'submodule') return '-. "submodule of" .->';
  // labelled only when every occurrence holds under the same condition
  const conds = [...e.conds];
  return conds.length === 1 && conds[0] ? `-- ${mermaidLabel(conds[0])} -->` : '-->';
}

/**
 * The graphs of one IR. Each method takes an entity (or its ID) and returns Mermaid source without a fence, or null
 * when the graph would hold only its subject.
 *
 * - `dependencies(unit)`: what the unit and everything in it uses, followed through project modules to `depth`; the
 *   units that use it; its submodules and, for a submodule, its parents.
 * - `inheritance(type)`: the types it extends, up to the root, and every type that extends it, directly or not.
 * - `calls(procedure)`: its callees to `depth`, through project procedures only, and the procedures that call it (also
 *   accepts a program or a generic interface).
 * - `overview()`: every module, submodule and program, with the HPC modules they use; null past `maxNodes` units.
 *
 * @param {import('../../types/index.d.ts').FortranIR} ir
 * @param {object} [options]
 * @param {(entity: object) => string|null} [options.url] the entity's page URL with its anchor; null without a heading
 * @param {(entity: object) => boolean} [options.shown] the access filter (default: every entity): what it hides is
 *   not drawn, except what the page names anyway: a shown generic's specifics, a shown binding's implementation, and
 *   a type's ancestors
 * @param {(name: string, how: { subroutine: boolean }) => string|null} [options.classify] a library routine's class
 *   from its lower-case name: a class such as fdfLapack, or a family word such as lapack; null when it does not know
 *   the name. `subroutine`: a CALL names it, or an interface body declares it a subroutine (a name can be a library's
 *   subroutine and an intrinsic function: ScaLAPACK's reshape)
 * @param {number} [options.maxNodes] nodes drawn at most, the "… N more" node included (default 40); below 2 it counts
 *   as 2, the subject and "… N more". Also the overview's limit on units (default 80), taken as given
 * @param {number} [options.depth] how far uses and callees are followed (default 2)
 */
export function buildGraphs(ir, options = {}) {
  const E = ir.entities;
  const all = Object.values(E);
  const depth = options.depth ?? 2;
  const maxNodes = Math.max(2, options.maxNodes ?? 40);
  const urlOf = (e) => (e && options.url ? options.url(e) ?? null : null);
  const shown = (e) => !options.shown || !!options.shown(e);
  const lc = (s) => String(s ?? '').toLowerCase();
  const kids = (e) => (e?.children ?? []).map((id) => E[id]).filter(Boolean);
  const up = (e) => (e?.parent ? E[e.parent] ?? null : null);
  const unitOf = (e) => {
    let x = e;
    while (x?.parent && E[x.parent]) x = E[x.parent];
    return x;
  };
  const push = (map, k, v) => {
    const list = map.get(k);
    if (list) list.push(v);
    else map.set(k, [v]);
  };

  // ---- indexes
  const modules = new Map(); // by name; the first, when two files define one
  const submodules = [];
  const externals = new Map(); // external procedures by name (two files may define one)
  const separates = new Map(); // separate module procedures by name
  const bodies = new Map(); // interface bodies of separate module procedures by name
  for (const e of all) {
    if (!e.parent) {
      if (e.kind === 'module' && !modules.has(lc(e.name))) modules.set(lc(e.name), e);
      else if (e.kind === 'submodule') submodules.push(e);
      else if (e.kind === 'procedure') push(externals, lc(e.name), e);
    }
    if (e.kind === 'procedure' && e.scope === 'separate') push(separates, lc(e.name), e);
    if (e.kind === 'procedure' && e.scope === 'interface' && e.separate) push(bodies, lc(e.name), e);
  }

  const parentMemo = new Map();
  /** A submodule's parent: its parent submodule, else its ancestor module; null when the project lacks it. */
  const parentUnit = (s) => {
    if (!parentMemo.has(s.id)) {
      const anc = lc(s.ancestor);
      const p = s.parentSubmodule
        ? submodules.find((x) => lc(x.ancestor) === anc && lc(x.name) === lc(s.parentSubmodule))
        : modules.get(anc);
      parentMemo.set(s.id, p ?? null);
    }
    return parentMemo.get(s.id);
  };
  /** A unit and, for a submodule, its parents up to the module: the units whose names it sees by host association. */
  const lineage = (u) => {
    const out = [];
    for (let x = u; x && !out.includes(x); x = x.kind === 'submodule' ? parentUnit(x) : null) out.push(x);
    return out;
  };
  /** The separate module procedure that implements an interface body, in its unit or a descendant submodule. */
  const implementationOf = (body) => {
    const home = unitOf(body);
    return (separates.get(lc(body.name)) ?? []).find((p) => lineage(unitOf(p)).includes(home)) ?? null;
  };
  /** The interface body a separate module procedure implements. */
  const bodyOf = (p) => {
    const homes = lineage(unitOf(p));
    return (bodies.get(lc(p.name)) ?? []).find((b) => homes.includes(unitOf(b))) ?? null;
  };

  // ---- names in scope

  const scopeMemo = new Map();
  /** Where a name is looked up from e, innermost first: e, its hosts, and a submodule's parents. */
  const scopes = (e) => {
    let out = scopeMemo.get(e.id);
    if (out) return out;
    out = [];
    const seen = new Set();
    for (let s = e; s && !seen.has(s.id); s = s.kind === 'submodule' ? parentUnit(s) : up(s)) {
      seen.add(s.id);
      // an interface block is not a scope; an interface body sees its host through import or, for a separate module
      // procedure, by host association
      if (s.kind !== 'interface') out.push(s);
    }
    scopeMemo.set(e.id, out);
    return out;
  };

  const declMemo = new Map();
  /**
   * The names a scope declares, each with what it names: procedures, interfaces (generic ones by name, and every
   * interface body), types, variables, enumerators, and for a procedure its dummy arguments and result, which are
   * not procedures to call ({ kind: 'arg' }).
   */
  const declared = (S) => {
    let map = declMemo.get(S.id);
    if (map) return map;
    map = new Map();
    const add = (name, x) => {
      if (name) push(map, lc(name), x);
    };
    if (S.kind === 'procedure') {
      // `module procedure f` takes its arguments from its interface body
      const from = !S.args && S.scope === 'separate' ? bodyOf(S) ?? S : S;
      for (const a of from.args ?? []) add(a.name, { kind: 'arg', of: S, type: a.type });
      if (from.result) add(from.result.name, { kind: 'arg', of: S, type: from.result.type });
    }
    for (const c of kids(S)) {
      if (c.kind === 'interface') {
        if (c.name && c.ikind !== 'abstract' && c.ikind !== 'explicit') add(c.name, c);
        for (const b of kids(c)) if (b.kind === 'procedure') add(b.name, b);
      } else if (c.kind === 'enum') {
        for (const x of c.enumerators ?? []) add(x.name, c);
      } else add(c.name, c);
    }
    declMemo.set(S.id, map);
    return map;
  };

  /** What a use statement makes `n` mean: the module's own name for it (lower case and as written), or null. */
  const viaUse = (u, n) => {
    if (u.only) {
      const hit = u.only.find((x) => lc(x.local ?? x.name) === n);
      return hit ? { name: lc(hit.name), written: hit.name, explicit: true } : null;
    }
    const ren = u.renames?.find((x) => x.local && lc(x.local) === n);
    if (ren) return { name: lc(ren.name), written: ren.name, explicit: true };
    // a renamed entity is not visible under its own name through this statement
    if (u.renames?.some((x) => x.local && lc(x.name) === n)) return null;
    return { name: n, written: null, explicit: false };
  };
  const projectModule = (u) => (u.nature === 'intrinsic' ? null : modules.get(lc(u.module)) ?? null);

  /**
   * What module m gives under its own name n: its entities of that name (only public ones to a use without only),
   * or what it passes on from a module it uses. Access statements on use-associated names are not in the IR, so
   * whatever m uses counts as passed on.
   */
  const exported = (m, n, plain, seen = new Set()) => {
    if (seen.has(m.id)) return null;
    seen.add(m.id);
    const own = declared(m).get(n);
    if (own) {
      const visible = plain ? own.filter((x) => x.access !== 'private') : own;
      return visible.length ? { list: visible } : null;
    }
    for (const u of m.uses ?? []) {
      const v = viaUse(u, n);
      if (!v) continue;
      const m2 = projectModule(u);
      if (m2) {
        const r = exported(m2, v.name, !v.explicit, seen);
        if (r) return r;
      } else if (v.explicit) return { ext: u, name: v.name, written: v.written };
    }
    return null;
  };

  /** What a use statement gives for `n`: { list } from a project module, { ext } named from another module, or null. */
  const fromUse = (u, n) => {
    const v = viaUse(u, n);
    if (!v) return null;
    const m = projectModule(u);
    if (m) return exported(m, v.name, !v.explicit);
    // a plain use of a module outside the project proves nothing about a name
    return v.explicit ? { ext: u, name: v.name, written: v.written } : null;
  };

  /**
   * Where `n` is declared as seen from e, nearest first: one level per declaring scope or use statement, then the
   * project's external procedures. A level is { list } of project entities, or { ext } when a use statement of a
   * module outside the project names it in an only list or a rename; `scope` is the scope it is seen in (null for the
   * externals).
   */
  function* levels(e, n) {
    for (const S of scopes(e)) {
      const own = declared(S).get(n);
      if (own) yield { list: own, scope: S };
      for (const u of S.uses ?? []) {
        const r = fromUse(u, n);
        if (r) yield { ...r, scope: S };
      }
    }
    const x = externals.get(n);
    if (x) yield { list: x, scope: null };
  }

  const familyMemo = new Map();
  /**
   * A generic interface and the generics it is one with: in Fortran, the generics of one name a scope declares or
   * sees by use association are a single generic. They are the others of its name its scope declares, those its scope's
   * use statements give, and theirs in turn (stdlib_linalg_lapack's rot extends stdlib_linalg_blas's).
   */
  const familyOf = (G) => {
    let out = familyMemo.get(G.id);
    if (out) return out;
    out = [G];
    const add = (list) => {
      for (const x of list ?? []) if (x.kind === 'interface' && x.name && !out.includes(x)) out.push(x);
    };
    for (let i = 0; i < out.length; i++) {
      const S = up(out[i]);
      if (!S) continue;
      const n = lc(out[i].name);
      add(declared(S).get(n));
      for (const u of S.uses ?? []) add(fromUse(u, n)?.list);
    }
    familyMemo.set(G.id, out);
    return out;
  };

  /** The project type `n` names as seen from e; a generic interface of the same name (a constructor) is passed over. */
  const typeNamed = (e, n) => {
    for (const lv of levels(e, n)) {
      if (lv.ext) return null;
      const t = lv.list.find((x) => x.kind === 'type');
      if (t) return t;
    }
    return null;
  };
  /** The project type a declaration's type names (`type(t)`, `class(t)`), as seen from e. */
  const typeOf = (t, e) => {
    if (!t || (t.base !== 'type' && t.base !== 'class') || !t.kind || t.kind === '*') return null;
    return typeNamed(e, lc(t.kind));
  };
  const parentType = (t) => (t.extends ? typeNamed(up(t) ?? t, lc(t.extends)) : null);
  /** A component or binding of a type, its own or inherited (an overriding binding hides its parent's). */
  const member = (t, n, kind) => {
    const seen = new Set();
    for (let x = t; x && !seen.has(x.id); x = parentType(x)) {
      seen.add(x.id);
      const hit = kids(x).find((c) => c.kind === kind && lc(c.name) === n);
      if (hit) return hit;
    }
    return null;
  };
  let extensions = null;
  const extensionsOf = (t) => {
    if (!extensions) {
      extensions = new Map();
      for (const x of all) {
        const p = x.kind === 'type' && x.extends ? parentType(x) : null;
        if (p && p !== x) push(extensions, p.id, x);
      }
    }
    return extensions.get(t.id) ?? [];
  };

  // ---- nodes

  /**
   * A project entity's node. A separate module procedure is one node with its interface body, keyed by the body:
   * callers name the interface, and two submodules may implement it for different compilers (stdlib's error_stop).
   * Without a heading of its own, it links to the body's.
   */
  const nodeOf = (e) => {
    const body = e.scope === 'separate' ? bodyOf(e) : null;
    const n = {
      key: body?.id ?? e.id,
      label: e.name || (e.kind === 'program' ? 'main program' : e.kind),
      shape: KIND_SHAPE[e.kind] ?? 'rect',
      classes: [KIND_CLASS[e.kind] ?? 'fdfExternal'],
      url: urlOf(e) ?? urlOf(body),
      entity: e,
    };
    if (e.kind === 'type' && e.abstract) n.classes.push('fdfAbstract');
    if (e.kind === 'interface' || e.kind === 'binding') n.generic = true;
    return n;
  };
  /**
   * A procedure outside the project, one node per name; `from` is an interface body that documents it. `library`
   * marks it for the cap, which leaves such a routine out before any of the project's when nothing else links to it.
   */
  const libraryNode = (name, cls, from = null) => ({ key: `lib:${lc(name)}`, label: name, shape: 'round',
    classes: [cls], url: urlOf(from), entity: null, library: true });
  // what a shown binding calls is drawn even when the filter hides it: the binding's row on the page names it
  // (`procedure :: start => engine_start`), as a generic's entry lists its specifics, however private
  const visible = (n) => !n.entity || shown(n.entity) || (!!n.via && shown(n.via));

  /**
   * A library routine's class from its lower-case name: the site's classify(), then the families the names show.
   * LAPACK and ScaLAPACK names are left to classify(). `subroutine`: the name is a subroutine's (a CALL's).
   */
  const libraryClass = (n, subroutine = false) => {
    const c = normaliseClass(options.classify?.(n, { subroutine }));
    if (c) return c;
    if (n.startsWith('mpi_')) return 'fdfMpi';
    if (n.startsWith('omp_')) return 'fdfOmp';
    if (n.startsWith('acc_')) return 'fdfAcc';
    if (CUDA_ROUTINE.test(n)) return 'fdfCuda';
    if (COARRAY_COLLECTIVES.has(n)) return 'fdfCoarray';
    return BLAS_ROUTINES.has(n) ? 'fdfBlas' : null;
  };
  /**
   * The node of a routine a use statement names from a module outside the project, classed by name or module. The
   * standard's intrinsic modules give intrinsic procedures, which are not drawn, as are those of another processor
   * module (`use, intrinsic`) unless it is an HPC library's: gfortran keeps omp_lib and openacc with the intrinsic
   * ones. `subroutine`: a CALL names it.
   */
  const usedRoutine = (lv, written, subroutine = false) => {
    const mod = lc(lv.ext.module);
    if (INTRINSIC_MODULES.has(mod) || (lv.ext.nature === 'intrinsic' && !HPC_MODULES.has(mod))) return null;
    const cls = libraryClass(lv.name, subroutine) ?? HPC_MODULES.get(mod);
    return { node: libraryNode(lv.written ?? written, cls ?? 'fdfExternal'), known: !!cls };
  };

  const isAbstract = (x) => x.kind === 'procedure' && x.scope === 'interface' && up(x)?.ikind === 'abstract';
  const procedures = (list) => list.filter((x) => x.kind === 'procedure' && !isAbstract(x));

  /**
   * The node a project entity stands for in a call graph, or null when it is not a procedure to call. An interface
   * body stands for what implements it: a separate module procedure, or the project's external procedure of that
   * name; without one, it documents a procedure outside the project.
   */
  const targetOf = (x) => {
    if (x.kind === 'interface') return x.name ? nodeOf(x) : null;
    if (x.kind === 'program') return nodeOf(x);
    if (x.kind !== 'procedure' || isAbstract(x)) return null;
    if (x.scope !== 'interface') return nodeOf(x);
    if (x.separate) return nodeOf(implementationOf(x) ?? x);
    const ext = externals.get(lc(x.name));
    if (ext) return nodeOf(nearest(ext, x.file));
    return libraryNode(x.name, libraryClass(lc(x.name), x.proc === 'subroutine') ?? 'fdfExternal', x);
  };

  const callableMemo = new Map();
  /**
   * What a called name means as seen from e: the nearest declaration decides. A generic interface there wins over a
   * specific of the same name; a dummy argument (even one an interface body describes), a variable or a type there
   * means no procedure of the project is called ({ none }). When that scope sees several generics of the name (its
   * own and a used module's, or two used modules'), they are one generic, and the one whose family holds the others
   * stands for it.
   */
  const callable = (e, n) => {
    const key = `${e.id}\n${n}`;
    if (callableMemo.has(key)) return callableMemo.get(key);
    let r = null;
    let found = null; // the generics of the name the nearest scope sees
    for (const lv of levels(e, n)) {
      if (found) {
        if (lv.scope !== found.scope) break;
        const g = lv.list?.find((x) => x.kind === 'interface');
        if (g && !found.list.includes(g)) found.list.push(g);
        continue;
      }
      if (lv.ext) r = lv;
      else {
        const procs = procedures(lv.list);
        const p = lv.list.some((x) => x.kind === 'arg') ? null
          : lv.list.find((x) => x.kind === 'interface') ?? nearest(procs, e.file);
        r = p ? { entity: p } : { none: true };
        if (p?.kind === 'interface') {
          found = { scope: lv.scope, list: [p] };
          continue;
        }
      }
      break;
    }
    if (found?.list.length > 1) {
      const widest = found.list.find((g) => found.list.every((x) => familyOf(g).includes(x)));
      if (widest) r = { entity: widest };
    }
    callableMemo.set(key, r);
    return r;
  };

  /**
   * A call (`call f`, isCall) or function reference (`f(…)`) by name. Intrinsic procedures are not drawn; a CALL
   * names a subroutine, so a CALL of a name only an intrinsic function has is another routine of that name
   * (ScaLAPACK's RESHAPE, which its TOOLS write in C). An unknown call is a library routine; an unknown reference may
   * as well be an array (from a module outside the project, say, named in an only list), so it is drawn only when its
   * name, or the module that names it, is a known library's.
   */
  const nameTarget = (e, written, isCall) => {
    const n = lc(written);
    const r = callable(e, n);
    if (r?.entity) return targetOf(r.entity);
    if (r?.none) return null;
    if (r?.ext) {
      const u = usedRoutine(r, written, isCall);
      return u && (u.known || isCall) ? u.node : null;
    }
    if ((isCall ? INTRINSIC_SUBROUTINES : INTRINSIC_PROCEDURES).has(n)) return null;
    const cls = libraryClass(n, isCall);
    return cls || isCall ? libraryNode(written, cls ?? 'fdfExternal') : null;
  };

  /** The procedure a binding calls, found where its type is declared; a generic binding: a node over its specifics. */
  const bindingTarget = (b, t) => {
    if (b.binding === 'generic') {
      const key = `${t.id}%${lc(b.name)}`;
      const url = urlOf(b);
      return { key, label: b.name, shape: 'hexagon', classes: ['fdfGeneric'], url, entity: b, type: t, generic: true };
    }
    // a deferred binding has no implementation to draw: which one runs depends on the dynamic type
    if (b.deferred) return null;
    const home = up(b);
    for (const lv of levels(up(home) ?? home, lc(b.impl ?? b.name))) {
      if (lv.ext) return null;
      const p = procedures(lv.list);
      if (p.length) {
        const node = targetOf(nearest(p, b.file));
        return node && { ...node, via: b };
      }
    }
    return null;
  };

  /**
   * `call x%p(…)`, `call x%c%p(…)`, and function references such as `y = x%f(…)`: through the declared type of x (a
   * dummy argument, a function result or a module variable) and of each component to the binding p. Only a binding
   * is drawn: a path that ends at a component (an array, a procedure pointer) draws nothing, nor does one through a
   * step that is unknown, such as a local variable, whose declaration the IR does not keep.
   */
  const boundTarget = (e, path) => {
    const [head, ...rest] = path.split('%');
    const last = rest.pop();
    let t = null;
    for (const lv of levels(e, head)) {
      if (lv.ext) break;
      const v = lv.list.find((x) => x.kind === 'arg' || x.kind === 'variable');
      if (v) t = typeOf(v.type, v.kind === 'arg' ? v.of : up(v) ?? e);
      break;
    }
    for (const c of rest) {
      const comp = t ? member(t, c, 'component') : null;
      t = comp ? typeOf(comp.type, up(up(comp)) ?? up(comp)) : null;
    }
    const b = t && last ? member(t, last, 'binding') : null;
    return b ? bindingTarget(b, t) : null;
  };

  const calleeMemo = new Map();
  /**
   * What a procedure or program calls: one entry per call statement or reference, { node, cond }. A call through a
   * procedure pointer the caller declares (`local`, which the parser marks) goes where the pointer points, which the
   * IR does not know: nothing is drawn for it, as for a dummy procedure.
   */
  const calleesOf = (e) => {
    let out = calleeMemo.get(e.id);
    if (out) return out;
    out = [];
    for (const c of e.calls ?? []) {
      if (c.local) continue;
      const node = c.name.includes('%') ? boundTarget(e, lc(c.name)) : nameTarget(e, c.name, true);
      if (node) out.push({ node, cond: condText(c.cond, e.cond) });
    }
    // the parser keeps no condition for a reference; a path through components (x%c%f) is a type-bound function's
    for (const r of e.refs ?? []) {
      const node = r.includes('%') ? boundTarget(e, lc(r)) : nameTarget(e, r, false);
      if (node) out.push({ node, cond: '' });
    }
    calleeMemo.set(e.id, out);
    return out;
  };
  // project code with calls of its own: not an interface body, nor a routine outside the project
  const expandable = (n) => n.entity?.kind === 'program'
    || (n.entity?.kind === 'procedure' && n.entity.scope !== 'interface');

  /** The resolution of a specific procedure's name in a generic interface: a procedure, never the generic itself. */
  const specificTarget = (S, n, written) => {
    for (const lv of levels(S, n)) {
      if (lv.ext) return usedRoutine(lv, written)?.node ?? null;
      const p = procedures(lv.list);
      if (p.length) return targetOf(nearest(p, S.file));
    }
    return null;
  };
  const specificsMemo = new Map();
  /**
   * A generic's specific procedures: those it names and its interface bodies, and those of the generics it is one
   * with (familyOf); or a generic binding's bindings. They are drawn whatever their access, as the generic is drawn
   * only when shown, and its entry on the page lists them.
   */
  const specificsOf = (g) => {
    let out = specificsMemo.get(g.key);
    if (out) return out;
    const list = [];
    const G = g.entity;
    if (G.kind === 'binding') {
      for (const s of G.procedures ?? []) {
        const b = member(g.type, lc(s), 'binding');
        const t = b && b.binding !== 'generic' ? bindingTarget(b, g.type) : null;
        if (t) list.push(t);
      }
    } else {
      for (const X of familyOf(G)) {
        for (const s of X.procedures ?? []) {
          const t = specificTarget(up(X) ?? X, lc(s), s);
          if (t) list.push(t);
        }
        for (const b of kids(X)) {
          const t = b.kind === 'procedure' ? targetOf(b) : null;
          if (t) list.push(t);
        }
      }
    }
    const keys = new Set();
    out = list.filter((t) => !keys.has(t.key) && keys.add(t.key));
    specificsMemo.set(g.key, out);
    return out;
  };

  let callers = null; // node key -> [{ node, cond }]
  let generics = null; // node key -> the generics some code calls that have it as a specific
  const indexCallers = () => {
    if (callers) return;
    callers = new Map();
    generics = new Map();
    const called = new Map();
    for (const e of all) {
      if ((e.kind !== 'procedure' && e.kind !== 'program') || (!e.calls && !e.refs)) continue;
      const from = nodeOf(e);
      for (const { node, cond } of calleesOf(e)) {
        push(callers, node.key, { node: from, cond });
        if (!called.has(node.key)) called.set(node.key, node);
      }
    }
    for (const g of called.values()) {
      if (!g.generic || !visible(g)) continue;
      for (const s of specificsOf(g)) if (s.key !== g.key) push(generics, s.key, g);
    }
  };

  // ---- dependencies

  const usesMemo = new Map();
  /** The modules an entity and everything in it use, by name, each use with its condition relative to the entity. */
  const usesOf = (U) => {
    let map = usesMemo.get(U.id);
    if (map) return map;
    map = new Map();
    const visit = (x) => {
      for (const u of x.uses ?? []) {
        const k = lc(u.module);
        if (!map.has(k)) map.set(k, { module: u.module, nature: u.nature, conds: [] });
        const rec = map.get(k);
        if (u.nature === 'intrinsic') rec.nature = 'intrinsic';
        rec.conds.push(condText(u.cond, U.cond));
      }
      for (const c of kids(x)) visit(c);
    };
    visit(U);
    usesMemo.set(U.id, map);
    return map;
  };
  /** A used module's node: the project's, else one classed by its name. */
  const moduleNode = (use) => {
    const k = lc(use.module);
    const m = use.nature === 'intrinsic' ? null : modules.get(k);
    if (m) return nodeOf(m);
    const intrinsic = INTRINSIC_MODULES.has(k) || use.nature === 'intrinsic';
    const cls = HPC_MODULES.get(k) ?? (intrinsic ? 'fdfIntrinsic' : 'fdfExternal');
    return { key: `mod:${k}`, label: use.module, shape: 'round', classes: [cls], url: null, entity: null };
  };
  /** A submodule's parent the project lacks. */
  const missingUnit = (name, kind) => ({ key: `mod:${lc(name)}`, label: name, shape: KIND_SHAPE[kind],
    classes: ['fdfExternal'], url: null, entity: null });

  const entityOf = (x) => (typeof x === 'string' ? E[x] : x && (E[x.id] ?? x)) ?? null;

  return {
    dependencies(x) {
      const U = entityOf(x);
      if (!U) return null;
      const g = new Graph('LR');
      // the subject's key, not its ID: a separate module procedure is keyed by its interface body
      const subject = g.add(nodeOf(U), true).key;
      // its submodules, all the way down; they come first, so that a cap keeps them before a long list of users
      const below = [U];
      while (below.length) {
        const p = below.shift();
        for (const s of submodules) {
          if (g.nodes.has(s.id) || parentUnit(s) !== p || !shown(s)) continue;
          g.add(nodeOf(s));
          g.link(s.id, p.id, 'submodule');
          below.push(s);
        }
      }
      // a submodule's parents, up to its module
      for (let s = U; s?.kind === 'submodule'; ) {
        const p = parentUnit(s);
        const node = p ? nodeOf(p)
          : missingUnit(s.parentSubmodule ?? s.ancestor, s.parentSubmodule ? 'submodule' : 'module');
        const known = g.nodes.has(node.key);
        g.add(node);
        g.link(s.id, node.key, 'submodule');
        if (known) break;
        s = p;
      }
      // what it uses, through project modules to `depth`
      const queue = [[U, subject, 0]];
      const seen = new Set([subject]);
      while (queue.length) {
        const [m, key, level] = queue.shift();
        if (level >= depth) continue;
        for (const use of usesOf(m).values()) {
          const node = moduleNode(use);
          if (!visible(node)) continue;
          g.add(node);
          for (const c of use.conds) g.link(key, node.key, 'solid', c);
          if (node.entity && !seen.has(node.key)) {
            seen.add(node.key);
            queue.push([node.entity, node.key, level + 1]);
          }
        }
      }
      // who uses it
      if (U.kind === 'module' && modules.get(lc(U.name)) === U) {
        for (const T of all) {
          if (T.parent || T === U || !shown(T)) continue;
          const use = usesOf(T).get(lc(U.name));
          if (!use || use.nature === 'intrinsic') continue;
          g.add(nodeOf(T));
          for (const c of use.conds) g.link(T.id, subject, 'solid', c);
        }
      }
      return g.nodes.size > 1 ? g.render(subject, maxNodes) : null;
    },

    inheritance(x) {
      const T = entityOf(x);
      if (!T || T.kind !== 'type') return null;
      const g = new Graph('BT');
      g.add(nodeOf(T), true);
      const seen = new Set([T.id]);
      for (let t = T; t.extends; ) {
        const p = parentType(t);
        if (!p) {
          // a type from a library: the root as far as the project knows
          const k = `type:${lc(t.extends)}`;
          g.add({ key: k, label: t.extends, shape: 'rect', classes: ['fdfExternal'], url: null, entity: null });
          g.link(t.id, k);
          break;
        }
        // an ancestor is drawn whatever its access: the type's page names it ("Extends", "Inherited from")
        if (seen.has(p.id)) break;
        seen.add(p.id);
        g.add(nodeOf(p));
        g.link(t.id, p.id);
        t = p;
      }
      const queue = [T];
      while (queue.length) {
        const t = queue.shift();
        for (const c of extensionsOf(t)) {
          if (seen.has(c.id) || !shown(c)) continue;
          seen.add(c.id);
          g.add(nodeOf(c));
          g.link(c.id, t.id);
          queue.push(c);
        }
      }
      return g.nodes.size > 1 ? g.render(T.id, maxNodes) : null;
    },

    calls(x) {
      const e = entityOf(x);
      const subject = e ? targetOf(e) : null;
      if (!subject) return null;
      const g = new Graph('LR');
      g.add(subject, true);
      // callees, breadth first; a generic's specifics count as one step with it
      const queue = [[subject, 0]];
      const seen = new Set([subject.key]);
      while (queue.length) {
        const [n, level] = queue.shift();
        if (n.generic) {
          for (const s of specificsOf(n)) {
            g.add(s);
            g.link(n.key, s.key, 'dotted');
            if (!seen.has(s.key)) {
              seen.add(s.key);
              queue.push([s, level]);
            }
          }
          continue;
        }
        if (level >= depth || !expandable(n)) continue;
        for (const { node, cond } of calleesOf(n.entity)) {
          if (!visible(node)) continue;
          g.add(node);
          g.link(n.key, node.key, 'solid', cond);
          if (!seen.has(node.key)) {
            seen.add(node.key);
            queue.push([node, level + 1]);
          }
        }
      }
      // callers, one step; those that call a generic it is a specific of come through the generic
      indexCallers();
      for (const { node, cond } of callers.get(subject.key) ?? []) {
        if (!visible(node)) continue;
        g.add(node);
        g.link(node.key, subject.key, 'solid', cond);
      }
      for (const gen of generics.get(subject.key) ?? []) {
        const via = (callers.get(gen.key) ?? []).filter((c) => visible(c.node));
        if (!via.length) continue;
        g.add(gen);
        g.link(gen.key, subject.key, 'dotted');
        for (const { node, cond } of via) {
          g.add(node);
          g.link(node.key, gen.key, 'solid', cond);
        }
      }
      return g.nodes.size > 1 ? g.render(subject.key, maxNodes) : null;
    },

    overview() {
      const RANK = { module: 0, submodule: 1, program: 2 };
      const units = all.filter((e) => !e.parent && Object.hasOwn(RANK, e.kind) && shown(e))
        .sort((a, b) => RANK[a.kind] - RANK[b.kind] || lc(a.name).localeCompare(lc(b.name)));
      if (units.length > (options.maxNodes ?? 80)) return null;
      const g = new Graph('LR');
      const ids = new Set(units.map((u) => u.id));
      for (const u of units) g.add(nodeOf(u));
      // an HPC library is one node, whichever of its modules a unit uses (mpi, mpi_f08); intrinsic modules and other
      // libraries are left out
      const hpc = new Map();
      for (const u of units) {
        if (u.kind === 'submodule') {
          const p = parentUnit(u);
          if (p && ids.has(p.id)) g.link(u.id, p.id, 'submodule');
        }
        for (const use of usesOf(u).values()) {
          const k = lc(use.module);
          const m = use.nature === 'intrinsic' ? null : modules.get(k);
          let to = null;
          if (m) to = ids.has(m.id) ? m.id : null;
          else if (HPC_MODULES.has(k)) {
            const cls = HPC_MODULES.get(k);
            if (!hpc.has(cls)) hpc.set(cls, new Map());
            if (!hpc.get(cls).has(k)) hpc.get(cls).set(k, use.module);
            to = `hpc:${cls}`;
          }
          if (to) for (const c of use.conds) g.link(u.id, to, 'solid', c);
        }
      }
      for (const cls of LIBRARY_CLASSES) {
        const names = hpc.get(cls);
        if (!names) continue;
        g.add({ key: `hpc:${cls}`, label: [...names.values()].sort().join(', '), shape: 'round', classes: [cls] });
      }
      return g.edges.size ? g.render(undefined, Infinity) : null;
    },
  };
}
