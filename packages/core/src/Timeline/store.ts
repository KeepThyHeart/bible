import { createStore, type ReadableStore } from '../Ui/ReadableStore';
import { defaultChronologyId, resolveItems, type ResolvedItem } from './chronology';
import { layoutTimeline, packRows, type TimelineLayout } from './layout';
import { itemsForPassage } from './passages';
import { searchTimelineItems } from './search';
import { clampView, DEFAULT_SPAN_DAYS, fractionToView, MIN_SPAN_DAYS, minContextDays, panView, type TimeView, tOf, viewSpan, zoomView } from './scale';
import type { TimelineDataset } from './types';

export interface TimelineState {
  chronologyId: string;
  view: TimeView;
  width: number;
  selectedId: number | null;
  hiddenLanes: string[];
  /** null = all kinds. */
  kinds: string[] | null;
  query: string;
}

export interface TimelineStore extends ReadableStore<TimelineState> {
  readonly dataset: TimelineDataset;
  /** Items dated under the current chronology (with fallback). */
  getResolved(): ResolvedItem[];
  /** Whole-dataset bounds under the current chronology. */
  getBounds(): TimeView;
  /** Layout for the current state; the same object until the state changes. */
  getLayout(): TimelineLayout;
  setWidth(width: number): void;
  setChronology(id: string): void;
  zoomAt(factor: number, anchorX: number): void;
  panByPixels(dx: number): void;
  setView(view: TimeView): void;
  fit(): void;
  select(id: number | null): void;
  /** Select an item and frame it in the view (at least the store's minimum span, centred on the item). With `fitPrecision` (search jumps), day/hour-dated items frame at their own precision instead. */
  focusItem(id: number, opts?: { fitPrecision?: boolean }): void;
  /** Select the best item for a verse (follow-my-reading); false when none covers it. */
  focusPassage(verseId: number, verseIdEnd?: number): boolean;
  toggleLane(laneId: string): void;
  setKinds(kinds: string[] | null): void;
  setQuery(query: string): void;
  /** Resize the window about its centre (clamped to bounds and MIN_SPAN_DAYS). */
  setSpan(span: number): void;
  /** Move one edge of the window to instant `t` (clamped to the bounds; never crosses the other edge). */
  setEdge(edge: 'start' | 'end', t: number): void;
  /** Slide the window, keeping its span, so it starts at `start` (clamped to the bounds). */
  panTo(start: number): void;
  /** Slide the window: 0 = left edge of the bounds, 1 = right edge. */
  setCenterFraction(f: number): void;
  /** Ranked title/summary search over the items dated under the current chronology. */
  search(query: string, limit?: number): ResolvedItem[];
}

export interface TimelineStoreOptions {
  chronologyId?: string;
  width?: number;
  /** Minimum span (days) framed by search jumps and follow-my-reading. Default DEFAULT_SPAN_DAYS. */
  minSpanDays?: number;
}

const FALLBACK_BOUNDS: TimeView = { start: 0, end: 365 };

export function createTimelineStore(dataset: TimelineDataset, options: TimelineStoreOptions = {}): TimelineStore {
  const chronologyId =
    options.chronologyId && dataset.chronologies.some((c) => c.id === options.chronologyId)
      ? options.chronologyId
      : defaultChronologyId(dataset) ?? '';

  const minSpanDays =
    options.minSpanDays !== undefined && Number.isFinite(options.minSpanDays) && options.minSpanDays > 0
      ? options.minSpanDays
      : DEFAULT_SPAN_DAYS;

  let resolved: ResolvedItem[] = [];
  let rows = new Map<number, number>();
  let bounds: TimeView = FALLBACK_BOUNDS;

  function prepare(chId: string): void {
    resolved = resolveItems(dataset, chId);
    rows = packRows(resolved);
    if (resolved.length === 0) {
      bounds = FALLBACK_BOUNDS;
      return;
    }
    let lo = Infinity;
    let hi = -Infinity;
    for (const r of resolved) {
      lo = Math.min(lo, r.date.startMin ?? r.date.start);
      hi = Math.max(hi, r.date.endMax ?? r.date.end ?? r.date.start);
    }
    const pad = Math.max((hi - lo) * 0.03, 30);
    bounds = { start: lo - pad, end: hi + pad };
  }
  prepare(chronologyId);

  const store = createStore<TimelineState>({
    chronologyId,
    view: bounds,
    width: options.width ?? 800,
    selectedId: null,
    hiddenLanes: [],
    kinds: null,
    query: '',
  });

  let layoutCache: { state: TimelineState; layout: TimelineLayout } | null = null;
  const update = (patch: Partial<TimelineState>): void => store.setState((s) => ({ ...s, ...patch }));
  const state = (): TimelineState => store.getSnapshot();

  const self: TimelineStore = {
    dataset,
    subscribe: store.subscribe,
    getSnapshot: store.getSnapshot,
    getResolved: () => resolved,
    getBounds: () => bounds,
    getLayout() {
      const s = state();
      if (layoutCache?.state === s) return layoutCache.layout;
      const layout = layoutTimeline(
        resolved,
        dataset.lanes,
        s.view,
        {
          width: s.width,
          kinds: s.kinds ? new Set(s.kinds) : null,
          hiddenLanes: new Set(s.hiddenLanes),
          query: s.query,
          selectedId: s.selectedId,
        },
        rows
      );
      layoutCache = { state: s, layout };
      return layout;
    },
    setWidth(width) {
      if (width > 0 && width !== state().width) update({ width });
    },
    setChronology(id) {
      if (id === state().chronologyId || !dataset.chronologies.some((c) => c.id === id)) return;
      prepare(id);
      update({ chronologyId: id, view: clampView(state().view, bounds) });
    },
    zoomAt(factor, anchorX) {
      const s = state();
      update({ view: zoomView(s.view, factor, tOf(s.view, s.width, anchorX), bounds) });
    },
    panByPixels(dx) {
      const s = state();
      update({ view: panView(s.view, -(dx / s.width) * viewSpan(s.view), bounds) });
    },
    setView(view) {
      update({ view: clampView(view, bounds) });
    },
    fit() {
      update({ view: bounds });
    },
    select(id) {
      update({ selectedId: id });
    },
    focusItem(id, opts) {
      const r = resolved.find((x) => x.item.id === id);
      if (!r) return;
      const start = r.date.start;
      const end = r.date.end ?? start;
      // With fitPrecision, frame a day/hour-dated item at its own precision; otherwise at least the
      // configured minimum span (and 1.5x the item), centred on the item.
      const fine = !!opts?.fitPrecision && (r.date.precision === 'day' || r.date.precision === 'hour');
      const span = Math.max(minContextDays(r.date.precision), (end - start) * 1.5, MIN_SPAN_DAYS, fine ? 0 : minSpanDays);
      const mid = (start + end) / 2;
      update({ selectedId: id, view: clampView({ start: mid - span / 2, end: mid + span / 2 }, bounds) });
    },
    focusPassage(verseId, verseIdEnd) {
      const dated = new Set(resolved.map((r) => r.item.id));
      const hit = itemsForPassage(dataset, verseId, verseIdEnd).find((i) => dated.has(i.id));
      if (!hit) return false;
      // Already selected: keep the user's zoom and pan.
      if (hit.id === state().selectedId) return true;
      self.focusItem(hit.id);
      return true;
    },
    toggleLane(laneId) {
      const hidden = state().hiddenLanes;
      update({ hiddenLanes: hidden.includes(laneId) ? hidden.filter((l) => l !== laneId) : [...hidden, laneId] });
    },
    setKinds(kinds) {
      update({ kinds });
    },
    setQuery(query) {
      update({ query });
    },
    setSpan(span) {
      const v = state().view;
      const mid = (v.start + v.end) / 2;
      const next = Math.max(span, MIN_SPAN_DAYS);
      update({ view: clampView({ start: mid - next / 2, end: mid + next / 2 }, bounds) });
    },
    setEdge(edge, t) {
      const v = state().view;
      if (!Number.isFinite(t)) return;
      const next =
        edge === 'start'
          ? { start: Math.min(Math.max(t, bounds.start), v.end - MIN_SPAN_DAYS), end: v.end }
          : { start: v.start, end: Math.max(Math.min(t, bounds.end), v.start + MIN_SPAN_DAYS) };
      update({ view: clampView(next, bounds) });
    },
    panTo(start) {
      const v = state().view;
      if (!Number.isFinite(start)) return;
      update({ view: clampView({ start, end: start + viewSpan(v) }, bounds) });
    },
    setCenterFraction(f) {
      const v = state().view;
      if (viewSpan(v) >= viewSpan(bounds)) return;
      update({ view: fractionToView(f, viewSpan(v), bounds) });
    },
    search(query, limit = 20) {
      return searchTimelineItems(resolved, query, limit);
    },
  };
  return self;
}
