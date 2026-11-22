// fumadocs-fortran: Fortran API reference for fumadocs. This entry point runs in Node only. Its exports are those
// types/index.d.ts declares; the stages between the sources and the model (preprocess, readEvents, parseEvents) stay
// inside the package.

export { extract, extractFiles, parseSource } from './extract.js';
export { discover, readText } from './source/files.js';
export { detectForm, formFromPath, resolveForm, EXTENSIONS } from './source/form.js';
export { evaluate } from './source/cpp.js';
export { DEFAULT_MARKS } from './parse/parser.js';
export { parseDirective } from './parse/directives.js';
export { IR_VERSION } from './model/ir.js';
export { renderDoc } from './docs/index.js';
export { katexMacros, normaliseTex } from './docs/math.js';
export { buildPages, anchorOf, prettyType, prettyCond } from './emit/pages.js';
export { generate, writePages } from './emit/generate.js';
export { buildGraphs } from './emit/graphs.js';
export { escapeText, safeMarkdown } from './emit/mdx.js';
