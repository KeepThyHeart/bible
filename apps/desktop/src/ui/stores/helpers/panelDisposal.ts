import type { PanelContentType } from '../useLayoutStore';
import { useBookStore } from '../useBookStore';
import { useDictionaryStore } from '../useDictionaryStore';
import { useSearchStore } from '../useSearchStore';

/**
 * Discard the per-panel state belonging to a pane that has actually been closed.
 *
 * The counterpart to `detachPanel` (see `createPanelSlice`). Content stores used
 * to clear their state from the pane component's unmount cleanup, which fires
 * for reasons that have nothing to do with the pane closing - a tab switch
 * inside `BookPane`, a StrictMode double-invoke, a layout preset rebuilding the
 * grid. Dockview's `onDidRemovePanel` is the only event that means the pane is
 * genuinely gone, so it is the only thing allowed to delete state.
 *
 * Books and dictionaries are cleared together on purpose: both content types
 * are rendered by a single `BookPane`, so one dockview panel owns an entry in
 * each store and removing that panel has to drop both.
 *
 * Search is here for a different reason: its state is not per-panel but global
 * (one query, one result set), and the pane's own X button already clears it.
 * Closing the same pane by its dockview tab x ran nothing search-specific, so
 * the results - and therefore the count badge on the search bar, which is
 * derived from them - outlived the pane that could show them.
 *
 * Stores whose panes are dockview panel roots in their own right (bible,
 * commentary, notes, study, topics) still clear on unmount; for them unmount
 * and removal coincide. They are not routed through here yet - see
 * `books.md` / `dictionary.md`.
 */
export function destroyPanelState(
  panelId: string,
  contentType: PanelContentType | undefined
): void {
  if (contentType === 'search') {
    // allow-getstate: dockview event callback - runs outside React render
    useSearchStore.getState().clearResults();
    return;
  }

  if (contentType !== 'book' && contentType !== 'dictionary') return;

  // allow-getstate: dockview event callback - runs outside React render
  useBookStore.getState().destroyPanel(panelId);
  // allow-getstate: dockview event callback - runs outside React render
  useDictionaryStore.getState().destroyPanel(panelId);
}
