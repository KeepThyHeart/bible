/**
 * @bible/extension-testing — Testing utilities for Bible app extensions.
 *
 * Provides mock API builders, a test host for lifecycle simulation, and
 * ready-made fixtures so extension developers can unit test in isolation
 * without needing Electron, a running app, or real databases.
 *
 * Usage:
 * ```ts
 * import { createMockApi, createTestHost, fixtures } from '@bible/extension-testing';
 * ```
 */

export {
  createMockApi,
  getMockPanelChannel,
  getMockRuntimeEndpoints,
  type MockApiOverrides,
  type MockDbStatement,
  type MockDbTransactionRecord,
  type MockExtensionDatabase,
  type MockPanelChannel,
  type MockRuntimeEndpoints,
} from './createMockApi';
export { createTestHost, type TestHost, type TestHostOptions } from './createTestHost';
export * as fixtures from './fixtures';
export * as smoke from './smoke';

// Re-export individual fixtures for convenience
export {
  VERSE_GEN_1_1,
  VERSE_JOHN_3_16,
  VERSE_PSALM_23_1,
  VERSE_ROM_8_28,
  VERSE_REV_22_21,
  VERSES_GEN_1_1_3,
  MODULE_KJV,
  MODULE_ESV,
  MODULE_HEBREW,
  BOOKS_SAMPLE,
  CHAPTERS_JOHN,
  COMMENTARY_MODULE_SAMPLE,
  COMMENTARY_ENTRY_JOHN_3_16,
  DICTIONARY_MODULE_SAMPLE,
  DICTIONARY_ENTRY_AGAPE,
  DICTIONARY_ENTRY_LOGOS,
  NOTE_SAMPLE,
  NOTE_SERMON,
  HIGHLIGHT_SAMPLE,
  BOOKMARK_SAMPLE,
  COLLECTION_SAMPLE,
  TOKENS_JOHN_1_1,
  PARSED_REF_JOHN_3_16,
  PARSED_REF_GEN_1,
  PARSED_REF_ROM_8_28_30,
  PANEL_BIBLE,
  PANEL_COMMENTARY,
} from './fixtures';
