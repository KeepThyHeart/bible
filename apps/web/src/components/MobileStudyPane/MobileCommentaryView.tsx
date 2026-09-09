import { useRef, useCallback, useEffect } from 'preact/hooks';
import { useTranslation } from 'react-i18next';
import { StudyVerseHeader } from './StudyVerseHeader';
import { MobileCommentary, MobileCommentaryDetail } from './MobileCommentary';
import { studyStore } from '../../stores/studyStore';
import { bibleStore } from '../../stores/bibleStore';
import { commentaryStore } from '../../stores/commentaryStore';
import { useStore } from '../../hooks/useStore';
import { useVerseNavigation } from '../../hooks/useVerseNavigation';
import { formatPassageRef } from '../../constants';
import { parseVerseId } from '../../utils/verseId';
import { getSyncStatus } from '../../utils/syncStatus';
import type { IDataProviders } from '../../providers/interfaces';

interface MobileCommentaryViewProps {
  providers: IDataProviders;
  onNavigateBible?: () => void;
  onOpenSettings?: (section?: string) => void;
}

/**
 * Dedicated Commentary tab view for mobile.
 * Shows the commentary card list / detail directly with a verse header.
 */
export function MobileCommentaryView({ providers, onNavigateBible, onOpenSettings }: MobileCommentaryViewProps) {
  const { t } = useTranslation();
  const studyVerseId = useStore(studyStore, () => studyStore.verseId);
  const studyBook = useStore(studyStore, () => studyStore.book);
  const studyChapter = useStore(studyStore, () => studyStore.chapter);
  const studyVerse = useStore(studyStore, () => studyStore.verse);
  const verseHistory = useStore(studyStore, () => studyStore.verseHistory);
  const pinned = useStore(studyStore, () => studyStore.pinned);
  // Subscribe to the active Bible tab's studyVerse so this view re-renders
  // (and the scroll-to-top effect re-fires) when the user clicks a new verse
  // in the Bible pane — bibleStore.navigateTo updates tab.studyVerse but does
  // not touch studyStore.
  useStore(bibleStore, () => bibleStore.getActiveTab()?.studyVerse);

  // Infer from Bible tab when no verse has been explicitly selected
  const activeTab = bibleStore.getActiveTab();
  const book = studyBook || activeTab?.book || null;
  const chapter = studyChapter || activeTab?.chapter || null;
  const verse = studyVerse || (activeTab?.studyVerse ? activeTab.studyVerse % 1000 : null) || (book && chapter ? 1 : null);
  const verseId = studyVerseId
    || activeTab?.studyVerse
    || (book && chapter ? book * 1000000 + chapter * 1000 + (verse ?? 1) : null);

  // Build verse label
  let verseLabel = '';
  if (book && chapter) {
    verseLabel = formatPassageRef(book, chapter, verse);
  }

  // Compute sync status using shared helper
  const syncInfo = getSyncStatus({
    pinned,
    pinnedBook: studyStore.pinnedBook,
    pinnedChapter: studyStore.pinnedChapter,
    pinnedVerse: studyStore.pinnedVerse,
    currentVerseId: verseId,
  });

  const handleSyncToVerse = () => {
    if (!syncInfo.syncVerseId) return;
    if (syncInfo.status === 'pinned-mismatch') {
      studyStore.unpin();
    }
    const { bookNumber, chapter: c, verse: v } = parseVerseId(syncInfo.syncVerseId);
    commentaryStore.loadForChapter(bookNumber, c);
    bibleStore.adoptPreviewAsStudy(syncInfo.syncVerseId);
    studyStore.loadForVerse(syncInfo.syncVerseId, bookNumber, c, v);
  };

  const { handlePrevVerse, handleNextVerse } = useVerseNavigation(book, chapter, verse);

  const handleHistorySelect = (targetVerseId: number) => {
    const { bookNumber, chapter, verse } = parseVerseId(targetVerseId);
    bibleStore.navigateTo(bookNumber, chapter, verse);
  };

  // Lifted commentary detail state — persisted in commentaryStore across tab switches
  const commentaryDetail = useStore(commentaryStore, () => commentaryStore.mobileSelectedCommentary);
  const setCommentaryDetail = useCallback((detail: { abbr: string; name: string } | null) => {
    commentaryStore.setMobileSelectedCommentary(detail, verseId);
  }, [verseId]);

  const paneRef = useRef<HTMLDivElement>(null);

  // The mobile counterpart of CommentaryPane's mount signal — the mobile nav
  // shows one view at a time, so this is when a chapter change is worth
  // spending commentary requests on.
  useEffect(() => {
    commentaryStore.viewMounted(true);
    return () => commentaryStore.viewMounted(false);
  }, []);

  // §2.3 — Scroll commentary to top whenever the current verse changes.
  useEffect(() => {
    paneRef.current?.scrollTo({ top: 0 });
    document.querySelector('.mobile-scroll-wrapper')?.scrollTo({ top: 0 });
  }, [verseId]);

  // §5.1A — Per-verse fast path: when navigating to a new verse with a single
  // commentary open, fetch just that verse's entries first (renders immediately),
  // then kick off the full chapter prefetch in the background.
  useEffect(() => {
    if (!commentaryDetail || !verseId || !book || !chapter) return;
    void commentaryStore.fetchEntriesForVerse(commentaryDetail.abbr, verseId);
    // Background prefetch — do not await
    void commentaryStore.prefetchAllEntries(book, chapter);
  }, [commentaryDetail, verseId, book, chapter]);

  const handleBackToList = useCallback(() => {
    setCommentaryDetail(null);
    // After returning to card list, scroll so the filter bar is flush at the top
    requestAnimationFrame(() => {
      const filter = paneRef.current?.querySelector('.mobile-commentary__filter-bar') as HTMLElement | null;
      if (filter) {
        filter.scrollIntoView({ block: 'start', behavior: 'instant' });
      }
    });
  }, [setCommentaryDetail]);

  // Back bar for commentary detail — back arrow to return to commentary list
  const backBar = commentaryDetail ? (
    <div class="mobile-study-pane__sticky-back mobile-study-pane__sticky-back--commentary-detail">
      <button class="mobile-commentary-detail__back-title" onClick={handleBackToList}>
        <i class="fa-solid fa-arrow-left fa-xs" />
        <span class="mobile-commentary-detail__back-title-text">{commentaryDetail.name}</span>
      </button>
    </div>
  ) : null;

  const syncBanner = syncInfo.status === 'pinned-mismatch' ? (
    <div class="commentary-pinned-banner">
      <i class="fa-solid fa-thumbtack" />
      <span>{t('studyPane.pinnedTo')} {verseLabel}.</span>
      <button class="commentary-pinned-banner__sync" onClick={handleSyncToVerse}>
        {t('studyPane.syncTo')} {syncInfo.syncLabel} <i class="fa-solid fa-rotate fa-xs" />
      </button>
    </div>
  ) : syncInfo.status === 'preview-available' ? (
    <div class="commentary-selected-banner">
      <button class="commentary-selected-banner__sync" onClick={handleSyncToVerse}>
        {t('commentaryPane.selectedSyncTo')} {syncInfo.syncLabel} <i class="fa-solid fa-rotate fa-xs" />
      </button>
    </div>
  ) : null;

  return (
    <div class="mobile-study-pane mobile-study-pane--commentary" ref={paneRef}>
      <div class="mobile-study-pane__content">
        <h2 class="mobile-study-pane__title">{t('commentaryPane.commentary')}</h2>
        {commentaryDetail && (
          <a
            class="mobile-commentary-detail__see-all"
            href="#"
            onClick={(e) => { e.preventDefault(); handleBackToList(); }}
          >
            <i class="fa-solid fa-arrow-left fa-xs" /> {t('commentaryPane.seeAllCommentaries')}
          </a>
        )}
        {backBar}
        {syncBanner}
        <StudyVerseHeader
          verseLabel={verseLabel}
          verseId={verseId}
          pinned={pinned}
          onTogglePin={() => pinned ? studyStore.unpin() : studyStore.pin()}
          onPrev={handlePrevVerse}
          onNext={handleNextVerse}
          onNavigateBible={onNavigateBible}
          history={verseHistory}
          onHistorySelect={handleHistorySelect}
          bibleProvider={providers.bible}
        />
        <MobileCommentary
          bibleProvider={providers.bible}
          onOpenSettings={onOpenSettings}
          viewingModule={commentaryDetail}
          onViewModule={setCommentaryDetail}
        />
      </div>
    </div>
  );
}
