// Shared by the tests of the Shiki grammar pack.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createHighlighter, createJavaScriptRegexEngine, createOnigurumaEngine, bundledLanguages } from 'shiki';
import { fortranLanguages } from '../../shiki/index.js';

export const HERE = path.dirname(fileURLToPath(import.meta.url));
export const THEMES = ['github-light', 'github-dark'];

/** A highlighter with the GitHub themes, on the JS ('js') or Oniguruma ('oniguruma') regex engine. */
export function highlighter(engine = 'js', langs = fortranLanguages) {
  return createHighlighter({
    langs,
    themes: THEMES,
    engine: engine === 'oniguruma' ? createOnigurumaEngine(import('shiki/wasm')) : createJavaScriptRegexEngine(),
  });
}

/** Shiki's own grammars (an array: fortran-fixed-form brings fortran-free-form along). */
export async function bundled(name) {
  return (await bundledLanguages[name]()).default;
}

/** Each line's tokens, with their text, scopes (the root scope left out) and colour in `theme`. */
export function scoped(hl, code, lang, theme = 'github-light') {
  const { tokens } = hl.codeToTokens(code, { lang, theme, includeExplanation: true });
  return tokens.map((line) =>
    line.flatMap((t) => t.explanation.map((e) => ({ text: e.content, scopes: e.scopes.map((s) => s.scopeName).slice(1), color: t.color }))),
  );
}

/** A scope snapshot: a line per source line, each token that is not blank with its innermost scope. */
export function snapshot(lines) {
  const text = lines.map((tokens, i) => {
    const parts = tokens.filter((t) => t.text.trim()).map((t) => `${t.text.trim()}⟨${t.scopes.at(-1) ?? ''}⟩`);
    return `${i + 1}: ${parts.join(' ')}`.trimEnd();
  });
  return `${text.join('\n')}\n`;
}

/** The tokens of the first line whose text contains `needle`. */
export function lineWith(lines, code, needle) {
  const i = code.split('\n').findIndex((l) => l.includes(needle));
  if (i < 0) throw new Error(`no line contains ${needle}`);
  return lines[i];
}

/** The innermost scope of the token holding `text` in a line's tokens, or undefined. */
export function scopeOf(tokens, text) {
  return tokens.find((t) => t.text.trim() === text)?.scopes.at(-1);
}

export const fixture = (name) => fs.readFileSync(path.join(HERE, 'fixtures', name), 'utf8');
