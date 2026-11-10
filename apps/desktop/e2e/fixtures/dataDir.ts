/**
 * Which Bible data the e2e suite runs on.
 *
 * - `BIBLE_E2E_DATA_DIR` (or an inherited `BIBLE_DESKTOP_DATA_DIR`) set: real data, used as given.
 *   The keyword indexes live in one shared, deliberately kept cache (`E2E_KEYWORD_INDEX_DIR`),
 *   built once by globalSetup.ts; `drive clean` removes it.
 * - Neither set: the committed fixture (`fixtures/bible-data`, ~8 MB, public domain). It is never
 *   used in place: every launch gets its own copy, deleted after the test, and the app builds its
 *   (tiny) keyword index in that copy at startup.
 *
 * Specs that need modules the fixture lacks call `needsRealData(test, 'Nave')`.
 */
import fs from 'fs';
import os from 'os';
import path from 'path';

// Same logic as fixtures/bible-data/copy.mjs, repeated here because Playwright loads these files as
// CommonJS, which cannot import that ES module.
const FIXTURE_DIR = path.resolve(__dirname, '../../../../fixtures/bible-data');

function copyFixture(destDir: string): void {
  fs.mkdirSync(destDir, { recursive: true });
  fs.cpSync(path.join(FIXTURE_DIR, 'main.db'), path.join(destDir, 'main.db'));
  fs.cpSync(path.join(FIXTURE_DIR, 'modules'), path.join(destDir, 'modules'), { recursive: true });
}

function fixtureHas(abbr: string): boolean {
  const manifest = JSON.parse(fs.readFileSync(path.join(FIXTURE_DIR, 'manifest.json'), 'utf8')) as { modules: Array<{ abbreviation: string }> };
  return manifest.modules.some(m => m.abbreviation.toLowerCase() === abbr.toLowerCase());
}

/** Shared keyword-index cache, real data only (never created for the fixture). */
export const E2E_KEYWORD_INDEX_DIR = path.join(os.tmpdir(), 'bible-e2e-keyword-index');

/** The explicitly chosen real data dir, if any. */
export function realDataDir(): string | undefined {
  return process.env.BIBLE_E2E_DATA_DIR || process.env.BIBLE_DESKTOP_DATA_DIR || undefined;
}

export function usingFixture(): boolean {
  return !realDataDir();
}

/** True when the module is available: always with real data, else only if the fixture holds it. */
export function hasModule(abbr: string): boolean {
  return usingFixture() ? fixtureHas(abbr) : true;
}

/** `test.skip` for a whole file (call at top level) when the module is not in the fixture. */
export function needsRealData(
  skip: (condition: boolean, description: string) => void,
  ...abbrs: string[]
): void {
  const missing = abbrs.filter(a => !hasModule(a));
  skip(missing.length > 0, `needs real data (${missing.join(', ')}): set BIBLE_E2E_DATA_DIR`);
}

/**
 * Environment for one Electron launch, plus a `cleanup` that removes what was created.
 * `scratchDir` is a path the caller owns (it is removed and recreated).
 */
export function dataEnv(scratchDir: string): { env: Record<string, string>; cleanup: () => void } {
  const real = realDataDir();
  if (real) {
    return {
      env: { BIBLE_DESKTOP_DATA_DIR: real, BIBLE_KEYWORD_INDEX_DIR: E2E_KEYWORD_INDEX_DIR },
      cleanup: () => undefined,
    };
  }
  fs.rmSync(scratchDir, { recursive: true, force: true });
  copyFixture(scratchDir);
  return {
    env: {
      BIBLE_DESKTOP_DATA_DIR: scratchDir,
      BIBLE_KEYWORD_INDEX_DIR: path.join(scratchDir, 'index', 'keyword'),
    },
    cleanup: () => fs.rmSync(scratchDir, { recursive: true, force: true }),
  };
}
