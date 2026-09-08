import { useEffect, useRef } from 'react';
import { bibleAPI } from '../../../services/electronAPI';
import { useBibleStore } from '../../../stores/useBibleStore';
import { decodeBibleContentKey } from '../../../stores/bible/contentKey';
import { AvailableBible } from '../../BiblePaneContext';

/**
 * Seeds a panel that was created with an encoded `contentKey` - "+ New tab", a
 * Ctrl-clicked scripture link, a split, or a pop-out - with that passage.
 *
 * Skipped when the panel has staged session state, which is strictly richer
 * (it carries navigation history and the per-passage toggles) and more current.
 * Runs at most once per mount.
 */
export function useContentKeyInit(args: {
  contentKey: string | undefined;
  panelId: string;
  openTabsLength: number;
  availableBibles: AvailableBible[];
  hasStagedSession: boolean;
  dockviewPanelApi: { setTitle: (title: string) => void } | undefined;
}) {
  const { contentKey, panelId, openTabsLength, availableBibles, hasStagedSession, dockviewPanelApi } = args;
  const initializedRef = useRef(false);

  useEffect(() => {
    if (!contentKey || initializedRef.current || hasStagedSession) return;
    if (openTabsLength > 0) return;
    if (availableBibles.length === 0) return;

    const seed = decodeBibleContentKey(contentKey);
    if (!seed) return;

    initializedRef.current = true;

    bibleAPI.getBookName(seed.book).then((bookName: string) => {
      const store = useBibleStore.getState(); // allow-getstate: event handler - imperative store access outside render
      const updatedPanels = new Map(store.panels);
      const currentPanelState = store.getPanelState(panelId);
      updatedPanels.set(panelId, {
        ...currentPanelState,
        currentBook: seed.book,
        currentChapter: seed.chapter,
        currentBookName: bookName,
        selectedVerseId: seed.selectedVerseId ?? null,
        // Mirror navigateToVerse's same-chapter branch (verseSlice.ts): seeding
        // a target verse is a navigation, so it should center and re-trigger
        // useBibleScrolling the same way clicking a scripture link in an
        // existing tab does. Without this, a brand-new tab (e.g. Ctrl-click a
        // reference, "+ New tab" to a verse) defaulted to scrollTrigger: 0 /
        // scrollMode: 'nearest' from createDefaultPanelState - and 'nearest'
        // silently no-ops against a panel dockview has only just created (see
        // the layout-not-settled guard in useBibleScrolling), so the verse
        // highlighted but never scrolled into view.
        ...(seed.selectedVerseId ? {
          scrollMode: 'center' as const,
          scrollTrigger: currentPanelState.scrollTrigger + 1,
        } : {}),
      });
      useBibleStore.setState({ panels: updatedPanels });

      const bible = store.availableBibles.find(b => b.abbreviation === seed.abbreviation);
      store.openBible(panelId, seed.abbreviation, bible?.name ?? seed.abbreviation, seed.displayMode);

      dockviewPanelApi?.setTitle(`${bookName} ${seed.chapter}`);
    }).catch((err) => {
      console.error('[BiblePane] Error initializing from contentKey:', err);
    });
  }, [contentKey, openTabsLength, availableBibles.length, panelId, dockviewPanelApi, hasStagedSession]);
}
