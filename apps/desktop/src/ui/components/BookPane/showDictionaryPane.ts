/**
 * Ask the `BookPane` that owns `panelId` to bring a just-opened dictionary tab
 * into view.
 *
 * The pane's Overview shelf covers its whole content area, and whether the
 * shelf is showing is local component state, not store state - it is a view
 * concern, and two panes should be able to differ. So a caller that opens a
 * dictionary tab from outside the pane (the Strong's-number click in
 * `useVerseInteractionHandlers`) has no way to reach that state directly, and
 * without this the tab it just opened sat hidden behind the shelf, which read
 * as the click having done nothing.
 *
 * A DOM event rather than a store field for exactly that reason, and because it
 * is a one-shot instruction rather than a piece of state worth persisting. The
 * `panelId` in the detail is what lets a specific pane act on it while any
 * other pane on screen ignores it.

 */
export const SHOW_DICTIONARY_PANE_EVENT = 'bible:show-dictionary-pane';

export interface ShowDictionaryPaneDetail {
  /** The dockview panel id of the Dictionary pane that should reveal its tab. */
  panelId: string;
}
