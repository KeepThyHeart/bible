import { useEffect, useCallback } from 'react';
import { useBibleStore } from '../stores/useBibleStore';
import { findVerseElement, restartArrivalFlash } from './verseScrollTarget';

/** Bounded retry budget for {@link scrollNearestOnceLaidOut} - see its doc comment. */
const LAYOUT_NOT_READY_MAX_RETRIES = 10;

/**
 * How much of a verse has to be on screen before a click on it counts as
 * "already visible" and scrolls nothing.
 *
 * "Fully visible" was too strict: a long verse, or one clipped by a few pixels
 * at the edge of the viewport, failed the test and got scrolled into view -
 * so clicking a verse the reader was plainly looking at moved the page under
 * them. They can see it; leave it where it is.
 */
const VISIBLE_ENOUGH_FRACTION = 0.5;

/**
 * A verse taller than the viewport can never reach {@link VISIBLE_ENOUGH_FRACTION},
 * so it counts as visible once it fills most of the viewport instead.
 */
const FILLS_VIEWPORT_FRACTION = 0.8;

/**
 * 'nearest'-mode scroll: only scrolls the verse into view if it isn't already
 * substantially visible in `container`.
 *
 * A panel that has JUST been created (e.g. a brand-new dockview tab opened via
 * "+ New tab" or a Ctrl-clicked scripture link) can still have a zero-size
 * container on the very first frame(s) this runs - dockview hasn't finished
 * laying it out yet. `getBoundingClientRect()` on a zero-size container
 * returns an empty rect that trivially satisfies "the verse is within the
 * container's bounds" (0 <= 0 <= 0), so without this check the visibility
 * test would wrongly conclude the verse is already in view and skip
 * scrolling entirely - the new-tab-highlights-but-doesn't-scroll bug.
 *
 * Retries for a bounded number of animation frames rather than concluding
 * "visible" (the bug) or scrolling blindly (which could land at the wrong
 * position before layout settles). Bounded so a panel that genuinely never
 * gets laid out (e.g. hidden/inactive) doesn't spin forever.
 */
function scrollNearestOnceLaidOut(
  // HTMLElement, not HTMLDivElement: the previewed verse is found by
  // `data-verse-id`, and in Parallel mode that row is a `<tr>`.
  verseEl: HTMLElement,
  container: HTMLDivElement | null,
  retriesLeft = LAYOUT_NOT_READY_MAX_RETRIES,
): void {
  if (!container) {
    // No scroll container to check visibility against - just scroll.
    verseEl.scrollIntoView({ behavior: 'auto', block: 'nearest' });
    return;
  }

  const containerRect = container.getBoundingClientRect();
  const containerNotLaidOut = containerRect.width === 0 && containerRect.height === 0;

  if (containerNotLaidOut) {
    if (retriesLeft <= 0) return; // give up quietly rather than spin forever
    requestAnimationFrame(() => scrollNearestOnceLaidOut(verseEl, container, retriesLeft - 1));
    return;
  }

  const rect = verseEl.getBoundingClientRect();
  const visibleHeight = Math.max(
    0,
    Math.min(rect.bottom, containerRect.bottom) - Math.max(rect.top, containerRect.top),
  );
  const visibleFraction = rect.height > 0 ? visibleHeight / rect.height : 0;
  const fillsViewport = visibleHeight >= containerRect.height * FILLS_VIEWPORT_FRACTION;

  if (visibleFraction < VISIBLE_ENOUGH_FRACTION && !fillsViewport) {
    verseEl.scrollIntoView({ behavior: 'auto', block: 'nearest' });
  }
}

/**
 * Manages scroll position save/restore and verse centering for the Bible pane.
 *
 * Responsibilities:
 * - Scroll to selected verse (center or nearest mode)
 * - Save/restore scroll position from navigation history
 */
export function useBibleScrolling(
  panelId: string,
  bibleTextRef: React.RefObject<HTMLDivElement | null>,
  selectedVerseRef: React.RefObject<HTMLDivElement | null>,
  selectedVerseId: number | null,
  /**
   * The verse a link just landed on, if any. Takes priority over
   * `selectedVerseId` as the scroll target: a preview deliberately leaves the
   * selection alone (see `previewSlice.ts`), so scrolling to the selection
   * would centre the verse the reader came FROM. Cross-chapter it is worse -
   * the selection points outside the loaded chapter, nothing carries
   * `selectedVerseRef`, and nothing scrolled at all.
   */
  previewVerseId: number | null,
  scrollTrigger: number,
  scrollMode: 'center' | 'nearest',
  currentVerses: any[],
  isLoading: boolean,
  saveScrollPosition: (scrollTop: number) => void,
  /** The Back button: the visit-stack back (see stores/bible/internals/visitStack.ts). */
  goBack: () => void,
  navigateToHistoryEntry: (index: number) => void,
) {

  // Two scroll modes serve different UX goals:
  // 'center' -- used after navigation (back/forward, search result click) to orient the reader
  // 'nearest' -- used after clicking a verse that's already visible, to avoid jarring scroll jumps
  // Depends on currentVerses.length so we scroll after verses actually render (not before).
  useEffect(() => {
    if (isLoading || currentVerses.length === 0) return;
    if (!selectedVerseId && !previewVerseId) return;

    const frameId = requestAnimationFrame(() => {
      const ps = useBibleStore.getState().getPanelState(panelId);
      const currentHistoryEntry = ps.navigationHistory[ps.historyIndex];
      // A saved scrollTop is an offset *into a particular chapter*. Applying it
      // while a different chapter is on screen scrolls to a meaningless place -
      // so the entry has to still describe what is rendered. Together with
      // loadChapter clearing scrollMode, this keeps a stale restore from firing
      // on an ordinary verse click.
      const entryMatchesRenderedChapter =
        currentHistoryEntry?.bookNumber === ps.currentBook &&
        currentHistoryEntry?.chapter === ps.currentChapter;
      // A preview is a request to look at one specific verse, so it overrides a
      // saved scroll offset - restoring the offset would put the reader back
      // where they were and leave the link looking broken.
      if (!previewVerseId && currentHistoryEntry?.scrollTop !== undefined && entryMatchesRenderedChapter && scrollMode === 'center' && bibleTextRef.current) {
        // Restore saved scroll position instead of scrolling to verse
        bibleTextRef.current.scrollTop = currentHistoryEntry.scrollTop;
        // Clear the saved scrollTop so it doesn't re-apply on subsequent renders
        const updatedHistory = [...ps.navigationHistory];
        updatedHistory[ps.historyIndex] = { ...currentHistoryEntry, scrollTop: undefined };
        useBibleStore.setState({ panels: new Map(useBibleStore.getState().panels).set(panelId, { ...ps, navigationHistory: updatedHistory }) });
        return;
      }

      // `selectedVerseRef` is attached only to the SELECTED verse, so a preview
      // has to be found by id. Every verse row carries `data-verse-id` in all
      // four display modes, which is what makes one lookup serve them all.
      const target: HTMLElement | null = previewVerseId
        ? findVerseElement(bibleTextRef.current, previewVerseId)
        : selectedVerseRef.current;

      if (!target) return;

      if (scrollMode === 'center') {
        target.scrollIntoView({ behavior: 'auto', block: 'center' });
      } else {
        // 'nearest' mode - only scroll if not fully visible
        scrollNearestOnceLaidOut(target, bibleTextRef.current);
      }

      if (previewVerseId) restartArrivalFlash(target);
    });

    return () => cancelAnimationFrame(frameId);
  }, [selectedVerseId, previewVerseId, scrollTrigger, scrollMode, currentVerses.length, isLoading, panelId, bibleTextRef, selectedVerseRef]);

  // There was a save-before / restore-after pair of effects here, keyed off
  // `isResultsVisible`. They existed solely because showing or hiding the search
  // results flipped `PanelGroup`'s `key` in BibleVerseList, destroying and
  // recreating the whole Bible text subtree at scrollTop 0. Search results are
  // their own dockview panel now, so the Bible pane is never remounted by a
  // search and there is no scroll position to rescue.

  // Helpers to save scroll position before history navigation
  const goBackWithScroll = useCallback(() => {
    if (bibleTextRef.current) {
      saveScrollPosition(bibleTextRef.current.scrollTop);
    }
    goBack();
  }, [goBack, saveScrollPosition, bibleTextRef]);

  // No goForwardWithScroll: the pane has a Back button and a history menu, and
  // the menu can reach anything ahead of the cursor by name.
  const navigateToHistoryEntryWithScroll = useCallback((index: number) => {
    if (bibleTextRef.current) {
      saveScrollPosition(bibleTextRef.current.scrollTop);
    }
    navigateToHistoryEntry(index);
  }, [navigateToHistoryEntry, saveScrollPosition, bibleTextRef]);

  return {
    goBackWithScroll,
    navigateToHistoryEntryWithScroll,
  };
}
