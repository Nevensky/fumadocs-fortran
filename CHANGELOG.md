# Changelog

All notable changes to fumadocs-fortran are listed here. The project follows [semantic versioning](https://semver.org).

## Unreleased

Milestone M0: the parser and its gate. There is no API reference output yet; that arrives with v0.1.

- **Parser.** A statement-level Fortran parser in plain JavaScript, with no dependencies:
  - free and fixed form, decided from the extension or, for `.F` and `.fpp`, from the text; continuation lines,
    `;`, DEC tab format, Hollerith constants, keywords run together in fixed form (`implicitnone`, `endsubroutine`);
  - a C preprocessor for Fortran: conditionals evaluated with the configured macros, every entity keeping its
    condition stack, object-like and function-like macros (with `#`, `##` and the traditional `/**/` paste),
    `#include`, line markers, and an option to keep every branch;
  - Fortran `include` lines, resolved from the including file's folder and then the include directories;
  - OpenMP, OpenACC, CUDA Fortran and vendor directives, with continuation lines; `!$` lines count as code only when
    `_OPENMP` is defined;
  - modules, submodules, programs, block data, external, module, internal and separate module procedures, interface
    blocks of every kind, derived types with components, type parameters, bindings, generics and finalisers, enums,
    module variables and parameters, `use` with `only` and renames, access, common blocks and namelists;
  - for every dummy argument: type, kind, length, intent, `optional`, `value`, dimensions, codimensions and the cpp
    condition it sits under; implicit typing where nothing is declared;
  - calls, references to other procedures, and coarray use in executable code;
  - doc comments attached in FORD and Doxygen style (`!!`, `!>`, `!<`, `!*`, `!|`, and `*>` in fixed form), kept raw
    for the doc engine that comes next.
- **Intermediate model.** Entities under stable IDs such as `module:solver_kernels/type:dense_matrix`, files, and
  coded diagnostics with file and line.
- **`fumadocs-fortran dump`** prints the model as JSON, or counts per file with `--summary`.
- **The parser gate** (`scripts/gate.mjs`) checks the parser against oracles that share no code with it: a golden file
  of 41 argument attributes, the signatures documented in Reference-LAPACK (2,300 of 2,300 routines), and a census of
  program units in gcc's preprocessor output for LAPACK, ScaLAPACK, json-fortran, Quantum ESPRESSO, stdlib, Wannier90
  and miniWeather (none lost). It parses about 1.4 million lines per second.
- **FORD as an oracle**, on demand: across all of LAPACK, json-fortran and Wannier90, FORD 7.0.13 agrees with the
  parser on the type, kind, length, intent, `optional`, `value` and dimensions of all 32,728 dummy arguments. The
  24 differences it shows are FORD's errors; they are listed with their reasons.
