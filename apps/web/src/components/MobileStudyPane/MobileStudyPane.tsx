import { useEffect, useRef, useState } from 'preact/hooks';
import { useTranslation } from 'react-i18next';
import { StudyVerseHeader } from './StudyVerseHeader';
import { StudyCrossRefs } from '../StudyPane/StudyCrossRefs';
import { StudyHome } from '../StudyPane/StudyHome';
import { StudyMeasures } from '../StudyPane/StudyMeasures';
import { StudyTopics } from '../StudyPane/StudyTopics';
import { TopicsBrowser } from '../StudyPane/TopicsBrowser';
import { mobileStudySections, useSlot } from '../../host/slots';
import { studyStore } from '../../stores/studyStore';
import { bibleStore } from '../../stores/bibleStore';
import { useStore } from '../../hooks/useStore';
import { useVerseNavigation } from '../../hooks/useVerseNavigation';
import { formatPassageRef } from '../../constants';
import { parseVerseId } from '../../utils/verseId';
import { getSyncStatus } from '../../utils/syncStatus';
import { isEnabled } from '../../utils/featureFlags';
import { isTagGraphEnabled } from '../../utils/clientConfig';
import { Suspense, lazy } from 'preact/compat';
import { commentaryStore } from '../../stores/commentaryStore';
import type { IDataProviders } from '../../providers/interfaces';

// Loaded when their sheet first opens. A static import here would also split them out of
// the Study chunk (they are lazy pane views too) and fetch them on every boot (task 0123).
const QuizPane = lazy(() => import('../QuizPane/QuizPane').then((m) => ({ default: m.QuizPane })));

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
  const moduleSections = [...useSlot(mobileStudySections)].sort((a, b) => a.order - b.order);
  const pendingTopicNav = useStore(studyStore, () => studyStore.pendingTopicNav);
  const verseTopics = useStore(studyStore, () => studyStore.verseTopics);
  const verseEntities = useStore(studyStore, () => studyStore.verseEntities);
  const topicsLoading = useStore(studyStore, () => studyStore.topicsLoading);

  const showQuiz = isEnabled('quiz');
  const [quizOpen, setQuizOpen] = useState(false);

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

  // Close the overlays on unmount
  const paneRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    return () => {
      studyStore.topicsBrowserOpen = false;
      studyStore.studyMode = null;
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

        {/* Sections feature modules contribute (family tree, timeline, ...) */}
        {moduleSections.map((m) => m.Section && <m.Section key={m.id} />)}

        {/* Quiz Section: opens a full-screen sheet that starts a quiz on the current chapter */}
        {showQuiz && (
          <div class="mobile-study-section">
            <div class="mobile-study-section__header">
              <i class="fa-solid fa-circle-question" /> {t('quiz.title')}
            </div>
            <div class="mobile-study-section__content">
              <button
                class="mobile-study-section__browse-link"
                onClick={() => setQuizOpen(true)}
              >
                <i class="fa-solid fa-arrow-up-right-from-square" /> {t('quiz.quizThisChapter')}
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

      {/* Quiz full-screen sheet (mounted only while open: the catalog loads on first open and the quiz starts on the current chapter) */}
      {showQuiz && quizOpen && (
        <div class="mobile-topics-overlay">
          <div class="mobile-topics-overlay__header">
            <button class="mobile-topics-overlay__close" onClick={() => setQuizOpen(false)} aria-label={t('quiz.close')}>
              <i class="fa-solid fa-xmark" />
            </button>
            <span class="mobile-topics-overlay__title">
              <span class="mobile-topics-overlay__pane-label">{t('studyPane.study')}</span> {t('quiz.title')}
            </span>
          </div>
          <div class="mobile-topics-overlay__body">
            <Suspense fallback={null}><QuizPane startOnCurrentChapter onPassageOpened={() => setQuizOpen(false)} /></Suspense>
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

      {moduleSections.map((m) => m.Sheet && <m.Sheet key={m.id} onNavigateBible={onNavigateBible} />)}
    </div>
  );
}
