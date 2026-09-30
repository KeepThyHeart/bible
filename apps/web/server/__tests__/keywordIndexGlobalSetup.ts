/**
 * Vitest global setup: build the sidecar keyword indexes for the test data's
 * modules before any route test searches them - exactly what the server does
 * before it listens (`DatabaseManager.prepareKeywordIndexes()`).
 *
 * Module schema v0.2 ships no FTS5 table, so without this a data directory
 * whose modules were fetched without `init:modules` building their indexes
 * would fail every search test as "no results". Current indexes are left
 * alone, so this is quick on every run after the first. The route tests'
 * own `DatabaseManager` instances point search at the same directory.
 */
import { existsSync } from 'fs';
import { resolve } from 'path';
import { DatabaseManager } from '../DatabaseManager';
import { TEST_DATA_DIR, TEST_MODULES_DIR } from './testDataDir';

export default async function setup(): Promise<void> {
  if (!existsSync(resolve(TEST_MODULES_DIR, 'modules'))) return;

  const result = await new DatabaseManager(TEST_DATA_DIR, TEST_MODULES_DIR).prepareKeywordIndexes((message) =>
    console.log(`[web tests] ${message}`)
  );
  for (const failure of result.failed) {
    console.warn(`[web tests] no keyword index for ${failure.path}: ${failure.reason}`);
  }
}
