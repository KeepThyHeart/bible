/**
 * Web dispatch sites for the core reader events and `settings.changed`
 * (task 0123). Same rules as the desktop's: every emitter checks
 * `featureModules.hasSubscribers(event)` FIRST and returns before building a
 * payload, so with no active subscriber an event costs one map lookup.
 * Consecutive identical verse and chapter values are dropped.
 *
 * - `reader.verseChanged`: the active tab's study (focus) verse changed.
 * - `reader.selectionChanged`: the shift-click passage selection changed
 *   (`[]` when it is cleared or only a single verse is focused).
 * - `reader.chapterRendered`: `BibleContent` painted a chapter's verses.
 * - `settings.changed`: a reader setting changed (one event per key).
 *
 * Entry-safe: imports only the module host; the stores call `watch*` on themselves.
 */
import { featureModules } from '../moduleHost';

let lastVerse: string | null = null;
let lastChapter: string | null = null;
let lastSelection: string | null = null;

export function emitVerseChanged(verseId: number, module: string): void {
  if (!featureModules.hasSubscribers('reader.verseChanged')) return;
  const key = `${module}:${verseId}`;
  if (key === lastVerse) return;
  lastVerse = key;
  featureModules.dispatch('reader.verseChanged', { verseId, module });
}

export function emitChapterRendered(book: number, chapter: number, module: string): void {
  if (!featureModules.hasSubscribers('reader.chapterRendered')) return;
  const key = `${module}:${book}:${chapter}`;
  if (key === lastChapter) return;
  lastChapter = key;
  featureModules.dispatch('reader.chapterRendered', { book, chapter, module });
}

/** `getVerseIds` runs only when a module is listening. */
export function emitSelectionChanged(getVerseIds: () => readonly number[], module: string): void {
  if (!featureModules.hasSubscribers('reader.selectionChanged')) return;
  const verseIds = getVerseIds();
  const key = `${module}:${verseIds.join(',')}`;
  if (key === lastSelection) return;
  lastSelection = key;
  featureModules.dispatch('reader.selectionChanged', { verseIds, module });
}

export function emitSettingChanged(key: string): void {
  if (!featureModules.hasSubscribers('settings.changed')) return;
  featureModules.dispatch('settings.changed', { key });
}

/** Test hook: forget the dedupe memory. */
export function resetReaderHookMemory(): void {
  lastVerse = null;
  lastChapter = null;
  lastSelection = null;
}

interface ReaderTabLike {
  readonly moduleAbbr: string;
  readonly studyVerse: number | null;
  readonly selectionEndVerse: number | null;
}

interface ReaderStoreLike {
  subscribe(listener: () => void): () => void;
  getActiveTab(): ReaderTabLike | null | undefined;
}

/** Verse ids from the anchor to the end of a same-chapter range (ids are contiguous there). */
export function selectionVerseIds(anchor: number | null, end: number | null): number[] {
  if (anchor === null || end === null) return [];
  const lo = Math.min(anchor, end);
  const hi = Math.max(anchor, end);
  const ids: number[] = [];
  for (let id = lo; id <= hi && ids.length < 500; id++) ids.push(id);
  return ids;
}

/** Subscribe the reader's verse and selection events to the Bible store. */
export function watchReaderStore(store: ReaderStoreLike): () => void {
  return store.subscribe(() => {
    const wantVerse = featureModules.hasSubscribers('reader.verseChanged');
    const wantSel = featureModules.hasSubscribers('reader.selectionChanged');
    if (!wantVerse && !wantSel) return;
    const tab = store.getActiveTab();
    if (!tab) return;
    if (wantVerse && tab.studyVerse !== null) emitVerseChanged(tab.studyVerse, tab.moduleAbbr);
    if (wantSel) emitSelectionChanged(() => selectionVerseIds(tab.studyVerse, tab.selectionEndVerse), tab.moduleAbbr);
  });
}

/**
 * Subscribe `settings.changed` to a settings store: diffs the store's own
 * data fields (and the given extra getters) on each change, only while a
 * module listens. The first change after a module starts listening seeds the
 * snapshot instead of reporting everything.
 */
export function watchSettingsStore(store: { subscribe(listener: () => void): () => void }, extra: () => Record<string, unknown> = () => ({})): () => void {
  let prev: Record<string, unknown> | null = null;
  const snapshot = (): Record<string, unknown> => {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(store)) {
      if (typeof v !== 'function' && !k.startsWith('_') && k !== 'listeners') out[k] = Array.isArray(v) ? (v as unknown[]).join('\u0000') : v;
    }
    return { ...out, ...extra() };
  };
  return store.subscribe(() => {
    if (!featureModules.hasSubscribers('settings.changed')) {
      prev = null;
      return;
    }
    const next = snapshot();
    if (prev) for (const k of Object.keys(next)) if (next[k] !== prev[k]) emitSettingChanged(k);
    prev = next;
  });
}
