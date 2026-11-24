/**
 * The audio store's view of the desktop reader (contract: `@bible/audio` `ports.ts`).
 * A "tab" here is a Bible PANE: `id` is the panel id. Audio follows ONE pane, the one Listen
 * was pressed in; closing it, navigating it elsewhere or changing its translation behaves like
 * the web tab (the shared store reacts to what `tab()` reports). Other panes are unaffected.
 *
 * Audio runs in the main window only: detached windows are separate renderers where feature
 * modules do not run.
 */
import type { AudioModulesPort, AudioReaderPort, AudioReaderTab } from '@bible/audio';
import { useBibleStore } from '../../stores/useBibleStore';
import { useLayoutStore } from '../../stores/useLayoutStore';
import { computeSelectedRange } from '../../stores/bible/internals/verseRange';

const EMPTY: ReadonlyArray<{ verse: number }> = [];

/** One tab object per panel while nothing it reports has changed (cheap `===` for callers). */
const cache = new Map<string, AudioReaderTab>();

function build(panelId: string): AudioReaderTab | undefined {
  const panel = useBibleStore.getState().panels.get(panelId); // allow-getstate: port read, not render
  if (!panel) { cache.delete(panelId); return undefined; }
  const open = panel.openTabs[panel.activeTabIndex];
  if (!open) { cache.delete(panelId); return undefined; }
  const verses = panel.versesByTab.get(open.tabId) ?? EMPTY;
  const next: AudioReaderTab = {
    id: panelId,
    moduleAbbr: open.abbreviation,
    book: panel.currentBook ?? null,
    chapter: panel.currentChapter ?? null,
    loading: panel.loadingByTab.get(open.tabId) ?? false,
    verses,
    studyVerse: panel.selectedVerseId ?? null,
  };
  const prev = cache.get(panelId);
  if (prev && prev.moduleAbbr === next.moduleAbbr && prev.book === next.book && prev.chapter === next.chapter
    && prev.loading === next.loading && prev.verses === next.verses && prev.studyVerse === next.studyVerse) return prev;
  cache.set(panelId, next);
  return next;
}

/** The pane Play acts on when none is named: the one last focused, else the first Bible pane. */
function activePanelId(): string | undefined {
  const panels = useBibleStore.getState().panels; // allow-getstate: port read
  const last = useLayoutStore.getState().lastActiveBiblePanelId; // allow-getstate: port read
  if (last && panels.has(last)) return last;
  return panels.keys().next().value as string | undefined;
}

/** The pane that owns a Bible tab id (the reader slots hand components the tab id, audio speaks in panel ids). */
export function panelIdOfTab(tabId: string | undefined): string | undefined {
  if (!tabId) return undefined;
  for (const [panelId, panel] of useBibleStore.getState().panels) { // allow-getstate: lookup
    const open = panel.openTabs[panel.activeTabIndex];
    if (open?.tabId === tabId) return panelId;
  }
  return undefined;
}

export const desktopReaderPort: AudioReaderPort = {
  subscribe(listener) {
    const offBible = useBibleStore.subscribe(listener);
    // A new active pane changes what Play acts on.
    const offLayout = useLayoutStore.subscribe((s, p) => { if (s.lastActiveBiblePanelId !== p.lastActiveBiblePanelId) listener(); });
    return () => { offBible(); offLayout(); };
  },
  tab: build,
  activeTab() {
    const id = activePanelId();
    return id ? build(id) : undefined;
  },
  selectionStart(panelId) {
    const panel = useBibleStore.getState().panels.get(panelId); // allow-getstate: port read
    if (!panel) return null;
    return computeSelectedRange(panel.selectedVerseId, panel.selectionEndVerseId)?.start ?? null;
  },
  followTo(panelId, book, chapter) {
    // A page turn only: no selection change, no history, no Study / Commentary movement.
    return useBibleStore.getState().followToChapter(panelId, book, chapter); // allow-getstate: command
  },
};

const languageOf = (abbr: string): string =>
  useBibleStore.getState().availableBibles.find(b => b.abbreviation === abbr)?.language_code ?? ''; // allow-getstate: port read

export const desktopModulesPort: AudioModulesPort = {
  subscribe(listener) {
    let last = useBibleStore.getState().availableBibles; // allow-getstate: subscribe seed
    return useBibleStore.subscribe(s => { if (s.availableBibles !== last) { last = s.availableBibles; listener(); } });
  },
  languageOf,
};

export { languageOf as desktopLanguageOf };
