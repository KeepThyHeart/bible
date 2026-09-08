// Re-export shim - the useBibleStore implementation has been sliced into
// `./bible/`. This shim preserves the original import path so consumers
// (components, hooks, other stores) don't need to be updated.
//
// See: docs/old/cleanup/07-store-slice-refactor.md
export { useBibleStore, DEFAULT_PANEL_ID } from './bible/useBibleStore';
export type {
  BibleState,
  BiblePanelState,
  BibleTab,
  BibleModule,
  BibleVerse,
  DisplayMode,
  StudyModeOptions,
  HistoryEntry,
  BiblePanelSession,
  BibleSessionData,
  PendingBiblePanel,
} from './bible/types';
export {
  DEFAULT_DISPLAY_MODE,
  DEFAULT_STUDY_OPTIONS,
  BIBLE_SESSION_VERSION,
  createDefaultPanelState,
} from './bible/types';
export { encodeBibleContentKey, decodeBibleContentKey } from './bible/contentKey';
