/**
 * TimelineView: the SVG timeline. Reads `store.getLayout()` (lanes, bars, diamonds, uncertainty bands) and
 * `computeTicks` for the axis. Wheel or ctrl/pinch zooms at the pointer, dragging pans, keys work when focused.
 * The store is the core `TimelineStore`; nothing here fetches or owns state.
 */
import { useEffect, useMemo, useRef } from 'react';
import type { KeyboardEvent, PointerEvent as ReactPointerEvent } from 'react';
import { chronologyChain, computeTicks, formatSpan, resolveItem, xOf } from '@bible/core/browser';
import type { Mark, TimelineStore } from '@bible/core/browser';
import { useTimelineStore } from './useTimelineStore';
import { DEFAULT_TIMELINE_VIEW_LABELS } from './labels';
import type { TimelineViewLabels } from './labels';

export interface TimelineViewProps {
  store: TimelineStore;
  labels?: Partial<TimelineViewLabels>;
  onSelect?: (itemId: number) => void;
  /** Visible height in px; the graphic scrolls vertically when the lanes are taller. Default: fit the lanes. */
  height?: number;
}

const AXIS_H = 26;
const ZOOM_STEP = 1.5;
const KEY_PAN_PX = 80;

// Static class strings (the lint guard reads literals only).
const LANE_CLASS: Record<string, string> = {
  red: 'kth-timeline-lane kth-timeline-lane--red',
  green: 'kth-timeline-lane kth-timeline-lane--green',
  orange: 'kth-timeline-lane kth-timeline-lane--orange',
  blue: 'kth-timeline-lane kth-timeline-lane--blue',
  yellow: 'kth-timeline-lane kth-timeline-lane--yellow',
  purple: 'kth-timeline-lane kth-timeline-lane--purple',
  teal: 'kth-timeline-lane kth-timeline-lane--teal',
  gray: 'kth-timeline-lane kth-timeline-lane--gray',
};
const LANE_CYCLE = [
  'kth-timeline-lane kth-timeline-lane--c0',
  'kth-timeline-lane kth-timeline-lane--c1',
  'kth-timeline-lane kth-timeline-lane--c2',
  'kth-timeline-lane kth-timeline-lane--c3',
  'kth-timeline-lane kth-timeline-lane--c4',
  'kth-timeline-lane kth-timeline-lane--c5',
];

function shapeClass(m: Mark): string {
  let c = 'kth-timeline-shape';
  if (m.circa) c += ' kth-timeline-shape--circa';
  if (m.viaFallback) c += ' kth-timeline-shape--fallback';
  if (m.selected) c += ' kth-timeline-shape--selected';
  return c;
}

export function TimelineView({ store, labels: labelOverrides, onSelect, height }: TimelineViewProps) {
  const labels = { ...DEFAULT_TIMELINE_VIEW_LABELS, ...labelOverrides };
  const state = useTimelineStore(store);
  const layout = store.getLayout();
  const boxRef = useRef<HTMLDivElement>(null);
  const svgRef = useRef<SVGSVGElement>(null);
  const drag = useRef<{ id: number; x: number; moved: number } | null>(null);
  const suppressClick = useRef(false);

  // Measure our own width.
  useEffect(() => {
    const el = boxRef.current;
    if (!el) return;
    const measure = () => store.setWidth(Math.floor(el.clientWidth));
    measure();
    if (typeof ResizeObserver === 'undefined') return;
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    return () => ro.disconnect();
  }, [store]);

  // Wheel needs a non-passive native listener to be able to preventDefault.
  useEffect(() => {
    const el = svgRef.current;
    if (!el) return;
    const onWheel = (e: WheelEvent) => {
      e.preventDefault();
      const rect = el.getBoundingClientRect();
      // ctrl/pinch wheels report small deltas; scale them so a pinch is not sluggish.
      const dy = e.ctrlKey ? e.deltaY * 4 : e.deltaY;
      store.zoomAt(Math.exp(-dy * 0.002), e.clientX - rect.left);
    };
    el.addEventListener('wheel', onWheel, { passive: false });
    return () => el.removeEventListener('wheel', onWheel);
  }, [store]);

  const dateText = useMemo(() => {
    const chain = chronologyChain(store.dataset, state.chronologyId);
    const out = new Map<number, string>();
    for (const item of store.dataset.items) {
      const r = resolveItem(chain, item);
      if (r) out.set(item.id, formatSpan(r.date.start, r.date.end, r.date.precision, r.date.circa));
    }
    return out;
  }, [store, state.chronologyId]);

  const ticks = computeTicks(state.view, state.width);
  const total = AXIS_H + layout.height + 8;
  const shownH = height ?? total;
  const laneIndex = new Map(store.dataset.lanes.map((l, i) => [l.id, i]));

  const select = (id: number) => {
    store.select(id);
    onSelect?.(id);
  };

  const onKeyDown = (e: KeyboardEvent<SVGSVGElement>) => {
    const mid = state.width / 2;
    switch (e.key) {
      case 'ArrowLeft': store.panByPixels(KEY_PAN_PX); break;
      case 'ArrowRight': store.panByPixels(-KEY_PAN_PX); break;
      case '+': case '=': store.zoomAt(ZOOM_STEP, mid); break;
      case '-': case '_': store.zoomAt(1 / ZOOM_STEP, mid); break;
      case 'Home': store.fit(); break;
      default: return;
    }
    e.preventDefault();
  };

  const onPointerDown = (e: ReactPointerEvent<SVGSVGElement>) => {
    if (e.button !== undefined && e.button !== 0) return;
    drag.current = { id: e.pointerId, x: e.clientX, moved: 0 };
    suppressClick.current = false;
    try { svgRef.current?.setPointerCapture?.(e.pointerId); } catch { /* not capturable */ }
  };
  const onPointerMove = (e: ReactPointerEvent<SVGSVGElement>) => {
    const d = drag.current;
    if (!d || d.id !== e.pointerId) return;
    const dx = e.clientX - d.x;
    d.x = e.clientX;
    d.moved += Math.abs(dx);
    if (d.moved > 3) suppressClick.current = true;
    if (dx !== 0) store.panByPixels(dx);
  };
  const endDrag = (e: ReactPointerEvent<SVGSVGElement>) => {
    if (drag.current?.id === e.pointerId) drag.current = null;
  };

  return (
    <div ref={boxRef} className="kth-timeline-view" style={{ maxBlockSize: shownH, overflowY: shownH < total ? 'auto' : 'hidden' }}>
      <svg
        ref={svgRef}
        className="kth-timeline-view__svg"
        width={state.width}
        height={total}
        viewBox={`0 0 ${state.width} ${total}`}
        role="group"
        aria-label={labels.group}
        aria-description={labels.help}
        tabIndex={0}
        onKeyDown={onKeyDown}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={endDrag}
        onPointerCancel={endDrag}
      >
        <g aria-hidden="true">
          {ticks.map((t) => {
            const x = xOf(state.view, state.width, t.t);
            return (
              <g key={t.t}>
                <line className={t.major ? 'kth-timeline-grid kth-timeline-grid--major' : 'kth-timeline-grid'} x1={x} x2={x} y1={AXIS_H} y2={total} />
                <text className={t.major ? 'kth-timeline-tick-label kth-timeline-tick-label--major' : 'kth-timeline-tick-label'} x={x + 3} y={AXIS_H - 9}>
                  {t.label}
                </text>
              </g>
            );
          })}
          <line className="kth-timeline-axis" x1={0} x2={state.width} y1={AXIS_H} y2={AXIS_H} />
        </g>
        <g transform={`translate(0 ${AXIS_H})`}>
          {layout.lanes.map((ln) => {
            const key = ln.lane.colorKey ?? '';
            const cls = LANE_CLASS[key] ?? LANE_CYCLE[(laneIndex.get(ln.lane.id) ?? 0) % LANE_CYCLE.length];
            return (
              <g key={ln.lane.id} className={cls} data-lane={ln.lane.id} data-lane-color={key || undefined}>
                <text className="kth-timeline-lane-label" x={6} y={ln.y + 12} aria-hidden="true">{ln.lane.name}</text>
                {ln.marks.map((m) => {
                  const cy = m.y + m.h / 2;
                  const name = `${m.title}, ${dateText.get(m.itemId) ?? ''}`;
                  return (
                    <g
                      key={m.itemId}
                      className={m.dim ? 'kth-timeline-mark kth-timeline-mark--dim' : 'kth-timeline-mark'}
                      data-item-id={m.itemId}
                      data-kind={m.kind}
                      role="button"
                      tabIndex={0}
                      aria-label={name}
                      aria-pressed={m.selected}
                      onClick={() => {
                        if (suppressClick.current) return;
                        select(m.itemId);
                      }}
                      onKeyDown={(e) => {
                        if (e.key === 'Enter' || e.key === ' ') {
                          e.preventDefault();
                          e.stopPropagation();
                          select(m.itemId);
                        }
                      }}
                    >
                      {m.uncertainty.map((u, i) => (
                        <rect key={i} className="kth-timeline-band" x={u.x} y={m.y} width={u.w} height={m.h} />
                      ))}
                      {m.isSpan ? (
                        <rect className={shapeClass(m)} x={m.x} y={m.y} width={m.w} height={m.h} rx={3} data-shape="bar" />
                      ) : (
                        <polygon
                          className={shapeClass(m)}
                          data-shape="diamond"
                          points={`${m.x + m.w / 2},${cy - m.h / 2} ${m.x + m.w},${cy} ${m.x + m.w / 2},${cy + m.h / 2} ${m.x},${cy}`}
                        />
                      )}
                      {m.labelVisible && (
                        <text className={m.labelInside ? 'kth-timeline-label kth-timeline-label--inside' : 'kth-timeline-label'} x={m.labelX} y={cy}>
                          {m.title}
                        </text>
                      )}
                    </g>
                  );
                })}
              </g>
            );
          })}
        </g>
      </svg>
    </div>
  );
}
