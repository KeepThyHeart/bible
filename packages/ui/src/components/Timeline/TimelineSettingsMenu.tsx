/** TimelineSettingsMenu: a popover with the chronology, kind and lane filters. */
import { useMemo, useRef, useState } from 'react';
import type { TimelineDataset, TimelineStore } from '@bible/core/browser';
import { Popover } from '../Popover';
import { useTimelineStore } from './useTimelineStore';
import { kindLabel } from './labels';
import type { TimelinePanelLabels } from './labels';

export interface TimelineSettingsMenuProps {
  store: TimelineStore;
  dataset: TimelineDataset;
  labels: Pick<TimelinePanelLabels, 'settings' | 'chronology' | 'kinds' | 'lanes' | 'kindNames'>;
  onOpenChange?: (open: boolean) => void;
}

export function TimelineSettingsMenu({ store, dataset, labels, onOpenChange }: TimelineSettingsMenuProps) {
  const state = useTimelineStore(store);
  const btnRef = useRef<HTMLButtonElement>(null);
  const [open, setOpenState] = useState(false);
  const setOpen = (next: boolean) => {
    setOpenState(next);
    onOpenChange?.(next);
  };
  const kinds = useMemo(() => [...new Set(dataset.items.map((i) => i.kind))], [dataset]);
  const activeKinds = state.kinds ?? kinds;
  const filtersActive = state.kinds !== null || state.hiddenLanes.length > 0;

  const toggleKind = (kind: string) => {
    const next = activeKinds.includes(kind) ? activeKinds.filter((k) => k !== kind) : [...activeKinds, kind];
    store.setKinds(next.length === 0 || next.length === kinds.length ? null : next);
  };

  return (
    <>
      <button
        ref={btnRef}
        type="button"
        className="kth-btn kth-btn--sm kth-timeline__settings-btn"
        aria-haspopup="dialog"
        aria-expanded={open}
        aria-label={labels.settings}
        onClick={() => setOpen(!open)}
      >
        <span aria-hidden="true">{'☰'}</span>
        {filtersActive && <span className="kth-timeline__settings-dot" aria-hidden="true" />}
      </button>
      <Popover
        open={open}
        anchor={open && btnRef.current ? btnRef.current.getBoundingClientRect() : null}
        onClose={() => setOpen(false)}
        role="dialog"
        label={labels.settings}
        autoFocus
        width={320}
        align="end"
        className="kth-timeline-settings"
      >
        {dataset.chronologies.length > 1 && (
          <label className="kth-timeline-settings__row">
            <span>{labels.chronology}</span>
            <select className="kth-select" value={state.chronologyId} onChange={(e) => store.setChronology(e.currentTarget.value)}>
              {[...dataset.chronologies].sort((a, b) => a.sortOrder - b.sortOrder).map((c) => (
                <option key={c.id} value={c.id}>{c.name}</option>
              ))}
            </select>
          </label>
        )}
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
      </Popover>
    </>
  );
}
