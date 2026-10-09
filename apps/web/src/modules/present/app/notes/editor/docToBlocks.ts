import type { EditorState } from 'prosemirror-state';
import type { Node as PMNode } from 'prosemirror-model';
import type { NotesBlock, NotesBlockKind, NotesMark, NotesMarkType, PinAttrs } from '../types';

/**
 * ProseMirror -> the detection engine's `NotesBlock` list (see ../types.ts).
 * `pos` is the position of the block's opening token; mark offsets are
 * character offsets within `text`; a hard break counts as one "\n" character
 * (the only inline leaf in the schema), so offsets line up with document
 * positions: doc position = `block.pos + 1 + offset`.
 *
 * `id` is the block's `blockId` attribute (assigned by blockIds.ts), `group`
 * the position of the enclosing blockquote for its paragraphs.
 */
export type BlockKind = NotesBlockKind;
export type BlockMarkType = NotesMarkType;
export type EditorBlockMark = NotesMark;
export type EditorBlock = NotesBlock;

const TRACKED: Record<string, NotesMarkType> = { bold: 'bold', pin: 'pin', unlink: 'unlink' };

function sameAttrs(a: unknown, b: unknown): boolean {
  return JSON.stringify(a ?? null) === JSON.stringify(b ?? null);
}

function blockKind(block: PMNode, parent: PMNode | null): NotesBlockKind {
  if (block.type.name === 'heading') return 'heading';
  if (parent?.type.name === 'list_item') return 'listItem';
  if (parent?.type.name === 'blockquote') return 'blockquote';
  return 'paragraph';
}

export function docToBlocks(state: Pick<EditorState, 'doc'>): NotesBlock[] {
  const blocks: NotesBlock[] = [];
  const quotePos = new Map<PMNode, number>();
  state.doc.descendants((node, pos, parent) => {
    if (node.type.name === 'blockquote') quotePos.set(node, pos);
    if (!node.isTextblock) return true;
    let text = '';
    const marks: NotesMark[] = [];
    // Open marks by type, so adjacent text nodes with the same mark merge.
    const open = new Map<NotesMarkType, NotesMark>();
    node.forEach((child) => {
      const start = text.length;
      text += child.isText ? child.text! : '\n';
      const end = text.length;
      const present = new Set<NotesMarkType>();
      for (const mark of child.marks) {
        const type = TRACKED[mark.type.name];
        if (!type) continue;
        present.add(type);
        const attrs = type === 'pin' ? (mark.attrs.choice as PinAttrs | null) ?? undefined : undefined;
        const current = open.get(type);
        if (current && current.to === start && sameAttrs(current.attrs, attrs)) {
          current.to = end;
        } else {
          const entry: NotesMark = { from: start, to: end, type };
          if (type === 'pin') entry.attrs = attrs;
          open.set(type, entry);
          marks.push(entry);
        }
      }
      for (const type of [...open.keys()]) if (!present.has(type)) open.delete(type);
    });
    const kind = blockKind(node, parent);
    const block: NotesBlock = { pos, text, kind, marks };
    const id = node.attrs.blockId as string | null | undefined;
    if (id) block.id = id;
    if (kind === 'blockquote' && parent) block.group = quotePos.get(parent);
    blocks.push(block);
    return false;
  });
  return blocks;
}
