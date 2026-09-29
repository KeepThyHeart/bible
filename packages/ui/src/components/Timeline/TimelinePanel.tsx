/** TimelinePanel: toolbar (chronology, kinds, search, lanes, zoom), the timeline and the selected item's card. */
import { useEffect, useMemo } from 'react';
import { createTimelineStore } from '@bible/core/browser';
import type { TimelineDataset } from '@bible/core/browser';
import { TimelineView } from './TimelineView';
import { TimelineItemCard } from './TimelineItemCard';
import { useTimelineStore } from './useTimelineStore';
import { DEFAULT_TIMELINE_PANEL_LABELS, defaultFormatReference, kindLabel } from './labels';
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
  className,
}: TimelinePanelProps) {
  const labels = { ...DEFAULT_TIMELINE_PANEL_LABELS, ...labelOverrides };
  // A new dataset is a new store; the initial chronology only seeds it.
  const store = useMemo(() => createTimelineStore(dataset, { chronologyId: initialChronologyId }), [dataset]);
  const state = useTimelineStore(store);

  useEffect(() => {
    if (focusVerse != null) store.focusPassage(focusVerse);
  }, [focusVerse, store]);

  const kinds = useMemo(() => [...new Set(dataset.items.map((i) => i.kind))], [dataset]);
  const chronology = dataset.chronologies.find((c) => c.id === state.chronologyId);
  const selected = state.selectedId === null ? undefined : dataset.items.find((i) => i.id === state.selectedId);
  const activeKinds = state.kinds ?? kinds;

  const toggleKind = (kind: string) => {
    const next = activeKinds.includes(kind) ? activeKinds.filter((k) => k !== kind) : [...activeKinds, kind];
    store.setKinds(next.length === 0 || next.length === kinds.length ? null : next);
  };

  return (
    <div className={className ? `kth-timeline ${className}` : 'kth-timeline'}>
      <div className="kth-timeline__toolbar">
        {dataset.chronologies.length > 1 && (
          <label className="kth-timeline__group">
            <span>{labels.chronology}</span>
            <select className="kth-select" value={state.chronologyId} onChange={(e) => store.setChronology(e.currentTarget.value)}>
              {[...dataset.chronologies].sort((a, b) => a.sortOrder - b.sortOrder).map((c) => (
                <option key={c.id} value={c.id}>{c.name}</option>
              ))}
            </select>
          </label>
        )}
        <input
          className="kth-input"
          type="search"
          aria-label={labels.search}
          placeholder={labels.search}
          value={state.query}
          onChange={(e) => store.setQuery(e.currentTarget.value)}
        />
        <div className="kth-timeline__group">
          <button type="button" className="kth-btn kth-btn--sm" aria-label={labels.zoomOut} onClick={() => store.zoomAt(1 / 1.5, state.width / 2)}>-</button>
          <button type="button" className="kth-btn kth-btn--sm" aria-label={labels.zoomIn} onClick={() => store.zoomAt(1.5, state.width / 2)}>+</button>
          <button type="button" className="kth-btn kth-btn--sm" onClick={() => store.fit()}>{labels.fit}</button>
        </div>
      </div>
      <div className="kth-timeline__toolbar">
        <div className="kth-timeline__group" role="group" aria-label={labels.kinds}>
          {kinds.map((k) => (
            <button key={k} type="button" className="kth-timeline__chip" aria-pressed={activeKinds.includes(k)} onClick={() => toggleKind(k)}>
              {kindLabel(labels.kindNames, k)}
            </button>
          ))}
        </div>
        <div className="kth-timeline__group" role="group" aria-label={labels.lanes}>
          {[...dataset.lanes].sort((a, b) => a.sortOrder - b.sortOrder).map((l) => (
            <button key={l.id} type="button" className="kth-timeline__chip" aria-pressed={!state.hiddenLanes.includes(l.id)} onClick={() => store.toggleLane(l.id)}>
              {l.name}
            </button>
          ))}
        </div>
      </div>
      {chronology?.description && <p className="kth-timeline__note">{chronology.description}</p>}
      <TimelineView store={store} labels={labels.view} height={height} />
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
