/** TimelineZoomControls: -, +, Fit, and log-scale zoom and position sliders. */
import { centerToFraction, formatYear, fractionToSpan, spanRange, spanToFraction, viewSpan, yearOf } from '@bible/core/browser';
import type { TimelineStore } from '@bible/core/browser';
import { useTimelineStore } from './useTimelineStore';
import type { TimelinePanelLabels } from './labels';

export interface TimelineZoomControlsProps {
  store: TimelineStore;
  labels: Pick<TimelinePanelLabels, 'zoomIn' | 'zoomOut' | 'fit' | 'zoom' | 'position'>;
}

const STEPS = 1000;

export function TimelineZoomControls({ store, labels }: TimelineZoomControlsProps) {
  const state = useTimelineStore(store);
  const bounds = store.getBounds();
  const { view } = state;
  const span = viewSpan(view);
  const { min, max } = spanRange(bounds);
  const zoomValue = Math.round(STEPS * (1 - spanToFraction(span, min, max)));
  const posValue = Math.round(STEPS * centerToFraction(view, bounds));
  const atFull = span >= viewSpan(bounds);
  const startYear = yearOf(view.start);
  const endYear = yearOf(view.end);
  const rangeText = startYear === endYear ? formatYear(startYear) : `${formatYear(startYear)} to ${formatYear(endYear)}`;
  const mid = (view.start + view.end) / 2;

  return (
    <div className="kth-timeline__zoom">
      <div className="kth-timeline__group">
        <button type="button" className="kth-btn kth-btn--sm" aria-label={labels.zoomOut} onClick={() => store.zoomAt(1 / 1.5, state.width / 2)}>-</button>
        <button type="button" className="kth-btn kth-btn--sm" aria-label={labels.zoomIn} onClick={() => store.zoomAt(1.5, state.width / 2)}>+</button>
        <button type="button" className="kth-btn kth-btn--sm" onClick={() => store.fit()}>{labels.fit}</button>
      </div>
      <span className="kth-timeline__slider-icon" aria-hidden="true">{'\u{1F50D}\uFE0E'}</span>
      <input
        type="range"
        className="kth-timeline-range"
        min={0}
        max={STEPS}
        step={1}
        aria-label={labels.zoom}
        aria-valuetext={rangeText}
        value={zoomValue}
        onChange={(e) => store.setSpan(fractionToSpan(1 - Number(e.currentTarget.value) / STEPS, min, max))}
      />
      <span className="kth-timeline__slider-icon" aria-hidden="true">{'\u2194'}</span>
      <input
        type="range"
        className="kth-timeline-range"
        min={0}
        max={STEPS}
        step={1}
        aria-label={labels.position}
        aria-valuetext={formatYear(yearOf(mid))}
        value={posValue}
        disabled={atFull}
        onChange={(e) => store.setCenterFraction(Number(e.currentTarget.value) / STEPS)}
      />
      <span className="kth-timeline__range-text" aria-hidden="true">{rangeText}</span>
    </div>
  );
}
