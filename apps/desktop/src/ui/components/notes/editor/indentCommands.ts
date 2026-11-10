import type { Editor } from '@tiptap/core';

/**
 * "Soft tab" used to indent paragraphs: non-breaking spaces survive the saved
 * HTML and actually render (a literal tab collapses to one space).
 */
export const SOFT_TAB = '    ';

function listItemType(editor: Editor): 'listItem' | 'taskItem' | null {
  if (editor.isActive('taskItem')) return 'taskItem';
  if (editor.isActive('listItem')) return 'listItem';
  return null;
}

/** Start positions of every textblock touched by the selection. */
function selectedBlockStarts(editor: Editor): number[] {
  const { from, to } = editor.state.selection;
  const starts: number[] = [];
  editor.state.doc.nodesBetween(from, to, (node, pos) => {
    if (node.isTextblock) {
      starts.push(pos + 1);
      return false;
    }
    return true;
  });
  return starts;
}

/** Indent: nest the list item, else prefix each selected paragraph with a soft tab. */
export function indentSelection(editor: Editor): boolean {
  const li = listItemType(editor);
  if (li) return editor.chain().focus().sinkListItem(li).run();
  const starts = selectedBlockStarts(editor);
  if (starts.length === 0) return false;
  const chain = editor.chain().focus();
  // Back to front so earlier positions stay valid.
  [...starts].reverse().forEach(pos => chain.insertContentAt(pos, SOFT_TAB));
  return chain.run();
}

/** Outdent: lift the list item, else strip up to one soft tab from each selected paragraph. */
export function outdentSelection(editor: Editor): boolean {
  const li = listItemType(editor);
  if (li) return editor.chain().focus().liftListItem(li).run();
  const { doc } = editor.state;
  const starts = selectedBlockStarts(editor);
  const chain = editor.chain().focus();
  let any = false;
  [...starts].reverse().forEach(pos => {
    const text = doc.textBetween(pos, Math.min(pos + SOFT_TAB.length, doc.content.size), '\n', '\n');
    const m = text.match(/^[  ]+/);
    if (m) {
      any = true;
      chain.deleteRange({ from: pos, to: pos + m[0].length });
    }
  });
  return any ? chain.run() : false;
}

/** Whether the selection can be outdented (drives the button's disabled state). */
export function canOutdent(editor: Editor): boolean {
  const li = listItemType(editor);
  if (li) return editor.can().liftListItem(li);
  const { doc } = editor.state;
  return selectedBlockStarts(editor).some(pos => /^[  ]/.test(doc.textBetween(pos, Math.min(pos + 1, doc.content.size))));
}
