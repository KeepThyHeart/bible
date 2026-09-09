import { useEffect, useRef, useCallback } from 'preact/hooks';
import { settingsStore } from '../../stores/settingsStore';
import { useTranslation } from 'react-i18next';
import { CommentaryTabBar } from './CommentaryTabBar';
import { CommentaryContent } from './CommentaryContent';
import { commentaryStore, HOME_TAB_ID } from '../../stores/commentaryStore';
import { bibleStore } from '../../stores/bibleStore';
import { moduleStore } from '../../stores/moduleStore';
import { useStore } from '../../hooks/useStore';
import { formatPassageRef, MAX_CHAPTERS } from '../../constants';
import { parseVerseId } from '../../utils/verseId';
import { getSyncStatus } from '../../utils/syncStatus';
import { useVerseText } from '../../hooks/useVerseText';
import type { IBibleDataProvider } from '../../providers/interfaces';

interface CommentaryPaneProps {
  bibleProvider?: IBibleDataProvider;
  onOpenSettings?: (section?: string) => void;
  /** When true, the CommentaryTabBar is not rendered (e.g. landscape mode renders it separately) */
  hideTabBar?: boolean;
}

export function CommentaryPane({ bibleProvider, onOpenSettings, hideTabBar }: CommentaryPaneProps) {
  const { t } = useTranslation();
  const collapsed = useStore(commentaryStore, () => commentaryStore.collapsed);
  const syncedBook = useStore(commentaryStore, () => commentaryStore.syncedBook);
  const syncedChapter = useStore(commentaryStore, () => commentaryStore.syncedChapter);
  const pinned = useStore(commentaryStore, () => commentaryStore.pinned);
  const studyVerse = useStore(bibleStore, () => bibleStore.getActiveTab()?.studyVerse);
  const previewVerse = useStore(bibleStore, () => bibleStore.getActiveTab()?.previewVerse);
  const tabs = useStore(commentaryStore, () => commentaryStore.tabs);
  const activeTabId = useStore(commentaryStore, () => commentaryStore.activeTabId);

  // Only one right-hand pane is mounted at a time, so this is the store's
  // signal that a chapter change is worth spending requests on. Collapsed
  // counts as not on screen — the reader asked for it to be out of the way, and
  // expanding re-runs this and loads whatever was missed meanwhile. Mounting
  // loads the current chapter for the same reason: the chapter may well have
  // changed while some other pane was up.
  useEffect(() => {
    commentaryStore.viewMounted(!collapsed);
    return () => commentaryStore.viewMounted(false);
  }, [collapsed]);

  if (collapsed) {
    return (
      <div class="commentary-pane commentary-pane--collapsed">
        <button
          class="commentary-pane__expand-btn"
          onClick={() => commentaryStore.toggleCollapsed()}
          title={t('commentaryPane.showCommentary')}
        >
          {t('commentaryPane.commentaryArrow')}
        </button>
      </div>
    );
  }

  const pinnedVerse = useStore(commentaryStore, () => commentaryStore.pinnedVerse);
  const pinnedBook = useStore(commentaryStore, () => commentaryStore.pinnedBook);
  const pinnedChapter = useStore(commentaryStore, () => commentaryStore.pinnedChapter);

  // For pinned tabs, show the pinned passage; otherwise show the live synced passage
  const effectiveBook = pinned ? (pinnedBook ?? syncedBook) : syncedBook;
  const effectiveChapter = pinned ? (pinnedChapter ?? syncedChapter) : syncedChapter;

  // Compute sync status using shared helper
  const currentVerseId = pinned
    ? (pinnedBook && pinnedChapter ? (pinnedBook * 1000000) + (pinnedChapter * 1000) + (pinnedVerse ?? 0) : null)
    : (studyVerse ?? null);
  const syncInfo = getSyncStatus({
    pinned,
    pinnedBook,
    pinnedChapter,
    pinnedVerse,
    currentVerseId,
  });

  // Build passage label for header
  let passageLabel = '';
  if (effectiveBook && effectiveChapter) {
    const displayVerse = pinned ? pinnedVerse : studyVerse;
    const verse = displayVerse ? displayVerse % 1000 : null;
    passageLabel = formatPassageRef(effectiveBook, effectiveChapter, verse, moduleStore.getBookName(effectiveBook));
  }

  const displayVerse = pinned ? pinnedVerse : studyVerse;
  const verseNum = displayVerse ? displayVerse % 1000 : null;

  // Verse text for the preview line below the passage header
  const verseText = useVerseText(displayVerse, bibleProvider);

  // Swipe left/right to navigate between commentary verses (mobile)
  const scrollRef = useRef<HTMLDivElement>(null);
  const touchStartRef = useRef<{ x: number; y: number } | null>(null);

  // Save and restore scroll position per commentary tab
  const scrollPositionsRef = useRef<Map<string, number>>(new Map());
  const prevTabIdRef = useRef(activeTabId);

  useEffect(() => {
    const el = scrollRef.current;
    if (!el) return;
    // Save previous tab's scroll position
    if (prevTabIdRef.current && prevTabIdRef.current !== activeTabId) {
      scrollPositionsRef.current.set(prevTabIdRef.current, el.scrollTop);
    }
    prevTabIdRef.current = activeTabId;
    // Restore new tab's scroll position
    const saved = scrollPositionsRef.current.get(activeTabId);
    if (saved != null) {
      requestAnimationFrame(() => { el.scrollTop = saved; });
    } else {
      el.scrollTop = 0;
    }
  }, [activeTabId]);

  // §2.3 — Scroll commentary to top whenever the current verse changes.
  useEffect(() => {
    scrollRef.current?.scrollTo({ top: 0 });
  }, [currentVerseId]);

  // §4 — Read configurable swipe threshold from settings (parallel agent owns settingsStore).
  const swipeCommentaryVerseThresholdPx = useStore(
    settingsStore,
    () => (settingsStore as any).swipeCommentaryVerseThresholdPx ?? 100,
  ) as number;

  const navigateCommentaryVerse = useCallback(async (delta: number) => {
    const verseNum = displayVerse ? displayVerse % 1000 : null;
    if (!effectiveBook || !effectiveChapter || !verseNum) return;
    const newVerse = verseNum + delta;
    if (newVerse < 1) {
      // Go to the last verse of the previous chapter
      let prevBook = effectiveBook;
      let prevChapter = effectiveChapter - 1;
      if (prevChapter < 1) {
        if (effectiveBook <= 1) return; // Already at Genesis 1
        prevBook = effectiveBook - 1;
        prevChapter = MAX_CHAPTERS[prevBook] || 1;
      }
      // Navigate Bible pane to the previous chapter (loads verses)
      await bibleStore.navigateTo(prevBook, prevChapter);
      // Pick the last verse from the loaded data
      const tab = bibleStore.getActiveTab();
      const verses = tab?.verses;
      const lastV = verses?.filter(v => v.verse_id % 1000 > 0).pop();
      const lastVerseNum = lastV ? lastV.verse_id % 1000 : 1;
      const lastVerseId = (prevBook * 1000000) + (prevChapter * 1000) + lastVerseNum;
      commentaryStore.setOverrideVerse(lastVerseId);
      bibleStore.adoptPreviewAsStudy(lastVerseId);
      return;
    }
    const newVerseId = (effectiveBook * 1000000) + (effectiveChapter * 1000) + newVerse;
    commentaryStore.setOverrideVerse(newVerseId);
    bibleStore.adoptPreviewAsStudy(newVerseId);
  }, [displayVerse, effectiveBook, effectiveChapter]);

  useEffect(() => {
    const el = scrollRef.current;
    if (!el) return;
    // Match BiblePane gesture constants — direction must be locked horizontal
    // before we'll commit or render any swipe feedback.
    const DECISION_DISTANCE = 30;
    const DIRECTION_LOCK_RATIO = 2.0;
    const onTouchStart = (e: TouchEvent) => {
      const t = e.touches[0];
      touchStartRef.current = { x: t.clientX, y: t.clientY };
    };
    const onTouchEnd = (e: TouchEvent) => {
      if (!touchStartRef.current) return;
      const t = e.changedTouches[0];
      const dx = t.clientX - touchStartRef.current.x;
      const dy = t.clientY - touchStartRef.current.y;
      touchStartRef.current = null;
      const adx = Math.abs(dx);
      const ady = Math.abs(dy);
      // Decision-distance phase: don't commit unless the gesture has locked horizontal
      if (adx <= DECISION_DISTANCE) return;
      if (adx <= ady * DIRECTION_LOCK_RATIO) return;
      // And require a minimum swipe distance to actually navigate
      if (adx < swipeCommentaryVerseThresholdPx) return;
      if (dx > 0) {
        navigateCommentaryVerse(-1); // swipe right → previous verse
      } else {
        navigateCommentaryVerse(1); // swipe left → next verse
      }
    };
    el.addEventListener('touchstart', onTouchStart, { passive: true });
    el.addEventListener('touchend', onTouchEnd, { passive: true });
    return () => {
      el.removeEventListener('touchstart', onTouchStart);
      el.removeEventListener('touchend', onTouchEnd);
    };
  }, [navigateCommentaryVerse, swipeCommentaryVerseThresholdPx]);

  return (
    <div class="commentary-pane">
      <h2 class="commentary-pane__title">{t('commentaryPane.commentary')}</h2>
      {!hideTabBar && <CommentaryTabBar />}
      {/* Scrollable area: passage header, verse preview, nav bar, and content all scroll together */}
      <div class="commentary-pane__scroll" ref={scrollRef}>
        {/* Passage header with pin and verse nav */}
        <div class={`commentary-passage-header ${pinned ? 'commentary-passage-header--pinned' : ''}`}>
          <div class="commentary-passage-header__ref-group">
            <span class="commentary-passage-header__label">
              {passageLabel || t('commentaryPane.noPassageSelected')}
            </span>
            <button
              class={`commentary-passage-header__pin ${pinned ? 'commentary-passage-header__pin--active' : ''}`}
              onClick={() => commentaryStore.togglePin(studyVerse)}
              title={pinned ? t('commentaryPane.unpinCommentary') : t('commentaryPane.pinCommentary')}
            >
              <i class={`fa-solid fa-thumbtack ${pinned ? '' : 'fa-rotate-by'}`} style={pinned ? {} : { '--fa-rotate-angle': '45deg' } as any} />
            </button>
          </div>
          <div class="commentary-passage-header__actions">
            {verseNum && (
              <>
                <button
                  class="commentary-passage-header__nav"
                  onClick={() => navigateCommentaryVerse(-1)}
                  disabled={verseNum <= 1 && (effectiveChapter ?? 0) <= 1 && (effectiveBook ?? 0) <= 1}
                  title={t('commentaryPane.prevVerse')}
                >
                  <i class="fa-solid fa-chevron-left fa-xs" />
                </button>
                <button
                  class="commentary-passage-header__nav"
                  onClick={() => navigateCommentaryVerse(1)}
                  title={t('commentaryPane.nextVerse')}
                >
                  <i class="fa-solid fa-chevron-right fa-xs" />
                </button>
              </>
            )}
            {onOpenSettings && (
              <button
                class="commentary-passage-header__settings"
                onClick={() => onOpenSettings('commentary-font')}
                title={t('commentaryPane.textSettings')}
              >
                Aa
              </button>
            )}
          </div>
        </div>
        {verseText && (
          <div class="commentary-verse-text">{verseText}</div>
        )}
        {syncInfo.status === 'pinned-mismatch' && (
          <div class="commentary-pinned-banner">
            <i class="fa-solid fa-thumbtack" />
            <span>{t('commentaryPane.pinnedTo')} {passageLabel}.</span>
            <button
              class="commentary-pinned-banner__sync"
              onClick={() => {
                commentaryStore.unpin();
                if (syncInfo.syncVerseId) {
                  const sb = Math.floor(syncInfo.syncVerseId / 1000000);
                  const sc = Math.floor((syncInfo.syncVerseId % 1000000) / 1000);
                  commentaryStore.loadForChapter(sb, sc);
                  bibleStore.adoptPreviewAsStudy(syncInfo.syncVerseId);
                }
              }}
            >
              {t('commentaryPane.syncTo')} {syncInfo.syncLabel} <i class="fa-solid fa-rotate fa-xs" />
            </button>
          </div>
        )}
        {syncInfo.status === 'preview-available' && (
          <div class="commentary-selected-banner">
            <button
              class="commentary-selected-banner__sync"
              onClick={() => {
                if (syncInfo.syncVerseId) {
                  const pb = Math.floor(syncInfo.syncVerseId / 1000000);
                  const pc = Math.floor((syncInfo.syncVerseId % 1000000) / 1000);
                  commentaryStore.loadForChapter(pb, pc);
                  bibleStore.adoptPreviewAsStudy(syncInfo.syncVerseId);
                }
              }}
            >
              {t('commentaryPane.selectedSyncTo')} {syncInfo.syncLabel} <i class="fa-solid fa-rotate fa-xs" />
            </button>
          </div>
        )}
        {/* "Add to tabs" bar for temporary preview tabs */}
        {(() => {
          const activeTabObj = tabs.find(t => t.id === activeTabId);
          if (!activeTabObj || !(activeTabObj.temporary ?? false)) return null;
          return (
            <div class="commentary-nav-bar">
              <button
                class="commentary-nav-bar__add"
                onClick={() => commentaryStore.keepTab(activeTabId)}
              >
                <i class="fa-solid fa-plus fa-xs" /> {t('commentaryPane.addToTabs')}
              </button>
            </div>
          );
        })()}
        <CommentaryContent bibleProvider={bibleProvider} />
      </div>
    </div>
  );
}
