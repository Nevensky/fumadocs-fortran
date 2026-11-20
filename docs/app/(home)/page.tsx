import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import Link from 'next/link';
import { FortranArg, FortranArgs, FortranBadge, FortranBadges, FortranSource } from 'fumadocs-fortran/react';
import { Credits } from '@/components/credits';
import { getShowcaseUrl } from '@/lib/source';
import { gitConfig, githubUrl } from '@/lib/shared';

// a procedure from examples/modern/src/modern_ford.F90, shortened, with its FORD doc comments
const SOURCE = `!> 2-norm reduced across OpenMP threads and MPI ranks.
function norm2_parallel(x &
#ifdef USE_MPI
    , comm &
#endif
    ) result(nrm)
  real(dp), intent(in) :: x(:) !! local slice of the vector
#ifdef USE_MPI
  type(MPI_Comm), intent(in) :: comm !! communicator
#endif
  real(dp) :: nrm !! the global 2-norm
  ...
  !$omp parallel do reduction(+:s)
  ...
  call MPI_Allreduce(MPI_IN_PLACE, s, 1, MPI_DOUBLE_PRECISION, MPI_SUM, comm)
  ...
end function norm2_parallel`;

const FILE = 'examples/modern/src/modern_ford.F90';
const NAME = 'norm2_parallel';

/**
 * The first and last lines of `function <name>` in a file of the repository, read when the page is rendered, so that
 * the source link follows edits to the example. Undefined, with a warning in the log, when either is missing.
 */
function functionLines(file: string, name: string): { line: number; lineEnd: number } | undefined {
  let lines: string[] = [];
  try {
    // next runs in docs/, one folder below the repository
    lines = readFileSync(join(process.cwd(), '..', file), 'utf8').split('\n');
  } catch {}
  // `[pure real(dp)] function <name>` outside a comment, and `end function <name>` (or `endfunction`)
  const head = new RegExp(`^(?!\\s*end\\b)[^!]*\\bfunction\\s+${name}\\b`, 'i');
  const tail = new RegExp(`^\\s*end\\s*function\\s+${name}\\b`, 'i');
  const start = lines.findIndex((l) => head.test(l));
  const end = lines.findIndex((l, i) => i > start && tail.test(l));
  if (start >= 0 && end > start) return { line: start + 1, lineEnd: end + 1 };
  console.warn(`home page: function ${name} not found in ${file}, so its source line is left out`);
}

const FEATURES: [string, string][] = [
  ['Its own parser', 'Written in plain JavaScript with no dependencies, so it needs no Python, no compiler and no build of your code.'],
  ['The comments you have', 'FORD, Doxygen and LAPACK doc comments are read as they are, with Markdown and maths.'],
  ['HPC aware', 'OpenMP and OpenACC directives, MPI and coarrays, and calls into BLAS, LAPACK and ScaLAPACK show as badges.'],
  ['cpp conditions', 'What exists only under #ifdef USE_MPI says so, on the entity and on each argument.'],
  ['Arguments in full', 'Every argument shows its type, dimensions, intent and attributes, with full Markdown under it.'],
  ['Plain MDX pages', 'fumadocs builds the reference like hand-written pages: search, a table of contents and static export included.'],
];

export default function HomePage() {
  const showcase = getShowcaseUrl() ?? '/docs';
  const lines = functionLines(FILE, NAME);

  return (
    <main className="flex flex-1 flex-col">
      <section className="mx-auto w-full max-w-5xl px-4 pt-16 pb-12 text-center">
        <h1 className="text-4xl font-bold tracking-tight sm:text-5xl">Fortran API reference for fumadocs</h1>
        <p className="mx-auto mt-5 max-w-2xl text-lg text-fd-muted-foreground">
          fumadocs-fortran reads your Fortran and the doc comments it already has, and writes the API reference as MDX
          pages that build with the rest of your site.
        </p>
        <div className="mt-8 flex flex-wrap justify-center gap-3">
          <Link href="/docs" className="rounded-full bg-fd-primary px-5 py-2.5 text-sm font-medium text-fd-primary-foreground transition-opacity hover:opacity-90">
            Introduction
          </Link>
          <Link href={showcase} className="rounded-full border px-5 py-2.5 text-sm font-medium transition-colors hover:bg-fd-accent">
            Showcase
          </Link>
          <a href={githubUrl} className="rounded-full border px-5 py-2.5 text-sm font-medium transition-colors hover:bg-fd-accent">
            GitHub
          </a>
        </div>
        <p className="mt-6 text-sm text-fd-muted-foreground">In development: this site is the first slice of v0.1.</p>
      </section>

      <section className="mx-auto grid w-full max-w-5xl items-start gap-6 px-4 pb-16 md:grid-cols-2">
        <figure className="min-w-0">
          <pre className="overflow-x-auto rounded-xl border bg-fd-card p-4 text-left font-mono text-[13px] leading-relaxed">
            {SOURCE}
          </pre>
          <figcaption className="mt-2 text-sm text-fd-muted-foreground">The Fortran, as written</figcaption>
        </figure>
        <figure className="min-w-0">
          <div className="prose max-w-none rounded-xl border p-4 text-sm">
            <p className="mt-0 font-mono font-semibold">{NAME}</p>
            <FortranBadges>
              <FortranBadge kind="function" />
              <FortranBadge kind="omp" label="OpenMP parallel region" />
              <FortranBadge kind="mpi" conditional="USE_MPI" />
            </FortranBadges>
            <p>2-norm reduced across OpenMP threads and MPI ranks.</p>
            <FortranArgs>
              <FortranArg name="x" type="real(dp)" dims="(:)" intent="in">
                local slice of the vector
              </FortranArg>
              <FortranArg name="comm" type="type(MPI_Comm)" intent="in" cond="USE_MPI">
                communicator
              </FortranArg>
            </FortranArgs>
            <FortranArgs title="Result">
              <FortranArg name="nrm" type="real(dp)">
                the global 2-norm
              </FortranArg>
            </FortranArgs>
            {lines && (
              <FortranSource
                file={FILE}
                line={lines.line}
                lineEnd={lines.lineEnd}
                href={`${githubUrl}/blob/${gitConfig.branch}/${FILE}#L${lines.line}-L${lines.lineEnd}`}
              />
            )}
          </div>
          <figcaption className="mt-2 text-sm text-fd-muted-foreground">The same procedure on its generated page</figcaption>
        </figure>
      </section>

      <section className="border-t bg-fd-card/40">
        <div className="mx-auto w-full max-w-5xl px-4 py-16">
          <div className="grid gap-x-8 gap-y-10 sm:grid-cols-2 lg:grid-cols-3">
            {FEATURES.map(([title, text]) => (
              <div key={title}>
                <h3 className="font-semibold">{title}</h3>
                <p className="mt-2 text-sm text-fd-muted-foreground">{text}</p>
              </div>
            ))}
          </div>
          <div className="mt-14 flex flex-wrap justify-center gap-3">
            <Link href="/docs/reference/components" className="rounded-full bg-fd-primary px-5 py-2.5 text-sm font-medium text-fd-primary-foreground transition-opacity hover:opacity-90">
              See the components
            </Link>
          </div>
        </div>
      </section>

      <footer className="border-t px-4 py-8 text-center">
        <Credits />
      </footer>
    </main>
  );
}
