import type { ResolvedItem } from './chronology';
import type { TimelineLaneDto } from './types';
import { type TimeView, viewSpan, xOf } from './scale';

/** Case- and accent-insensitive form used by search and the dim filter. */
export const fold = (s: string): string => s.normalize('NFD').replace(/\p{M}/gu, '').toLowerCase().trim();

export interface LayoutOptions {
  width: number;
  rowHeight?: number;
  laneGap?: number;
  laneHeaderHeight?: number;
  /** Show only these kinds (null/undefined = all). */
  kinds?: ReadonlySet<string> | null;
  hiddenLanes?: ReadonlySet<string>;
  /** Items not matching are dimmed, not removed. */
  query?: string;
  selectedId?: number | null;
  /** Approximate pixels per label character. */
  charPx?: number;
}

export interface Mark {
  itemId: number;
  laneId: string;
  kind: string;
  isSpan: boolean;
  title: string;
  row: number;
  x: number;
  y: number;
  w: number;
  h: number;
  /** Uncertainty bands (pixels, absolute x) drawn faded beside the solid bar. */
  uncertainty: { x: number; w: number }[];
  circa: boolean;
  viaFallback: boolean;
  selected: boolean;
  dim: boolean;
  labelVisible: boolean;
  /** Where the label starts and whether it sits inside the bar or after the mark. */
  labelX: number;
  labelInside: boolean;
}

export interface LaneLayout {
  lane: TimelineLaneDto;
  y: number;
  height: number;
  rows: number;
  marks: Mark[];
}

export interface TimelineLayout {
  height: number;
  lanes: LaneLayout[];
  /** Marks skipped because they were off-screen or sub-pixel. */
  culled: number;
}

const DAY = 1;

/**
 * Assign each item a row inside its lane, in TIME space, so rows do not
 * jump while the user zooms. Points occupy one day so distinct days can share
 * a row. Returns itemId -> row.
 */
export function packRows(resolved: readonly ResolvedItem[]): Map<number, number> {
  const rows = new Map<number, number>();
  const byLane = new Map<string, ResolvedItem[]>();
  for (const r of resolved) {
    const list = byLane.get(r.item.laneId) ?? [];
    list.push(r);
    byLane.set(r.item.laneId, list);
  }
  for (const list of byLane.values()) {
    list.sort((a, b) => a.date.start - b.date.start || (b.date.end ?? b.date.start) - (a.date.end ?? a.date.start) || a.item.id - b.item.id);
    const rowEnd: number[] = [];
    for (const r of list) {
      const start = r.date.start;
      const end = r.date.end !== undefined ? r.date.end : start + DAY;
      let row = rowEnd.findIndex((e) => e <= start);
      if (row < 0) {
        row = rowEnd.length;
        rowEnd.push(end);
      } else {
        rowEnd[row] = end;
      }
      rows.set(r.item.id, row);
    }
  }
  return rows;
}

/** Lay the resolved items out for a view and pixel width. Pure. */
export function layoutTimeline(
  resolved: readonly ResolvedItem[],
  lanes: readonly TimelineLaneDto[],
  view: TimeView,
  opts: LayoutOptions,
  rows: Map<number, number> = packRows(resolved)
): TimelineLayout {
  const rowHeight = opts.rowHeight ?? 26;
  const laneGap = opts.laneGap ?? 10;
  const header = opts.laneHeaderHeight ?? 18;
  const charPx = opts.charPx ?? 6.5;
  const width = opts.width;
  const q = opts.query ? fold(opts.query) : '';
  const barH = Math.round(rowHeight * 0.7);
  const span = viewSpan(view);
  const out: LaneLayout[] = [];
  let y = 0;
  let culled = 0;

  const sortedLanes = [...lanes].sort((a, b) => a.sortOrder - b.sortOrder);
  for (const lane of sortedLanes) {
    if (opts.hiddenLanes?.has(lane.id)) continue;
    const items = resolved.filter((r) => r.item.laneId === lane.id && (!opts.kinds || opts.kinds.has(r.item.kind)));
    if (items.length === 0) continue;
    const marks: Mark[] = [];
    const ordered = [...items].sort((a, b) => a.date.start - b.date.start || a.item.id - b.item.id);
    for (const r of ordered) {
      const packed = rows.get(r.item.id) ?? 0;
      const isSpan = r.date.end !== undefined;
      const x0 = xOf(view, width, r.date.start);
      const x1 = isSpan ? xOf(view, width, r.date.end as number) : x0;
      const selected = opts.selectedId === r.item.id;
      const visible = x1 >= -20 && x0 <= width + 20;
      const rawW = x1 - x0;
      if (!visible || (isSpan && rawW < 0.5 && !selected)) {
        culled += 1;
        continue;
      }
      const w = isSpan ? Math.max(rawW, 2) : 12;
      const x = isSpan ? x0 : x0 - 6;
      const text = r.item.title;
      const uncertainty: { x: number; w: number }[] = [];
      const d = r.date;
      if (d.startMin !== undefined || d.startMax !== undefined) {
        const a = xOf(view, width, d.startMin ?? d.start);
        const b = xOf(view, width, d.startMax ?? d.start);
        if (b - a > 0.5) uncertainty.push({ x: a, w: b - a });
      }
      if (isSpan && (d.endMin !== undefined || d.endMax !== undefined)) {
        const a = xOf(view, width, d.endMin ?? (d.end as number));
        const b = xOf(view, width, d.endMax ?? (d.end as number));
        if (b - a > 0.5) uncertainty.push({ x: a, w: b - a });
      }
      const matches = !q || fold(text).includes(q) || fold(r.item.summary ?? '').includes(q);
      marks.push({
        itemId: r.item.id,
        laneId: lane.id,
        kind: r.item.kind,
        isSpan,
        title: text,
        row: packed,
        x,
        y: 0,
        w,
        h: barH,
        uncertainty,
        circa: r.date.circa,
        viaFallback: r.viaFallback,
        selected,
        dim: !matches,
        labelVisible: false,
        labelX: 0,
        labelInside: false,
      });
    }

    // Compact the packed rows of the visible marks into dense rows, so empty rows take no space.
    const usedRows = [...new Set(marks.map((m) => m.row))].sort((a, b) => a - b);
    const dense = new Map(usedRows.map((row, i) => [row, i]));
    for (const m of marks) {
      m.row = dense.get(m.row) ?? 0;
      m.y = y + header + m.row * rowHeight + (rowHeight - barH) / 2;
    }
    const laneRows = Math.max(usedRows.length, 1);

    // Labels: inside a wide-enough bar, else after the mark when clear of the previous label and the next mark.
    const nextX: number[] = new Array(marks.length).fill(Infinity);
    const seenX = new Map<number, number>();
    for (let i = marks.length - 1; i >= 0; i--) {
      nextX[i] = seenX.get(marks[i].row) ?? Infinity;
      seenX.set(marks[i].row, marks[i].x);
    }
    const labelEnd: number[] = []; // per row: right edge of the last outside label drawn
    marks.forEach((m, i) => {
      const labelPx = m.title.length * charPx + 8;
      if (m.isSpan) {
        const left = Math.max(m.x, 0);
        const right = Math.min(m.x + m.w, width);
        if (right - left >= labelPx) {
          m.labelVisible = true;
          m.labelInside = true;
          m.labelX = left + 4;
          return;
        }
      }
      const lx = m.x + m.w + 4;
      if ((labelEnd[m.row] ?? -Infinity) + 4 <= lx && lx + labelPx < nextX[i] && lx + labelPx <= width) {
        m.labelVisible = true;
        m.labelX = lx;
        labelEnd[m.row] = lx + labelPx;
      }
    });
    const height = header + laneRows * rowHeight;
    out.push({ lane, y, height, rows: laneRows, marks });
    y += height + laneGap;
  }
  void span;
  return { height: Math.max(y - laneGap, 0), lanes: out, culled };
}
