/**
 * Named layout constants for the main screen's two-pane design, kept in one
 * place rather than as literals scattered through `Main.ts`.
 *
 * The two panes are not symmetric. The **main** pane (left) is the passage —
 * the Bible text in reading mode, or the open study resource in study mode —
 * and wants as much width as the terminal can spare. The **right** pane is a
 * sidebar: the current verse, then the shortcut legend for whatever is
 * active. It is fixed-width because its content is fixed-width — a verse
 * reference and a column of `key  description` rows do not benefit from
 * stretching the way prose does.
 */

/**
 * Terminal columns at or above which the right-hand pane is drawn.
 *
 * Below this there is no room for a `RIGHT_PANE_WIDTH`-column sidebar without
 * crowding the reading column down to something uncomfortable, so the pane is
 * dropped entirely and the footer's one-line hint carries the shortcuts
 * instead — the same trade a narrow terminal already makes for the header's
 * tab strip.
 */
export const RIGHT_PANE_BREAKPOINT_COLUMNS = 96;

/**
 * Fixed width of the right-hand pane.
 *
 * Wide enough for a verse reference (`John 3:16`), a couple of lines of its
 * text, and a `↑↓  scroll study` legend line without wrapping mid-word;
 * narrow enough that the main pane keeps the reading width it had before this
 * pane existed.
 */
export const RIGHT_PANE_WIDTH = 28;

/** Columns spent on the vertical divider between the two panes (`" │ "`). */
export const PANE_SEPARATOR_WIDTH = 3;

/** Narrowest either pane is allowed to shrink to. */
export const MIN_PANE_WIDTH = 20;
