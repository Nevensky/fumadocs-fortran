// The statement-level parser. It reads events from the reader (statements, comments, directives) and builds program
// units on a stack of scopes. Specification statements are parsed fully; executable statements are only scanned for
// calls, procedure references, coarrays and directives. A statement-level stack ignores the ends of executable
// constructs, so an `#if` around a lone `END IF` cannot derail it, and an unparsable statement costs only itself.

import { canon, lower, splitTop, splitRanges, matchClose, indexTop, blankStrings, isWord } from './text.js';
import { typeSpec, parseAttrs, parseEntities, parseDeclaration, listItems } from './decl.js';
import { parseDirective } from './directives.js';

const PREFIX = new Set(['pure', 'impure', 'elemental', 'recursive', 'non_recursive', 'module', 'simple']);
const TYPE_WORD = new Set([
  'integer', 'real', 'complex', 'logical', 'character', 'byte', 'double', 'doubleprecision', 'doublecomplex', 'type',
  'class', 'procedure', 'typeof', 'classof',
]);
const ATTR_STMT = new Set([
  'intent', 'optional', 'value', 'dimension', 'codimension', 'allocatable', 'pointer', 'target', 'save', 'protected',
  'volatile', 'asynchronous', 'contiguous', 'external', 'intrinsic', 'bind',
]);
const END_WORDS = [
  'block data', 'blockdata', 'enumeration type', 'enumerationtype', 'subroutine', 'submodule', 'function', 'procedure',
  'program', 'module', 'interface', 'type', 'enum', 'do', 'if', 'select', 'associate', 'where', 'forall', 'critical',
  'team', 'block', 'file',
];
const END_UNIT = { '': ['procedure', 'program', 'module', 'submodule', 'blockdata'], subroutine: ['procedure'], function: ['procedure'], procedure: ['procedure'], module: ['module'], submodule: ['submodule'], program: ['program'], 'block data': ['blockdata'], blockdata: ['blockdata'], interface: ['interface'], type: ['type'], enum: ['enum'], 'enumeration type': ['enum'], enumerationtype: ['enum'] };
const NOT_REF = new Set([
  'if', 'elseif', 'while', 'case', 'select', 'write', 'read', 'print', 'allocate', 'deallocate', 'where', 'elsewhere',
  'forall', 'open', 'close', 'inquire', 'rewind', 'backspace', 'endfile', 'format', 'stop', 'associate', 'rank', 'do',
  'concurrent', 'local', 'local_init', 'shared', 'reduce', 'default', 'sync', 'images', 'lock', 'unlock', 'nullify',
  'flush', 'wait', 'post', 'team', 'change', 'form', 'event', 'call', 'go', 'goto', 'then', 'type', 'class', 'is',
  'critical', 'block', 'return', 'entry', 'notify', 'error',
]);
const COARRAY_STMT = /^(sync (all|images|memory|team)|critical|lock\(|unlock\(|event (post|wait)|form team|change team|fail image|notify wait)/;

const BEFORE = { dir: 'before', alt: false };
const BEFORE_ALT = { dir: 'before', alt: true };
const AFTER = { dir: 'after', alt: false };
const AFTER_ALT = { dir: 'after', alt: true };
const SKIP = { dir: 'skip' };

const EXEC = { targets: [], exec: true };
const SPEC = { targets: [] };
const END = { targets: [], end: true };
const SINK = { targets: [], sink: true };

/** The default comment marks: `!!` and `!<` document the previous item, `!>` the next; `!*` and `!|` are FORD's alternates. */
export const DEFAULT_MARKS = { docmark: '!', predocmark: '>', docmarkAlt: '*', predocmarkAlt: '|', postmark: '<' };

function markTable(marks = {}) {
  const m = { ...DEFAULT_MARKS, ...marks };
  const t = new Map();
  if (m.postmark) t.set(m.postmark, AFTER);
  if (m.predocmarkAlt) t.set(m.predocmarkAlt, BEFORE_ALT);
  if (m.docmarkAlt) t.set(m.docmarkAlt, AFTER_ALT);
  if (m.predocmark) t.set(m.predocmark, BEFORE);
  if (m.docmark) t.set(m.docmark, AFTER);
  return t;
}

/** Default implicit typing: i to n are integer, everything else real. */
function defaultImplicit() {
  const map = [];
  for (let i = 0; i < 26; i++) map.push(i >= 8 && i <= 13 ? { base: 'integer', kind: null, len: null, text: 'integer' } : { base: 'real', kind: null, len: null, text: 'real' });
  return map;
}

/**
 * Parses one file's events into program units.
 * @param {object[]} events from readEvents()
 * @param {{ file: number, diagnostics: object[], marks?: object }} ctx
 * @returns {object[]} the top-level entities, each with `children`
 */
export function parseEvents(events, ctx) {
  const p = new Parser(ctx);
  for (let i = 0; i < events.length; i++) p.event(events[i]);
  p.finish();
  return p.roots;
}

class Parser {
  constructor(ctx) {
    this.ctx = ctx;
    this.marks = markTable(ctx.marks);
    this.roots = [];
    this.stack = [{ kind: 'file', entity: null }];
    this.block = null; // the doc-comment block being read
    this.pending = null; // a finished before-block waiting for its statement
    this.after = null; // what an after-block documents now
    this.last = null; // the last event
  }

  get top() {
    return this.stack[this.stack.length - 1];
  }

  diag(code, message, ev, severity = 'warning') {
    this.ctx.diagnostics.push({ code, severity, file: ev.f, line: ev.n, message });
  }

  // ---------------------------------------------------------------- events

  event(ev) {
    if (ev.t === 'comment') return this.comment(ev);
    this.closeBlock();
    if (ev.t === 'dir') return this.directive(ev);
    const text = ev.text;
    if (text.indexOf(';') >= 0) {
      const parts = splitTop(text, ';');
      for (let i = 0; i < parts.length; i++) this.statement(parts[i], ev, i === parts.length - 1);
    } else this.statement(text, ev, true);
  }

  finish() {
    this.closeBlock();
    const ev = this.lastEvent ?? { f: this.ctx.file, n: 0, e: 0 };
    while (this.stack.length > 1) {
      const sc = this.stack.pop();
      if (sc.kind !== 'block') this.diag('unclosed', `${sc.kind} ${sc.entity?.name ?? ''} has no end statement`, { f: ev.f, n: sc.entity?.line ?? ev.n });
      this.close(sc, ev);
    }
  }

  // ---------------------------------------------------------------- doc comments

  role(lead, body) {
    const ch = body[0];
    if (ch === undefined) return null;
    const r = lead === '!' ? this.marks.get(ch) : ch === '>' ? BEFORE : ch === '<' ? AFTER : null;
    if (!r) return null;
    const rest = body.slice(1);
    if (rest[0] === '$') return SKIP; // !!$omp: a directive or conditional line that was commented out
    if (rest.length >= 3 && /^[!*=\-#~_+.<>/\\]+\s*$/.test(rest)) return SKIP; // a banner
    return r;
  }

  comment(ev) {
    const r = this.role(ev.lead, ev.body);
    if (r === SKIP) return;
    if (!r) {
      if (this.block?.alt && ev.lead === '!' && ev.f === this.block.f && !ev.blank) {
        this.block.lines.push(ev.body);
        this.block.e = ev.n;
        return;
      }
      this.closeBlock();
      return;
    }
    const text = ev.body.slice(1);
    // a blank line or another file ends a block (a line cpp removed, such as #ifdef, does not)
    if (this.block && (ev.f !== this.block.f || ev.blank)) this.closeBlock();
    // a before-mark after an after-block starts the next item's doc; an after-mark continues a before-block
    // (Doxygen's `!>` brief followed by `!!` lines)
    if (this.block && this.block.dir === 'after' && r.dir === 'before') this.closeBlock();
    if (this.block) {
      this.block.lines.push(text);
      this.block.e = ev.n;
      return;
    }
    this.block = { dir: r.dir, alt: r.alt, lines: [text], n: ev.n, e: ev.n, f: ev.f };
  }

  closeBlock() {
    const b = this.block;
    if (!b) return;
    this.block = null;
    if (b.dir === 'before') {
      // before-blocks wait for their statement; they stay separate (a Doxygen \file block is not the next entity's)
      (this.pending ??= []).push(b);
    } else if (this.after) {
      for (const t of this.after) addDoc(t, b);
    }
  }

  afterStatement(r, ev, last) {
    const pend = this.pending;
    this.pending = null;
    const silent = r.exec || r.end || r.sink;
    const targets = r.targets.length ? r.targets : this.top.entity ? [this.top.entity] : [];
    if (pend && !silent) for (const t of targets) for (const b of pend) addDoc(t, b);
    this.after = silent || !targets.length ? null : targets;
    if (last && ev.trail && !silent) {
      for (const c of ev.trail) {
        const role = this.role('!', c.body);
        if (!role || role.dir !== 'after') continue;
        let on = targets;
        if (ev.parts && targets.length > 1) {
          const here = targets.filter((t) => lineOf(ev, t.name) === c.n);
          if (here.length) on = here;
        }
        const b = { dir: 'after', lines: [c.body.slice(1)], n: c.n, e: c.n, inline: true };
        for (const t of on) addDoc(t, b);
      }
    }
  }

  // ---------------------------------------------------------------- directives

  directive(ev) {
    const d = parseDirective(ev.sentinel, ev.text);
    const rec = { family: d.family, construct: d.construct, line: ev.n };
    if (ev.e !== ev.n) rec.lineEnd = ev.e;
    if (d.end) rec.end = true;
    if (d.clauses) rec.clauses = d.clauses;
    if (ev.c) rec.cond = ev.c;
    if (d.family === 'vendor') rec.sentinel = ev.sentinel;
    const owner = this.owner();
    if (owner) ((owner.hpc ??= {}).directives ??= []).push(rec);
    else (this.ctx.fileDirectives ??= []).push(rec);
  }

  /** The innermost entity that can own directives, uses and calls. */
  owner() {
    for (let i = this.stack.length - 1; i > 0; i--) if (this.stack[i].entity) return this.stack[i].entity;
    return null;
  }

  /** The innermost procedure or program scope (for calls and references). */
  execScope() {
    for (let i = this.stack.length - 1; i > 0; i--) {
      const k = this.stack[i].kind;
      if (k === 'procedure' || k === 'program') return this.stack[i];
      if (k !== 'block') return null;
    }
    return null;
  }

  // ---------------------------------------------------------------- statements

  statement(text, ev, last) {
    this.lastEvent = ev;
    let o = canon(text);
    if (!o) return;
    let s = lower(o);
    let m = /^\d+ (?=[a-z])/.exec(s);
    if (m) { o = o.slice(m[0].length); s = s.slice(m[0].length); }
    m = /^[a-z_]\w*:(?=(do|if|select|block|associate|critical|forall|where|change)\b)/.exec(s);
    if (m) { o = o.slice(m[0].length); s = s.slice(m[0].length); }
    let r;
    try {
      r = this.classify(s, o, ev);
    } catch (err) {
      this.diag('parse-error', `could not parse this statement: ${err.message}`, ev);
      r = SPEC;
    }
    this.afterStatement(r, ev, last);
  }

  classify(s, o, ev) {
    if (isAssignment(s)) return this.exec(s, o, ev);
    const w = /^[a-z][a-z0-9_]*/.exec(s)?.[0];
    if (!w) return this.exec(s, o, ev);
    switch (w) {
      case 'module': return this.moduleStmt(s, o, ev);
      case 'submodule': {
        const m = /^submodule\(([^)]*)\)([a-z_]\w*)$/.exec(s);
        if (!m) break;
        const parent = o.slice(10, 10 + m[1].length).trim();
        const [ancestor, parentSub] = parent.split(':').map((x) => x.trim());
        return this.unitStart('submodule', o.slice(o.length - m[2].length), ev, parentSub ? { ancestor, parentSubmodule: parentSub } : { ancestor });
      }
      case 'program': {
        const m = /^program ([a-z_]\w*)$/.exec(s);
        if (m) return this.unitStart('program', o.slice(8), ev);
        if (s === 'program') return this.unitStart('program', '', ev);
        break;
      }
      case 'block': case 'blockdata': {
        const m = /^block ?data(?: ?([a-z_]\w*))?$/.exec(s);
        if (m) return this.unitStart('blockdata', m[1] ? o.slice(o.length - m[1].length) : '', ev);
        if (s === 'block') {
          this.push({ kind: 'block', entity: null, decls: new Map() });
          return EXEC;
        }
        break;
      }
      case 'contains':
        if (s === 'contains') {
          this.ensureUnit(ev);
          this.top.contains = true;
          return SPEC;
        }
        break;
      case 'interface': return this.interfaceStart(s, o, ev, false);
      case 'abstract':
        if (s === 'abstract interface') return this.interfaceStart(s, o, ev, true);
        break;
      case 'use': return this.useStmt(s, o, ev);
      case 'import': return SPEC;
      case 'implicit': case 'implicitnone': return this.implicitStmt(s, o, ev);
      case 'public': case 'private': return this.accessStmt(w, s, o, ev);
      case 'type': {
        if (/^type is\(/.test(s)) return this.exec(s, o, ev);
        if (/^type(?:,|::| [a-z_])/.test(s) && !s.startsWith('type(')) return this.typeStart(s, o, ev);
        break;
      }
      case 'class':
        if (/^class (is\(|default\b)/.test(s)) return this.exec(s, o, ev);
        break;
      case 'procedure': {
        const sc = this.top;
        if (sc.kind === 'interface') return this.specifics(s, o, 9);
        if (sc.kind === 'type' && sc.contains) return this.bindingStmt(s, o, ev);
        break;
      }
      case 'generic': return this.genericStmt(s, o, ev);
      case 'final': {
        const sc = this.top;
        if (sc.kind === 'type') {
          const i = s.startsWith('final::') ? 7 : 6;
          sc.entity.finals.push(...listItems(o.slice(i), s.slice(i)));
          return SPEC;
        }
        break;
      }
      case 'enum': {
        const m = /^enum(?:,bind\((\w+)\))?(?:::([a-z_]\w*))?$/.exec(s);
        if (!m) break;
        return this.enumStart(m[2] ? o.slice(o.length - m[2].length) : '', ev, m[1] ? { bind: m[1] } : {});
      }
      case 'enumeration': case 'enumerationtype': {
        const m = /^enumeration ?type(?:::| )([a-z_]\w*)$/.exec(s);
        if (m) return this.enumStart(o.slice(o.length - m[1].length), ev, { enumeration: true });
        break;
      }
      case 'enumerator': {
        const sc = this.top;
        if (sc.kind !== 'enum') break;
        const i = s.startsWith('enumerator::') ? 12 : 11;
        const list = parseEntities(s.slice(i), o.slice(i));
        const targets = [];
        for (const en of list) {
          const x = { name: en.name };
          if (en.init !== undefined) x.init = en.init;
          sc.entity.enumerators.push(x);
          targets.push(x);
        }
        return { targets };
      }
      case 'parameter': return this.parameterStmt(s, o, ev);
      case 'common': return this.commonStmt(s, o, ev);
      case 'namelist': return this.namelistStmt(s, o, ev);
      case 'sequence':
        if (this.top.kind === 'type') this.top.entity.sequence = true;
        return SPEC;
      case 'data': case 'equivalence': case 'entry': case 'include':
        if (/^(data|equivalence|entry|include)\b/.test(s)) return SPEC;
        break;
      case 'format':
        if (s.startsWith('format(')) return EXEC;
        break;
      case 'call': return this.callStmt(s, o, ev, 0);
      case 'if': {
        if (s[2] !== '(') break;
        const k = matchClose(s, 2);
        if (k > 0 && /^call\b/.test(s.slice(k + 1))) {
          this.exec(s.slice(0, k + 1), o.slice(0, k + 1), ev);
          return this.callStmt(s, o, ev, k + 1);
        }
        return this.exec(s, o, ev);
      }
      default:
        if (ATTR_STMT.has(w)) {
          const r = this.attrStmt(w, s, o, ev);
          if (r) return r;
        }
    }
    if (w.startsWith('end')) {
      const r = this.endStmt(s, o, ev);
      if (r) return r;
    }
    if (PREFIX.has(w) || w === 'subroutine' || w === 'function' || TYPE_WORD.has(w)) {
      if (s.indexOf('function') >= 0 || s.indexOf('subroutine') >= 0) {
        const h = procHeader(s, o);
        if (h) return this.procStart(h, ev);
      }
    }
    if (TYPE_WORD.has(w)) {
      const d = parseDeclaration(s, o);
      if (d) return this.declaration(d, ev);
    }
    if (COARRAY_STMT.test(s)) {
      const sc = this.execScope();
      if (sc) (sc.entity.hpc ??= {}).coarray = true;
      return EXEC;
    }
    return this.exec(s, o, ev);
  }

  // ---------------------------------------------------------------- scopes

  push(sc) {
    this.stack.push(sc);
  }

  /** Statements outside any program unit belong to a main program without a PROGRAM statement. */
  ensureUnit(ev) {
    if (this.stack.length === 1) this.unitStart('program', '', ev, { implicit: true });
  }

  entity(kind, name, ev, parent, extra) {
    const e = { kind, name, file: ev.f, line: ev.n, lineEnd: ev.e, cond: ev.c, parent, children: [], ...extra };
    if (parent) parent.children.push(e);
    else this.roots.push(e);
    return e;
  }

  unitStart(kind, name, ev, extra = {}) {
    if (this.stack.length > 1) {
      const open = this.stack[1];
      this.diag('unclosed', `${open.kind} ${open.entity?.name ?? ''} has no end statement`, { f: ev.f, n: open.entity?.line ?? ev.n });
      while (this.stack.length > 1) this.close(this.stack.pop(), ev);
    }
    const e = this.entity(kind, name, ev, null, extra);
    this.push({ kind, entity: e, contains: false, imp: null, decls: new Map(), access: new Map(), defaultAccess: null, pendingAttrs: new Map(), refs: new Set() });
    return { targets: [e] };
  }

  popTo(kinds, ev) {
    let i = this.stack.length - 1;
    while (i > 0 && !kinds.includes(this.stack[i].kind)) i--;
    if (i <= 0) {
      this.diag('unmatched-end', `an end statement with no open ${kinds.join(' or ')}`, ev);
      return false;
    }
    while (this.stack.length > i + 1) {
      const sc = this.stack.pop();
      if (sc.kind !== 'block') this.diag('unclosed', `${sc.kind} ${sc.entity?.name ?? ''} has no end statement`, { f: ev.f, n: sc.entity?.line ?? ev.n });
      this.close(sc, ev);
    }
    this.close(this.stack.pop(), ev);
    return true;
  }

  close(sc, ev) {
    const e = sc.entity;
    if (!e) return;
    if (ev.f === e.file && ev.e >= e.line) e.lineEnd = ev.e;
    switch (sc.kind) {
      case 'procedure': this.finishProcedure(sc); break;
      case 'program': this.finishProcedure(sc); break;
      case 'module': this.finishModule(sc); break;
      case 'type': this.finishType(sc); break;
    }
  }

  /** The implicit typing rules in force in the scope at `depth` and its hosts: 'none', or a table of 26 types. */
  implicitFor(depth) {
    for (let i = depth; i > 0; i--) {
      const sc = this.stack[i];
      if (sc.imp) return sc.imp;
      if (sc.kind === 'procedure' && sc.entity.scope === 'interface') break;
    }
    return defaultImplicit();
  }

  finishProcedure(sc) {
    const e = sc.entity;
    // sc was just popped, so its host is on top; interface bodies do not see their host's rules
    const imp = sc.imp ?? (e.scope === 'interface' ? defaultImplicit() : this.implicitFor(this.stack.length - 1));
    const typeOf = (name) => {
      if (imp === 'none') return null;
      const i = name.toLowerCase().charCodeAt(0) - 97;
      const t = imp[i];
      return t ? { ...t, implicit: true } : null;
    };
    if (e.args) for (const a of e.args) if (a.type === undefined && a.name !== '*') a.type = typeOf(a.name);
    if (e.result && !e.result.type) e.result.type = typeOf(e.result.name);
    if (sc.refs?.size) {
      sc.refs.delete(e.name.toLowerCase());
      if (sc.refs.size) e.refs = [...sc.refs].sort();
    }
  }

  finishModule(sc) {
    const def = sc.defaultAccess ?? 'public';
    const access = (name, attr) => attr ?? sc.access.get(name.toLowerCase()) ?? def;
    for (const c of sc.entity.children) {
      if (c.kind === 'interface') {
        // the procedures an interface block declares are module names of their own (the specifics of a generic too)
        for (const b of c.children) b.access = access(b.name, b.accessAttr);
        if (!c.name) continue;
      }
      if (c.kind === 'enum') {
        if (c.name) c.access = access(c.name, c.accessAttr);
        for (const x of c.enumerators) x.access = access(x.name);
        continue;
      }
      c.access = access(c.name, c.accessAttr);
    }
  }

  finishType(sc) {
    for (const c of sc.entity.children) {
      if (c.kind === 'component') c.access = c.accessAttr ?? (sc.privateComponents ? 'private' : 'public');
      else if (c.kind === 'binding') c.access = c.accessAttr ?? (sc.privateBindings ? 'private' : 'public');
    }
  }

  // ---------------------------------------------------------------- program units and procedures

  moduleStmt(s, o, ev) {
    if (s.startsWith('module procedure')) {
      if (this.top.kind === 'interface') return this.specifics(s, o, 16);
      const m = /^module procedure ([a-z_]\w*)$/.exec(s);
      if (m) return this.procStart({ proc: 'procedure', name: o.slice(17), args: null, prefix: ['module'], rtype: null, result: null, bind: null }, ev);
      return SPEC;
    }
    const m = /^module ([a-z_]\w*)$/.exec(s);
    if (m && !PREFIX.has(m[1])) return this.unitStart('module', o.slice(7), ev);
    const h = procHeader(s, o);
    if (h) return this.procStart(h, ev);
    return SPEC;
  }

  procStart(h, ev) {
    let sc = this.top;
    // a procedure header can never sit inside a type, an enum or a block construct: their end statements are missing
    while (sc.kind === 'type' || sc.kind === 'enum' || sc.kind === 'block') {
      if (sc.kind !== 'block') this.diag('unclosed', `${sc.kind} ${sc.entity?.name ?? ''} has no end statement`, { f: ev.f, n: sc.entity?.line ?? ev.n });
      this.close(this.stack.pop(), ev);
      sc = this.top;
    }
    let scope;
    switch (sc.kind) {
      case 'file': scope = 'external'; break;
      case 'interface': scope = 'interface'; break;
      case 'module': case 'submodule': scope = h.prefix.includes('module') ? 'separate' : 'module'; break;
      default: scope = 'internal';
    }
    const e = this.entity('procedure', h.name, ev, sc.entity, { proc: h.proc, scope });
    const prefix = h.prefix.filter((p) => p !== 'module' || scope === 'interface');
    if (prefix.length) e.prefix = prefix;
    if (h.bind !== null) e.bind = h.bind;
    if (h.args) e.args = h.args.map((name) => ({ name }));
    if (h.proc === 'function') {
      e.result = { name: h.result ?? h.name, type: h.rtype };
      if (h.rtype) e.result.typeInHeader = true; // `pure real(dp) function f(x)`: shown in the signature
    }
    if (h.proc === 'procedure') e.separate = true;
    if (scope === 'interface' && h.prefix.includes('module')) e.separate = true;
    const args = new Map();
    if (e.args) for (const a of e.args) args.set(a.name.toLowerCase(), a);
    this.push({ kind: 'procedure', entity: e, args, resultName: e.result ? e.result.name.toLowerCase() : null, contains: false, imp: null, decls: new Map(), pendingAttrs: new Map(), refs: new Set() });
    return { targets: [e] };
  }

  interfaceStart(s, o, ev, abstract) {
    this.ensureUnit(ev);
    const spec = abstract ? '' : s.slice(9).trim();
    const ospec = abstract ? '' : o.slice(9).trim();
    const ikind = abstract ? 'abstract' : !spec ? 'explicit' : spec.startsWith('operator(') ? 'operator'
      : spec.startsWith('assignment(') ? 'assignment' : /^(read|write)\((un)?formatted\)$/.test(spec) ? 'dtio' : 'generic';
    const e = this.entity('interface', ospec, ev, this.top.entity, { ikind, procedures: [] });
    this.push({ kind: 'interface', entity: e });
    return { targets: [e] };
  }

  /** The specific procedures of a generic interface: `module procedure a, b` or `procedure :: a, b`. */
  specifics(s, o, i) {
    if (s.startsWith('::', i)) i += 2;
    else if (s[i] === ' ') i++;
    this.top.entity.procedures.push(...listItems(o.slice(i), s.slice(i)));
    return SPEC;
  }

  typeStart(s, o, ev) {
    const m = /^type(?:,(.*?))?(?:::| )([a-z_]\w*)(?:\(([^)]*)\))?$/.exec(s);
    if (!m) return this.exec(s, o, ev);
    this.ensureUnit(ev);
    const dc = s.indexOf('::');
    const at = dc >= 0 ? dc + 2 : 5;
    const name = o.slice(at, at + m[2].length);
    const attrs = m[1] ? parseAttrs(m[1], o.slice(5, 5 + m[1].length)) : { list: [] };
    const extra = { params: [], finals: [] };
    if (attrs.extends) extra.extends = attrs.extends;
    if (attrs.abstract) extra.abstract = true;
    if (attrs.bind !== undefined) extra.bind = attrs.bind;
    if (attrs.access) extra.accessAttr = attrs.access;
    if (m[3]) for (const p of listItems(o.slice(at + m[2].length + 1, at + m[2].length + 1 + m[3].length))) extra.params.push({ name: p });
    const e = this.entity('type', name, ev, this.top.entity, extra);
    this.push({ kind: 'type', entity: e, contains: false, privateComponents: false, privateBindings: false });
    return { targets: [e] };
  }

  enumStart(name, ev, extra) {
    this.ensureUnit(ev);
    const e = this.entity('enum', name, ev, this.top.entity, { ...extra, enumerators: [] });
    this.push({ kind: 'enum', entity: e });
    return { targets: [e] };
  }

  endStmt(s, o, ev) {
    let rest = s.slice(3);
    if (rest[0] === ' ') rest = rest.slice(1);
    let kw = null;
    for (const k of END_WORDS) {
      if (rest.startsWith(k) && (rest.length === k.length || !isWord(rest.charCodeAt(k.length)))) { kw = k; break; }
    }
    if (kw === null) {
      if (rest === '') kw = '';
      else {
        // fixed form may run the name on: ENDSUBROUTINEDGESV
        const k = ['subroutine', 'function', 'module', 'program', 'interface'].find((x) => rest.startsWith(x));
        if (!k) return null;
        kw = k;
      }
    }
    switch (kw) {
      case 'do': case 'if': case 'select': case 'associate': case 'where': case 'forall': case 'critical': case 'team':
      case 'file':
        return EXEC;
      case 'block':
        if (this.top.kind === 'block') this.stack.pop();
        return EXEC;
    }
    this.popTo(END_UNIT[kw], ev);
    return END;
  }

  // ---------------------------------------------------------------- specification statements

  declaration(d, ev) {
    let sc = this.top;
    if (sc.kind === 'file') {
      this.ensureUnit(ev);
      sc = this.top;
    }
    const { type, attrs, entities } = d;
    const targets = [];
    switch (sc.kind) {
      case 'procedure': {
        for (const en of entities) {
          const key = en.name.toLowerCase();
          const arg = sc.args.get(key);
          let v = null;
          if (arg) v = arg;
          else if (key === sc.resultName) v = sc.entity.result;
          if (v) {
            fillVar(v, type, attrs, en);
            if (ev.c && ev.c !== sc.entity.cond) v.cond = ev.c;
            targets.push(v);
          } else sc.decls.set(key, { dims: en.dims ?? attrs.dims, character: type.base === 'character' });
        }
        return targets.length ? { targets } : SINK;
      }
      case 'module': case 'submodule': {
        for (const en of entities) {
          const v = this.entity('variable', en.name, ev, sc.entity, {});
          fillVar(v, type, attrs, en);
          if (attrs.parameter) v.parameter = true;
          const key = en.name.toLowerCase();
          sc.decls.set(key, v);
          const pend = sc.pendingAttrs.get(key);
          if (pend) { for (const f of pend) f(v); sc.pendingAttrs.delete(key); }
          targets.push(v);
        }
        return { targets };
      }
      case 'type': {
        if (sc.contains) return SPEC;
        for (const en of entities) {
          if (attrs.typeParam) {
            let p = sc.entity.params.find((x) => x.name.toLowerCase() === en.name.toLowerCase());
            if (!p) sc.entity.params.push((p = { name: en.name }));
            p.attr = attrs.typeParam;
            p.type = type;
            if (en.init !== undefined) p.init = en.init;
            targets.push(p);
            continue;
          }
          const c = this.entity('component', en.name, ev, sc.entity, {});
          fillVar(c, type, attrs, en);
          targets.push(c);
        }
        return { targets };
      }
      case 'program': case 'block': case 'blockdata':
        for (const en of entities) sc.decls?.set(en.name.toLowerCase(), { dims: en.dims ?? attrs.dims, character: type.base === 'character' });
        return SINK;
      default:
        return SINK;
    }
  }

  /** `intent(in) :: x`, `optional y`, `dimension a(n)`, `external f`, … */
  attrStmt(word, s, o, ev) {
    let i = word.length, arg = null;
    if (s[i] === '(') {
      const k = matchClose(s, i);
      if (k < 0) return null;
      arg = o.slice(i + 1, k).trim();
      i = k + 1;
    }
    if (s.startsWith('::', i)) i += 2;
    else if (s[i] === ' ') i++;
    else if (i < s.length && !/[a-z_]/.test(s[i])) return null;
    const sc = this.top;
    if (i >= s.length) {
      // `save` alone, `protected` alone: nothing to attach
      return SPEC;
    }
    // `bind(c) :: x` and `save /blk/` name common blocks; skip them
    const list = s.slice(i).startsWith('/') ? [] : parseEntities(s.slice(i), o.slice(i));
    const apply = (v, en) => {
      switch (word) {
        case 'intent': v.intent = arg.toLowerCase().replace(/\s+/g, ''); break;
        case 'optional': v.optional = true; break;
        case 'value': v.value = true; break;
        case 'dimension': if (en.dims) v.dims = en.dims; break;
        case 'codimension': if (en.codims) v.codims = en.codims; break;
        default: (v.attrs ??= []).includes(word) || v.attrs.push(arg !== null ? `${word}(${arg})` : word);
      }
    };
    const targets = [];
    for (const en of list) {
      const key = en.name.toLowerCase();
      if (sc.kind === 'procedure') {
        const v = sc.args.get(key) ?? (key === sc.resultName ? sc.entity.result : null);
        if (v) { apply(v, en); targets.push(v); }
        else if (word === 'dimension') sc.decls.set(key, { dims: en.dims });
        else if (word === 'external' && !sc.decls.has(key)) sc.decls.set(key, { external: true });
      } else if (sc.kind === 'module' || sc.kind === 'submodule') {
        const v = sc.decls.get(key);
        if (v) apply(v, en);
        else if (word !== 'external' && word !== 'intrinsic') {
          const fns = sc.pendingAttrs.get(key) ?? [];
          fns.push((x) => apply(x, en));
          sc.pendingAttrs.set(key, fns);
        }
      }
    }
    return targets.length ? { targets } : SPEC;
  }

  parameterStmt(s, o, ev) {
    const m = /^parameter\((.*)\)$/.exec(s);
    if (!m) return null;
    const sc = this.top;
    if (sc.kind !== 'module' && sc.kind !== 'submodule') return SPEC;
    const targets = [];
    for (const [a, b] of splitRanges(m[1], ',')) {
      const item = o.slice(10 + a, 10 + b);
      const eq = item.indexOf('=');
      if (eq < 0) continue;
      const name = item.slice(0, eq).trim();
      const key = name.toLowerCase();
      let v = sc.decls.get(key);
      if (!v) {
        v = this.entity('variable', name, ev, sc.entity, { type: null });
        sc.decls.set(key, v);
      }
      v.parameter = true;
      v.init = item.slice(eq + 1).trim();
      targets.push(v);
    }
    return { targets };
  }

  commonStmt(s, o, ev) {
    const sc = this.top;
    if (!sc.entity) return SPEC;
    // common /a/ x, y, /b/ z  and the blank common `common x, y`
    let i = s[6] === ' ' ? 7 : 6;
    while (i < s.length) {
      let name = '';
      if (s[i] === '/') {
        const j = s.indexOf('/', i + 1);
        if (j < 0) break;
        name = o.slice(i + 1, j).trim();
        i = j + 1;
      }
      let j = i, depth = 0;
      for (; j < s.length; j++) {
        const c = s[j];
        if (c === '(') depth++;
        else if (c === ')') depth--;
        else if (c === '/' && depth === 0) break;
      }
      const members = listItems(o.slice(i, j), s.slice(i, j)).map((x) => x.replace(/\(.*$/, '').trim()).filter(Boolean);
      if (members.length || name) (sc.entity.commons ??= []).push({ name, members, line: ev.n });
      i = j;
    }
    return SPEC;
  }

  namelistStmt(s, o, ev) {
    const sc = this.top;
    if (!sc.entity) return SPEC;
    const re = /\/([a-z_]\w*)\//g;
    const marks = [];
    let m;
    while ((m = re.exec(s))) marks.push({ name: o.slice(m.index + 1, m.index + 1 + m[1].length), start: re.lastIndex, at: m.index });
    for (let i = 0; i < marks.length; i++) {
      const end = i + 1 < marks.length ? marks[i + 1].at : s.length;
      const members = listItems(o.slice(marks[i].start, end).replace(/,$/, ''), s.slice(marks[i].start, end).replace(/,$/, ''));
      (sc.entity.namelists ??= []).push({ name: marks[i].name, members, line: ev.n });
    }
    return SPEC;
  }

  implicitStmt(s, o, ev) {
    this.ensureUnit(ev);
    const sc = this.top;
    if (/^implicit ?none\b/.test(s)) {
      sc.imp = 'none';
      return SPEC;
    }
    const map = Array.isArray(sc.imp) ? sc.imp : defaultImplicit();
    const body = s.slice(9), obody = o.slice(9);
    for (const [a, b] of splitRanges(body, ',')) {
      const is = body.slice(a, b).trim(), os = obody.slice(a, b).trim();
      const t = typeSpec(is, os);
      if (!t) continue;
      let type = t.type, letters;
      if (is[t.end] === '(') letters = is.slice(t.end + 1, -1);
      else {
        // IMPLICIT REAL (A-H): the parentheses were the letters, not a kind
        const m = /^([a-z ]+?)\((.*)\)$/.exec(is);
        if (!m) continue;
        type = { base: type.base, kind: null, len: null, text: os.slice(0, m[1].length) };
        letters = m[2];
      }
      for (const r of letters.split(',')) {
        const [x, y = x] = r.split('-').map((c) => c.trim().charCodeAt(0) - 97);
        for (let c = x; c <= y && c >= 0 && c < 26; c++) map[c] = type;
      }
    }
    sc.imp = map;
    return SPEC;
  }

  accessStmt(word, s, o, ev) {
    const sc = this.top;
    let i = word.length;
    if (s.startsWith('::', i)) i += 2;
    else if (s[i] === ' ') i++;
    else if (i < s.length) return this.exec(s, o, ev);
    if (i >= s.length) {
      if (sc.kind === 'module' || sc.kind === 'submodule') sc.defaultAccess = word;
      else if (sc.kind === 'type') {
        if (sc.contains) sc.privateBindings = word === 'private';
        else sc.privateComponents = word === 'private';
      }
      return SPEC;
    }
    if (sc.access) for (const item of splitTop(s.slice(i), ',')) sc.access.set(item.trim(), word);
    return SPEC;
  }

  useStmt(s, o, ev) {
    const m = /^use(?:,(intrinsic|non_intrinsic))?(?:::| )([a-z_]\w*)/.exec(s);
    if (!m) return this.exec(s, o, ev);
    this.ensureUnit(ev);
    const at = m[0].length;
    const u = { module: o.slice(at - m[2].length, at), line: ev.n };
    if (m[1]) u.nature = m[1];
    if (ev.c) u.cond = ev.c;
    if (s.startsWith(',only:', at)) u.only = listItems(o.slice(at + 6), s.slice(at + 6)).map(rename);
    else if (s[at] === ',') u.renames = listItems(o.slice(at + 1), s.slice(at + 1)).map(rename);
    const owner = this.owner();
    if (owner) (owner.uses ??= []).push(u);
    return SPEC;
  }

  bindingStmt(s, o, ev) {
    const sc = this.top;
    let i = 9, iface = null;
    if (s[i] === '(') {
      const k = matchClose(s, i);
      if (k < 0) return SPEC;
      iface = o.slice(i + 1, k).trim();
      i = k + 1;
    }
    let attrs = { list: [] };
    if (s[i] === ',') {
      const dc = s.indexOf('::', i);
      if (dc < 0) return SPEC;
      attrs = parseAttrs(s.slice(i + 1, dc), o.slice(i + 1, dc));
      i = dc + 2;
    } else if (s.startsWith('::', i)) i += 2;
    else if (s[i] === ' ') i++;
    const targets = [];
    for (const [a, b] of splitRanges(s.slice(i), ',')) {
      const is = s.slice(i + a, i + b), os = o.slice(i + a, i + b);
      const arrow = is.indexOf('=>');
      const name = (arrow >= 0 ? os.slice(0, arrow) : os).trim();
      if (!name) continue;
      const bnd = this.entity('binding', name, ev, sc.entity, { binding: 'procedure' });
      if (arrow >= 0) bnd.impl = os.slice(arrow + 2).trim();
      if (iface) bnd.iface = iface;
      if (attrs.deferred) bnd.deferred = true;
      if (attrs.nopass) bnd.nopass = true;
      if (attrs.pass !== undefined) bnd.pass = attrs.pass;
      if (attrs.nonOverridable) bnd.nonOverridable = true;
      if (attrs.access) bnd.accessAttr = attrs.access;
      targets.push(bnd);
    }
    return { targets };
  }

  genericStmt(s, o, ev) {
    const m = /^generic(?:,(public|private))?::/.exec(s);
    if (!m) return null;
    const at = m[0].length;
    const arrow = indexTop(s, '=>', at);
    if (arrow < 0) return SPEC;
    const spec = o.slice(at, arrow).trim();
    const list = listItems(o.slice(arrow + 2), s.slice(arrow + 2));
    const sc = this.top;
    if (sc.kind === 'type' && sc.contains) {
      const g = this.entity('binding', spec, ev, sc.entity, { binding: 'generic', procedures: list });
      if (m[1]) g.accessAttr = m[1];
      return { targets: [g] };
    }
    this.ensureUnit(ev);
    const lspec = spec.toLowerCase();
    const ikind = lspec.startsWith('operator(') ? 'operator' : lspec.startsWith('assignment(') ? 'assignment' : /^(read|write)\(/.test(lspec) ? 'dtio' : 'generic';
    const e = this.entity('interface', spec, ev, this.top.entity, { ikind, procedures: list, statement: true });
    if (m[1]) e.accessAttr = m[1];
    return { targets: [e] };
  }

  // ---------------------------------------------------------------- executable statements

  callStmt(s, o, ev, at) {
    const m = /^call ?([a-z_][\w%]*)/.exec(s.slice(at));
    const sc = this.execScope();
    if (m && sc) {
      const name = o.slice(at + m[0].length - m[1].length, at + m[0].length);
      const call = { name, line: ev.n };
      if (ev.c) call.cond = ev.c;
      (sc.entity.calls ??= []).push(call);
      if (/^co_(sum|min|max|reduce|broadcast)$/.test(m[1])) (sc.entity.hpc ??= {}).coarray = true;
    }
    return this.exec(s.slice(at + (m ? m[0].length : 0)), o, ev);
  }

  exec(s, o, ev) {
    const sc = this.execScope();
    if (!sc) {
      if (this.stack.length === 1) {
        this.ensureUnit(ev);
        return this.exec(s, o, ev);
      }
      return EXEC;
    }
    const t = blankStrings(s);
    if (t.indexOf('[') >= 0 && /[\w)]\[/.test(t)) (sc.entity.hpc ??= {}).coarray = true;
    if (t.indexOf('(') >= 0) {
      const re = /(^|[^%\w])([a-z_]\w*) ?\(/g;
      let m;
      while ((m = re.exec(t))) {
        const name = m[2];
        if (NOT_REF.has(name) || sc.args?.has(name)) continue;
        const d = sc.decls.get(name);
        if (d && !d.external && (d.dims || d.character)) continue;
        sc.refs.add(name);
      }
    }
    return EXEC;
  }
}

// ---------------------------------------------------------------- helpers

/** True when the statement assigns to a variable: `x = 1`, `a(i)%b = 2`, `p => q`, even when `x` is a keyword. */
export function isAssignment(s) {
  let i = 0;
  const n = s.length;
  const c0 = s.charCodeAt(0);
  if (!((c0 >= 97 && c0 <= 122) || c0 === 95)) return false;
  while (i < n && isWord(s.charCodeAt(i))) i++;
  for (;;) {
    const c = s.charCodeAt(i);
    if (c === 40 || c === 91) {
      const k = matchClose(s, i);
      if (k < 0) return false;
      i = k + 1;
    } else if (c === 37) {
      i++;
      while (i < n && isWord(s.charCodeAt(i))) i++;
    } else if (c === 61) {
      return s.charCodeAt(i + 1) !== 61;
    } else return false;
  }
}

/**
 * Parses a procedure header: `[prefixes] [type] subroutine|function name[(args)] [result(r)] [bind(c…)]`.
 * @returns {{ proc: string, name: string, args: string[]|null, prefix: string[], rtype: object|null, result: string|null, bind: string|null }|null}
 */
export function procHeader(s, o) {
  let i = 0;
  const prefix = [];
  let rtype = null;
  for (;;) {
    if (s[i] === ' ') i++;
    const m = /[a-z_]\w*/y;
    m.lastIndex = i;
    const w = m.exec(s)?.[0];
    if (!w) return null;
    if (w === 'subroutine' || w === 'function') {
      if (s[i + w.length] !== ' ') return null;
      const n = /[a-z_]\w*/y;
      n.lastIndex = i + w.length + 1;
      const name = n.exec(s)?.[0];
      if (!name) return null;
      let j = n.lastIndex;
      let args = [];
      if (s[j] === '(') {
        const k = matchClose(s, j);
        if (k < 0) return null;
        args = listItems(o.slice(j + 1, k), s.slice(j + 1, k)).filter(Boolean);
        j = k + 1;
      }
      let result = null, bind = null;
      for (;;) {
        if (s[j] === ' ') j++;
        if (s.startsWith('result(', j)) {
          const k = matchClose(s, j + 6);
          if (k < 0) return null;
          result = o.slice(j + 7, k).trim();
          j = k + 1;
        } else if (s.startsWith('bind(', j)) {
          const k = matchClose(s, j + 4);
          if (k < 0) return null;
          bind = o.slice(j + 5, k).trim();
          j = k + 1;
        } else break;
      }
      if (j < s.length) return null;
      if (args.some((a) => !/^([A-Za-z_]\w*|\*)$/.test(a))) return null;
      return { proc: w, name: o.slice(i + w.length + 1, i + w.length + 1 + name.length), args, prefix, rtype, result, bind };
    }
    if (PREFIX.has(w) && (i + w.length === s.length || !isWord(s.charCodeAt(i + w.length)))) {
      prefix.push(w);
      i += w.length;
      continue;
    }
    if (!rtype) {
      const t = typeSpec(s.slice(i), o.slice(i));
      if (t) {
        rtype = t.type;
        i += t.end;
        continue;
      }
    }
    return null;
  }
}

function rename(item) {
  const k = item.indexOf('=>');
  if (k < 0) return { name: item.trim() };
  return { name: item.slice(k + 2).trim(), local: item.slice(0, k).trim() };
}

function fillVar(v, type, attrs, en) {
  v.type = en.len !== undefined && type.base === 'character' ? { ...type, len: en.len, text: `${type.text}*${en.len}` } : type;
  if (attrs.intent) v.intent = attrs.intent;
  if (attrs.optional) v.optional = true;
  if (attrs.value) v.value = true;
  const dims = en.dims ?? attrs.dims;
  if (dims) v.dims = dims;
  const codims = en.codims ?? attrs.codims;
  if (codims) v.codims = codims;
  if (en.init !== undefined) {
    v.init = en.init;
    if (en.pointerInit) v.pointerInit = true;
  }
  if (attrs.access) v.accessAttr = attrs.access;
  const rest = attrs.list.filter((a) => !/^(intent|optional|value|dimension|codimension|public|private|parameter)\b/i.test(a));
  if (rest.length) v.attrs = rest;
}

function addDoc(t, b) {
  (t.doc ??= []).push({ dir: b.dir, line: b.n, ...(b.e !== b.n ? { end: b.e } : {}), lines: b.lines, ...(b.inline ? { inline: true } : {}) });
}

/** The physical line of a continued statement on which `name` appears. */
function lineOf(ev, name) {
  const p = ev.parts;
  const re = new RegExp(`(^|[^A-Za-z0-9_])${name}([^A-Za-z0-9_]|$)`, 'i');
  for (let i = 0; i < p.length; i += 2) {
    const seg = ev.text.slice(p[i], i + 2 < p.length ? p[i + 2] : ev.text.length);
    if (re.test(seg)) return p[i + 1];
  }
  return -1;
}
