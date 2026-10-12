/**
 * Notes are plain text in the web editor and HTML in the database (desktop's `content_format: 'html'`), so text is
 * escaped into one `<p>` per line on save and flattened back on load. Formatting made in the desktop editor is shown
 * as text and is lost if the note is saved from the web.
 */
const ESC: Record<string, string> = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' };

export function textToHtml(text: string): string {
  const lines = text.replace(/\r\n?/g, '\n').split('\n');
  while (lines.length > 0 && lines[lines.length - 1].trim() === '') lines.pop();
  return lines.map((l) => `<p>${l.replace(/[&<>"]/g, (c) => ESC[c])}</p>`).join('');
}

export function htmlToText(html: string): string {
  return html
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<\/(p|div|li|h[1-6]|blockquote)>/gi, '\n')
    .replace(/<[^>]*>/g, '')
    .replace(/&nbsp;/g, ' ')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;|&apos;/g, "'")
    .replace(/&amp;/g, '&')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}
