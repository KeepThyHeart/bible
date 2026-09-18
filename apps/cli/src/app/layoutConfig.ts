/**
 * Named layout constants for the main screen's wide/narrow split, kept in one
 * place rather than as literals scattered through `Main.ts`.
 */

/** Terminal columns at or above which the Study pane sits beside the Bible
 * pane rather than replacing it. Below this, `s` swaps the whole screen. */
export const WIDE_BREAKPOINT_COLUMNS = 110;

/** Fraction of the body width the Study pane occupies in wide mode. */
export const STUDY_PANE_WIDTH_FRACTION = 0.44;

/** Columns spent on the vertical divider between the two panes (`" │ "`). */
export const PANE_SEPARATOR_WIDTH = 3;

/** Narrowest either pane is allowed to shrink to. */
export const MIN_PANE_WIDTH = 20;
