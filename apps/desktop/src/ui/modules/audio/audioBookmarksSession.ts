/**
 * Audio resume points in the saved session (`sessionData.ui.audio = { v: 1, tabs: { [panelId]: AudioBookmark } }`).
 * Pane ids survive a restart, so each bookmark finds its pane again. Quit-mid-play: the selection
 * was never set, so when a restored pane first reports its chapter ready we mark the verse as the
 * selected one, once, and only if the pane's selection still equals the one persisted with the
 * bookmark (`selAtSave`), i.e. the reader has not chosen something else since.
 */
import { MAX_CHAPTERS, type Disposable } from '@bible/core/browser';
import type { AudioBookmark } from '@bible/audio';
import { markSessionDirty } from '../../stores/helpers/sessionNotifier';
import { claimRestoredSessionSection, registerSessionSerializer } from '../../stores/helpers/sessionRegistry';
import { useBibleStore } from '../../stores/useBibleStore';
import { audioStore } from './audioState';
import { AUDIO_SESSION_KEY } from './manifest';

export const AUDIO_SESSION_VERSION = 1;

export interface AudioSessionData {
  v: number;
  tabs: Record<string, AudioBookmark>;
}

const chapterCount = (book: number): number => MAX_CHAPTERS[book] ?? 0;

export function serializeAudioSession(): AudioSessionData {
  const tabs: Record<string, AudioBookmark> = {};
  for (const [id, mark] of audioStore.allBookmarks()) tabs[id] = mark;
  return { v: AUDIO_SESSION_VERSION, tabs };
}

/** The bookmark map inside saved data, or null when it is not the shape we wrote. */
export function parseAudioSession(data: unknown): Record<string, unknown> | null {
  if (!data || typeof data !== 'object') return null;
  const d = data as Partial<AudioSessionData>;
  if (d.v !== AUDIO_SESSION_VERSION || !d.tabs || typeof d.tabs !== 'object' || Array.isArray(d.tabs)) return null;
  return d.tabs as Record<string, unknown>;
}

/**
 * Apply restored bookmarks to their panes' selection as each pane first reports its chapter loaded.
 * No timeout: a pane that never shows the chapter is simply left alone. Returns a disposer.
 */
function applyWhenReady(marks: ReadonlyMap<string, AudioBookmark>): () => void {
  const pending = new Map(marks);
  let off: (() => void) | null = null;
  const check = (): void => {
    for (const [panelId, mark] of [...pending]) {
      const ps = useBibleStore.getState().panels.get(panelId); // allow-getstate: one-shot restore check
      if (!ps) continue; // not mounted yet; keep waiting
      const open = ps.openTabs[ps.activeTabIndex];
      if (!open || ps.loadingByTab.get(open.tabId)) continue;
      if (ps.currentBook !== mark.book || ps.currentChapter !== mark.chapter) {
        if (ps.currentBook != null && ps.currentChapter != null && ps.versesByTab.get(open.tabId)?.length) pending.delete(panelId); // loaded elsewhere
        continue;
      }
      if (!ps.versesByTab.get(open.tabId)?.length) continue;
      const sel = ps.selectedVerseId;
      if (sel == null) continue; // the pane has not settled its selection yet
      pending.delete(panelId);
      if (sel !== mark.selAtSave) continue; // the reader chose something since
      useBibleStore.getState().markReadingStop(panelId, mark.book * 1_000_000 + mark.chapter * 1_000 + mark.verse); // allow-getstate: command
    }
    if (pending.size === 0 && off) { off(); off = null; }
  };
  off = useBibleStore.subscribe(check);
  check();
  return () => { if (off) { off(); off = null; } };
}

/** Register the serializer and claim the restored section. Call from `activate`; dispose on switch-off. */
export function installAudioBookmarksSession(): Disposable {
  let stopApply: (() => void) | null = null;
  // The registry has no unregister: after switch-off keep writing the last saved resume points.
  let frozen: AudioSessionData | null = null;
  registerSessionSerializer(AUDIO_SESSION_KEY, () => frozen ?? serializeAudioSession());
  const offDirty = audioStore.bookmarksChanged.subscribe(() => markSessionDirty());
  claimRestoredSessionSection(AUDIO_SESSION_KEY, (data) => {
    const raw = parseAudioSession(data);
    if (!raw) return;
    audioStore.restoreBookmarks(raw, chapterCount);
    stopApply?.();
    const restored = new Map<string, AudioBookmark>();
    for (const id of Object.keys(raw)) {
      const m = audioStore.bookmarkFor(id);
      if (m) restored.set(id, m);
    }
    stopApply = applyWhenReady(restored);
  });
  return { dispose: () => { frozen = serializeAudioSession(); offDirty(); stopApply?.(); stopApply = null; } };
}
