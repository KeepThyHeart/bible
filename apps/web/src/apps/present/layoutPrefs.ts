/**
 * The Presenter's remembered grid: how wide the Notes column is, and how tall
 * Control is inside the right column. Both are stored as fractions, so they
 * survive a window resize, per device in `localStorage`.
 *
 * Pure functions plus a thin storage wrapper, so the arithmetic is testable
 * without a DOM.
 */

export const LAYOUT_KEY = 'presenter-layout';

/** Full grid from this width; below it the Notes column narrows. */
export const FULL_GRID_MIN_WIDTH = 1100;
/** Under this width the phone layout takes over. */
export const PHONE_MAX_WIDTH = 760;

export const DEFAULT_NOTES_FRACTION = 0.5;
export const NARROW_NOTES_FRACTION = 0.42;

const MIN_NOTES = 0.25;
const MAX_NOTES = 0.75;
const MIN_CONTROL_PX = 140;
const MIN_PREVIEW_PX = 90;

export interface LayoutPrefs {
  /** Notes column share of the width, or null for "the default for this width". */
  notesFraction: number | null;
  /** Control's share of the right column's height, or null for "Preview is 16:9". */
  controlFraction: number | null;
}

export const EMPTY_PREFS: LayoutPrefs = { notesFraction: null, controlFraction: null };

const clamp = (value: number, min: number, max: number): number => Math.max(min, Math.min(max, value));

function fractionOrNull(value: unknown, min: number, max: number): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? clamp(value, min, max) : null;
}

export function parsePrefs(raw: string | null): LayoutPrefs {
  if (!raw) return EMPTY_PREFS;
  try {
    const parsed = JSON.parse(raw) as Partial<LayoutPrefs> | null;
    return {
      notesFraction: fractionOrNull(parsed?.notesFraction, MIN_NOTES, MAX_NOTES),
      controlFraction: fractionOrNull(parsed?.controlFraction, 0.1, 0.9),
    };
  } catch {
    return EMPTY_PREFS;
  }
}

export function loadPrefs(): LayoutPrefs {
  try {
    return parsePrefs(localStorage.getItem(LAYOUT_KEY));
  } catch {
    return EMPTY_PREFS;
  }
}

export function savePrefs(prefs: LayoutPrefs): void {
  try {
    localStorage.setItem(LAYOUT_KEY, JSON.stringify(prefs));
  } catch {
    // Private mode or blocked storage: the layout just is not remembered.
  }
}

/** Which of the three layouts a page width gets. */
export function layoutForWidth(width: number): 'full' | 'narrow' | 'phone' {
  if (width < PHONE_MAX_WIDTH) return 'phone';
  return width < FULL_GRID_MIN_WIDTH ? 'narrow' : 'full';
}

export function notesFractionFor(width: number, prefs: LayoutPrefs): number {
  if (prefs.notesFraction !== null) return clamp(prefs.notesFraction, MIN_NOTES, MAX_NOTES);
  return layoutForWidth(width) === 'narrow' ? NARROW_NOTES_FRACTION : DEFAULT_NOTES_FRACTION;
}

/** A dragged x position (relative to the grid's left edge) as a Notes fraction. */
export function notesFractionFromDrag(x: number, gridWidth: number): number {
  return gridWidth > 0 ? clamp(x / gridWidth, MIN_NOTES, MAX_NOTES) : DEFAULT_NOTES_FRACTION;
}

export interface RightRows { controlHeight: number; previewHeight: number }

/**
 * Split the right column's height between Control (top) and Preview (bottom).
 * With no remembered split the Preview is a 16:9 screen at the column's width
 * and Control takes the rest; a remembered split gives Control that share, and
 * the Preview then fits inside whatever is left.
 */
export function rightRows(width: number, height: number, controlFraction: number | null): RightRows {
  const usable = Math.max(0, height);
  const controlMin = Math.min(MIN_CONTROL_PX, usable / 2);
  let controlHeight: number;
  if (controlFraction === null) {
    controlHeight = usable - (width * 9) / 16;
  } else {
    controlHeight = usable * controlFraction;
  }
  controlHeight = clamp(controlHeight, controlMin, Math.max(controlMin, usable - Math.min(MIN_PREVIEW_PX, usable / 2)));
  return { controlHeight, previewHeight: usable - controlHeight };
}

/** A dragged y position (relative to the column's top edge) as Control's fraction. */
export function controlFractionFromDrag(y: number, columnHeight: number): number {
  return columnHeight > 0 ? clamp(y / columnHeight, 0.1, 0.9) : 0.5;
}

/** The largest 16:9 box that fits in a slot. */
export function fit16x9(width: number, height: number): { width: number; height: number } {
  const w = Math.max(0, Math.min(width, (height * 16) / 9));
  return { width: w, height: (w * 9) / 16 };
}
