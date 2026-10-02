/** TimelinePanel: toolbar (chronology, kinds, search, lanes, zoom), the timeline and the selected item's card. */
import { useEffect, useMemo, useRef, useState } from 'react';
import { createTimelineStore, spanYearsToDays } from '@bible/core/browser';
import type { TimelineDataset } from '@bible/core/browser';
import { TimelineView } from './TimelineView';
import { TimelineItemCard } from './TimelineItemCard';
import { TimelineSearch } from './TimelineSearch';
import { TimelineSettingsMenu } from './TimelineSettingsMenu';
import { TimelineZoomControls } from './TimelineZoomControls';
import { FullscreenButton } from '../fullscreen/FullscreenButton';
import { FULLSCREEN_CLASS, useFullscreen } from '../fullscreen/useFullscreen';
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
  /** Minimum span (years) framed by search jumps and follow-my-reading; build config, default 200. */
  minSpanYears?: number;
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
  minSpanYears,
  className,
}: TimelinePanelProps) {
  const labels = { ...DEFAULT_TIMELINE_PANEL_LABELS, ...labelOverrides };
  // A new dataset is a new store; the initial chronology only seeds it.
  const store = useMemo(() => createTimelineStore(dataset, { chronologyId: initialChronologyId, minSpanDays: spanYearsToDays(minSpanYears) }),
    [dataset, minSpanYears],
  );
  const state = useTimelineStore(store);

  useEffect(() => {
    if (focusVerse != null) store.focusPassage(focusVerse);
  }, [focusVerse, store]);

  const chronology = dataset.chronologies.find((c) => c.id === state.chronologyId);
  const selected = state.selectedId === null ? undefined : dataset.items.find((i) => i.id === state.selectedId);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);
  // The settings popup owns Escape while it is open.
  const fs = useFullscreen(rootRef, { escape: !settingsOpen });
  const isFullscreen = allowFullscreen && fs.full;
  const rootClass = ['kth-timeline', isFullscreen && 'kth-timeline--fs', isFullscreen && selected && 'kth-timeline--fs-card', isFullscreen && FULLSCREEN_CLASS, className]
    .filter(Boolean).join(' ');

  return (
    <div ref={rootRef} className={rootClass}>
      <div className="kth-timeline__toolbar">
        <TimelineSearch store={store} labels={labels} />
        <TimelineZoomControls store={store} labels={labels} />
        <TimelineSettingsMenu store={store} dataset={dataset} labels={labels} onOpenChange={setSettingsOpen} />
        {allowFullscreen && (
          <FullscreenButton
            full={isFullscreen}
            onToggle={() => { setSettingsOpen(false); fs.toggle(); }}
            labels={{ enter: labels.fullscreen, exit: labels.exitFullscreen }}
          />
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
}
