/**
 * TimelineRangeSlider: one track showing the whole dataset with two angled "flag" handles, From and To.
 * Dragging a flag moves that edge; dragging the band between them (or the bare track) pans. Each flag is a
 * keyboard slider. It only reads and writes the store, so wheel/pinch zoom, the buttons and search jumps
 * stay in sync for free.
 */
import { useRef } from 'react';
import type { KeyboardEvent, PointerEvent as ReactPointerEvent } from 'react';
import { formatInstant, MIN_SPAN_DAYS, viewSpan } from '@bible/core/browser';
import type { TimelineStore } from '@bible/core/browser';
import { useTimelineStore } from './useTimelineStore';

export interface TimelineRangeSliderProps {
  store: TimelineStore;
  label: string;
  fromLabel: string;
  toLabel: string;
}

type Drag = { kind: 'start' | 'end' } | { kind: 'pan'; grabT: number; startAtGrab: number };

/** Read-out precision that suits the window's span. */
export function precisionForSpan(spanDays: number): 'year' | 'month' | 'day' | 'hour' {
  if (spanDays < 3) return 'hour';
  if (spanDays < 120) return 'day';
  if (spanDays < 3 * 365.25) return 'month';
  return 'year';
}

export function TimelineRangeSlider({ store, label, fromLabel, toLabel }: TimelineRangeSliderProps) {
  const state = useTimelineStore(store);
  const trackRef = useRef<HTMLDivElement>(null);
  const drag = useRef<Drag | null>(null);
  const bounds = store.getBounds();
  const { view } = state;
  const total = viewSpan(bounds);
  const span = viewSpan(view);
  const precision = precisionForSpan(span);
  const pct = (t: number): number => Math.min(100, Math.max(0, ((t - bounds.start) / total) * 100));
  const left = pct(view.start);
  const right = pct(view.end);

  const tAt = (clientX: number): number => {
    const r = trackRef.current?.getBoundingClientRect();
    if (!r || r.width <= 0) return view.start;
    return bounds.start + Math.min(1, Math.max(0, (clientX - r.left) / r.width)) * total;
  };

  const begin = (e: ReactPointerEvent<HTMLElement>, d: Drag): void => {
    e.preventDefault();
    e.stopPropagation();
    e.currentTarget.setPointerCapture?.(e.pointerId);
    drag.current = d;
  };
  const onMove = (e: ReactPointerEvent<HTMLElement>): void => {
    const d = drag.current;
    if (!d) return;
    const t = tAt(e.clientX);
    if (d.kind === 'pan') store.panTo(d.startAtGrab + (t - d.grabT));
    else store.setEdge(d.kind, t);
  };
  const end = (e: ReactPointerEvent<HTMLElement>): void => {
    drag.current = null;
    e.currentTarget.releasePointerCapture?.(e.pointerId);
  };
  const grabBand = (e: ReactPointerEvent<HTMLElement>, centre: boolean): void => {
    const t = tAt(e.clientX);
    if (centre) store.panTo(t - span / 2);
    begin(e, { kind: 'pan', grabT: t, startAtGrab: centre ? t - span / 2 : view.start });
  };

  const onKey = (edge: 'start' | 'end') => (e: KeyboardEvent<HTMLElement>): void => {
    const cur = edge === 'start' ? view.start : view.end;
    let next: number | null = null;
    switch (e.key) {
      case 'ArrowLeft':
      case 'ArrowDown':
        next = cur - span * 0.1;
        break;
      case 'ArrowRight':
      case 'ArrowUp':
        next = cur + span * 0.1;
        break;
      case 'PageDown':
        next = cur - span * 0.5;
        break;
      case 'PageUp':
        next = cur + span * 0.5;
        break;
      case 'Home':
        next = edge === 'start' ? bounds.start : view.start + MIN_SPAN_DAYS;
        break;
      case 'End':
        next = edge === 'start' ? view.end - MIN_SPAN_DAYS : bounds.end;
        break;
      default:
        return;
    }
    e.preventDefault();
    store.setEdge(edge, next);
  };

  const flag = (edge: 'start' | 'end', name: string) => {
    const t = edge === 'start' ? view.start : view.end;
    return (
      <div
        role="slider"
        tabIndex={0}
        className={edge === 'start' ? 'kth-timeline-range__flag kth-timeline-range__flag--from' : 'kth-timeline-range__flag kth-timeline-range__flag--to'}
        style={{ insetInlineStart: `${edge === 'start' ? left : right}%` }}
        aria-label={name}
        aria-orientation="horizontal"
        aria-valuemin={edge === 'start' ? bounds.start : view.start + MIN_SPAN_DAYS}
        aria-valuemax={edge === 'start' ? view.end - MIN_SPAN_DAYS : bounds.end}
        aria-valuenow={t}
        aria-valuetext={formatInstant(t, precision)}
        onKeyDown={onKey(edge)}
        onPointerDown={(e) => begin(e, { kind: edge })}
        onPointerMove={onMove}
        onPointerUp={end}
        onPointerCancel={end}
      />
    );
  };

  return (
    <div className="kth-timeline-range" role="group" aria-label={label}>
      <div className="kth-timeline-range__track" ref={trackRef} onPointerDown={(e) => grabBand(e, true)} onPointerMove={onMove} onPointerUp={end} onPointerCancel={end}>
        <div
          className="kth-timeline-range__band"
          style={{ insetInlineStart: `${left}%`, inlineSize: `${Math.max(right - left, 0)}%` }}
          onPointerDown={(e) => grabBand(e, false)}
          onPointerMove={onMove}
          onPointerUp={end}
          onPointerCancel={end}
        />
        {flag('start', fromLabel)}
        {flag('end', toLabel)}
      </div>
    </div>
  );
}
