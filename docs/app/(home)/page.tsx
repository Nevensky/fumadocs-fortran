import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import type { Metadata } from 'next';
import Link from 'next/link';
import { getHighlighter, highlight } from 'fumadocs-core/highlight';
import { Card, Cards } from 'fumadocs-ui/components/card';
import { CodeBlock, Pre } from 'fumadocs-ui/components/codeblock';
import {
  FortranArg,
  FortranArgs,
  FortranBadge,
  FortranBadges,
  FortranGraph,
  FortranRef,
  FortranSource,
  type FortranRefTarget,
} from 'fumadocs-fortran/react';
import { fortranLanguages, transformerFortranDirectives } from 'fumadocs-fortran/shiki';
import { Mermaid } from 'fumadocs-fortran/mermaid';
import { changelogRoute, gitConfig, githubUrl, siteHref, siteOpenGraph, statusSentence } from '@/lib/shared';

// the home page's address, as the site links it (metadataBase gives it its origin); its title is the root layout's
export const metadata: Metadata = {
  alternates: { canonical: siteHref('/') },
  openGraph: { ...siteOpenGraph(), url: siteHref('/') },
};

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
  ! …
  !$omp parallel do reduction(+:s)
  ! …
  call MPI_Allreduce(MPI_IN_PLACE, s, 1, MPI_DOUBLE_PRECISION, MPI_SUM, comm)
  ! …
end function norm2_parallel`;

const FILE = 'examples/modern/src/modern_ford.F90';
const NAME = 'norm2_parallel';

// its call graph, as the generator writes it for the Showcase
const CALLS = `flowchart LR
  classDef fdfProcedure fill:#98b6c8,stroke:#386a86,color:#111111
  classDef fdfMpi fill:#85c19a,stroke:#057743,color:#111111
  classDef fdfFocus stroke-width:3px
  n1("${NAME}")
  n2("MPI_Allreduce")
  n1 -- "USE_MPI" --> n2
  class n1 fdfProcedure
  class n1 fdfFocus
  class n2 fdfMpi
  click n1 href "/docs/showcase/modern/solver_kernels#${NAME}"`;

/**
 * `function <name>` in a file of the repository, read when the page is rendered, so that the sample follows edits to
 * the example: its first and last lines, its code, and the lines of the use statements before it that rename real64
 * to dp and take in mpi_f08. Undefined, with a warning in the log, when the function is missing.
 */
function readFunction(file: string, name: string) {
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
  if (start < 0 || end <= start) {
    console.warn(`home page: function ${name} not found in ${file}, so its source is left out`);
    return undefined;
  }
  const renames = lines.slice(0, start).findLastIndex((l) => /^[^!]*\buse\b.*\bdp\s*=>\s*real64\b/i.test(l));
  const mpi = lines.slice(0, start).findLastIndex((l) => /^[^!]*\buse\b.*\bmpi_f08\b/i.test(l));
  return {
    line: start + 1,
    lineEnd: end + 1,
    code: lines.slice(start, end + 1).join('\n'),
    renames: renames < 0 ? undefined : renames + 1,
    mpi: mpi < 0 ? undefined : mpi + 1,
  };
}

/**
 * Fortran highlighted as the site's code blocks are: with fumadocs-fortran/shiki's grammars, which read `!$omp` as a
 * directive where Shiki's own read it as a comment, and the transformer that marks a directive's line (fdf-directive,
 * which fumadocs-fortran/style.css tints). With `line`, as the generated page's source block shows it, numbered from
 * that line of the file.
 */
async function fortran(code: string, line?: number) {
  // fumadocs' highlighter, which highlight() uses, with the package's grammars added (once: a loaded one is kept)
  await getHighlighter('js', { langs: fortranLanguages });
  const numbers = line === undefined ? {} : { 'data-line-numbers': true, 'data-line-numbers-start': line };
  return highlight(code, {
    lang: 'fortran',
    transformers: [transformerFortranDirectives()],
    components: {
      pre: ({ className, style, children }) => (
        <CodeBlock className={className} style={style} {...numbers}>
          <Pre>{children}</Pre>
        </CodeBlock>
      ),
    },
  });
}

const FEATURES: [string, string][] = [
  ['Its own parser', 'Written in plain JavaScript with no dependencies, so it needs no Python, no compiler and no build of your code. Sources written for fypp need fypp first.'],
  ['The comments you have', 'FORD, Doxygen and LAPACK doc comments are read as they are, with Markdown and maths.'],
  ['HPC aware', 'OpenMP and OpenACC directives, MPI, coarrays and CUDA Fortran show as badges, what exists only under #ifdef USE_MPI says so, on the entity and on each argument, and calls into BLAS, LAPACK, ScaLAPACK, MPI, OpenMP and OpenACC link to their documentation.'],
  ['Arguments in full', 'Arguments, results and components are rows that open to their docs in full Markdown and their declarations; names show a card on hover, and every badge and attribute says what it means.'],
  ['Graphs and source', 'Dependency, inheritance and call graphs as Mermaid, and the code of each entry in a block that opens, numbered as in its file.'],
  ['Plain MDX pages', "Fumadocs builds the reference like hand-written pages: search, a table of contents with each entry's kind, and static export included."],
];

const primary = 'rounded-full bg-fd-primary px-5 py-2.5 text-sm font-medium text-fd-primary-foreground transition-opacity hover:opacity-90';
const secondary = 'rounded-full border px-5 py-2.5 text-sm font-medium transition-colors hover:bg-fd-accent';

export default async function HomePage() {
  const fn = readFunction(FILE, NAME);
  const written = await fortran(SOURCE);
  const code = fn && (await fortran(fn.code, fn.line));
  // the hover card of dp, as the generator writes it for a kind that a use statement renames
  const dp: Record<string, FortranRefTarget> = {
    dp: {
      href: 'https://gcc.gnu.org/onlinedocs/gfortran/ISO_005fFORTRAN_005fENV.html',
      title: 'dp ⇒ real64',
      detail: 'Real kind with a storage size of 64 bits: double precision',
      note: fn?.renames ? `Renamed in the use statement at ${FILE}:${fn.renames}` : undefined,
    },
  };
  // the hover card of MPI_Comm, as the generator writes it, from the HPC registry, for a type that mpi_f08 gives
  const comm: Record<string, FortranRefTarget> = {
    MPI_Comm: {
      href: 'https://www.mpi-forum.org/docs/mpi-5.0/mpi50-report/node35.htm',
      title: 'MPI_Comm',
      detail: 'Handle of a communicator: a group of processes and the context their messages are sent in.',
      note: fn?.mpi ? `From the use of mpi_f08 at ${FILE}:${fn.mpi}` : undefined,
    },
  };

  // HomeLayout gives the page its <main>; the skip link of (home)/layout.tsx leads to this element
  return (
    <div id="content" className="flex flex-1 flex-col">
      <section className="mx-auto w-full max-w-5xl px-4 pt-16 pb-12 text-center">
        <h1 className="text-4xl font-bold tracking-tight sm:text-5xl">Fortran API reference for Fumadocs</h1>
        <p className="mx-auto mt-5 max-w-2xl text-lg text-fd-muted-foreground">
          fumadocs-fortran reads your Fortran and the doc comments it already has, and writes the API reference as MDX
          pages that build with the rest of your site.
        </p>
        <div className="mt-8 flex flex-wrap justify-center gap-3">
          <Link href="/docs/get-started" className={primary}>
            Get started
          </Link>
          <Link href="/docs/showcase" className={secondary}>
            Showcase
          </Link>
          <a href={githubUrl} className={secondary}>
            GitHub
          </a>
        </div>
        <p className="mx-auto mt-6 max-w-2xl text-sm text-fd-muted-foreground">
          {statusSentence}{' '}
          <Link href={changelogRoute} className="underline underline-offset-4 hover:text-fd-foreground">
            Changelog
          </Link>
        </p>
      </section>

      {/* side by side only where the rendered entry gets the 34rem its tables need for all their columns */}
      <section className="mx-auto grid w-full max-w-6xl items-start gap-6 px-4 pb-16 lg:grid-cols-[minmax(0,5fr)_minmax(0,7fr)]">
        <figure className="min-w-0 [&>figure]:my-0">
          {written}
          <figcaption className="mt-2 text-sm text-fd-muted-foreground">The Fortran, as written</figcaption>
        </figure>
        <figure className="min-w-0">
          <div className="prose max-w-none rounded-xl border p-4 text-sm">
            <p className="mt-0 font-mono font-semibold">{NAME}</p>
            <FortranBadges>
              <FortranBadge kind="function" />
              <FortranBadge kind="omp" label="OpenMP parallel region" title="parallel do" />
              <FortranBadge kind="mpi" label="MPI" conditional="USE_MPI" title="MPI_Allreduce" />
            </FortranBadges>
            <p>2-norm reduced across OpenMP threads and MPI ranks.</p>
            <FortranArgs columns="type shape intent attrs">
              <FortranArg name="x" type="real(dp)" dims="(:)" intent="in" decl="real(dp), intent(in) :: x(:)" refs={dp}>
                <p>local slice of the vector</p>
              </FortranArg>
              <FortranArg
                name="comm"
                type="type(MPI_Comm)"
                intent="in"
                cond="USE_MPI"
                decl="type(MPI_Comm), intent(in) :: comm"
                refs={comm}
              >
                <p>communicator</p>
              </FortranArg>
            </FortranArgs>
            <FortranArgs title="Result" columns="type intent">
              <FortranArg name="nrm" type="real(dp)" result decl="real(dp) :: nrm" refs={dp}>
                <p>the global 2-norm</p>
              </FortranArg>
            </FortranArgs>
            <p>
              <strong>Calls:</strong>{' '}
              <FortranRef
                href="https://docs.open-mpi.org/en/v5.0.x/man-openmpi/man3/MPI_Allreduce.3.html"
                title="subroutine MPI_Allreduce (MPI)"
                detail="Combines values from all processes and distributes the result back to all processes."
              >
                <code>MPI_Allreduce</code>
              </FortranRef>{' '}
              when USE_MPI
            </p>
            <FortranGraph title="Call graph" collapsed>
              <Mermaid chart={CALLS} href={siteHref} narrow={320} />
            </FortranGraph>
            {fn && (
              <FortranSource
                file={FILE}
                line={fn.line}
                lineEnd={fn.lineEnd}
                href={`${githubUrl}/blob/${gitConfig.branch}/${FILE}#L${fn.line}-L${fn.lineEnd}`}
              >
                {code}
              </FortranSource>
            )}
          </div>
          <figcaption className="mt-2 text-sm text-fd-muted-foreground">The same procedure on its generated page</figcaption>
        </figure>
      </section>

      <section className="mx-auto w-full max-w-5xl px-4 pb-16">
        <h2 className="mb-6 text-center text-2xl font-semibold tracking-tight">Where to start</h2>
        <Cards className="sm:grid-cols-3">
          <Card title="Start a site" href="/docs/get-started">
            Your Fortran sources in a Fumadocs site made for them, from the first command to the reference in your browser.
          </Card>
          <Card title="Add it to your Fumadocs site" href="/docs/guides/site-setup">
            The packages, components and settings the generated pages need, with maths and graphs.
          </Card>
          <Card title="Coming from FORD or Doxygen" href="/docs/guides/from-ford-doxygen">
            What carries over from a FORD project file or a Doxyfile, and what works differently.
          </Card>
        </Cards>
      </section>

      <section className="border-t bg-fd-card/40">
        <div className="mx-auto w-full max-w-5xl px-4 py-16">
          <div className="grid gap-x-8 gap-y-10 sm:grid-cols-2 lg:grid-cols-3">
            {FEATURES.map(([title, text]) => (
              <div key={title}>
                <h2 className="font-semibold">{title}</h2>
                <p className="mt-2 text-sm text-fd-muted-foreground">{text}</p>
              </div>
            ))}
          </div>
          <div className="mt-14 flex flex-wrap justify-center gap-3">
            <Link href="/docs/get-started" className={primary}>
              Get started
            </Link>
            <Link href="/docs/showcase" className={secondary}>
              Showcase
            </Link>
          </div>
        </div>
      </section>
    </div>
  );
}
