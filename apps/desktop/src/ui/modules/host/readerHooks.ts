/**
 * Dispatch sites for the core reader events and `settings.changed` (task 0123).
 *
 * Every function checks `featureModules.hasSubscribers(event)` FIRST and returns before
 * building any payload, so a build where no active module declares the hook pays one map
 * lookup. Consecutive identical verse / chapter values are dropped.
 *
 * Imports only `moduleHost` (plus erased types), so the stores can call it without
 * pulling the UI in.
 */
import { featureModules } from '../moduleHost';
import type { BibleState } from '../../stores/bible/types';

let lastVerse: string | null = null;
let lastChapter: string | null = null;
const lastChapterByPanel = new Map<string, string>();

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
  featureModules.dispatch('reader.selectionChanged', { verseIds: getVerseIds(), module });
}

export function emitSettingChanged(key: string): void {
  if (!featureModules.hasSubscribers('settings.changed')) return;
  featureModules.dispatch('settings.changed', { key });
}

/** Test hook: forget the dedupe memory. */
export function resetReaderHookMemory(): void {
  lastVerse = null;
  lastChapter = null;
  lastChapterByPanel.clear();
}

function selectionIds(anchor: number | null, end: number | null): number[] {
  if (anchor === null) return [];
  if (end === null) return [anchor];
  const lo = Math.min(anchor, end);
  const hi = Math.max(anchor, end);
  const ids: number[] = [];
  // Verse ids are book*1e6 + chapter*1e3 + verse, so a same-chapter range is contiguous.
  for (let id = lo; id <= hi && ids.length < 500; id++) ids.push(id);
  return ids;
}

/** Bible store subscriber: one pass over the panels that changed, run on every store update. */
export function bibleStateChanged(state: BibleState, prev: BibleState): void {
  const wantVerse = featureModules.hasSubscribers('reader.verseChanged');
  const wantSel = featureModules.hasSubscribers('reader.selectionChanged');
  const wantChapter = featureModules.hasSubscribers('reader.chapterRendered');
  if (!wantVerse && !wantSel && !wantChapter) return;
  if (state.panels === prev.panels) return;
  for (const [panelId, ps] of state.panels) {
    const before = prev.panels.get(panelId);
    if (before === ps) continue;
    const tab = ps.openTabs[ps.activeTabIndex] ?? ps.openTabs[0];
    if (!tab) continue;
    const module = tab.abbreviation;
    if (ps.selectedVerseId !== before?.selectedVerseId) {
      if (ps.selectedVerseId !== null) emitVerseChanged(ps.selectedVerseId, module);
    }
    if (ps.selectedVerseId !== before?.selectedVerseId || ps.selectionEndVerseId !== before?.selectionEndVerseId) {
      emitSelectionChanged(() => selectionIds(ps.selectedVerseId, ps.selectionEndVerseId), module);
    }
    const verses = ps.versesByTab.get(tab.tabId);
    if (verses && verses.length > 0 && verses !== before?.versesByTab.get(tab.tabId) && !ps.loadingByTab.get(tab.tabId)) {
      const first = verses[0];
      const key = `${module}:${first.book_number}:${first.chapter}`;
      if (wantChapter && lastChapterByPanel.get(panelId) !== key) {
        lastChapterByPanel.set(panelId, key);
        // Deduped per panel above; dispatch directly so another panel's last chapter cannot swallow it.
        featureModules.dispatch('reader.chapterRendered', { book: first.book_number, chapter: first.chapter, module });
      }
    }
  }
}

/** Preferences store subscriber: reports each top-level key whose value changed. */
export function preferencesChanged(state: object, prev: object): void {
  if (!featureModules.hasSubscribers('settings.changed')) return;
  for (const key of Object.keys(state)) {
    const next = (state as Record<string, unknown>)[key];
    if (typeof next === 'function') continue;
    if (next !== (prev as Record<string, unknown>)[key]) emitSettingChanged(key);
  }
}
