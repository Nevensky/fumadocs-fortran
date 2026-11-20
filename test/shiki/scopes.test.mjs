// Scope snapshots of the fixtures, and the same tokens and scopes on both of Shiki's regex engines.
import fs from 'node:fs';
import path from 'node:path';
import { highlighter, scoped, snapshot, fixture } from './helpers.mjs';

const FIXTURES = {
  'directives.f90': 'fortran',
  'f2023.f90': 'f90',
  'heat.F90': 'f90',
  'fixed.f': 'f77',
  'generic.fypp': 'fypp',
};

export default async function ({ ok, here }) {
  const js = await highlighter('js');
  const oniguruma = await highlighter('oniguruma');
  for (const [file, lang] of Object.entries(FIXTURES)) {
    const code = fixture(file);
    const a = scoped(js, code, lang);
    const b = scoped(oniguruma, code, lang);
    const differ = a.findIndex((line, i) => JSON.stringify(line) !== JSON.stringify(b[i]));
    ok(differ < 0 && a.length === b.length, `${file}: the JS and Oniguruma engines differ, first on line ${differ + 1}`);
    ok(!a.flat().some((t) => t.scopes.some((s) => s.startsWith('invalid'))), `${file}: an invalid scope`);

    const text = snapshot(a);
    const file_ = path.join(here, 'snapshots', `${file}.txt`);
    if (process.env.UPDATE_SNAPSHOTS) fs.writeFileSync(file_, text);
    const saved = fs.existsSync(file_) ? fs.readFileSync(file_, 'utf8') : '';
    const want = saved.split('\n');
    const got = text.split('\n');
    const line = got.findIndex((l, i) => l !== want[i]);
    ok(saved === text, `${file}: the scopes differ from snapshots/${file}.txt${saved ? ` at line ${line + 1}:\n  want ${want[line]}\n  got  ${got[line]}` : ' (missing: run with UPDATE_SNAPSHOTS=1)'}`);
  }
}
