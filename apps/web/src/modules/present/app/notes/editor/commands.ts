import { lift, setBlockType, toggleMark, wrapIn } from 'prosemirror-commands';
import { wrapInList } from 'prosemirror-schema-list';
import type { Command, EditorState } from 'prosemirror-state';
import { TextSelection } from 'prosemirror-state';
import type { EditorView } from 'prosemirror-view';
import { Fragment, Slice, type Node as PMNode } from 'prosemirror-model';
import type { PresentItem } from '../../../lib/protocol';
import type { PinAttrs } from '../types';
import { docFromJSON, notesSchema as s, type ProseMirrorJSON } from './schema';

export const toggleBold = toggleMark(s.marks.bold);
export const toggleItalic = toggleMark(s.marks.italic);

/** Cycle paragraph -> H1 -> H2 -> paragraph. */
export const cycleHeading: Command = (state, dispatch) => {
  const { $from } = state.selection;
  const parent = $from.parent;
  if (parent.type === s.nodes.heading) {
    return parent.attrs.level === 1
      ? setBlockType(s.nodes.heading, { level: 2 })(state, dispatch)
      : setBlockType(s.nodes.paragraph)(state, dispatch);
  }
  return setBlockType(s.nodes.heading, { level: 1 })(state, dispatch);
};

function inside(state: EditorState, name: string): boolean {
  const { $from } = state.selection;
  for (let d = $from.depth; d > 0; d--) if ($from.node(d).type.name === name) return true;
  return false;
}

function toggleList(listName: 'bullet_list' | 'ordered_list'): Command {
  return (state, dispatch) => {
    if (inside(state, listName)) return lift(state, dispatch);
    return wrapInList(s.nodes[listName])(state, dispatch);
  };
}

export const toggleBulletList = toggleList('bullet_list');
export const toggleOrderedList = toggleList('ordered_list');

export const toggleBlockquote: Command = (state, dispatch) =>
  inside(state, 'blockquote') ? lift(state, dispatch) : wrapIn(s.nodes.blockquote)(state, dispatch);

export function isMarkActive(state: EditorState, name: string): boolean {
  const { from, $from, to, empty } = state.selection;
  const type = s.marks[name];
  if (empty) return !!type.isInSet(state.storedMarks || $from.marks());
  return state.doc.rangeHasMark(from, to, type);
}

export function isBlockActive(state: EditorState, name: string, level?: number): boolean {
  const { $from } = state.selection;
  if (name === 'heading') {
    return $from.parent.type === s.nodes.heading && (level === undefined || $from.parent.attrs.level === level);
  }
  return inside(state, name);
}

/**
 * Put text into the notes. With the caret in the editor: at the caret
 * (newlines become line breaks). Otherwise: as new paragraph(s) at the end
 * (reusing a trailing empty paragraph), with the caret left after it.
 */
export function insertItemText(view: EditorView, text: string): void {
  const lines = text.split(/\r?\n/);
  const { state } = view;
  if (view.hasFocus()) {
    const nodes: PMNode[] = [];
    lines.forEach((line, i) => {
      if (i > 0) nodes.push(s.nodes.hard_break.create());
      if (line) nodes.push(s.text(line));
    });
    const tr = state.tr.replaceSelection(new Slice(Fragment.from(nodes), 0, 0));
    view.dispatch(tr.scrollIntoView());
    return;
  }
  const last = state.doc.lastChild!;
  const reuse = last.type === s.nodes.paragraph && last.content.size === 0;
  const paragraphs = lines.map((line) => s.nodes.paragraph.create(null, line ? s.text(line) : undefined));
  const tr = state.tr;
  if (reuse) tr.replaceWith(state.doc.content.size - last.nodeSize, state.doc.content.size, paragraphs);
  else tr.insert(state.doc.content.size, paragraphs);
  tr.setSelection(TextSelection.atEnd(tr.doc));
  view.dispatch(tr.scrollIntoView());
}

/** A text node for `label` carrying a `pin` mark that fixes the item it stands for. */
function pinnedText(label: string, item: PresentItem): PMNode {
  return s.text(label, [s.marks.pin.create({ choice: { item } })]);
}

/**
 * Put an item into the notes as its own label text, pinned to `item` so the
 * detector shows exactly that (right module, right hymn verses) whatever the
 * label says. At the caret when the editor has focus, otherwise as a new
 * paragraph at the end (reusing a trailing empty one).
 */
export function insertPinned(view: EditorView, label: string, item: PresentItem): void {
  const { state } = view;
  if (view.hasFocus()) {
    const tr = state.tr.replaceSelection(new Slice(Fragment.from(pinnedText(label, item)), 0, 0));
    view.dispatch(tr.scrollIntoView());
    return;
  }
  const last = state.doc.lastChild!;
  const reuse = last.type === s.nodes.paragraph && last.content.size === 0;
  const para = s.nodes.paragraph.create(null, pinnedText(label, item));
  const tr = state.tr;
  if (reuse) tr.replaceWith(state.doc.content.size - last.nodeSize, state.doc.content.size, para);
  else tr.insert(state.doc.content.size, para);
  tr.setSelection(TextSelection.atEnd(tr.doc));
  view.dispatch(tr.scrollIntoView());
}

/** `insertPinned` for a document with no editor mounted: returns the new document JSON. */
export function appendPinnedParagraph(json: ProseMirrorJSON | null, label: string, item: PresentItem): ProseMirrorJSON {
  const doc = docFromJSON(json);
  const last = doc.lastChild!;
  const reuse = last.type === s.nodes.paragraph && last.content.size === 0;
  const para = s.nodes.paragraph.create(null, pinnedText(label, item));
  const children: PMNode[] = [];
  doc.forEach((child, _offset, index) => {
    if (!(reuse && index === doc.childCount - 1)) children.push(child);
  });
  children.push(para);
  return s.topNodeType.create(null, children).toJSON() as ProseMirrorJSON;
}

/** Replace the pin/unlink marks over a range: `mode` 'pin' sets `choice`, 'unlink' marks it "not an item", 'clear' removes both. */
export function setChoiceMarks(
  view: EditorView,
  from: number,
  to: number,
  mode: { pin: PinAttrs } | 'unlink' | 'clear',
): void {
  const tr = view.state.tr.removeMark(from, to, s.marks.pin).removeMark(from, to, s.marks.unlink);
  if (mode === 'unlink') tr.addMark(from, to, s.marks.unlink.create());
  else if (mode !== 'clear') tr.addMark(from, to, s.marks.pin.create({ choice: mode.pin }));
  view.dispatch(tr);
}
