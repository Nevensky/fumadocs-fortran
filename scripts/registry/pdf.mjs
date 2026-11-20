// Reads the outline (bookmarks) of a PDF: each entry's title, depth and page number. Only what the OpenACC
// specification needs: objects in plain `n 0 obj … endobj` form (no object streams), named or explicit
// destinations, and a page tree. The PDF is data; nothing in it is run.

/** Decodes a PDF string: a literal `(…)` with escapes, or `<hex>`; UTF-16BE when it starts with a byte-order mark. */
function pdfString(raw) {
  let bytes;
  if (raw.startsWith('<')) {
    const hex = raw.slice(1, -1).replace(/\s+/g, '');
    bytes = Buffer.from(hex.length % 2 ? `${hex}0` : hex, 'hex');
  } else {
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
    bytes = Buffer.from(out);
  }
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

  const out = [];
  const item = (n, depth, seen = new Set()) => {
    while (n !== null && !seen.has(n)) {
      seen.add(n);
      const b = objs.get(n) ?? '';
      const title = stringAfter(b, 'Title');
      let page = null;
      const dest = /\/Dest\s*(\[[^\]]*\]|\((?:[^()\\]|\\[\s\S])*\)|<[^>]*>|\/\S+)/.exec(b)?.[1];
      if (dest) page = dest.startsWith('[') ? destPage(dest) : named.get(dest.startsWith('/') ? dest.slice(1) : pdfString(dest)) ?? null;
      if (page === null) {
        const action = /\/A\s*(<<[\s\S]*?>>|\d+\s+0\s+R)/.exec(b)?.[1];
        const a = action && (action.startsWith('<<') ? action : objs.get(Number(action.split(/\s+/)[0])) ?? '');
        const d = a && /\/D\s*(\[[^\]]*\]|\((?:[^()\\]|\\[\s\S])*\)|<[^>]*>|\/\S+)/.exec(a)?.[1];
        if (d) page = d.startsWith('[') ? destPage(d) : named.get(d.startsWith('/') ? d.slice(1) : pdfString(d)) ?? null;
      }
      if (title !== null) out.push({ title: title.replace(/\s+/g, ' ').trim(), depth, page });
      item(ref(b, 'First'), depth + 1, seen);
      n = ref(b, 'Next');
    }
  };
  item(ref(objs.get(ref(catalog, 'Outlines')) ?? '', 'First'), 0);
  return { pages: pageNo.size, outline: out };
}
