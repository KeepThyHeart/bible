/** TimelinePanel: toolbar (chronology, kinds, search, lanes, zoom), the timeline and the selected item's card. */
import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { createTimelineStore } from '@bible/core/browser';
import type { TimelineDataset } from '@bible/core/browser';
import { TimelineView } from './TimelineView';
import { TimelineItemCard } from './TimelineItemCard';
import { TimelineSearch } from './TimelineSearch';
import { TimelineSettingsMenu } from './TimelineSettingsMenu';
import { TimelineZoomControls } from './TimelineZoomControls';
import { FullscreenPanel } from '../FullscreenPanel';
import { useTimelineStore } from './useTimelineStore';
import { DEFAULT_TIMELINE_PANEL_LABELS, defaultFormatReference } from './labels';
import type { TimelinePanelLabels } from './labels';

export interface TimelinePanelProps {
  dataset: TimelineDataset;
  labels?: Partial<TimelinePanelLabels>;
  /** Follow-my-reading: selects and frames the best item for this verse whenever it changes. */
  focusVerse?: number | null;
  onOpenPassage?: (startVerseId: number, endVerseId: number) => void;
  formatReference?: (verseId: number, endVerseId?: number) => string;
  initialChronologyId?: string;
  /** Height of the timeline graphic in px (default: fit). */
  height?: number;
  /** Show a full-screen toggle (default false). */
  allowFullscreen?: boolean;
  className?: string;
}

export function TimelinePanel({
  dataset,
  labels: labelOverrides,
  focusVerse,
  onOpenPassage,
  formatReference = defaultFormatReference,
  initialChronologyId,
  height,
  allowFullscreen = false,
  className,
}: TimelinePanelProps) {
  const labels = { ...DEFAULT_TIMELINE_PANEL_LABELS, ...labelOverrides };
  // A new dataset is a new store; the initial chronology only seeds it.
  const store = useMemo(() => createTimelineStore(dataset, { chronologyId: initialChronologyId }), [dataset]);
  const state = useTimelineStore(store);

  useEffect(() => {
    if (focusVerse != null) store.focusPassage(focusVerse);
  }, [focusVerse, store]);

  const chronology = dataset.chronologies.find((c) => c.id === state.chronologyId);
  const selected = state.selectedId === null ? undefined : dataset.items.find((i) => i.id === state.selectedId);
  const [fullscreen, setFullscreen] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const isFullscreen = allowFullscreen && fullscreen;
  const toggleRef = useRef<HTMLButtonElement>(null);
  const wasFullscreen = useRef(false);
  // Leaving full screen: the dialog unmounts, so put focus back on the inline toggle.
  useLayoutEffect(() => {
    if (wasFullscreen.current && !isFullscreen) toggleRef.current?.focus();
    wasFullscreen.current = isFullscreen;
  }, [isFullscreen]);
  const rootClass = ['kth-timeline', isFullscreen && 'kth-timeline--fs', isFullscreen && selected && 'kth-timeline--fs-card', className]
    .filter(Boolean).join(' ');

  const body = (
    <div className={rootClass}>
      <div className="kth-timeline__toolbar">
        <TimelineSearch store={store} labels={labels} />
        <TimelineZoomControls store={store} labels={labels} />
        <TimelineSettingsMenu store={store} dataset={dataset} labels={labels} onOpenChange={setSettingsOpen} />
        {allowFullscreen && (
          <button
            ref={toggleRef}
            type="button"
            className="kth-btn kth-btn--sm kth-timeline__fullscreen-btn"
            aria-label={isFullscreen ? labels.exitFullscreen : labels.fullscreen}
            title={isFullscreen ? labels.exitFullscreen : labels.fullscreen}
            onClick={() => { setSettingsOpen(false); setFullscreen(!isFullscreen); }}
          >
            <span aria-hidden="true">{isFullscreen ? '\u21F2' : '\u26F6'}</span>
          </button>
        )}
      </div>
      {chronology?.description && <p className="kth-timeline__note">{chronology.description}</p>}
      <TimelineView store={store} labels={labels.view} height={isFullscreen ? undefined : height} />
      {selected && (
        <TimelineItemCard
          item={selected}
          chronologies={dataset.chronologies}
          activeChronologyId={state.chronologyId}
          labels={{ kinds: labels.kindNames, ...labels.card }}
          formatReference={formatReference}
          onOpenPassage={onOpenPassage}
          onClose={() => store.select(null)}
        />
      )}
    </div>
  );

  if (!isFullscreen) return body;
  return (
    <FullscreenPanel
      open
      onClose={() => { setSettingsOpen(false); setFullscreen(false); }}
      label={labels.fullscreen}
      hideHeader
      closeOnEscape={!settingsOpen}
      className="kth-timeline--fullscreen"
    >
      {body}
    </FullscreenPanel>
  );
}
