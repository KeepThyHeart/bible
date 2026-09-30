import { useEffect, useRef, useState } from 'preact/hooks';
import { EditorState, type Plugin } from 'prosemirror-state';
import { EditorView } from 'prosemirror-view';
import './editor.css';
import { buildPlugins } from './plugins';
import { docFromJSON, type ProseMirrorJSON } from './schema';
import { Toolbar, type InsertKind } from './Toolbar';

export { insertItemText } from './commands';
export { docToBlocks } from './docToBlocks';
export type { EditorBlock, EditorBlockMark } from './docToBlocks';
export type { ProseMirrorJSON } from './schema';
export type { InsertKind } from './Toolbar';

export interface NotesEditorProps {
  /** The saved document; null starts empty. Pass a different object (e.g. after opening another service) to replace the content. */
  doc: ProseMirrorJSON | null;
  /** Called on every document change with the new JSON. The host debounces saving. */
  onChange: (doc: ProseMirrorJSON) => void;
  /** Extra plugins (row 8 decorations). Appended after the core ones. */
  plugins?: Plugin[];
  /** "+ Insert" menu choice; the host shows its picker and calls insertItemText. */
  onInsertRequest?: (kind: InsertKind) => void;
  /** Ctrl/Cmd+Enter with the caret at document position `pos`. */
  onShowAtCaret?: (pos: number) => void;
  /** Called once with the view (and null on unmount). */
  onReady?: (view: EditorView | null) => void;
  class?: string;
}

/**
 * ProseMirror mounted in Preact. The editor owns the live document; `doc`
 * only seeds it and replaces it when the host hands over a different object
 * than the last one this editor emitted.
 */
export function NotesEditor(props: NotesEditorProps) {
  const host = useRef<HTMLDivElement>(null);
  const viewRef = useRef<EditorView | null>(null);
  const lastEmitted = useRef<ProseMirrorJSON | null>(null);
  const propsRef = useRef(props);
  propsRef.current = props;
  const [tick, setTick] = useState(0);
  const [view, setView] = useState<EditorView | null>(null);

  const makeState = (json: ProseMirrorJSON | null, extra?: Plugin[]) =>
    EditorState.create({
      doc: docFromJSON(json),
      plugins: buildPlugins(() => propsRef.current, extra ?? propsRef.current.plugins),
    });

  useEffect(() => {
    const v = new EditorView(host.current!, {
      state: makeState(props.doc),
      attributes: { class: 'notes-editor__content', spellcheck: 'true' },
      dispatchTransaction(tr) {
        const next = v.state.apply(tr);
        v.updateState(next);
        if (tr.docChanged) {
          const json = next.doc.toJSON() as ProseMirrorJSON;
          lastEmitted.current = json;
          propsRef.current.onChange(json);
        }
        setTick((n) => n + 1);
      },
    });
    viewRef.current = v;
    lastEmitted.current = props.doc;
    setView(v);
    props.onReady?.(v);
    return () => {
      props.onReady?.(null);
      v.destroy();
      viewRef.current = null;
    };
  }, []);

  // The host opened a different document.
  useEffect(() => {
    const v = viewRef.current;
    if (!v || props.doc === lastEmitted.current) return;
    lastEmitted.current = props.doc;
    v.updateState(makeState(props.doc));
    setTick((n) => n + 1);
  }, [props.doc]);

  // Row 8 swaps its decoration plugins in and out.
  useEffect(() => {
    const v = viewRef.current;
    if (!v) return;
    v.updateState(v.state.reconfigure({ plugins: buildPlugins(() => propsRef.current, props.plugins) }));
  }, [props.plugins]);

  return (
    <div class={`notes-editor${props.class ? ` ${props.class}` : ''}`}>
      <Toolbar view={view} tick={tick} onInsertRequest={props.onInsertRequest} />
      <div class="notes-editor__scroll" ref={host} />
    </div>
  );
}

export default NotesEditor;
