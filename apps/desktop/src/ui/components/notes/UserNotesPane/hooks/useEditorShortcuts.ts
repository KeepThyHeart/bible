import { useEffect } from 'react';

interface UseEditorShortcutsArgs {
  view: 'browser' | 'editor';
  onSave: () => void;
  onSaveAs: () => void;
  onPrint: () => void;
}

/**
 * Wires Ctrl/Cmd+S, Ctrl/Cmd+Shift+S, and Ctrl/Cmd+P to the editor's
 * save / save-as / print actions while the editor view is active.
 */
export function useEditorShortcuts({ view, onSave, onSaveAs, onPrint }: UseEditorShortcutsArgs): void {
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (view !== 'editor') return;
      if ((e.ctrlKey || e.metaKey) && !e.shiftKey && e.key === 's') {
        e.preventDefault();
        onSave();
        return;
      }
      if ((e.ctrlKey || e.metaKey) && e.shiftKey && e.key.toLowerCase() === 's') {
        e.preventDefault();
        onSaveAs();
        return;
      }
      if ((e.ctrlKey || e.metaKey) && !e.shiftKey && e.key === 'p') {
        e.preventDefault();
        onPrint();
        return;
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [view, onSave, onSaveAs, onPrint]);
}
