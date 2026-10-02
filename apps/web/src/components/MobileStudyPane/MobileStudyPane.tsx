import { useEffect, useRef, useState } from 'preact/hooks';
import { useTranslation } from 'react-i18next';
import { StudyVerseHeader } from './StudyVerseHeader';
import { StudyCrossRefs } from '../StudyPane/StudyCrossRefs';
import { StudyHome } from '../StudyPane/StudyHome';
import { StudyMeasures } from '../StudyPane/StudyMeasures';
import { StudyTopics } from '../StudyPane/StudyTopics';
import { TopicsBrowser } from '../StudyPane/TopicsBrowser';
import { GenealogyPane } from '../StudyPane/GenealogyPane';
import { studyStore } from '../../stores/studyStore';
import { bibleStore } from '../../stores/bibleStore';
import { useStore } from '../../hooks/useStore';
import { useVerseNavigation } from '../../hooks/useVerseNavigation';
import { formatPassageRef } from '../../constants';
import { parseVerseId } from '../../utils/verseId';
import { getSyncStatus } from '../../utils/syncStatus';
import { isEnabled } from '../../utils/featureFlags';
import { isTagGraphEnabled } from '../../utils/clientConfig';
import { isGenealogyEnabled } from '../../utils/featureFlags';
import { TimelinePane } from '../TimelinePane/TimelinePane';
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
export function MobileStudyPane({ providers, onStrongsClick, onStrongsHover, onStrongsLeave, onOpenSettings, onNavigateBible }: MobileStudyPaneProps) {
  const { t } = useTranslation();
  const verseId = useStore(studyStore, () => studyStore.verseId);
  const book = useStore(studyStore, () => studyStore.book);
  const chapter = useStore(studyStore, () => studyStore.chapter);
  const verse = useStore(studyStore, () => studyStore.verse);
  const verseHistory = useStore(studyStore, () => studyStore.verseHistory);
  const pinned = useStore(studyStore, () => studyStore.pinned);
  const topicsBrowserOpen = useStore(studyStore, () => studyStore.topicsBrowserOpen);
  const familyTreeOpen = useStore(studyStore, () => studyStore.familyTreeOpen);
  const familyTreeFocus = useStore(studyStore, () => studyStore.familyTreeFocus);
  const genealogyEnabled = isGenealogyEnabled();
  const pendingTopicNav = useStore(studyStore, () => studyStore.pendingTopicNav);
  const verseTopics = useStore(studyStore, () => studyStore.verseTopics);
  const verseEntities = useStore(studyStore, () => studyStore.verseEntities);
  const topicsLoading = useStore(studyStore, () => studyStore.topicsLoading);

  const showTimeline = isEnabled('timeline');
  const [timelineOpen, setTimelineOpen] = useState(false);

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

  // Reading a verse from the family tree: preview it, then leave the sheet for the reader.
  const handleFamilyTreeOpenVerse = (targetVerseId: number) => {
    handleNavigateBible(targetVerseId);
    studyStore.closeFamilyTree();
    onNavigateBible?.();
  };

  // From a person's Topics detail: swap the Topics overlay for the family tree sheet.
  const handleShowFamilyTree = (personId: string, name: string) => {
    studyStore.closeTopicsBrowser();
    studyStore.openFamilyTree({ personId, name });
  };

  // Close the overlays on unmount
  const paneRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    return () => {
      studyStore.topicsBrowserOpen = false;
      studyStore.familyTreeOpen = false;
    };
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

        {/* Weights, measures and money: hidden when off or none */}
        <StudyMeasures variant="mobile" verseId={verseId} onOpenSettings={onOpenSettings} compact />

        {/* Family tree (genealogy explorer) */}
        {genealogyEnabled && (
          <div class="mobile-study-section">
            <div class="mobile-study-section__header">
              <i class="fa-solid fa-sitemap" /> {t('genealogyPane.title')}
            </div>
            <div class="mobile-study-section__content">
              <button
                class="mobile-study-section__browse-link"
                onClick={() => studyStore.openFamilyTree()}
              >
                <i class="fa-solid fa-arrow-up-right-from-square" /> {t('genealogyPane.title')}
              </button>
            </div>
          </div>
        )}

        {/* Timeline Section: opens a full-screen sheet, loaded on first open */}
        {showTimeline && (
          <div class="mobile-study-section">
            <div class="mobile-study-section__header">
              <i class="fa-solid fa-timeline" /> {t('timeline.title')}
            </div>
            <div class="mobile-study-section__content">
              <button
                class="mobile-study-section__browse-link"
                onClick={() => setTimelineOpen(true)}
              >
                <i class="fa-solid fa-arrow-up-right-from-square" /> {t('timeline.open')}
              </button>
            </div>
          </div>
        )}

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

      {/* Timeline full-screen sheet (mounted only while open, so the dataset loads on first open) */}
      {showTimeline && timelineOpen && (
        <div class="mobile-topics-overlay">
          <div class="mobile-topics-overlay__header">
            <button class="mobile-topics-overlay__close" onClick={() => setTimelineOpen(false)} aria-label={t('timeline.close')}>
              <i class="fa-solid fa-xmark" />
            </button>
            <span class="mobile-topics-overlay__title">
              <span class="mobile-topics-overlay__pane-label">{t('studyPane.study')}</span> {t('timeline.title')}
            </span>
          </div>
          <div class="mobile-topics-overlay__body">
            <TimelinePane />
          </div>
        </div>
      )}

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
              onShowFamilyTree={genealogyEnabled ? handleShowFamilyTree : undefined}
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

      {/* Family tree full-screen sheet */}
      {genealogyEnabled && familyTreeOpen && (
        <div class="mobile-topics-overlay mobile-family-tree-overlay">
          <div class="mobile-topics-overlay__header">
            <button
              class="mobile-topics-overlay__close"
              onClick={() => studyStore.closeFamilyTree()}
              aria-label={t('genealogyPane.close')}
            >
              <i class="fa-solid fa-xmark" />
            </button>
            <span class="mobile-topics-overlay__title">
              <span class="mobile-topics-overlay__pane-label">{t('studyPane.study')}</span> {t('genealogyPane.title')}
            </span>
          </div>
          <div class="mobile-topics-overlay__body">
            <GenealogyPane
              provider={providers.genealogy}
              focus={familyTreeFocus}
              compact
              onOpenVerse={handleFamilyTreeOpenVerse}
            />
          </div>
        </div>
      )}
    </div>
  );
}
