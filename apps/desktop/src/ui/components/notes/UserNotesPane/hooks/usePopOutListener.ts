import { useEffect } from 'react';

interface UsePopOutListenerArgs {
  panelId: string;
  isDetached: boolean;
  view: 'browser' | 'editor';
  editorIsDirty: boolean;
  currentPath: string;
  handleSaveNote: () => void;
  loadDirectory: (path: string) => void;
}

/**
 * When the same panelId is popped out into a detached window, the in-place
 * pane closes its editor (saving first if dirty) so the note isn't being
 * edited in two windows simultaneously.
 */
export function usePopOutListener(args: UsePopOutListenerArgs): void {
  const { panelId, isDetached, view, editorIsDirty, currentPath, handleSaveNote, loadDirectory } = args;

  useEffect(() => {
    if (isDetached) return undefined;
    const handler = (e: Event) => {
      const detail = (e as CustomEvent).detail;
      if (detail?.panelId === panelId && view === 'editor') {
        if (editorIsDirty) handleSaveNote();
        loadDirectory(currentPath);
      }
    };
    window.addEventListener('notes-pane-popped-out', handler);
    return () => window.removeEventListener('notes-pane-popped-out', handler);
  }, [panelId, view, editorIsDirty, handleSaveNote, loadDirectory, currentPath, isDetached]);
}
