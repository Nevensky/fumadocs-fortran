// Builds registry/intrinsics.json: the Fortran intrinsic procedures (and those of iso_c_binding and iso_fortran_env)
// from M_intrinsics (MIT): category, one-liner and arguments, with their pages on fortran-lang.org and in the gfortran
// manual.
//
//   node scripts/registry/intrinsics.mjs [--refresh]
import { inflateSync } from 'node:zlib';
import { capitalise, fetchPinned, formatRegistry, isMain, loadSources, readTarGz, saveLock, source, squash, writeRegistry } from './lib.mjs';

const MODULES = { iso_c_binding: /^c_/, iso_fortran_env: /^compiler_(?:options|version)$/ };

/** Splits at top-level commas. */
function splitTop(s) {
  const out = [];
  let depth = 0;
  let cur = '';
  for (const c of s) {
    if ('([{'.includes(c)) depth++;
    if (')]}'.includes(c)) depth--;
    if (c === ',' && !depth) {
      out.push(cur);
      cur = '';
    } else cur += c;
  }
  out.push(cur);
  return out.map((x) => x.trim()).filter(Boolean);
}

/** A declared type, without its generic kinds: integer(kind=**) → integer, type(TYPE(kind=KIND)) → any. */
function simpleType(spec) {
  const s = spec.trim().toLowerCase().replace(/\s+/g, '');
  if (/^type\(type|^class\(\*\)|^type\(\*\)|^type\(kind=|^class\(/.test(s)) return 'any';
  const m = /^(integer|real|complex|logical|character|type|double precision)(?:\((.*)\))?$/.exec(s);
  if (!m) return s;
  if (m[1] === 'type') return `type(${m[2]})`;
  if (m[1] === 'character') {
    const len = /len=([^,)]+)/.exec(m[2] ?? '')?.[1];
    return len && len !== '*' && !/^\*+$/.test(len) && !/^[a-z]/.test(len) ? `character(${len})` : len === '*' ? 'character(*)' : 'character';
  }
  return m[1];
}

/** Reads one M_intrinsics page (md3/NAME.md). */
export function readPage(text) {
  // `**sum**(3) - \[ARRAY:REDUCTION\] Sum all …` (one page writes [STATE:INQUIRY\] without the first backslash)
  const head = /\*\*(\w+)\*\*\(3\)\s*-\s*\\?\[([^\]\\]*)\\?\]\s*([\s\S]*?)(?:\n\s*\n|$)/.exec(text);
  if (!head) return null;
  const name = head[1].toLowerCase();
  const synopsis = /###\s*\*\*Synopsis\*\*([\s\S]*?)(?=\n###\s)/.exec(text)?.[1] ?? '';
  const blocks = [...synopsis.matchAll(/```fortran\n([\s\S]*?)```/g)].map((m) => m[1]);
  // continued lines (… &) are joined first
  const lines = blocks.join('\n').replace(/&\s*\n\s*&?/g, ' ').split('\n').map((l) => l.trim()).filter(Boolean);

  let kind = 'f';
  let argText = null;
  for (const l of lines) {
    let m;
    if ((m = /^call\s+(\w+)\s*\((.*)\)\s*$/i.exec(l)) && m[1].toLowerCase() === name) {
      kind = 's';
      argText = m[2];
      break;
    }
    if ((m = /^(?:\w+\s*=\s*)(\w+)\s*\((.*)\)\s*$/i.exec(l)) && m[1].toLowerCase() === name) {
      argText = m[2];
      break;
    }
    if ((m = /\b(subroutine|function)\s+(\w+)\s*\((.*)\)/i.exec(l)) && m[2].toLowerCase() === name) {
      kind = m[1].toLowerCase() === 'subroutine' ? 's' : 'f';
      argText = m[3];
      break;
    }
    if ((m = /^(\w+)\s*\((.*)\)\s*$/.exec(l)) && m[1].toLowerCase() === name) {
      argText = m[2];
      break;
    }
  }
  // arguments in order; inside [brackets] they are optional
  const args = [];
  if (argText !== null) {
    let depth = 0;
    for (const tok of argText.match(/\[|\]|\w+|\|/g) ?? []) {
      if (tok === '[') depth++;
      else if (tok === ']') depth--;
      else if (tok !== '|' && !args.some((a) => a.name === tok.toLowerCase())) args.push({ name: tok.toLowerCase(), optional: depth > 0 });
    }
  }
  // declarations: types, intents, optional
  const decl = new Map();
  for (const l of lines) {
    const m = /^(.*?)\s*::\s*(.*)$/.exec(l);
    if (!m) continue;
    const [spec, ...attrs] = splitTop(m[1]);
    const a = attrs.map((x) => x.toLowerCase().replace(/\s+/g, ''));
    for (const ent of splitTop(m[2])) {
      const em = /^(\w+)\s*(\(.*\))?/.exec(ent);
      if (!em) continue;
      decl.set(em[1].toLowerCase(), {
        type: simpleType(spec) + (em[2] ? em[2].replace(/\s+/g, '') : ''),
        intent: a.find((x) => x.startsWith('intent('))?.slice(7, -1) ?? '',
        optional: a.includes('optional'),
      });
    }
  }
  const INTENT = { in: 'i', out: 'o', inout: 'b' };
  const result = kind === 'f' ? decl.get(name)?.type ?? null : null;
  return {
    name,
    kind,
    category: head[2].toLowerCase(),
    summary: capitalise(squash(head[3]).replace(/\\([[\]_*])/g, '$1').replace(/\*\*|__/g, '').replace(/(^|\W)_(\w[^_]*?)_(?=\W|$)/g, '$1$2')),
    result: result && result !== 'any' ? result : null,
    args: args.map(({ name: n, optional }) => {
      const d = decl.get(n);
      const arg = [n, INTENT[d?.intent] ?? '', d?.type ?? ''];
      if (optional || d?.optional) arg.push('?');
      return arg;
    }),
  };
}

/** A Sphinx inventory (objects.inv, version 2) → name → { role, uri }. */
export function sphinxInventory(buf) {
  let off = 0;
  for (let i = 0; i < 4; i++) off = buf.indexOf(10, off) + 1;
  const header = buf.subarray(0, off).toString('utf8');
  if (!header.startsWith('# Sphinx inventory version 2')) throw new Error('not a Sphinx inventory, version 2');
  const out = new Map();
  for (const line of inflateSync(buf.subarray(off)).toString('utf8').split('\n')) {
    const m = /^(.+?)\s+(\S+:\S+)\s+(-?\d+)\s+(\S+)\s+(.*)$/.exec(line);
    if (!m) continue;
    const uri = m[4].endsWith('$') ? m[4].slice(0, -1) + m[1] : m[4];
    if (!out.has(m[1])) out.set(m[1], { role: m[2], uri });
  }
  return out;
}

const gfortranPage = (name) => name.toUpperCase().replace(/_/g, '_005f');

export async function build() {
  const sources = await loadSources();
  const src = source(sources, 'm-intrinsics');
  const tar = readTarGz(await fetchPinned('m-intrinsics', src.urls.tarball), (p) => /^md3\/\w+\.md$/.test(p) || p === 'LICENSE');
  const fl = source(sources, 'fortran-lang');
  const inventory = sphinxInventory(await fetchPinned('fortran-lang', fl.urls.inventory));
  const flLicence = (await fetchPinned('fortran-lang', fl.urls.licence)).toString('utf8');
  const gf = source(sources, 'gfortran-index');
  const gfIndex = (await fetchPinned('gfortran-index', gf.urls.index)).toString('utf8');
  const gfPages = new Set([...gfIndex.matchAll(/href="([A-Z][A-Za-z0-9_-]*)\.html"/g)].map((m) => m[1]));

  const problems = [];
  const entries = {};
  for (const [path, buf] of [...tar].filter(([p]) => p.startsWith('md3/')).sort()) {
    const page = readPage(buf.toString('utf8'));
    if (!page) {
      problems.push(`${path}: unreadable`);
      continue;
    }
    const e = { k: page.kind, c: page.category, s: page.summary };
    if (page.result) e.r = page.result;
    e.a = page.args;
    const mod = Object.entries(MODULES).find(([, re]) => re.test(page.name))?.[0];
    if (mod) e.m = mod;
    // fortran-lang.org: learn/intrinsics/<page>/#<anchor>; the anchor is the name with hyphens unless noted
    const inv = inventory.get(page.name);
    if (inv && /^learn\/intrinsics\//.test(inv.uri)) {
      const m = /^learn\/intrinsics\/([^/]+)\/#(.*)$/.exec(inv.uri);
      if (m) {
        e.fl = m[1];
        if (m[2] !== page.name.replace(/_/g, '-') && m[2] !== page.name) e.fa = m[2];
      } else problems.push(`${page.name}: fortran-lang uri ${inv.uri}`);
    }
    // the manual names a page INDEX-intrinsic where the plain name is taken
    if (!gfPages.has(gfortranPage(page.name))) {
      const alt = `${gfortranPage(page.name)}-intrinsic`;
      if (gfPages.has(alt)) e.gp = alt;
      else e.gf = 0;
    }
    entries[page.name] = e;
  }

  const out = {
    format: 1,
    id: 'intrinsics',
    title: 'Fortran intrinsic procedures',
    version: 'Fortran 2023',
    sources: ['m-intrinsics', 'fortran-lang', 'gfortran-index'],
    legend: {
      kinds: { f: 'function', s: 'subroutine' },
      intents: { i: 'in', o: 'out', b: 'inout', '': 'not stated' },
      flags: { '?': 'optional' },
      fields: {
        k: 'kind',
        c: 'category, as M_intrinsics files it (array:transformational, numeric, …)',
        s: 'one-line description (M_intrinsics, MIT)',
        r: 'result type, when it is not generic',
        a: 'arguments: [name, intent, type, flags]; any is a generic type',
        m: 'the intrinsic module that provides it',
        fl: 'the fortran-lang.org page (learn/intrinsics/{fl}/)',
        fa: 'its anchor there, when it is not the name with hyphens',
        gf: '0: no page in the gfortran manual',
        gp: 'its gfortran page, when it is not the rule’s',
      },
    },
    links: {
      'fortran-lang': { base: 'https://fortran-lang.org/learn/intrinsics/', page: '{fl}/#{anchor}', rule: 'anchor: fa, else the name with _ written - ' },
      gfortran: { base: 'https://gcc.gnu.org/onlinedocs/gcc-16.1.0/gfortran/', page: '{NAME}.html', rule: 'the upper-case name with _ written _005f (CO_SUM → CO_005fSUM); not for entries with gf: 0' },
    },
    entries,
  };
  const text = formatRegistry(out, ['entries']);
  const bytes = await writeRegistry('intrinsics.json', text);
  const all = Object.values(entries);
  const stats = {
    entries: all.length,
    functions: all.filter((e) => e.k === 'f').length,
    subroutines: all.filter((e) => e.k === 's').length,
    fortranLang: all.filter((e) => e.fl).length,
    noGfortranPage: Object.entries(entries).filter(([, e]) => e.gf === 0).map(([n]) => n),
    noArgs: Object.entries(entries).filter(([, e]) => !e.a.length).map(([n]) => n),
    untypedArgs: Object.entries(entries).filter(([, e]) => e.a.some((a) => !a[2])).length,
    problems,
    bytes,
  };
  return { file: 'intrinsics.json', bytes, stats, licences: { 'm-intrinsics': tar.get('LICENSE').toString('utf8'), 'fortran-lang': flLicence } };
}

if (isMain(import.meta.url)) {
  const { stats } = await build();
  await saveLock();
  console.log(JSON.stringify(stats, null, 2));
}
