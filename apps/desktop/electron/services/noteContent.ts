/**
 * Whether a note's content has nothing in it a user wrote: the empty editor
 * document, or one holding only blank paragraphs, headings and line breaks.
 * Anything else (an image, a table, a horizontal rule, any non-blank text)
 * counts as content, so an emptied note is only ever removed when there is
 * truly nothing to lose.
 *
 * Accepts the TipTap JSON document the editor saves, and the HTML string some
 * older notes hold.
 */
const BLANK_CONTAINERS = new Set(['doc', 'paragraph', 'heading', 'hardBreak']);

export function isEmptyNoteContent(content: unknown): boolean {
  if (content == null) return true;
  if (typeof content === 'string') {
    return content.replace(/<br\s*\/?>/gi, '').replace(/<\/?(p|h[1-6])(\s[^>]*)?>/gi, '').replace(/&nbsp;/g, ' ').trim() === '';
  }
  if (typeof content !== 'object') return false;
  const node = content as { type?: unknown; text?: unknown; content?: unknown };
  if (node.type === 'text') return typeof node.text !== 'string' || node.text.trim() === '';
  if (typeof node.type !== 'string' || !BLANK_CONTAINERS.has(node.type)) return false;
  if (node.content === undefined) return true;
  return Array.isArray(node.content) && node.content.every(isEmptyNoteContent);
}
