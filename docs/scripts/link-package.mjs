#!/usr/bin/env node
// The site's postinstall. The site uses the package from this repository (file:..), which npm links into
// node_modules, and Node.js and Turbopack resolve what the package's files import from where they really are: the
// repository's top folder. fumadocs-fortran/mdx imports fumadocs-core and fumadocs-fortran/mermaid imports pele, as
// a site's own packages, which an installed copy finds in the site's node_modules. This links the repository's
// node_modules to the site's (node_modules -> docs/node_modules, a relative link, which a container that mounts the
// repository follows too), so that the linked copy finds them as well, as one copy of each.
//
// When the top folder has a node_modules of its own (the tools of the package's tests, installed there with
// npm install --no-save), it links the site's packages that the package imports into it instead, those it lacks.
//
//   node docs/scripts/link-package.mjs
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const docs = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const repo = path.dirname(docs);
const top = path.join(repo, 'node_modules');
const own = path.join(docs, 'node_modules');
// the site's packages that the package's entry points import: React too, which Next.js gives the modules it bundles,
// but not those Node.js runs, such as lib/source.ts when Fumadocs MDX reads the collections from it
const PEERS = ['fumadocs-core', 'pele', 'react', 'react-dom'];

const say = (s) => console.log(`link-package: ${s}`);
let stat = null;
try {
  stat = fs.lstatSync(top);
} catch {
  // nothing there
}
if (!stat || (stat.isSymbolicLink() && !fs.existsSync(top))) {
  if (stat) fs.unlinkSync(top);
  fs.symlinkSync(path.relative(repo, own), top, 'junction');
  say(`${path.relative(process.cwd(), top) || top} -> ${path.relative(repo, own)}`);
} else if (stat.isSymbolicLink()) {
  say(`${top} is a link already, to ${fs.readlinkSync(top)}`);
} else if (stat.isDirectory()) {
  for (const name of PEERS) {
    const from = path.join(own, name);
    const to = path.join(top, name);
    if (!fs.existsSync(from) || fs.existsSync(to)) continue;
    fs.mkdirSync(path.dirname(to), { recursive: true });
    fs.symlinkSync(path.relative(path.dirname(to), from), to, 'junction');
    say(`${path.relative(repo, to)} -> ${path.relative(repo, from)}`);
  }
}
