import { useEffect, useRef, useMemo } from 'preact/hooks';
import { useTranslation } from 'react-i18next';
import { StudyVerseHeader } from './StudyVerseHeader';
import { StudyCrossRefs } from '../StudyPane/StudyCrossRefs';
import { StudyHome } from '../StudyPane/StudyHome';
import { StudyTopics } from '../StudyPane/StudyTopics';
import { TopicsBrowser } from '../StudyPane/TopicsBrowser';
import { studyStore } from '../../stores/studyStore';
import { bibleStore } from '../../stores/bibleStore';
import { useStore } from '../../hooks/useStore';
import { useVerseNavigation } from '../../hooks/useVerseNavigation';
import { formatPassageRef } from '../../constants';
import { parseVerseId } from '../../utils/verseId';
import { getSyncStatus } from '../../utils/syncStatus';
import { isTagGraphEnabled } from '../../utils/clientConfig';
import { commentaryStore } from '../../stores/commentaryStore';
import type { IDataProviders } from '../../providers/interfaces';

interface MobileStudyPaneProps {
  providers: IDataProviders;
  onStrongsClick?: (strongsNumber: string) => void;
  onStrongsHover?: (strongsNumber: string, rect: DOMRect) => void;
  onStrongsLeave?: () => void;
  onOpenSettings?: (section?: string) => void;
  onNavigateBible?: () => void;
}

/**
 * Mobile Study tab — single scrollable page with Cross-References, Topics,
 * and Interlinear sections. Topics browser opens as a full-screen overlay.
 */
export function MobileStudyPane({ providers, onStrongsClick, onStrongsHover, onStrongsLeave, onNavigateBible }: MobileStudyPaneProps) {
  const { t } = useTranslation();
  const verseId = useStore(studyStore, () => studyStore.verseId);
  const book = useStore(studyStore, () => studyStore.book);
  const chapter = useStore(studyStore, () => studyStore.chapter);
  const verse = useStore(studyStore, () => studyStore.verse);
  const verseHistory = useStore(studyStore, () => studyStore.verseHistory);
  const pinned = useStore(studyStore, () => studyStore.pinned);
  const topicsBrowserOpen = useStore(studyStore, () => studyStore.topicsBrowserOpen);
  const pendingTopicNav = useStore(studyStore, () => studyStore.pendingTopicNav);
  const verseTopics = useStore(studyStore, () => studyStore.verseTopics);
  const verseEntities = useStore(studyStore, () => studyStore.verseEntities);
  const topicsLoading = useStore(studyStore, () => studyStore.topicsLoading);

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

  const handleNavigateBible = (targetVerseId: number) => {
    const { bookNumber, chapter, verse } = parseVerseId(targetVerseId);
    bibleStore.navigateToPreview(bookNumber, chapter, verse);
  };

  // Close topics overlay on unmount
  const paneRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    return () => { studyStore.topicsBrowserOpen = false; };
  }, []);

  // The pending topic is read here and cleared by TopicsBrowser once it has
  // actually opened it. Consuming it here (in a useMemo, during render) meant a
  // second request while the overlay was already open was thrown away.
  const overlayInitialTopic = pendingTopicNav ?? undefined;

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
    <div class="mobile-study-pane" ref={paneRef}>
      <div class="mobile-study-pane__content">
        <h2 class="mobile-study-pane__title">{t('mobileStudyPane.study')}</h2>
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

        {/* Cross-References Section */}
        <div class="mobile-study-section">
          <div class="mobile-study-section__header">
            <i class="fa-solid fa-link" />
            <span class="mobile-study-section__titles">
              {t('mobileStudyPane.crossReferences')}
              <span class="mobile-study-section__subtitle">{t('studyCrossRefs.tskSubtitle')}</span>
            </span>
          </div>
          <div class="mobile-study-section__content">
            <StudyCrossRefs bibleProvider={providers.bible} />
          </div>
        </div>

        {/* Topics Section */}
        <div class="mobile-study-section">
          <div class="mobile-study-section__header">
            <i class="fa-solid fa-tags" /> {t('mobileStudyPane.topics')}
          </div>
          <div class="mobile-study-section__content">
            <StudyTopics onTopicClick={(topicId, module, name, sourceName) => {
              studyStore.openTopicsBrowser({ topicId, module, topicName: name, sourceName });
            }} />
            <button
              class="mobile-study-section__browse-link"
              onClick={() => studyStore.openTopicsBrowser()}
            >
              <i class="fa-solid fa-arrow-up-right-from-square" /> {t('mobileStudyPane.browseAllTopics')}
            </button>
          </div>
        </div>

        {/* Interlinear Section */}
        <div class="mobile-study-section">
          <div class="mobile-study-section__header">
            <i class="fa-solid fa-language" /> {t('mobileStudyPane.interlinear')}
          </div>
          <div class="mobile-study-section__content">
            <StudyHome onStrongsClick={onStrongsClick} onStrongsHover={onStrongsHover} onStrongsLeave={onStrongsLeave} />
          </div>
        </div>
      </div>

      {/* Topics Browser full-screen overlay */}
      {topicsBrowserOpen && (
        <div class="mobile-topics-overlay">
          <div class="mobile-topics-overlay__header">
            <button class="mobile-topics-overlay__close" onClick={() => studyStore.closeTopicsBrowser()}>
              <i class="fa-solid fa-xmark" />
            </button>
            <span class="mobile-topics-overlay__title">
              <span class="mobile-topics-overlay__pane-label">{t('studyPane.study')}</span> {t('mobileStudyPane.topicsBrowser')}
            </span>
          </div>
          <div class="mobile-topics-overlay__body">
            <TopicsBrowser
              verseId={verseId}
              verseTopics={verseTopics}
              verseEntities={verseEntities}
              loading={topicsLoading}
              onNavigateBible={handleNavigateBible}
              topicalProvider={providers.topical}
              // Gated the same way DesktopApp gates the Topics pane: with the
              // feature off there is nothing for the browser to search or open.
              tagGraphProvider={isTagGraphEnabled() ? providers.tagGraph : undefined}
              bibleProvider={providers.bible}
              topicRequest={overlayInitialTopic}
              onTopicRequestHandled={() => studyStore.consumePendingTopicNav()}
              mobile
            />
          </div>
        </div>
      )}
    </div>
  );
}
