import { marked } from 'marked';

// Configure marked for commentary content
marked.setOptions({
  gfm: true,
  breaks: true,
});

/**
 * Convert Markdown content to HTML for rendering in commentary panes.
 *
 * marked escapes characters like " to &quot; in text nodes. Since the output
 * passes through processCommentaryLinks (which applies its own escapeHtml on
 * text segments), those entities would get double-encoded (&amp;quot;) and
 * render literally. We decode entities in text nodes only (not inside tags)
 * so the downstream escaping produces the correct single-encoded entities.
 */
export function renderMarkdownToHtml(markdown: string): string {
  if (!markdown) return '';
  let html = marked.parse(markdown) as string;
  // Strip leading H1 — synthesis commentaries start with a redundant verse
  // identifier heading (e.g. "Genesis 1:1 Commentary Synthesis") that is
  // already shown by the commentary-entry__ref element.
  html = html.replace(/^\s*<h1>.*?<\/h1>\s*/i, '');
  // Decode HTML entities in text nodes only (not inside HTML tags),
  // so processCommentaryLinks' escapeHtml re-encodes them exactly once.
  const segments = html.split(/(<[^>]+>)/);
  return segments.map(seg => {
    if (seg.startsWith('<')) return seg; // HTML tag — leave as-is
    return seg
      .replace(/&amp;/g, '&')
      .replace(/&lt;/g, '<')
      .replace(/&gt;/g, '>')
      .replace(/&quot;/g, '"')
      .replace(/&#39;/g, "'");
  }).join('');
}
