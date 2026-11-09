/**
 * Prepare step of the desktop manifest. Decides which Bible data the Electron app runs on and
 * prints it as the last stdout line: {"dataDir": ..., "keywordIndexDir": ...}.
 *
 * - BIBLE_DESKTOP_DATA_DIR set: use that directory as given (real data, explicit choice). Its keyword
 *   index goes to BIBLE_KEYWORD_INDEX_DIR or a shared cache dir in the tmp dir (re-indexing real
 *   modules is slow; `drive clean` removes the cache).
 * - Otherwise: copy the committed fixture (fixtures/bible-data) into <profile>/data, seed its sample
 *   note into <profile>/user-data, and keep the keyword index inside the copy. All of it lives under
 *   the profile, which the driver deletes on stop. A kept profile (DRIVE_PROFILE_DIR) reuses its copy.
 *
 * DRIVE_PROFILE is the profile dir (set by the manifest). Run with plain node.
 */

import { existsSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { copyFixture, seedNotes } from '../../../fixtures/bible-data/copy.mjs';

const explicit = process.env.BIBLE_DESKTOP_DATA_DIR;
if (explicit) {
  const keywordIndexDir = process.env.BIBLE_KEYWORD_INDEX_DIR ?? path.join(os.tmpdir(), 'bible-ui-driver-keyword-index');
  console.log(JSON.stringify({ dataDir: explicit, keywordIndexDir }));
} else {
  const profile = process.env.DRIVE_PROFILE;
  if (!profile) throw new Error('DRIVE_PROFILE is not set (the manifest passes it)');
  const dataDir = path.join(profile, 'data');
  if (!existsSync(path.join(dataDir, 'main.db'))) {
    copyFixture(dataDir);
    seedNotes(path.join(profile, 'user-data'));
  }
  console.log(JSON.stringify({ dataDir, keywordIndexDir: path.join(dataDir, 'index', 'keyword') }));
}
