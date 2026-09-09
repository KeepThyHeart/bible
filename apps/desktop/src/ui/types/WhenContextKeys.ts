/**
 * Canonical starter list of `when`-context keys owned by built-in code.
 *
 * Each key is published by exactly one Zustand store (or by `App.tsx` for the
 * app-wide ones), and `WhenContextService` is where that wiring lives.
 * Extension code only sees these as strings; built-in code uses the
 * `BuiltinContextKey` union to catch typos.
 */

export const BUILTIN_CONTEXT_KEYS = [
  // selection
  'verseSelected',
  'selectedVerseId',
  'selectedVerseHasNote',
  'selectedVerseHasHighlight',
  'selectedVerseIsBookmarked',
  // panel state
  'activePane',
  'activePaneId',
  'panelCount',
  // editor state
  'editor.focused',
  'editor.dirty',
  // search/find
  'searchActive',
  'searchHasResults',
  'findBarOpen',
  // appearance
  'theme',
  'displayMode',
  // bible-pane state
  'bible.parallelView',
  'bible.interlinearOpen',
  // derived "is open" flags
  'commentaryOpen',
  'dictionaryOpen',
  'notesOpen',
  'prayerOpen',
  // localization
  'currentLocale',
  // modal state
  'moduleManagerOpen',
  'preferencesOpen',
  // runtime
  'os',
] as const;

export type BuiltinContextKey = (typeof BUILTIN_CONTEXT_KEYS)[number];
