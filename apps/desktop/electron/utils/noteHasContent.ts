/**
 * Does a note have real content?
 *
 * One definition shared by the renderer (editor, marker logic) and the main
 * process (`BibleNotesFileService`, which decides what the Bible pane's verse
 * markers and the Verse Notes folder listing show). Pure and import-free so
 * both sides can load it.
 *
 * "Real content" = the note has non-whitespace text, or an embedded object
 * (image, table, rule, video...). An empty paragraph, `<p></p><p><br></p>`,
 * `&nbsp;` and zero-width characters do not count. `content` is either the
 * editor's HTML string (what the renderer saves) or a TipTap JSON document
 * (what `createNote` writes for a fresh file).
 */

const EMBED_TAGS = /<(img|table|hr|iframe|video|audio|svg|object|embed|canvas)\b/i;
const EMBED_NODE_TYPES = new Set([
  'image', 'table', 'horizontalRule', 'video', 'audio', 'iframe', 'embed',
]);
// Whitespace, nbsp, zero-width space/joiners, BOM.
const BLANK_CHARS = /[\s ​‌‍⁠﻿]/g;

function htmlHasContent(html: string): boolean {
  if (EMBED_TAGS.test(html)) return true;
  const text = html
    .replace(/<!--[\s\S]*?-->/g, '')
    .replace(/<[^>]*>/g, '')
    .replace(/&(nbsp|#160|#xa0|#8203|#x200b);/gi, '')
    .replace(BLANK_CHARS, '');
  return text.length > 0;
}

function jsonHasContent(node: unknown): boolean {
  if (!node || typeof node !== 'object') return false;
  const n = node as { type?: unknown; text?: unknown; content?: unknown };
  if (typeof n.type === 'string' && EMBED_NODE_TYPES.has(n.type)) return true;
  if (typeof n.text === 'string' && n.text.replace(BLANK_CHARS, '').length > 0) return true;
  return Array.isArray(n.content) && n.content.some(jsonHasContent);
}

export function noteHasContent(content: unknown): boolean {
  if (typeof content === 'string') return htmlHasContent(content);
  return jsonHasContent(content);
}
