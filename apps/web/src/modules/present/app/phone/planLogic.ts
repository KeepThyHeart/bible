/** Small pure helpers for the phone plan list. */

import type { HighlightRange, PresentItem } from '../../lib/protocol';

/** The index a row moves to for "Move up" / "Move down", or null at the ends. */
export function moveTarget(index: number, dir: 'up' | 'down', length: number): number | null {
  const to = dir === 'up' ? index - 1 : index + 1;
  return to < 0 || to >= length ? null : to;
}

/** The last item whose id was not in `before`: the one that just got added at the end. */
export function newestItem<T extends { id: string }>(before: ReadonlySet<string>, items: readonly T[]): T | undefined {
  for (let i = items.length - 1; i >= 0; i--) if (!before.has(items[i].id)) return items[i];
  return undefined;
}

/** A leftward swipe: far enough, and more horizontal than vertical. */
export function isSwipeLeft(dx: number, dy: number, threshold = 80): boolean {
  return dx <= -threshold && Math.abs(dx) > Math.abs(dy) * 1.5;
}

/** Whether `range` is exactly one of the wall's highlights (so a chip shows "on"). */
export function rangeOnWall(range: HighlightRange | null | undefined, wall: readonly HighlightRange[]): boolean {
  if (!range) return false;
  return wall.some(w =>
    w.verseIdStart === range.verseIdStart
    && w.textStart === range.textStart
    && (w.verseIdEnd ?? w.verseIdStart) === (range.verseIdEnd ?? range.verseIdStart)
    && (w.textEnd ?? w.textStart) === (range.textEnd ?? range.textStart));
}

/** Whether two items are the same thing to put on screen. */
export function sameItem(a: PresentItem | null | undefined, b: PresentItem | null | undefined): boolean {
  return !!a && !!b && JSON.stringify(a) === JSON.stringify(b);
}

/**
 * What to do with an item shown ad hoc: `add` it as a new row, or `reuse` the
 * newest row when it already holds the same item (no duplicate).
 */
export function adoptShown(
  item: PresentItem,
  plan: readonly { id: string; item?: PresentItem | null }[],
): { action: 'reuse'; id: string } | { action: 'add' } {
  const last = plan[plan.length - 1];
  return last && sameItem(last.item, item) ? { action: 'reuse', id: last.id } : { action: 'add' };
}

export interface OnScreenSummary {
  mode: 'empty' | 'hidden' | 'item';
  /** The reference, hymn title or quote start. */
  title: string;
  /** The current verse or first line, truncated; empty when unknown. */
  line: string;
}

function clip(text: string, max: number): string {
  const flat = text.replace(/\s+/g, ' ').trim();
  return flat.length > max ? `${flat.slice(0, max - 1)}…` : flat;
}

/** The text of the "On screen" card. `title` is the already-described reference. */
export function onScreenSummary(
  live: PresentItem | null,
  blanked: boolean,
  title: string | null,
  verseText?: string | null,
): OnScreenSummary {
  if (!live) return { mode: 'empty', title: '', line: '' };
  if (blanked) return { mode: 'hidden', title: title ?? '', line: '' };
  let line = '';
  if (live.kind === 'passage') line = clip(verseText ?? '', 120);
  else if (live.kind === 'quote') line = clip(live.text, 120);
  else if (live.kind === 'text') line = clip(live.body, 120);
  // A quote's title already is its start; do not repeat it.
  return { mode: 'item', title: live.kind === 'quote' ? (live.attribution ?? '') : title ?? '', line };
}
