/**
 * Vitest global setup: make sure every real test module has its sidecar
 * keyword index before any suite searches one.
 *
 * v0.2 modules ship no FTS5 table (see `docs/features/module-format.md`), so
 * the data-backed search suites need the `.kwi` files `init:modules` builds.
 * This builds whichever are missing or stale, once per run and before the
 * workers start, so a checkout whose modules were fetched without indexes -
 * or an older data directory - still runs those suites instead of failing
 * them. Indexes that are already current are left alone, which makes this a
 * few milliseconds on every run after the first.
 *
 * A data directory with no modules does nothing here; the suites skip loudly
 * on their own (`testDataAvailable()`).
 */
import { existsSync, mkdirSync, readdirSync } from 'fs';
import { join, resolve } from 'path';
import { SidecarFts5Provider } from '../../Data/Access/Fts5/SidecarFts5Provider';
import { ensureModuleKeywordIndexes } from '../../Data/Repositories/ModuleKeywordIndexes';
import { openTestSidecarDatabase } from '../helpers/TestSidecarDatabase';
import { TestSqliteProvider } from '../helpers/TestSqliteProvider';
import { TEST_KEYWORD_INDEX_DIR, TEST_MODULES_DIR } from '../helpers/testData';

export default async function setup(): Promise<void> {
  const modulesDir = resolve(TEST_MODULES_DIR, 'modules');
  if (!existsSync(modulesDir)) return;

  const modulePaths = readdirSync(modulesDir)
    .filter((name) => name.endsWith('.db'))
    .map((name) => join(modulesDir, name));
  if (modulePaths.length === 0) return;

  mkdirSync(TEST_KEYWORD_INDEX_DIR, { recursive: true });
  const result = await ensureModuleKeywordIndexes({
    provider: new SidecarFts5Provider({ indexDir: TEST_KEYWORD_INDEX_DIR, openDatabase: openTestSidecarDatabase }),
    modulePaths,
    openModule: (path) => new TestSqliteProvider(path, { readonly: true, fileMustExist: true }),
    log: (message) => console.log(`[core tests] ${message}`),
  });
  for (const failure of result.failed) {
    console.warn(`[core tests] no keyword index for ${failure.path}: ${failure.reason}`);
  }
}
