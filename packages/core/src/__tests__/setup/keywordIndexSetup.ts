/**
 * Vitest per-worker setup: point every repository and `BibleSearchService`
 * at the sidecar keyword indexes `keywordIndexGlobalSetup.ts` built - the same
 * wiring an app's composition root does with `configureModuleKeywordIndex()`.
 *
 * Tests that need to see the unconfigured state call
 * `configureModuleKeywordIndex(null)` themselves and restore this afterwards.
 */
import { existsSync } from 'fs';
import { configureModuleKeywordIndex } from '../../Data/Access/Fts5/ModuleKeywordIndex';
import { SidecarFts5Provider } from '../../Data/Access/Fts5/SidecarFts5Provider';
import { openTestSidecarDatabase } from '../helpers/TestSidecarDatabase';
import { TEST_KEYWORD_INDEX_DIR } from '../helpers/testData';

if (existsSync(TEST_KEYWORD_INDEX_DIR)) {
  configureModuleKeywordIndex(
    new SidecarFts5Provider({ indexDir: TEST_KEYWORD_INDEX_DIR, openDatabase: openTestSidecarDatabase })
  );
}
