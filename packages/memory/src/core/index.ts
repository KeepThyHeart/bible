/**
 * The memory core's public surface (task 0114): the service, its API and
 * ports, the schema, the SQL adapter, the legacy import, and the public types.
 */

export { MemoryService, versesFromMenuArgs } from './service';
export type { MemoryServiceOptions } from './service';

export * from './api';
export type * from './ports';

export { installMemorySchema, MEMORY_TABLES, MEMORY_DDL } from './schema';
export { createSqlPort, MemoryStorageError } from './sqlPort';
export {
  importLegacyMemory,
  mergeLegacyMemory,
  legacyImportRecord,
  LEGACY_EXTENSION_ID,
  LEGACY_DB_NAME,
  LEGACY_SOURCE_KEY,
  LEGACY_MAX_VERSION,
} from './legacyImport';
export type {
  LegacyCounts,
  LegacyImportResult,
  LegacyImportOptions,
  LegacyMergeResult,
} from './legacyImport';
export { readMemoryStatus } from './status';
export { deletedPassageActivity, reviveMergedPassages, pushCardsEnabled } from './maintenance';

export type * from './types';
export type {
  Weekday, WallTime, ReminderSlot, QuietHours, ReminderPlan, FireTime, JsonValue, ReminderItem,
  ReminderCapabilities, ReminderEvent, PushCardSettings, RecallGrade, PushCardState, PushCardRow,
  PushCandidate, PushStatus, PushSettingsView, RecallCardView, CardStackView,
} from './pushTypes';
