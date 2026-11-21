// Reads the outline (bookmarks) of a PDF: each entry's title, depth and the page that prints its heading; and the text
// of its pages, as lines. Only what the OpenACC specification needs: objects in plain `n 0 obj … endobj` form (no
// object streams), named or explicit destinations, a page tree, and page contents in plain or Flate-compressed
// streams, whose text is read through the fonts' simple encodings. The PDF is data; nothing in it is run.
import { inflateSync } from 'node:zlib';

/** The bytes of a PDF string: a literal `(…)` with escapes, or `<hex>`. */
function pdfBytes(raw) {
  if (raw.startsWith('<')) {
    const hex = raw.slice(1, -1).replace(/\s+/g, '');
    return Buffer.from(hex.length % 2 ? `${hex}0` : hex, 'hex');
  }
  const out = [];
  const s = raw.slice(1, -1);
  for (let i = 0; i < s.length; i++) {
    const c = s[i];
    if (c !== '\\') {
      out.push(c.charCodeAt(0) & 0xff);
      continue;
    }
    const n = s[++i];
    if (/[0-7]/.test(n)) {
      let oct = n;
      while (oct.length < 3 && /[0-7]/.test(s[i + 1])) oct += s[++i];
      out.push(parseInt(oct, 8) & 0xff);
    } else if (n === '\n' || n === '\r') {
      if (n === '\r' && s[i + 1] === '\n') i++;
    } else out.push(({ n: 10, r: 13, t: 9, b: 8, f: 12 }[n] ?? n.charCodeAt(0)) & 0xff);
  }
  return Buffer.from(out);
}

/** Decodes a PDF string; UTF-16BE when it starts with a byte-order mark. */
function pdfString(raw) {
  const bytes = pdfBytes(raw);
  if (bytes[0] === 0xfe && bytes[1] === 0xff) {
    const swapped = Buffer.from(bytes.subarray(2));
    swapped.swap16();
    return swapped.toString('utf16le');
  }
  return bytes.toString('latin1');
}

/** The PDF string or name that follows `/Key` in a dictionary body. */
function stringAfter(body, key) {
  const m = new RegExp(`/${key}\\s*(\\((?:[^()\\\\]|\\\\[\\s\\S]|\\((?:[^()\\\\]|\\\\[\\s\\S])*\\))*\\)|<[0-9A-Fa-f\\s]*>|/[^\\s/<>\\[\\]()]+)`).exec(body);
  if (!m) return null;
  return m[1].startsWith('/') ? m[1].slice(1) : pdfString(m[1]);
}

/** Text compared without case, blanks or punctuation: "2.7.8 copyin clause" → "278copyinclause". */
const norm = (s) => s.toLowerCase().replace(/[^a-z0-9]/g, '');

// glyph names of a font's /Differences that stand for letters or digits (the ligatures, chiefly)
const GLYPHS = { fi: 'fi', fl: 'fl', ff: 'ff', ffi: 'ffi', ffl: 'ffl' };
const DIGITS = ['zero', 'one', 'two', 'three', 'four', 'five', 'six', 'seven', 'eight', 'nine'];
DIGITS.forEach((d, i) => (GLYPHS[d] = String(i)));
// a literal string (pdfTeX escapes the parentheses in them) or a hex string
const STR = String.raw`\((?:[^()\\]|\\[\s\S])*\)|<[0-9A-Fa-f\s]*>`;
const STRING = new RegExp(STR, 'g');
// a font change, an array shown with TJ, or a string shown with Tj, ' or "
const SHOWN = new RegExp(
  [
    String.raw`\/([^\s/<>[\]()]+)\s+[-+\d.]+\s+Tf\b`,
    String.raw`\[((?:${STR}|[^\]()<])*)\]\s*TJ`,
    String.raw`(${STR})\s*(?:Tj|'|")`,
  ].join('|'),
  'g',
);

// what places and shows text, for a page's lines: a font change (its size), a move (Td, TD), a text matrix (Tm, whose
// last number is the line's height on the page), T*, an array shown with TJ, a string shown with Tj, ' or "
const PLACED = new RegExp(
  [
    String.raw`\/([^\s/<>[\]()]+)\s+([-+\d.]+)\s+Tf\b`,
    String.raw`([-+\d.]+)\s+([-+\d.]+)\s+T[dD]\b`,
    String.raw`(?:[-+\d.]+\s+){5}([-+\d.]+)\s+Tm\b`,
    String.raw`(T\*)`,
    String.raw`\[((?:${STR}|[^\]()<])*)\]\s*TJ`,
    String.raw`(${STR})\s*(?:Tj|'|")`,
  ].join('|'),
  'g',
);
// an item of a TJ array: a string, or a move in thousandths of an em (below -150, a gap between words)
const ITEM = new RegExp(`${STR}|[-+]?(?:\\d+\\.?\\d*|\\.\\d+)`, 'g');

const SECTION_DEST = /^(?:chapter|appendix|(?:sub)*section|(?:sub)*paragraph)\.([0-9A-Z][0-9A-Z.]*)$/;

/**
 * The outline of a PDF: { pages, outline: [{ title, depth, page, anchor, printed }], lines }.
 * - `anchor` is the page of the entry's destination;
 * - `page` is the page that prints the entry's heading: hyperref can leave a section's anchor at the foot of the page
 *   before its heading (the copyin clause's anchor is at the foot of page 54, its heading "2.7.8 copyin clause" at the
 *   top of page 55), so the page after the anchor's counts when only it prints the section number and title;
 * - `printed` says whether either page prints them (null for an entry without a section number);
 * - `lines(page)` is the text of a page (numbered from 1) as lines, as it is written there.
 */
export function pdfOutline(buf) {
  const s = buf.toString('latin1');
  const objs = new Map();
  for (const m of s.matchAll(/(?:^|[\r\n])(\d+)\s+0\s+obj\b([\s\S]*?)\bendobj/g)) objs.set(Number(m[1]), m[2]);
  const ref = (body, key) => {
    const m = new RegExp(`/${key}\\s+(\\d+)\\s+0\\s+R`).exec(body ?? '');
    return m ? Number(m[1]) : null;
  };
  const catalog = [...objs.values()].find((b) => /\/Type\s*\/Catalog\b/.test(b));
  if (!catalog) throw new Error('PDF: no catalog');

  // pages, in order
  const pageNo = new Map();
  const walk = (n, seen = new Set()) => {
    if (seen.has(n)) return;
    seen.add(n);
    const b = objs.get(n) ?? '';
    if (/\/Type\s*\/Pages\b/.test(b)) {
      const kids = /\/Kids\s*\[([^\]]*)\]/.exec(b)?.[1] ?? '';
      for (const k of kids.matchAll(/(\d+)\s+0\s+R/g)) walk(Number(k[1]), seen);
    } else pageNo.set(n, pageNo.size + 1);
  };
  walk(ref(catalog, 'Pages'));
  const pageObj = new Map([...pageNo].map(([n, i]) => [i, n]));

  // a destination (explicit array, or an object holding one, or a dictionary with /D) → page number
  const destPage = (text) => {
    const m = /\[\s*(\d+)\s+0\s+R/.exec(text);
    if (m && pageNo.has(Number(m[1]))) return pageNo.get(Number(m[1]));
    const r = /^\s*(\d+)\s+0\s+R/.exec(text);
    if (r) return destPage(objs.get(Number(r[1])) ?? '');
    const d = /\/D\s*(\[[^\]]*\]|\d+\s+0\s+R)/.exec(text);
    return d ? destPage(d[1]) : null;
  };

  // named destinations: /Names << /Dests … >> trees, and the older /Dests dictionary
  const named = new Map();
  const tree = (n, seen = new Set()) => {
    if (n === null || seen.has(n)) return;
    seen.add(n);
    const b = objs.get(n) ?? '';
    const kids = /\/Kids\s*\[([^\]]*)\]/.exec(b)?.[1];
    if (kids) for (const k of kids.matchAll(/(\d+)\s+0\s+R/g)) tree(Number(k[1]), seen);
    const names = /\/Names\s*\[([\s\S]*)\]/.exec(b)?.[1];
    if (names) {
      const re = /(\((?:[^()\\]|\\[\s\S])*\)|<[0-9A-Fa-f\s]*>)\s*(\d+\s+0\s+R|\[[^\]]*\])/g;
      for (const m of names.matchAll(re)) named.set(pdfString(m[1]), destPage(m[2]));
    }
  };
  const namesDict = /\/Names\s*<<([\s\S]*?)>>/.exec(catalog)?.[1] ?? objs.get(ref(catalog, 'Names')) ?? '';
  tree(ref(namesDict, 'Dests'));
  const kidsInline = /\/Dests\s*<<\s*\/Kids\s*\[([^\]]*)\]/.exec(namesDict)?.[1];
  if (kidsInline) for (const k of kidsInline.matchAll(/(\d+)\s+0\s+R/g)) tree(Number(k[1]));

  // ---------------------------------------------------------------- the text of a page

  /** The decoded data of a stream object (plain or Flate), or '' when it cannot be read. */
  const streamOf = (n) => {
    const b = objs.get(n) ?? '';
    const m = /^([\s\S]*?)\bstream\r?\n/.exec(b);
    if (!m) return '';
    const lm = /\/Length\s+(\d+)(\s+0\s+R)?/.exec(m[1]);
    const len = lm ? (lm[2] ? Number((objs.get(Number(lm[1])) ?? '').trim()) : Number(lm[1])) : NaN;
    const end = Number.isInteger(len) && len > 0 ? m[0].length + len : b.lastIndexOf('endstream');
    const raw = Buffer.from(b.slice(m[0].length, end), 'latin1');
    if (!/\/Filter/.test(m[1])) return raw.toString('latin1');
    if (!/\/Filter\s*(?:\[\s*)?\/FlateDecode\s*\]?\s*(?:\/|>>|$)/.test(m[1])) return '';
    try {
      return inflateSync(raw).toString('latin1');
    } catch {
      return '';
    }
  };
  const dictOf = (body, key) => {
    const r = ref(body, key);
    if (r !== null) return objs.get(r) ?? '';
    return new RegExp(`/${key}\\s*<<([\\s\\S]*?)>>`).exec(body ?? '')?.[1] ?? '';
  };
  /** A font's /Differences: code → the text of its glyph, for letters, digits and ligatures. */
  const encodingOf = (font) => {
    const body = objs.get(font) ?? '';
    const enc = ref(body, 'Encoding') !== null ? objs.get(ref(body, 'Encoding')) ?? '' : body;
    const diffs = /\/Differences\s*\[([^\]]*)\]/.exec(enc)?.[1] ?? '';
    const out = new Map();
    let code = 0;
    for (const t of diffs.match(/\d+|\/[^\s/[\]]+/g) ?? []) {
      if (!t.startsWith('/')) code = Number(t);
      else {
        const g = t.slice(1);
        out.set(code++, GLYPHS[g] ?? (/^[A-Za-z]$/.test(g) ? g : ''));
      }
    }
    return out;
  };
  /** A page's fonts (name → encoding) and the data of its content streams. */
  const pageData = (page) => {
    const b = objs.get(pageObj.get(page)) ?? '';
    const resources = dictOf(b, 'Resources') || b;
    const fontDict = dictOf(resources, 'Font') || dictOf(b, 'Font');
    const fonts = new Map();
    for (const m of fontDict.matchAll(/\/([^\s/<>[\]()]+)\s+(\d+)\s+0\s+R/g)) fonts.set(m[1], encodingOf(Number(m[2])));
    const contents = /\/Contents\s*(\[[^\]]*\]|\d+\s+0\s+R)/.exec(b)?.[1] ?? '';
    const data = [...contents.matchAll(/(\d+)\s+0\s+R/g)].map((m) => streamOf(Number(m[1]))).join('\n');
    return { fonts, data };
  };
  const texts = new Map();
  /** A page's text, normalised: the shown strings joined, and the offsets where each starts. */
  const pageText = (page) => {
    if (texts.has(page)) return texts.get(page);
    const { fonts, data } = pageData(page);
    let enc = new Map();
    let joined = '';
    const starts = new Set();
    for (const m of data.matchAll(SHOWN)) {
      if (m[1]) {
        enc = fonts.get(m[1]) ?? new Map();
        continue;
      }
      const strings = m[2] !== undefined ? m[2].match(STRING) ?? [] : [m[3]];
      const glyphs = (x) => [...pdfBytes(x)].map((c) => enc.get(c) ?? String.fromCharCode(c)).join('');
      const t = norm(strings.map(glyphs).join(''));
      if (!t) continue;
      starts.add(joined.length);
      joined += t;
    }
    const out = { joined, starts };
    texts.set(page, out);
    return out;
  };
  /** Whether a page shows `key` as text that starts a shown string (a heading's number starts its line). */
  const prints = (page, key) => {
    if (!pageObj.has(page) || !key) return false;
    const { joined, starts } = pageText(page);
    for (let i = joined.indexOf(key); i >= 0; i = joined.indexOf(key, i + 1)) if (starts.has(i)) return true;
    return false;
  };
  /**
   * A page's text as lines, as written (not normalised): a blank where a TJ array leaves a gap between words or a
   * move goes on along the line, a line break where a move or a new text matrix goes to another line. Text below 7
   * points (the margin's line numbers, superscripts) is left out. '' for a page the PDF does not have.
   */
  const lines = (page) => {
    if (!pageObj.has(page)) return '';
    const { fonts, data } = pageData(page);
    let enc = new Map();
    let size = 12;
    let y = null;
    let out = '';
    const gap = (c) => {
      if (!out || out.endsWith('\n')) return;
      if (c === '\n') out = `${out.trimEnd()}\n`;
      else if (!out.endsWith(' ')) out += ' ';
    };
    const glyphs = (x) => [...pdfBytes(x)].map((c) => enc.get(c) ?? String.fromCharCode(c)).join('');
    for (const m of data.matchAll(PLACED)) {
      if (m[1]) {
        enc = fonts.get(m[1]) ?? new Map();
        size = Math.abs(Number(m[2]));
      } else if (m[3] !== undefined) {
        if (Number(m[4]) !== 0) {
          gap('\n');
          if (y !== null) y += Number(m[4]);
        } else if (Number(m[3]) !== 0) gap(' ');
      } else if (m[5] !== undefined) {
        const f = Number(m[5]);
        gap(y !== null && Math.abs(f - y) < 0.5 ? ' ' : '\n');
        y = f;
      } else if (m[6]) gap('\n');
      else if (size >= 7) {
        if (m[7] === undefined) out += glyphs(m[8]);
        else {
          for (const t of m[7].matchAll(ITEM)) {
            if (/^[(<]/.test(t[0])) out += glyphs(t[0]);
            else if (Number(t[0]) < -150) gap(' ');
          }
        }
      }
    }
    return out.trimEnd();
  };

  const out = [];
  const item = (n, depth, seen = new Set()) => {
    while (n !== null && !seen.has(n)) {
      seen.add(n);
      const b = objs.get(n) ?? '';
      const title = stringAfter(b, 'Title');
      let page = null;
      let name = null;
      const resolve = (d) => {
        if (d.startsWith('[')) return destPage(d);
        name = d.startsWith('/') ? d.slice(1) : pdfString(d);
        return named.get(name) ?? null;
      };
      const dest = /\/Dest\s*(\[[^\]]*\]|\((?:[^()\\]|\\[\s\S])*\)|<[^>]*>|\/\S+)/.exec(b)?.[1];
      if (dest) page = resolve(dest);
      if (page === null) {
        const action = /\/A\s*(<<[\s\S]*?>>|\d+\s+0\s+R)/.exec(b)?.[1];
        const a = action && (action.startsWith('<<') ? action : objs.get(Number(action.split(/\s+/)[0])) ?? '');
        const d = a && /\/D\s*(\[[^\]]*\]|\((?:[^()\\]|\\[\s\S])*\)|<[^>]*>|\/\S+)/.exec(a)?.[1];
        if (d) page = resolve(d);
      }
      if (title !== null) {
        const text = title.replace(/\s+/g, ' ').trim();
        // hyperref's destination names carry the section number: subsection.2.7.8, appendix.A
        const number = SECTION_DEST.exec(name ?? '')?.[1];
        const entry = { title: text, depth, page, anchor: page, printed: null };
        if (number && page !== null) {
          const key = norm(`${number} ${text}`);
          const here = prints(page, key);
          const next = !here && prints(page + 1, key);
          entry.printed = here || next;
          if (next) entry.page = page + 1;
        }
        out.push(entry);
      }
      item(ref(b, 'First'), depth + 1, seen);
      n = ref(b, 'Next');
    }
  };
  item(ref(objs.get(ref(catalog, 'Outlines')) ?? '', 'First'), 0);
  return { pages: pageNo.size, outline: out, lines };
}
