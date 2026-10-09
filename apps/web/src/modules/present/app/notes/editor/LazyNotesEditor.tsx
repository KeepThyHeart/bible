import { useEffect, useState } from 'preact/hooks';
import type { NotesEditorProps } from './NotesEditor';

/**
 * Loads ProseMirror only when the Presenter is opened, keeping it out of
 * the main bundle. Mount this from NotesPane instead of NotesEditor.
 */
export function LazyNotesEditor(props: NotesEditorProps) {
  const [Editor, setEditor] = useState<((p: NotesEditorProps) => preact.JSX.Element) | null>(null);
  useEffect(() => {
    let live = true;
    void import('./NotesEditor').then((m) => {
      // Wrapped in a function: setState would otherwise call the component.
      if (live) setEditor(() => m.NotesEditor);
    });
    return () => {
      live = false;
    };
  }, []);
  if (!Editor) return <div class="notes-editor notes-editor--loading" aria-busy="true" />;
  return <Editor {...props} />;
}
