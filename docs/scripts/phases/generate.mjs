// Generate the reference (guides/generate.mdx) on the site Get started made, and Set up your site after it: the
// guide's commands, run as the page writes them, and the outputs it quotes.
// - the reference script, which Get started adds: `npm pkg set` sets it as the page gives it, `npm run reference`
//   prints the quoted line, and the script holds the command the page gives;
// - the build: the page's -D command, and what How a condition shows says the MPI build's pages hold;
// - dump --summary with -D USE_MPI, and its quoted total;
// - --repo and --rev for one run, after --, and the link the page quotes;
// - the generate() script of Options only in JavaScript, written from its titled block and run, and its quoted line;
// - Run it again: a page written by hand into the folder stays, out of meta.json, and the page of a source taken away
//   is deleted, and comes back with it;
// - What is read: the sentinels the page lists, against those the reader of this repository's src/ knows.
// On the site Get started leaves, with no maths or graphs (Set up's phase did not run), the runs add the guide's own
// flags for such a site, `-- --math code --graphs none`, and the quoted lines that hold only after Set up are not
// checked. The phase leaves the pages as it found them, and the reference script in docs/package.json, which the
// GitHub Pages phase runs.
import fs from 'node:fs';
import path from 'node:path';

const PAGE = 'guides/generate.mdx';
const API = 'docs/content/docs/api';
const RUN = 'npm run --prefix docs reference';
const UNCHANGED = /\b7 files \(0 changed, 0 removed\) from 3 sources\b/;

/** The page's blocks that one test picks, as a page for ctx.follow. */
const pick = (page, test) => ({ ...page, blocks: page.blocks.filter(test) });
const under = (id) => (b) => b.sections.includes(id);
const bashStarting = (start) => (b) => b.lang === 'bash' && b.body.trim().startsWith(start);

/** The words of a regular expression's first group of alternatives, as /^!\$(ompx|omp|acc|cuf)/ gives them. */
function alternatives(source, name) {
  const m = new RegExp(`const ${name} = /([^\\n]*)/[a-z]*;`).exec(source);
  const group = m && /\(([a-z|]+)\)/.exec(m[1]);
  return group ? group[1].split('|') : null;
}

export default {
  name: 'generate',
  async run(ctx) {
    const page = ctx.page(PAGE);
    const source = ctx.exists('docs/lib/source.ts') ? ctx.read('docs/lib/source.ts') : '';
    // Set up your site gives withFortran the maths plugins and the graphs
    const setUp = /\bremarkMath\b/.test(source) && /\bgraphs: true\b/.test(source);
    // the flags of Flags for one run, for a site without maths and graphs
    const extra = setUp ? '' : ' -- --math code --graphs none';
    ctx.note(`  the site ${setUp ? 'has maths and graphs (Set up your site)' : 'has no maths or graphs: runs add'
      + extra}`);
    const restore = (label) => ctx.run(`${RUN}${extra}`, { label });
    const pageOf = (slug) => ctx.read(`${API}/${slug}.mdx`);

    // ---- Keep the command in a script
    const set = page.blocks.find(bashStarting('npm pkg set --prefix docs scripts.reference='));
    if (!ctx.expect(set, `${page.rel} has no bash block that adds the reference script`)) return;
    const script = /scripts\.reference="(.*)"\s*$/.exec(set.body.trim())?.[1];
    if (setUp) {
      const r = await ctx.follow(pick(page, (b) => under('reference-script')(b) && !under('one-run')(b)));
      if (!r.ok) return;
    } else {
      const r = await ctx.follow(pick(page, (b) => b === set));
      if (!r.ok) return;
      const one = await ctx.follow(pick(page, under('one-run')), { expect: [[RUN, '7 files (0 changed, 0 removed) from 3 sources']] });
      if (!one.ok) return;
    }
    const held = JSON.parse(ctx.read('docs/package.json')).scripts?.reference;
    ctx.expect(held === script, `the reference script is "${held}", not the page's "${script}"`);

    // ---- Choose the build, and How a condition shows
    if (!(await ctx.follow(pick(page, (b) => under('choose-the-build')(b) && b.lang === 'bash'))).ok) return;
    const mpi = pageOf('solver_kernels');
    ctx.expect(/<FortranBadge kind="mpi" label="MPI" conditional="USE_MPI" title="MPI_Allreduce" \/>/.test(mpi),
      "norm2_parallel's MPI badge is not MPI when USE_MPI");
    ctx.expect(/<FortranArg name="comm" type="type\(MPI_Comm\)" intent="in" cond="USE_MPI"/.test(mpi),
      "norm2_parallel's comm row has no condition");
    ctx.expect(/`mpi_f08` \([^\n]*\) when USE_MPI/.test(mpi), "the module's Uses line has no mpi_f08 when USE_MPI");
    restore('the pages as they were');

    // ---- Check what it read
    if (!(await ctx.follow(pick(page, under('check')))).ok) return;

    // ---- Link to your repository
    if (!(await ctx.follow(pick(page, (b) => under('repository-links')(b) && b.lang === 'bash'))).ok) return;
    const link = /https:\/\/github\.com\/OWNER\/REPOSITORY\/blob\/[^\s`]+/.exec(page.prose)?.[0];
    if (ctx.expect(link, `${page.rel} quotes no link of --repo`)) {
      ctx.expect(pageOf('solver_kernels').includes(`href="${link}"`), `the pages have no source link ${link}`);
    }
    restore('the pages as they were, without links');

    // ---- Options only in JavaScript: the generate() script
    const file = 'docs/scripts/reference.mjs';
    const hadScripts = ctx.exists('docs/scripts');
    try {
      const js = pick(page, (b) => under('javascript')(b) && (setUp || b.lang !== 'text'));
      if (!(await ctx.follow(js)).ok) return;
      ctx.expect(ctx.exists(file), `${file} was not written from the page`);
      const index = ctx.read(`${API}/index.mdx`);
      const meta = JSON.parse(ctx.read(`${API}/meta.json`));
      const description = /description: '([^']+)'/.exec(page.blocks.find((b) => b.title === file)?.body ?? '')?.[1];
      ctx.expect(description && index.includes(description), "the script's description is not the overview's");
      ctx.expect(meta.defaultOpen === true, 'the script did not open the folder (defaultOpen)');
    } finally {
      fs.rmSync(path.join(ctx.project, file), { force: true });
      if (!hadScripts) fs.rmSync(path.join(ctx.project, 'docs/scripts'), { recursive: true, force: true });
    }
    restore('the pages of the command again');

    // ---- Run it again: a page written by hand stays, out of the sidebar
    const notes = `${API}/notes.mdx`;
    ctx.write(notes, '---\ntitle: Notes\n---\n\nWritten by hand.\n');
    try {
      const r = restore('with a page written by hand');
      ctx.expect(r.code === 0 && UNCHANGED.test(r.out), 'a page written by hand changed what the run wrote');
      ctx.expect(ctx.exists(notes), 'the run deleted a page written by hand');
      const meta = JSON.parse(ctx.read(`${API}/meta.json`));
      const manifest = JSON.parse(ctx.read(`${API}/.fumadocs-fortran.json`));
      ctx.expect(!meta.pages.includes('notes') && !manifest.files.includes('notes.mdx'),
        'the page written by hand is in meta.json or the manifest');
    } finally {
      fs.rmSync(path.join(ctx.project, notes), { force: true });
    }

    // ---- Run it again: the page of a source taken away is deleted, and comes back with it
    const away = path.join(ctx.logDir, 'tridiag.f');
    fs.renameSync(path.join(ctx.project, 'src/tridiag.f'), away);
    try {
      const r = restore('without src/tridiag.f');
      ctx.expect(/\b6 files \(2 changed, 1 removed\) from 2 sources\b/.test(r.out),
        'without src/tridiag.f, the run did not delete its page (6 files, 2 changed, 1 removed)');
      ctx.expect(!ctx.exists(`${API}/gtsv.mdx`), 'gtsv.mdx is still there');
    } finally {
      fs.renameSync(away, path.join(ctx.project, 'src/tridiag.f'));
    }
    // gtsv.mdx, written again, counts as changed, with the overview and meta.json
    const back = restore('with src/tridiag.f again');
    ctx.expect(/\b7 files \(3 changed, 0 removed\) from 3 sources\b/.test(back.out) && ctx.exists(`${API}/gtsv.mdx`),
      'with src/tridiag.f again, its page did not come back (7 files, 3 changed)');
    const last = restore('the pages as the phase found them');
    ctx.expect(UNCHANGED.test(last.out), 'the pages are not as they were before the phase');

    // ---- What is read: the page's sentinels against the reader's
    const reader = fs.readFileSync(path.join(ctx.repo, 'src/source/reader.js'), 'utf8');
    const section = page.text.slice(page.text.indexOf('## What is read'), page.text.indexOf('## What the HPC badges'));
    const spans = new Set([...section.matchAll(/`([^`]+)`/g)].map((m) => m[1]));
    const lists = {
      free: alternatives(reader, 'SENTINEL'), fixed: alternatives(reader, 'FIXED_SENTINEL'),
      vendor: alternatives(reader, 'VENDOR'), fixedVendor: alternatives(reader, 'FIXED_VENDOR'),
    };
    if (!ctx.expect(Object.values(lists).every(Boolean), "src/source/reader.js's sentinel lists were not found")) return;
    const want = [
      ...lists.free.map((w) => `!$${w}`),
      ...lists.fixed.flatMap((w) => (w === 'omp' ? ['c$omp', '*$omp', '!$omp'] : [w])),
      ...lists.vendor.map((w) => `!${w}$`),
      ...lists.fixedVendor.map((w) => `${w}$`),
    ];
    const missing = want.filter((w) => !spans.has(w));
    ctx.expect(!missing.length, `What is read lacks ${missing.join(', ')}`);
    const known = new Set([...want, '!$', 'c$', '*$', '&', '0', 'c', 'C', '*', '!', '-D _OPENMP', '--all-branches',
      '!$cuf kernel do']);
    const extraSpans = [...spans].filter((s) => !known.has(s));
    ctx.expect(!extraSpans.length, `What is read names what the reader does not know: ${extraSpans.join(', ')}`);
    ctx.note(`  What is read: ${want.length} sentinels, as src/source/reader.js has them`);
  },
};
