/**
 * Layout numbers for the 2026 redesign's main screen (0001-bible-cli, question
 * 14): named constants rather than literals scattered through `Main.ts`, so an
 * `Options` screen can read (and later let the user adjust) them from one
 * place instead of a search-and-replace. Hard-coded for now, as agreed — no
 * settings UI for these yet.
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
