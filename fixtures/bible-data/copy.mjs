// Helpers for using the committed Bible fixture. The fixture is NEVER used in place:
// the app writes to main.db and the keyword index, so every run works on a copy.
import { cpSync, existsSync, mkdirSync, readFileSync, readdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

export const fixtureDir = dirname(fileURLToPath(import.meta.url));

/** Copy main.db and modules/ (not notes/, manifest or docs) into destDir. Returns destDir. */
export function copyFixture(destDir) {
  mkdirSync(destDir, { recursive: true });
  cpSync(join(fixtureDir, 'main.db'), join(destDir, 'main.db'));
  cpSync(join(fixtureDir, 'modules'), join(destDir, 'modules'), { recursive: true });
  return destDir;
}

/** Copy the sample notes into <userDataDir>/BibleReader/ (the desktop's default notes dir). */
export function seedNotes(userDataDir) {
  const dest = join(userDataDir, 'BibleReader');
  mkdirSync(dest, { recursive: true });
  const src = join(fixtureDir, 'notes');
  if (existsSync(src)) {
    for (const f of readdirSync(src)) if (f.endsWith('.bn')) cpSync(join(src, f), join(dest, f));
  }
  return dest;
}

/** Abbreviations of the modules the fixture holds (e.g. 'KJV'). */
export function fixtureModules() {
  const m = JSON.parse(readFileSync(join(fixtureDir, 'manifest.json'), 'utf8'));
  return m.modules.map(x => x.abbreviation);
}

/** True when the fixture holds the module (case-insensitive). */
export function fixtureHas(abbr) {
  return fixtureModules().some(a => a.toLowerCase() === String(abbr).toLowerCase());
}
