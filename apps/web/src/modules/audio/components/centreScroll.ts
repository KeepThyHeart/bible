export interface CentreInput {
  scrollTop: number;
  /** Viewport top of the scroller. */
  scrollerTop: number;
  clientHeight: number;
  /** Viewport top of the verse. */
  verseTop: number;
  verseHeight: number;
  scrollHeight: number;
  /** Where the verse's middle sits, as a fraction of the pane height from its top. Default 0.5. */
  anchor?: number;
}

/** The pane's anchor line: the phone centres the verse being read; the desktop pop-up sits it a little higher. */
export const ANCHOR = { phone: 0.5, popup: 0.33 } as const;

/**
 * Where to scroll the scroller so the verse's middle sits on the anchor line (or, when taller than the pane,
 * starts near its top). The pane pads its ends (see `endPadding`) so the first and last verses can reach it too.
 */
export function centreTarget(i: CentreInput): number {
  const anchor = i.anchor ?? 0.5;
  const offset = i.scrollTop + (i.verseTop - i.scrollerTop);
  const t = i.verseHeight > i.clientHeight ? offset - 8 : offset - (i.clientHeight * anchor - i.verseHeight / 2);
  return Math.min(Math.max(0, t), Math.max(0, i.scrollHeight - i.clientHeight));
}

/** Spacer heights (px) above the first and below the last verse, so either can be scrolled to the anchor line. */
export function endPadding(clientHeight: number, anchor: number): { top: number; bottom: number } {
  return { top: Math.round(clientHeight * anchor), bottom: Math.round(clientHeight * (1 - anchor)) };
}
