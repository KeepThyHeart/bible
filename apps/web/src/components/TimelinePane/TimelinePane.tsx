import { useState, useEffect, useMemo, useCallback } from 'preact/hooks';
import { useTranslation } from 'react-i18next';
import { TimelinePanel } from '@bible/ui';
import type { TimelinePanelLabels } from '@bible/ui';
import type { ITimelineDataProvider, TimelineDataset } from '@bible/core/browser';
import { studyStore } from '../../stores/studyStore';
import { bibleStore } from '../../stores/bibleStore';
import { useStore } from '../../hooks/useStore';
import { parseVerseId, formatVerseRange } from '../../utils/verseId';
import { getTimelineProvider } from '../../providers/TimelineDataProvider';

interface TimelinePaneProps {
  /** Defaults to the app-wide provider; tests inject their own. */
  provider?: ITimelineDataProvider;
  /** Offer a full-screen toggle (desktop only; the phone sheet is already full screen). */
  allowFullscreen?: boolean;
}

type LoadState =
  | { status: 'loading' }
  | { status: 'ready'; dataset: TimelineDataset }
  | { status: 'empty' }
  | { status: 'error' };

/**
 * Timeline explorer pane (desktop right-pane tab and the phone full-screen
 * sheet). The dataset is fetched on first mount, i.e. the first time the tab is
 * opened, and kept by the provider afterwards.
 */
export function TimelinePane({ provider, allowFullscreen }: TimelinePaneProps) {
  const { t } = useTranslation();
  const verseId = useStore(studyStore, () => studyStore.verseId);
  const [state, setState] = useState<LoadState>({ status: 'loading' });
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    let cancelled = false;
    setState({ status: 'loading' });
    (provider ?? getTimelineProvider()).getDataset().then(
      (dataset) => { if (!cancelled) setState(dataset ? { status: 'ready', dataset } : { status: 'empty' }); },
      () => { if (!cancelled) setState({ status: 'error' }); },
    );
    return () => { cancelled = true; };
  }, [provider, attempt]);

  const labels = useMemo<Partial<TimelinePanelLabels>>(() => ({
    chronology: t('timeline.chronology'),
    kinds: t('timeline.show'),
    search: t('timeline.search'),
    lanes: t('timeline.lanes'),
    zoomIn: t('timeline.zoomIn'),
    zoomOut: t('timeline.zoomOut'),
    fit: t('timeline.fit'),
    settings: t('timeline.settings'),
    fullscreen: t('timeline.fullscreen'),
    exitFullscreen: t('timeline.exitFullscreen'),
    zoom: t('timeline.zoom'),
    position: t('timeline.position'),
    searchResults: t('timeline.searchResults'),
    noResults: t('timeline.noResults'),
    kindNames: {
      reign: t('timeline.kinds.reign'),
      life: t('timeline.kinds.life'),
      period: t('timeline.kinds.period'),
      event: t('timeline.kinds.event'),
      ministry: t('timeline.kinds.ministry'),
    },
    view: { group: t('timeline.group'), help: t('timeline.help') },
    card: {
      close: t('timeline.close'),
      read: t('timeline.read'),
      passages: t('timeline.passages'),
      dates: t('timeline.dates'),
      basis: t('timeline.basis'),
      circa: t('timeline.circa'),
      startRange: t('timeline.startRange'),
      endRange: t('timeline.endRange'),
      viaFallback: t('timeline.viaFallback'),
      reviewed: t('timeline.reviewed'),
      unreviewed: t('timeline.unreviewed'),
    },
  }), [t]);

  // Same navigation as a study-pane verse link: read the passage in the main reader.
  const openPassage = useCallback((start: number, end: number) => {
    const s = parseVerseId(start);
    void bibleStore.navigateToPreview(s.bookNumber, s.chapter, s.verse, end !== start ? end : undefined);
  }, []);

  if (state.status === 'loading') {
    return <div class="timeline-pane timeline-pane--message" role="status">{t('timeline.loading')}</div>;
  }
  if (state.status === 'empty') {
    return <div class="timeline-pane timeline-pane--message timeline-pane--empty">{t('timeline.empty')}</div>;
  }
  if (state.status === 'error') {
    return (
      <div class="timeline-pane timeline-pane--message timeline-pane--error" role="alert">
        <p>{t('timeline.error')}</p>
        <button type="button" onClick={() => setAttempt(n => n + 1)}>{t('timeline.retry')}</button>
      </div>
    );
  }
  return (
    <div class="timeline-pane">
      <TimelinePanel
        dataset={state.dataset}
        labels={labels}
        focusVerse={verseId}
        onOpenPassage={openPassage}
        formatReference={formatVerseRange}
        allowFullscreen={allowFullscreen}
      />
    </div>
  );
}
