// Troubleshooting (guides/troubleshooting.mdx): each entry's cause reproduced where a run can reproduce it, with the
// fix run after it; every message heading's words found in a log of this run (the logs of Get started and of every
// phase), or, for the few no run can reproduce, named with the log of the trial or review that printed them; and the
// Docker route of "Without Node.js", run as the page writes it on a published port, where docker is on PATH.
import fs from 'node:fs';
import net from 'node:net';
import path from 'node:path';

// every heading of the page, and how it is checked. A message's heading holds its words as printed, without code
// font: each part of it between commas must be in a log of this run (from: the phase whose logs hold it), or, where
// no run can print it, in the log of the trial or review named (outside); words: more that a log must hold. A
// symptom's heading says what the page or the site shows, and its check is the phase named, or the entry's below.
const ENTRIES = {
  'docs-exists': { message: true },
  'code-128': { message: true, outside: 'the trial (logs/02-install-github-node24-root.log) and the clean-room review '
    + '(logs/x9-github-install-today.log), with the repository private; Permission denied (publickey) in the first' },
  eallowgit: { message: true },
  'eallowgit-non-root': { message: true },
  'no-git': { message: true },
  // npm 11's words; npm 12 says it blocked the script, and npm 10 runs it and says nothing
  esbuild: { message: true, from: 'get-started', npm: 11, words: ['esbuild@'] },
  'katex-version': {},
  'zero-files': { message: true, words: ['from 0 sources'] },
  fypp: { message: true, words: ['run fypp first, and give fumadocs-fortran the Fortran it writes'] },
  unclosed: { message: true },
  'dot-dot-src': {},
  'hand-written': {},
  'not-in-sidebar': {},
  'base-url': {},
  acorn: { message: true, from: 'site-setup', words: ['Expecting Unicode escape sequence'] },
  // the component named is the first the first page built uses: FortranBadge or FortranArg, as the builds go
  'expected-component': { message: true, from: 'site-setup', pattern: /Expected component Fortran\w+ to be defined/,
    words: ['to be defined: you likely forgot to import, pass, or provide it'] },
  'expected-mermaid': { message: true, from: 'site-setup' },
  metadatabase: { message: true, from: 'get-started' },
  'api-search': { message: true, words: ['export const revalidate not configured'] },
  // the build the large-references phase runs with the search route renamed and the development server's types left
  'route-types': { message: true, from: 'large-references',
    words: ['error TS2307', 'or its corresponding type declarations'] },
  font: { message: true, outside: 'a build of the tutorial\'s site with no network (docker run --network none), '
    + 'run by hand for the Troubleshooting page' },
  // no run here can be made to run out of memory as a reader's build does
  killed: { message: true, outside: 'the clean-room review\'s builds of stdlib\'s reference in a container of 6 GiB '
    + '(rc/logs/007-stdlib-build-.log, exit 137), the page\'s Large codes' },
  'generated-page': {},
  'graphs-as-code': { from: 'site-setup' },
  maths: { from: 'site-setup' },
  'no-letters': { from: 'site-setup' },
  'no-layout': { from: 'site-setup' },
  // the index under its name, and as npm start sends it (gzipped, application/json): the large-references phase
  'slow-search': { from: 'large-references' },
  // GitHub's own Jekyll build, which runs only on GitHub with Pages set to deploy from a branch
  liquid: { message: true, outside: 'GitHub\'s pages build and deployment run on this repository, with Pages set to '
    + 'deploy from a branch: Liquid syntax error (line 104) on reference/components.mdx' },
  'pages-404': {},
  'off-site': { from: 'github-pages' },
  reload: { from: 'github-pages' },
  'markdown-twice': { from: 'github-pages' },
};

/** Every log of the run, as one text, and the phases that wrote one. */
function allLogs(dir) {
  const texts = [];
  const phases = new Set(['get-started']);
  const walk = (d, phase) => {
    for (const e of fs.readdirSync(d, { withFileTypes: true })) {
      const p = path.join(d, e.name);
      if (e.isDirectory()) {
        phases.add(e.name);
        walk(p, e.name);
      } else if (e.name.endsWith('.log')) texts.push(fs.readFileSync(p, 'utf8'));
    }
  };
  walk(dir, 'get-started');
  return { text: texts.join('\n'), phases };
}

const freePort = () => new Promise((ok, no) => {
  const s = net.createServer();
  s.on('error', no);
  s.listen(0, '127.0.0.1', () => {
    const { port } = s.address();
    s.close(() => ok(port));
  });
});

const version = (file) => (fs.existsSync(file) ? JSON.parse(fs.readFileSync(file, 'utf8')).version : null);

export default {
  name: 'troubleshooting',
  async run(ctx) {
    const page = ctx.page('guides/troubleshooting.mdx');
    const entries = page.headings.filter((h) => h.depth === 3).map((h) => h.id);
    for (const id of entries) ctx.expect(ENTRIES[id], `the heading #${id} has no check in phases/troubleshooting.mjs`);
    for (const id of Object.keys(ENTRIES)) ctx.expect(entries.includes(id), `no heading #${id} on the page`);
    const heading = (id) => page.headings.find((h) => h.id === id)?.title ?? '';
    const npmExec = 'npm exec --prefix docs -- fumadocs-fortran';

    // ---- creating the site over a docs/ with files in it, then with another name
    {
      const ns = ctx.page('new-site.mdx');
      const step1 = ns.blocks.find((b) => b.lang === 'bash' && b.body.includes('create-fumadocs-app'));
      const cmd = ctx.commands(step1.body)[0];
      const dir = ctx.scratch('docs-exists');
      fs.mkdirSync(path.join(dir, 'docs'));
      fs.writeFileSync(path.join(dir, 'docs', 'notes.md'), 'FORD output\n');
      const r = ctx.run(cmd, { cwd: dir, allowFail: true, label: 'create the site over docs/' });
      ctx.expect(r.code !== 0 && fs.readdirSync(path.join(dir, 'docs')).join() === 'notes.md',
        `over a docs/ with files, step 1 exited ${r.code} or changed docs/`);
      // the fix, another name; without installing the packages, which the steps did already
      const fix = cmd.replace(/ docs /, ' site ').replace('--install', '--no-install');
      const f = ctx.run(fix, { cwd: dir, allowFail: true, label: 'create the site as site/' });
      ctx.expect(f.code === 0 && fs.existsSync(path.join(dir, 'site', 'package.json')),
        'step 1 with another name failed');
    }

    // ---- installing from Git: a repository of the packed package, fetched by npm 12, 11.12.1, 10 and this one
    if (!ctx.tarball) ctx.note('  the Git installs are not checked: with --github, no tarball to make a repository of');
    else {
      const repoDir = ctx.scratch('git-repo');
      ctx.run(`tar -xzf "${ctx.tarball}" -C "${repoDir}" --strip-components=1`, { label: 'the package as a repo' });
      const id = '-c user.name=test -c user.email=test@example.invalid';
      const git = (cmd, cwd = repoDir) => ctx.run(`git ${id} ${cmd}`, { cwd });
      git('init -q');
      git('add -A');
      git('commit -qm one');
      const sha1 = git('rev-parse HEAD').out.trim().split('\n')[0];
      const spec = `git+file://${repoDir}`;
      const fresh = (name) => {
        const d = ctx.scratch(name);
        fs.writeFileSync(path.join(d, 'package.json'), '{ "name": "p", "version": "1.0.0", "private": true }\n');
        return d;
      };
      const installed = (d) => fs.existsSync(path.join(d, 'node_modules', 'fumadocs-fortran', 'package.json'));
      const npm = (v, args, cwd, label) => ctx.run(`npx --yes npm@${v} ${args} --no-audit --no-fund`,
        { cwd, allowFail: true, label });

      let d = fresh('npm12');
      const n12 = npm(12, `install ${spec}`, d, 'npm 12 without --allow-git');
      ctx.expect(n12.code !== 0 && !installed(d), 'npm 12 installed from Git without --allow-git');
      const n12f = npm(12, `install ${spec} --allow-git=root`, d, 'npm 12 with --allow-git=root');
      ctx.expect(n12f.code === 0 && installed(d), 'npm 12 with --allow-git=root failed');
      fs.rmSync(path.join(d, 'node_modules'), { recursive: true });
      fs.writeFileSync(path.join(d, '.npmrc'), 'allow-git=root\n');
      const n12r = npm(12, 'ci', d, 'npm 12 ci with allow-git=root in .npmrc');
      ctx.expect(n12r.code === 0 && installed(d), 'npm 12 ci with allow-git=root in .npmrc failed');

      d = fresh('npm11-12-1');
      const n1112c = npm('11.12.1', `install ${spec} --allow-git=root`, d, 'npm 11.12.1, the install line');
      ctx.expect(n1112c.code !== 0 && !installed(d), 'npm 11.12.1 installed from Git with --allow-git=root');
      fs.writeFileSync(path.join(d, 'package.json'), JSON.stringify({ name: 'p', version: '1.0.0', private: true,
        dependencies: { 'fumadocs-fortran': spec } }, null, 2));
      const n1112 = npm('11.12.1', 'install --allow-git=root', d, 'npm 11.12.1 with the dependency in package.json');
      ctx.expect(n1112.code !== 0, 'npm 11.12.1 installed a Git dependency of package.json');
      const n11 = ctx.run('npm install --allow-git=root --no-audit --no-fund',
        { cwd: d, allowFail: true, label: 'this npm, the same' });
      ctx.expect(n11.code === 0 && installed(d), "this run's npm failed on the Git dependency of package.json");

      d = fresh('npm10');
      fs.writeFileSync(path.join(d, '.npmrc'), 'allow-git=root\n');
      const n10 = npm(10, `install ${spec}`, d, 'npm 10 with allow-git=root in .npmrc');
      ctx.expect(n10.code === 0 && installed(d), 'npm 10 with allow-git=root in .npmrc failed');
      const warned = /unknown[^\n]*allow-git[^\n]*/i.exec(n10.out)?.[0];
      ctx.note(`  npm 10 on allow-git in .npmrc: ${warned ?? 'no warning'}`);

      // no Git on PATH, then Git
      d = fresh('no-git');
      const nodeDir = path.dirname(process.execPath);
      const nogit = ctx.run(`PATH="${nodeDir}" "${nodeDir}/npm" install ${spec} --no-audit --no-fund`,
        { cwd: d, allowFail: true, label: 'npm without Git on PATH' });
      ctx.expect(nogit.code !== 0 && !installed(d), 'npm installed from Git with no Git on PATH');
      // the lock records the commit; ci installs it again; installing again takes the newer one
      const withGit = ctx.run(`npm install ${spec} --no-audit --no-fund`, { cwd: d, label: 'npm with Git' });
      const lock = () => fs.readFileSync(path.join(d, 'package-lock.json'), 'utf8');
      ctx.expect(withGit.code === 0 && lock().includes(`#${sha1}`), 'package-lock.json does not record the commit');
      fs.appendFileSync(path.join(repoDir, 'README.md'), '\nA second commit.\n');
      git('commit -qam two');
      const sha2 = git('rev-parse HEAD').out.trim().split('\n')[0];
      ctx.run('npm ci --no-audit --no-fund', { cwd: d, label: 'npm ci after a new commit' });
      const readme = () => fs.readFileSync(path.join(d, 'node_modules', 'fumadocs-fortran', 'README.md'), 'utf8');
      ctx.expect(!readme().includes('A second commit.'), 'npm ci did not install the commit of the lock');
      ctx.run(`npm install ${spec} --no-audit --no-fund`, { cwd: d, label: 'the install command again' });
      ctx.expect(lock().includes(`#${sha2}`) && readme().includes('A second commit.'),
        'installing again did not take the newer commit');
      ctx.run(`npm install ${spec}#${sha1} --no-audit --no-fund`, { cwd: d, label: 'a pinned commit' });
      ctx.expect(lock().includes(`#${sha1}`) && !readme().includes('A second commit.'),
        'the pinned commit is not installed');
    }

    // ---- KaTeX 0.19 beside rehype-katex's 0.16, then the fix the page gives
    {
      const top = path.join(ctx.site, 'node_modules', 'katex', 'package.json');
      const nested = path.join(ctx.site, 'node_modules', 'rehype-katex', 'node_modules', 'katex', 'package.json');
      // a site without katex yet, as before Set up's packages: an install by name takes the latest
      ctx.run('npm uninstall --prefix docs katex --no-audit --no-fund', { label: 'npm uninstall katex' });
      ctx.run('npm install --prefix docs katex --no-audit --no-fund', { label: 'npm install katex' });
      ctx.note(`  after npm install katex: katex ${version(top)}, rehype-katex's ${version(nested)}`);
      ctx.expect(/^0\.(1[7-9]|[2-9]\d)/.test(version(top) ?? '') && version(nested)?.startsWith('0.16.'),
        `npm install katex gave ${version(top)}, rehype-katex ${version(nested)}`);
      const r = await ctx.follow(page, { sections: ['katex-version'] });
      ctx.expect(r.ok && version(top)?.startsWith('0.16.') && !version(nested), `after the fix: katex ${version(top)}`
        + `, rehype-katex's own ${version(nested)}`);
    }

    // ---- generating
    {
      const out = ctx.scratch('generate');
      const z1 = ctx.run(`${npmExec} dump --summary scr`, { label: 'dump a mistyped folder' });
      const z2 = ctx.run(`${npmExec} dump --summary src`, { cwd: ctx.site, label: 'dump from docs/' });
      const fy = ctx.scratch('fypp-only');
      fs.writeFileSync(path.join(fy, 'a.fypp'), '#:set N = 3\nmodule m\nend module m\n');
      fs.writeFileSync(path.join(fy, 'b.inc'), 'integer :: x\n');
      fs.writeFileSync(path.join(fy, 'c.h'), '#define X 1\n');
      const z3 = ctx.run(`${npmExec} dump --summary "${fy}"`, { label: 'dump a folder of .fypp, .inc and .h' });
      const z4 = ctx.run(`${npmExec} generate scr -o "${out}/empty"`, { label: 'generate a mistyped folder' });
      for (const [what, r] of [['a mistyped folder', z1], ['from docs/', z2], ['.fypp, .inc and .h', z3]]) {
        ctx.expect(r.code === 0 && r.out.includes('0 files, 0 lines, 0 entities'), `dump of ${what}: no "0 files"`);
      }
      ctx.expect(z4.code === 0 && z4.out.includes('from 0 sources'), 'a mistyped folder: no "from 0 sources"');

      const named = ctx.run(`${npmExec} generate "${fy}/a.fypp" -o "${out}/fypp"`, { label: 'generate a named .fypp' });
      ctx.expect(named.code === 0 && named.out.includes('[fypp]'), 'a named .fypp file gave no fypp warning');

      const wrong = ctx.run(`${npmExec} generate src/modern_ford.F90 --form fixed -o "${out}/form"`,
        { label: 'free form read as fixed' });
      const unclosed = (wrong.out.match(/\[unclosed\]/g) ?? []).length;
      ctx.note(`  free form read as fixed form: ${unclosed} [unclosed] warnings`);
      ctx.expect(unclosed > 5, 'free-form code read as fixed form gave few [unclosed] warnings');
      const right = ctx.run(`${npmExec} generate src/modern_ford.F90 -o "${out}/form"`, { label: 'its own form' });
      ctx.expect(!right.out.includes('[unclosed]'), 'the file in its own form still gives [unclosed]');
      for (const n of ['132', '0']) {
        const r = ctx.run(`${npmExec} generate src/tridiag.f --fixed-length ${n} -o "${out}/len${n}"`,
          { label: `--fixed-length ${n}` });
        ctx.expect(r.code === 0, `--fixed-length ${n} failed`);
      }

      const repoFlag = '--repo https://github.com/OWNER/REPOSITORY';
      ctx.run(`npm exec -- fumadocs-fortran generate ../src -o "${out}/dd" ${repoFlag}`, { cwd: ctx.site,
        label: 'generate ../src from docs/' });
      const dd = fs.readFileSync(path.join(out, 'dd', 'solver_kernels.mdx'), 'utf8');
      ctx.expect(dd.includes('file="../src/') && dd.includes('/blob/main/../src/'), 'from docs/, no ../src/ there');
      ctx.run(`${npmExec} generate src -o "${out}/top" ${repoFlag}`, { label: 'generate src from the top folder' });
      const top = fs.readFileSync(path.join(out, 'top', 'solver_kernels.mdx'), 'utf8');
      ctx.expect(top.includes('file="src/') && top.includes('/blob/main/src/'), 'from the top folder, no src/ there');

      fs.cpSync(path.join(ctx.site, 'content', 'docs', 'api'), path.join(out, 'api'), { recursive: true });
      fs.writeFileSync(path.join(out, 'api', 'notes.mdx'), '---\ntitle: Notes\n---\n\nWritten by hand.\n');
      ctx.run(`${npmExec} generate src -o "${out}/api"`, { label: 'generate over a page written by hand' });
      const meta = JSON.parse(fs.readFileSync(path.join(out, 'api', 'meta.json'), 'utf8'));
      ctx.expect(fs.existsSync(path.join(out, 'api', 'notes.mdx')) && !meta.pages.includes('notes'),
        'the page written by hand is gone, or in the sidebar');

      ctx.run(`${npmExec} generate src -o "${out}/reference"`, { label: 'generate into reference/, the default URL' });
      const ref = fs.readFileSync(path.join(out, 'reference', 'demo.mdx'), 'utf8');
      ctx.expect(ref.includes('](/docs/api/'), 'with the default --base-url, the links do not start /docs/api/');
      ctx.run(`${npmExec} generate src -o "${out}/reference" --base-url /docs/reference`, { label: 'with --base-url' });
      const ref2 = fs.readFileSync(path.join(out, 'reference', 'demo.mdx'), 'utf8');
      ctx.expect(ref2.includes('](/docs/reference/') && !ref2.includes('](/docs/api/'), '--base-url left the links');
    }

    // ---- building: the sidebar's meta.json, the search route
    {
      const meta = 'docs/content/docs/meta.json';
      ctx.write(meta, '{ "pages": ["index"] }\n');
      const b1 = ctx.build({ label: 'a meta.json without the folder' });
      // the page as drawn, without the payload's scripts, which hold the tree of every page
      const drawn = () => (ctx.outHtml('/docs') ?? '').replace(/<script\b[\s\S]*?<\/script>/g, '');
      const without = ctx.count(drawn(), 'apiReference');
      ctx.write(meta, '{ "pages": ["index", "api"] }\n');
      const b2 = ctx.build({ label: 'a meta.json with the folder' });
      const withIt = ctx.count(drawn(), 'apiReference');
      fs.rmSync(path.join(ctx.project, meta));
      ctx.expect(b1.code === 0 && b2.code === 0 && without === 0 && withIt > 0,
        `"API reference" in the first page's sidebar: ${without} without the folder in meta.json, ${withIt} with it`);

      // the template's route, whose path the message gives
      ctx.seed('docs/app/api/search/route.ts', (t) => t.replace('export const revalidate = false;\n', '')
        .replace('staticGET: GET', 'GET'));
      const b3 = ctx.build({ label: 'a search route that is not static', allowFail: true });
      ctx.expect(b3.code !== 0 && /Failed to collect configuration for \/api\/search\b(?!\.json)/.test(b3.out),
        'a search route that is not static did not stop the build with the route\'s path, /api/search');
    }

    // ---- every message heading against the logs
    const logs = allLogs(ctx.logs);
    const npmMajor = Number(ctx.run('npm --version', { label: 'npm --version' }).out.trim().split('.')[0]);
    const plain = (t) => t.replace(/`/g, '');
    const logText = plain(logs.text);
    for (const [id, e] of Object.entries(ENTRIES)) {
      if (!e.message) continue;
      if (e.outside) {
        ctx.note(`  #${id}: printed in ${e.outside}`);
        continue;
      }
      if (e.from && !logs.phases.has(e.from)) {
        ctx.note(`  #${id}: not checked, as ${e.from} did not run`);
        continue;
      }
      if (e.npm && e.npm !== npmMajor) {
        ctx.note(`  #${id}: not checked, as npm ${npmMajor} does not print npm ${e.npm}'s message`);
        continue;
      }
      const parts = e.pattern ? [] : plain(heading(id)).split(', ');
      for (const w of [...parts, ...(e.words ?? [])]) {
        ctx.expect(logText.includes(plain(w)), `#${id}: "${w}" is in no log of this run`);
      }
      if (e.pattern) ctx.expect(e.pattern.test(logText), `#${id}: no log of this run matches ${e.pattern}`);
    }

    // ---- the Docker route, as the page writes it: detached, the development server for the shell, a free port
    const block = page.blocks.find((b) => b.lang === 'bash' && b.sections.includes('without-nodejs'));
    const cmd = block && ctx.commands(block.body)[0];
    if (!ctx.expect(cmd?.startsWith('docker run ') && cmd.includes('-p 127.0.0.1:3000:3000'),
      'the page has no docker run command with port 3000 published on 127.0.0.1')) return;
    if (!ctx.has('docker')) {
      ctx.note('  the Docker route is not run: docker is not on PATH');
      return;
    }
    // the container runs the site's node_modules, which hold Linux builds only when the steps ran on Linux
    if (process.platform !== 'linux') {
      ctx.note(`  the Docker route is not run: the steps ran on ${process.platform}, whose node_modules Linux cannot run`);
      return;
    }
    const port = await freePort();
    const name = `fdf-get-started-${process.pid}`;
    const detached = cmd.replace(' -it ', ` -d --name ${name} --memory 4g `)
      .replace('127.0.0.1:3000:3000', `127.0.0.1:${port}:3000`).replace(/ bash$/, " bash -c 'cd docs && npm run dev'");
    ctx.expect(detached !== cmd && detached.endsWith("'cd docs && npm run dev'"), 'the docker command did not adapt');
    const started = ctx.run(detached, { label: 'the Docker route' });
    if (started.code !== 0) return;
    try {
      let status = 0;
      let html = '';
      for (let i = 0; i < 240 && status !== 200; i++) {
        try {
          const r = await fetch(`http://127.0.0.1:${port}/docs/api/`);
          status = r.status;
          html = await r.text();
        } catch {
          await new Promise((ok) => setTimeout(ok, 500));
        }
      }
      ctx.note(`  ${ctx.checkPage('docker', '/docs/api', status, html)}`);
      ctx.run(`docker logs ${name}`, { label: 'the Docker route\'s output', allowFail: true });
    } finally {
      ctx.run(`docker rm -f ${name}`, { label: 'the Docker route stopped', allowFail: true });
    }
  },
};
