import { useEffect } from 'react';

interface UsePopOutListenerArgs {
  panelId: string;
  isDetached: boolean;
  view: 'browser' | 'editor' | 'chapter';
  editorIsDirty: boolean;
  currentPath: string;
  handleSaveNote: () => void;
  loadDirectory: (path: string) => void;
  /** Chapter view: close the open row's editor (flushing it) but stay in Chapter mode. */
  deactivateChapter?: () => void;
}

/**
 * When the same panelId is popped out into a detached window, the in-place
 * pane closes its editor (saving first if dirty) so the note isn't being
 * edited in two windows simultaneously.
 */
export function usePopOutListener(args: UsePopOutListenerArgs): void {
  const { panelId, isDetached, view, editorIsDirty, currentPath, handleSaveNote, loadDirectory, deactivateChapter } = args;

  useEffect(() => {
    if (isDetached) return undefined;
    const handler = (e: Event) => {
      const detail = (e as CustomEvent).detail;
      if (detail?.panelId === panelId && view !== 'browser') {
        // Chapter view stays in place (it is the pane the reader docks back to), with no row being
        // edited in two windows at once.
        if (view === 'chapter') { deactivateChapter?.(); return; }
        if (view === 'editor' && editorIsDirty) handleSaveNote();
        loadDirectory(currentPath);
      }
    };
    window.addEventListener('notes-pane-popped-out', handler);
    return () => window.removeEventListener('notes-pane-popped-out', handler);
  }, [panelId, view, editorIsDirty, handleSaveNote, loadDirectory, currentPath, isDetached, deactivateChapter]);
}
