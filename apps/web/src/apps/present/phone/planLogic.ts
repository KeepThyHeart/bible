/** Small pure helpers for the phone plan list. */

import type { HighlightRange } from '../../../present/protocol';

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
