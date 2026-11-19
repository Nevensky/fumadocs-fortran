# fumadocs-fortran

Fortran API reference for [fumadocs](https://fumadocs.dev). It reads Fortran sources with its own parser, written in
plain JavaScript with no dependencies, and will write the API reference as MDX pages that a fumadocs site builds like
its hand-written pages. It reads the doc comments projects already have, in FORD, Doxygen and LAPACK style, and it
understands HPC code: OpenMP and OpenACC directives, MPI and coarrays, and calls into BLAS, LAPACK and ScaLAPACK.

**Status: in development.** The parser is done and checked (milestone M0). Page generation, the doc-comment engine
and the documentation site come with v0.1.

## What works now

It is not published to npm yet. Install it from GitHub:

```bash
npm install github:Nevensky/fumadocs-fortran --allow-git=root
```

```bash
npx fumadocs-fortran dump --summary src/
```

```bash
npx fumadocs-fortran dump -D_OPENMP -DUSE_MPI -I include src/ -o model.json
```

`dump` prints the intermediate model: every module, procedure, type, interface and variable with its arguments,
types, attributes, cpp conditions, directives, calls and doc comments. `fumadocs-fortran dump --help` lists the
options.

From JavaScript:

```js
import { extract, parseSource } from 'fumadocs-fortran';

const model = await extract({ sources: ['src'], cpp: { macros: { _OPENMP: 1 } } });
const one = parseSource('subroutine hello(n)\n  integer, intent(in) :: n\nend subroutine\n');
```

It needs Node 18 or later.

## Development

The scripts run in Docker, so the machine needs no Node: `scripts/dev.sh` runs a command in a `node:24-bookworm`
container with the repository mounted.

```bash
scripts/dev.sh npm test
```

```bash
scripts/fetch-corpus.sh
```

```bash
scripts/dev.sh node scripts/gate.mjs
```

`fetch-corpus.sh` fetches the public test corpora at pinned commits into `.corpus/`. These are Reference-LAPACK,
ScaLAPACK, json-fortran, Quantum ESPRESSO, stdlib, Wannier90 and miniWeather, and they are never committed.
`gate.mjs` then checks the parser against them.

Two further checks run on demand:
- `scripts/oracle/ford.sh` runs FORD 7.0.13 in Docker, and `scripts/oracle/compare-ford.mjs` compares every dummy
  argument with FORD's, field by field. The FORD script is GPL-3.0-or-later, like FORD, and is not part of the
  package.
- `scripts/search/measure.mjs` measures the static search index for all of LAPACK with fumadocs' own index builder.

## Licence

MIT. Test corpora keep their own licences and are only fetched, never committed or shipped.
