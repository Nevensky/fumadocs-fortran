// fumadocs-fortran: Fortran API reference for fumadocs. This entry point runs in Node only.

export { extract, extractFiles, parseSource } from './extract.js';
export { discover, readText } from './source/files.js';
export { detectForm, formFromPath, resolveForm, EXTENSIONS } from './source/form.js';
export { preprocess, macroTable, CondTable, evaluate } from './source/cpp.js';
export { readEvents } from './source/reader.js';
export { parseEvents, DEFAULT_MARKS } from './parse/parser.js';
export { parseDirective } from './parse/directives.js';
export { IR_VERSION } from './model/ir.js';
