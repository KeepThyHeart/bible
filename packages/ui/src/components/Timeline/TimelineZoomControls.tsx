/** TimelineZoomControls: -, +, Fit, and the two-handle From/To range slider. */
import { formatInstant, viewSpan } from '@bible/core/browser';
import type { TimelineStore } from '@bible/core/browser';
import { useTimelineStore } from './useTimelineStore';
import { precisionForSpan, TimelineRangeSlider } from './TimelineRangeSlider';
import type { TimelinePanelLabels } from './labels';

export interface TimelineZoomControlsProps {
  store: TimelineStore;
  labels: Pick<TimelinePanelLabels, 'zoomIn' | 'zoomOut' | 'fit' | 'zoom' | 'rangeFrom' | 'rangeTo'>;
}

export function TimelineZoomControls({ store, labels }: TimelineZoomControlsProps) {
  const state = useTimelineStore(store);
  const { view } = state;
  const precision = precisionForSpan(viewSpan(view));
  const from = formatInstant(view.start, precision);
  // The stored end is exclusive; read it back from just inside the window.
  const to = formatInstant(view.end - (precision === 'hour' ? 0 : 1 / 48), precision);
  const rangeText = from === to ? from : `${from} to ${to}`;

  return (
    <div className="kth-timeline__zoom">
      <div className="kth-timeline__group">
        <button type="button" className="kth-btn kth-btn--sm" aria-label={labels.zoomOut} onClick={() => store.zoomAt(1 / 1.5, state.width / 2)}>-</button>
        <button type="button" className="kth-btn kth-btn--sm" aria-label={labels.zoomIn} onClick={() => store.zoomAt(1.5, state.width / 2)}>+</button>
        <button type="button" className="kth-btn kth-btn--sm" onClick={() => store.fit()}>{labels.fit}</button>
      </div>
      <TimelineRangeSlider store={store} label={labels.zoom} fromLabel={labels.rangeFrom} toLabel={labels.rangeTo} />
      <span className="kth-timeline__range-text" aria-hidden="true">{rangeText}</span>
    </div>
  );
}
