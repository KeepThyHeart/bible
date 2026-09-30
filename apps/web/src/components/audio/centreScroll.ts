export interface CentreInput {
  scrollTop: number;
  /** Viewport top of the scroller. */
  scrollerTop: number;
  clientHeight: number;
  /** Viewport top of the verse. */
  verseTop: number;
  verseHeight: number;
  scrollHeight: number;
}

/** Where to scroll the scroller so the verse sits in its middle (or, when taller than it, starts near its top). */
export function centreTarget(i: CentreInput): number {
  const offset = i.scrollTop + (i.verseTop - i.scrollerTop);
  const t = i.verseHeight > i.clientHeight ? offset - 8 : offset - (i.clientHeight - i.verseHeight) / 2;
  return Math.min(Math.max(0, t), Math.max(0, i.scrollHeight - i.clientHeight));
}
