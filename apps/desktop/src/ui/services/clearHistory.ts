/**
 * "Clear history" (task 0224): forget what the reader searched for and where
 * they read, without touching anything they made.
 *
 * Closes every search tab (and empties the search box and its suggestions),
 * and leaves each Bible pane with only the passage it is showing: its history
 * list and Back stack are emptied. Notes, highlights, bookmarks and
 * reading-plan progress are not touched.
 *
 * Other lists of this kind (the "Recent versions" picker, on another branch)
 * should be cleared from here once they exist on this one.
 */
import { useBibleStore } from '../stores/bible/useBibleStore';
import { useLayoutStore } from '../stores/useLayoutStore';
import { useSearchStore } from '../stores/useSearchStore';
import { useSessionStore } from '../stores/useSessionStore';

export function clearHistory(): void {
  useLayoutStore.getState().closeSearchResultsPanels();

  // Anything the panels did not take with them (a session without a tab).
  const search = useSearchStore.getState();
  const ids = [search.activeSessionId, ...Object.keys(search.parkedSessions)].filter((id): id is string => !!id);
  for (const id of ids) useSearchStore.getState().closeSession(id);
  useSearchStore.getState().clearSearch();

  useBibleStore.getState().clearAllHistory();

  // The saved session must lose them now, not at the next change.
  useSessionStore.getState().markDirty();
}
