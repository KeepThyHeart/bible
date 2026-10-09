import { useTranslation } from 'react-i18next';
import { StudySection } from './StudySection';
import { StudyCrossRefs } from './StudyCrossRefs';
import { StudySynthesis } from './StudySynthesis';
import { StudyTopics } from './StudyTopics';
import { StudyHome } from './StudyHome';
import { Suspense, lazy } from 'preact/compat';
import { useMemo } from 'preact/hooks';
import { studyModes, studySections, useSlot } from '../../host/slots';
import type { StudyMode } from '../../host/slots';
import { studyStore } from '../../stores/studyStore';
import { bibleStore } from '../../stores/bibleStore';
import { commentaryStore } from '../../stores/commentaryStore';
import { useStore } from '../../hooks/useStore';
import { parseVerseId } from '../../utils/verseId';
import { getSyncStatus } from '../../utils/syncStatus';
import type { IBibleDataProvider } from '../../providers/interfaces';

interface StudyPaneProps {
  onStrongsClick?: (strongsNumber: string) => void;
  onStrongsHover?: (strongsNumber: string, rect: DOMRect) => void;
  onStrongsLeave?: () => void;
  bibleProvider?: IBibleDataProvider;
  /** Opens the settings dialog (a module section's deep link). */
  onOpenSettings?: (section?: string) => void;
}

/**
 * Unified Study pane — scrollable view with collapsible sections.
 * Synced to the active Bible verse (with optional pin-to-verse).
 */
export function StudyPane({ onStrongsClick, onStrongsHover, onStrongsLeave, bibleProvider, onOpenSettings }: StudyPaneProps) {
  const { t } = useTranslation();
  const verseId = useStore(studyStore, () => studyStore.verseId);
  const book = useStore(studyStore, () => studyStore.book);
  const chapter = useStore(studyStore, () => studyStore.chapter);
  const verse = useStore(studyStore, () => studyStore.verse);
  const pinned = useStore(studyStore, () => studyStore.pinned);
  const pinnedBook = useStore(studyStore, () => studyStore.pinnedBook);
  const pinnedChapter = useStore(studyStore, () => studyStore.pinnedChapter);
  const pinnedVerse = useStore(studyStore, () => studyStore.pinnedVerse);
  const openMode = useStore(studyStore, () => studyStore.studyMode);
  const modeFocus = useStore(studyStore, () => studyStore.studyModeFocus);
  const modes = [...useSlot(studyModes)].sort((a, b) => a.order - b.order);
  const sections = [...useSlot(studySections)].sort((a, b) => a.order - b.order);
  const activeMode = modes.find((m) => m.id === openMode);

  // Passage labels
  const displayBook = pinned ? pinnedBook : book;
  const displayChapter = pinned ? pinnedChapter : chapter;
  const displayVerse = pinned ? pinnedVerse : verse;
  let passageLabel = '';
  if (displayBook && displayChapter) {
    const bookName = t(String(displayBook), { ns: 'books' });
    passageLabel = displayVerse
      ? `${bookName} ${displayChapter}:${displayVerse}`
      : `${bookName} ${displayChapter}`;
  }

  // Compute sync status using shared helper
  const syncInfo = getSyncStatus({
    pinned,
    pinnedBook,
    pinnedChapter,
    pinnedVerse,
    currentVerseId: verseId,
  });

  const handleSync = () => {
    studyStore.unpin();
    if (syncInfo.syncVerseId) {
      const { bookNumber, chapter, verse } = parseVerseId(syncInfo.syncVerseId);
      commentaryStore.loadForChapter(bookNumber, chapter);
      bibleStore.adoptPreviewAsStudy(syncInfo.syncVerseId);
      studyStore.loadForVerse(syncInfo.syncVerseId, bookNumber, chapter, verse);
    }
  };

  const handleSelectedSync = () => {
    if (!syncInfo.syncVerseId) return;
    const { bookNumber, chapter } = parseVerseId(syncInfo.syncVerseId);
    commentaryStore.loadForChapter(bookNumber, chapter);
    bibleStore.adoptPreviewAsStudy(syncInfo.syncVerseId);
  };

  const handleOpenVerse = (targetVerseId: number) => {
    const { bookNumber, chapter, verse } = parseVerseId(targetVerseId);
    bibleStore.navigateToPreview(bookNumber, chapter, verse);
  };

  const modeTabs = modes.length > 0 && (
    <div class="study-pane__modes" role="tablist" aria-label={t(modes[0].stripLabelKey)}>
      <button
        role="tab"
        aria-selected={!activeMode}
        class={`study-pane__mode${!activeMode ? ' study-pane__mode--active' : ''}`}
        onClick={() => studyStore.closeStudyMode()}
      >
        {t('studyPane.study')}
      </button>
      {modes.map((m) => (
        <button
          key={m.id}
          role="tab"
          aria-selected={activeMode === m}
          class={`study-pane__mode${activeMode === m ? ' study-pane__mode--active' : ''}`}
          onClick={() => studyStore.openStudyMode(m.id)}
        >
          {t(m.labelKey)}
        </button>
      ))}
    </div>
  );

  if (activeMode) {
    return (
      <div class={`study-pane study-pane--${activeMode.id}`}>
        <h2 class="study-pane__title">{t('studyPane.study')}</h2>
        {modeTabs}
        <StudyModeView mode={activeMode} focus={modeFocus} onOpenVerse={handleOpenVerse} />
      </div>
    );
  }

  return (
    <div class="study-pane">
      <h2 class="study-pane__title">{t('studyPane.study')}</h2>
      {modeTabs}
      <div class="study-pane__header">
        {passageLabel && <span class="study-pane__passage">{passageLabel}</span>}
        <button
          class={`study-pane__pin${pinned ? ' study-pane__pin--active' : ''}`}
          onClick={() => pinned ? studyStore.unpin() : studyStore.pin()}
          title={pinned ? t('studyPane.unpinVerse') : t('studyPane.pinVerse')}
        >
          <i class={`fa-solid fa-thumbtack${pinned ? '' : ' fa-rotate-by'}`} style={pinned ? {} : { '--fa-rotate-angle': '45deg' } as any} />
        </button>
      </div>

      {syncInfo.status === 'pinned-mismatch' && (
        <div class="study-pane__pinned-banner">
          <span>{t('studyPane.pinnedTo')} {passageLabel}</span>
          <button onClick={handleSync} class="study-pane__sync-btn">
            {t('studyPane.syncTo')} {syncInfo.syncLabel}
          </button>
        </div>
      )}

      {syncInfo.status === 'preview-available' && (
        <div class="study-pane__selected-banner">
          <button onClick={handleSelectedSync} class="study-pane__sync-btn">
            {t('studyPane.selectedSyncTo')} {syncInfo.syncLabel} <i class="fa-solid fa-rotate fa-xs" />
          </button>
        </div>
      )}

      <div class="study-pane__content">
        <StudySection id="crossrefs" label={t('studyPane.crossReferences')} subtitle={t('studyCrossRefs.tskSubtitle')}>
          <StudyCrossRefs bibleProvider={bibleProvider} />
        </StudySection>

        <StudySection id="topics" label={t('studyPane.topics')}>
          <StudyTopics onTopicClick={(topicId, module, name, sourceName) => commentaryStore.navigateToTopic(topicId, module, name, sourceName)} />
        </StudySection>

        {sections.map((sec) => <sec.Section key={sec.id} verseId={verseId} onOpenSettings={onOpenSettings} />)}

        <StudySynthesis bibleProvider={bibleProvider} />

        <StudySection id="interlinear" label={t('studyPane.interlinear')} defaultExpanded={false}>
          <StudyHome onStrongsClick={onStrongsClick} onStrongsHover={onStrongsHover} onStrongsLeave={onStrongsLeave} />
        </StudySection>
      </div>
    </div>
  );
}

/** A mode's view loads on first use; one `lazy` component per mode. */
function StudyModeView({ mode, focus, onOpenVerse }: { mode: StudyMode; focus: { token: number } | null; onOpenVerse: (verseId: number) => void }) {
  const View = useMemo(() => lazy(mode.load), [mode]);
  return (
    <Suspense fallback={null}>
      <View focus={focus} onOpenVerse={onOpenVerse} />
    </Suspense>
  );
}
