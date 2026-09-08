import { useLayoutStore } from '../../stores/useLayoutStore';
import { useBookStore } from '../../stores/useBookStore';
import { useDictionaryStore } from '../../stores/useDictionaryStore';

export interface MoveIntoBooksPaneRequest {
  type: 'book' | 'dictionary';
  abbreviation: string;
  /** Display name for the new tab. */
  name: string;
  /** Reading position to reopen at: section id for a book, entry key for a dictionary. */
  sectionId?: number | null;
  entryKey?: string | null;
  /** The single-module panel to close once the module has moved out of it. */
  sourcePanelId?: string;
}

/**
 * Move a module out of its own dockview panel and back into the multi-tab pane
 * for its kind - the return leg of "Open in own panel".
 *
 * Without it that gesture was one-way: the source tab is closed when the panel
 * is created, and the single panels had no way back, so undoing it meant
 * closing the panel and hunting the module down in the selector again, losing
 * the place you were reading.
 *
 * The reading position travels with it: the book reopens on its current
 * section and the dictionary on its current entry.
 *
 * Returns false when there is no dockview to add a pane to (the pane is
 * detached, or dockview has not mounted), in which case nothing is closed.
 */
export function moveIntoBooksPane(request: MoveIntoBooksPaneRequest): boolean {
  const layout = useLayoutStore.getState(); // allow-getstate: event handler - imperative panel lookup/creation outside render

  // A multi-tab pane is one with no contentKey; a panel *with* one is another
  // single-module panel (possibly this very one), which has no tab strip to
  // move into. The pane must also be of the module's own kind: books and
  // dictionaries render the same component but are segregated panes, so a
  // dictionary dropped into a Books pane would not be listed at all.
  let targetPanelId: string | null = null;
  for (const panel of layout.panels.values()) {
    if (panel.contentType === request.type && !panel.contentKey) {
      targetPanelId = panel.panelId;
      break;
    }
  }

  if (targetPanelId) {
    // Bring it forward: a pane hidden behind another tab in its group is as
    // good as absent to someone who just asked for their module to go there.
    layout.dockviewApi?.getPanel(targetPanelId)?.api.setActive();
  } else {
    targetPanelId = layout.addPanel(
      request.type,
      undefined,
      request.type === 'dictionary' ? 'Dictionary' : 'Books',
    );
  }

  if (!targetPanelId) return false;

  if (request.type === 'book') {
    const books = useBookStore.getState(); // allow-getstate: event handler - imperative cross-panel open
    books.openBook(
      targetPanelId,
      request.abbreviation,
      request.name,
      request.sectionId ?? undefined,
    );
  } else {
    const dictionaries = useDictionaryStore.getState(); // allow-getstate: event handler - imperative cross-panel open
    dictionaries.openDictionary(targetPanelId, request.abbreviation, request.name);
    if (request.entryKey) {
      void dictionaries.lookupEntry(targetPanelId, request.abbreviation, request.entryKey);
    }
  }

  // Closed last: this unmounts the component that called us.
  if (request.sourcePanelId) {
    layout.removePanel(request.sourcePanelId);
  }

  return true;
}
