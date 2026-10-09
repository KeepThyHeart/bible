import type { Node as PMNode } from 'prosemirror-model';
import { EditorState, Plugin, type Transaction } from 'prosemirror-state';
import { notesSchema, type ProseMirrorJSON } from './schema';

/**
 * Stable block identity. Every paragraph and heading carries a `blockId`
 * attribute so detected items and plan entries stay attached to their block
 * while the user types above it. A missing id (new block) or a repeated one
 * (a split, or a paste of text copied from this document) is replaced; the
 * first occurrence in document order keeps its id.
 */

let counter = 0;

export function newBlockId(): string {
  counter += 1;
  return `b${Date.now().toString(36)}${counter.toString(36)}${Math.random().toString(36).slice(2, 6)}`;
}

/** Add ids to a transaction so every textblock that has a `blockId` attr has a unique one. */
export function assignBlockIds(doc: PMNode, tr: Transaction, makeId: () => string = newBlockId): boolean {
  const seen = new Set<string>();
  let changed = false;
  doc.descendants((node, pos) => {
    if (!node.isTextblock || !('blockId' in node.type.spec.attrs!)) return true;
    const id = node.attrs.blockId as string | null;
    if (!id || seen.has(id)) {
      tr.setNodeAttribute(pos, 'blockId', makeId());
      changed = true;
    } else {
      seen.add(id);
    }
    return false;
  });
  return changed;
}

export function blockIdPlugin(): Plugin {
  return new Plugin({
    appendTransaction(trs, _old, state) {
      if (!trs.some((tr) => tr.docChanged)) return null;
      const tr = state.tr;
      if (!assignBlockIds(state.doc, tr)) return null;
      // Bookkeeping, not an edit the user should be able to undo on its own.
      tr.setMeta('addToHistory', true);
      return tr;
    },
  });
}

/** Ensure ids on a saved document (used before the editor is ever mounted). Returns the same object if nothing changed. */
export function withBlockIds(json: ProseMirrorJSON): ProseMirrorJSON {
  let doc: PMNode;
  try {
    doc = notesSchema.nodeFromJSON(json);
  } catch {
    return json;
  }
  const tr = EditorState.create({ doc }).tr;
  return assignBlockIds(doc, tr) ? (tr.doc.toJSON() as ProseMirrorJSON) : json;
}
