// What a reader of the package sees besides the pages: the command line's help, its messages and counts, and each
// entry point's exports, which are the names its types declare, no more and no fewer.
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { pathToFileURL } from 'node:url';

export default async function ({ ok, eq, here, out }) {
  const root = path.dirname(here);
  const bin = path.join(root, 'bin/fumadocs-fortran.js');
  const dir = path.join(out, 'surface');
  fs.mkdirSync(dir, { recursive: true });
  const run = (...args) => spawnSync(process.execPath, [bin, ...args], { cwd: dir, encoding: 'utf8' });
  const put = (name, text) => fs.writeFileSync(path.join(dir, name), text);
  const page = (folder, name) => {
    try {
      return fs.readFileSync(path.join(dir, folder, name), 'utf8');
    } catch {
      return '';
    }
  };

  // ---- the help
  const help = run('--help').stdout;
  const commands = /\nCommands:\n((?: {2}\S.*\n)+)/.exec(help)?.[1] ?? '';
  eq(commands.split('\n').filter(Boolean).map((l) => l.trim().split(/\s/)[0]), ['dump', 'generate'],
    'the help lists the two commands there are');
  ok(!/\bv0\.\d|\bM\d\b|\binit\b|\bdoctor\b/.test(help), 'the help names no milestone and no command to come');
  const shared = 'Options for generate (and -D, -I, --all-branches, --form, --fixed-length, --exclude as for dump):';
  ok(help.includes(`\n${shared}\n`),
    'the help says that generate takes the reading options of dump, --fixed-length among them');
  const repoLine = 'link each entity to its lines in this GitHub repository (URL/blob/REV/FILE#L10-L20)';
  ok(new RegExp(`\\n {2}--repo URL +${repoLine.replace(/[()/]/g, '\\$&')}\\n`).test(help) && !help.includes('GitLab'),
    '--repo: the help names the link form generate writes, GitHub\'s');

  // generate takes --fixed-length: past column 72 the header goes on, so with the default the unit is a main program
  put('long.f', `      SUBROUTINE LONG(A,${' '.repeat(49)}B)\n      REAL A, B\n      END\n`);
  const fixed = run('generate', 'long.f', '-o', 'f132', '--fixed-length', '132');
  const cut = run('generate', 'long.f', '-o', 'f72');
  ok(fixed.status === 0 && page('f132', 'long.mdx').includes('LONG') && cut.status === 0 && !page('f72', 'long.mdx'),
    'generate reads --fixed-length, as the help says');

  // --repo and --rev: GitHub's form, URL/blob/REV/FILE#Lfirst-Llast
  put('one.f90', 'module one\ncontains\n  subroutine s()\n  end subroutine s\nend module one\n');
  const repo = run('generate', 'one.f90', '-o', 'repo', '--repo', 'https://example.org/team/code/', '--rev', 'v1.0');
  ok(repo.status === 0 && page('repo', 'one.mdx').includes('https://example.org/team/code/blob/v1.0/one.f90#L3-L4'),
    '--repo links each entity to its lines in GitHub\'s form, on any host');

  // ---- messages
  for (const name of ['init', 'check', 'doctor', 'gen']) {
    const r = run(name);
    eq([r.status, r.stderr], [2, `fumadocs-fortran: unknown command ${name}; the commands are dump and generate\n`],
      `${name}: an unknown command, and the commands there are`);
  }
  // a fypp source is skipped with a warning that says what to do, and the counts read as English
  put('macros.fypp', '#:set KINDS = ["sp", "dp"]\nmodule m\nend module m\n');
  const fypp = run('generate', 'macros.fypp', '-o', 'fypp');
  const singular = /^\d+ files \(\d+ changed, 0 removed\) from 1 source in \d+ ms; 1 diagnostic\n$/;
  ok(fypp.status === 0 && singular.test(fypp.stdout),
    `generate counts 1 source and 1 diagnostic in the singular: ${JSON.stringify(fypp.stdout)}`);
  eq(fypp.stderr, 'macros.fypp:1: warning: fypp source skipped: run fypp first, and give fumadocs-fortran the Fortran '
    + 'it writes [fypp]\n', 'the fypp warning names no setting that does not exist');
  put('tiny.f90', 'subroutine tiny(); end subroutine tiny\n');
  const total = run('dump', '--summary', 'tiny.f90').stdout.trim().split('\n').pop();
  ok(/^1 file, 1 line, 1 entity, 0 diagnostics, \d+ ms$/.test(total),
    `dump --summary: 1 file, 1 line, 1 entity: ${total}`);
  const two = run('dump', '--summary', 'tiny.f90', 'one.f90').stdout.trim().split('\n').pop();
  ok(/^2 files, 6 lines, 3 entities, 0 diagnostics, \d+ ms$/.test(two), `and the plural above 1: ${two}`);

  // ---- each entry point exports what its types declare
  const pkg = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8'));
  const declared = (file) => {
    const text = fs.readFileSync(path.join(root, file), 'utf8').replace(/\/\*[\s\S]*?\*\/|\/\/.*$/gm, '');
    const names = [...text.matchAll(/^export (?:declare )?(?:const|function|class|let|var) (\w+)/gm)].map((m) => m[1]);
    for (const m of text.matchAll(/^export \{([^}]*)\} from/gm)) {
      names.push(...m[1].split(',').map((x) => x.trim().split(/\s+as\s+/).pop()).filter(Boolean));
    }
    return [...new Set(names)].sort();
  };
  for (const [entry, target] of Object.entries(pkg.exports)) {
    if (typeof target !== 'object' || !target.types) continue;
    let mod;
    try {
      mod = await import(pathToFileURL(path.join(root, target.default)).href);
    } catch (e) {
      // ./react needs React, which the package does not depend on
      console.log(`exports of ${entry} not checked: ${e.message.split('\n')[0]}`);
      continue;
    }
    eq(Object.keys(mod).sort(), declared(target.types), `${entry}: its exports are the names ${target.types} declares`);
  }
}
