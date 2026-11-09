import type { Node as ProseMirrorNode } from '@tiptap/pm/model';

export interface NoteFindRange {
  from: number;
  to: number;
}

/**
 * Every occurrence of `query` in the document's text nodes (pure; no view).
 * Matches never span two text nodes, so a match across a bold boundary is
 * missed - acceptable for a find-as-you-type bar and keeps positions exact.
 */
export function findNoteMatches(doc: ProseMirrorNode, query: string, caseSensitive: boolean): NoteFindRange[] {
  if (!query) return [];
  const needle = caseSensitive ? query : query.toLowerCase();
  const out: NoteFindRange[] = [];
  doc.descendants((node, pos) => {
    if (!node.isText || !node.text) return;
    const hay = caseSensitive ? node.text : node.text.toLowerCase();
    let i = hay.indexOf(needle);
    while (i !== -1) {
      out.push({ from: pos + i, to: pos + i + needle.length });
      i = hay.indexOf(needle, i + needle.length);
    }
  });
  return out;
}
