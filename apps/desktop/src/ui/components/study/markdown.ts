/**
 * Minimal Markdown renderer for module content.
 *
 * Some commentary modules ship Markdown rather than HTML - the bundled
 * `SYNTHESIS` digest declares `content_format: "markdown"` in its module
 * metadata and its entries are written with Setext headings, ATX headings and
 * bullet lists. Rendered raw, that text reaches the reader as `====` rules and
 * literal asterisks.
 *
 * The web app solves this with `marked` (see
 * `apps/web/src/utils/markdownRenderer.ts`). The desktop package does not
 * depend on `marked`, and adding a dependency for the handful of constructs the
 * shipped modules actually use is a poor trade - so this is a deliberately
 * small renderer covering exactly those constructs, plus the common inline
 * marks. It is NOT a CommonMark implementation, and it is not meant to become
 * one: if a module ever needs tables, footnotes or nested lists, pull in a real
 * parser instead of growing this file.
 *
 * ## Escaping contract
 *
 * Text nodes are emitted **unescaped**, exactly as `marked` output is treated
 * on the web. The output is not HTML-safe on its own - it is an intermediate
 * form that must go through the same pipeline the HTML modules use:
 *
 *     markdownToHtml() -> reprocessCommentaryLinks() -> sanitizeHtml()
 *
 * `reprocessCommentaryLinks` HTML-escapes every text segment while it inserts
 * scripture links (escaping here as well would double-encode into a visible
 * `&amp;quot;`), and `sanitizeHtml` (DOMPurify) is the final backstop that
 * removes anything script-shaped. Never feed this function's output straight
 * into `dangerouslySetInnerHTML`.
 */

/** Setext underline for a level-1 heading (`===`). */
const SETEXT_H1 = /^\s*=+\s*$/;
/** Setext underline for a level-2 heading (`---`). */
const SETEXT_H2 = /^\s*-{2,}\s*$/;
/** ATX heading: `# Title` through `###### Title`. */
const ATX_HEADING = /^ {0,3}(#{1,6})\s+(.*?)\s*#*\s*$/;
/** Thematic break: three or more `*`, `-` or `_`, optionally spaced. */
const THEMATIC_BREAK = /^\s*(?:(?:\*\s*){3,}|(?:-\s*){3,}|(?:_\s*){3,})$/;
/** Unordered list item: `* text`, `- text`, `+ text` at any indent. */
const UL_ITEM = /^\s*[*+-]\s+(.*)$/;
/** Ordered list item: `1. text` or `1) text` at any indent. */
const OL_ITEM = /^\s*\d+[.)]\s+(.*)$/;
/** Fenced or inline code span. */
const CODE_SPAN = /`[^`\n]+`/;

/**
 * Does this text read as Markdown rather than HTML?
 *
 * Used to pick a rendering path when the module's declared `content_format` is
 * not available to the renderer (the commentary IPC surface does not carry it).
 * Errs towards HTML: a module whose text contains block-level tags is treated
 * as HTML even if it also happens to contain something list-shaped, because
 * running the Markdown path over real HTML would mangle it, while running the
 * HTML path over Markdown only leaves the text unformatted.
 */
export function looksLikeMarkdown(content: string): boolean {
  if (!content) return false;
  if (/<(?:p|div|br|h[1-6]|ul|ol|li|table|blockquote|span|b|i|em|strong)\b[^>]*>/i.test(content)) {
    return false;
  }
  const lines = content.replace(/\r\n?/g, '\n').split('\n');
  for (let i = 0; i < lines.length; i++) {
    if (ATX_HEADING.test(lines[i])) return true;
    if (UL_ITEM.test(lines[i]) && !THEMATIC_BREAK.test(lines[i])) return true;
    const next = lines[i + 1];
    if (next !== undefined && lines[i].trim() && (SETEXT_H1.test(next) || SETEXT_H2.test(next))) {
      return true;
    }
  }
  return /\*\*[^*\n]+\*\*/.test(content);
}

/**
 * Convert Markdown to HTML.
 *
 * `stripLeadingHeading` drops a leading level-1 heading, matching the web
 * renderer: synthesis entries open with a redundant "Genesis 1:1 Commentary
 * Synthesis" title that duplicates the reference the pane already shows.
 */
export function markdownToHtml(
  markdown: string,
  options: { stripLeadingHeading?: boolean } = {}
): string {
  if (!markdown) return '';
  const { stripLeadingHeading = true } = options;

  const lines = markdown.replace(/\r\n?/g, '\n').split('\n');
  const out: string[] = [];
  const paragraph: string[] = [];
  let listType: 'ul' | 'ol' | null = null;

  const closeList = (): void => {
    if (listType) {
      out.push(`</${listType}>`);
      listType = null;
    }
  };
  const flushParagraph = (): void => {
    if (paragraph.length > 0) {
      out.push(`<p>${renderInline(paragraph.join('\n'))}</p>`);
      paragraph.length = 0;
    }
  };

  let i = 0;
  while (i < lines.length) {
    const line = lines[i];

    if (!line.trim()) {
      flushParagraph();
      closeList();
      i++;
      continue;
    }

    // Setext headings consume two lines: the text, then its underline.
    const next = lines[i + 1];
    if (next !== undefined && !UL_ITEM.test(line) && !OL_ITEM.test(line)) {
      if (SETEXT_H1.test(next)) {
        flushParagraph();
        closeList();
        out.push(`<h1>${renderInline(line.trim())}</h1>`);
        i += 2;
        continue;
      }
      if (SETEXT_H2.test(next)) {
        flushParagraph();
        closeList();
        out.push(`<h2>${renderInline(line.trim())}</h2>`);
        i += 2;
        continue;
      }
    }

    const atx = ATX_HEADING.exec(line);
    if (atx) {
      flushParagraph();
      closeList();
      const level = atx[1].length;
      out.push(`<h${level}>${renderInline(atx[2])}</h${level}>`);
      i++;
      continue;
    }

    // Checked before list items so `* * *` is a rule, not a bullet.
    if (THEMATIC_BREAK.test(line)) {
      flushParagraph();
      closeList();
      out.push('<hr />');
      i++;
      continue;
    }

    const ul = UL_ITEM.exec(line);
    const ol = ul ? null : OL_ITEM.exec(line);
    if (ul || ol) {
      flushParagraph();
      const wanted: 'ul' | 'ol' = ul ? 'ul' : 'ol';
      if (listType !== wanted) {
        closeList();
        out.push(`<${wanted}>`);
        listType = wanted;
      }
      let text = (ul ? ul[1] : ol![1]).trim();
      i++;
      // Lazy continuation: wrapped lines belong to the item until a blank
      // line, a new item, a heading, or the text line of a Setext heading.
      while (i < lines.length && lines[i].trim() && !isBlockStart(lines, i)) {
        text += `\n${lines[i].trim()}`;
        i++;
      }
      out.push(`<li>${renderInline(text)}</li>`);
      continue;
    }

    closeList();
    paragraph.push(line.trim());
    i++;
  }

  flushParagraph();
  closeList();

  let html = out.join('\n');
  if (stripLeadingHeading) {
    html = html.replace(/^\s*<h1>[\s\S]*?<\/h1>\s*/i, '');
  }
  return html;
}

/**
 * Flatten Markdown to readable plain text - for previews and word counts,
 * where the marks themselves are noise.
 */
export function markdownToPlainText(markdown: string): string {
  if (!markdown) return '';
  return markdown
    .replace(/\r\n?/g, '\n')
    // Setext underlines, then the marks that open a line.
    .replace(/^\s*(?:=+|-{2,})\s*$/gm, '')
    .replace(/^ {0,3}#{1,6}\s+/gm, '')
    .replace(/^\s*[*+-]\s+/gm, '')
    .replace(/^\s*\d+[.)]\s+/gm, '')
    // Inline marks.
    .replace(/!\[([^\]]*)\]\([^)]*\)/g, '$1')
    .replace(/\[([^\]]+)\]\([^)]*\)/g, '$1')
    .replace(/`([^`]+)`/g, '$1')
    .replace(/\*\*([^*]+)\*\*/g, '$1')
    .replace(/__([^_]+)__/g, '$1')
    .replace(/\*([^*\n]+)\*/g, '$1')
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * Does the line at `index` start a new block (so a list item's lazy
 * continuation has to stop before it)?
 */
function isBlockStart(lines: string[], index: number): boolean {
  const line = lines[index];
  if (UL_ITEM.test(line) || OL_ITEM.test(line)) return true;
  if (ATX_HEADING.test(line)) return true;
  if (THEMATIC_BREAK.test(line)) return true;
  const next = lines[index + 1];
  return next !== undefined && (SETEXT_H1.test(next) || SETEXT_H2.test(next));
}

/**
 * Render inline marks. Text outside the generated tags stays unescaped; see the
 * escaping contract at the top of this file.
 *
 * Code spans are split out first and their contents left alone, so `*` inside
 * `` `code` `` is not read as emphasis.
 */
function renderInline(text: string): string {
  const parts = text.split(new RegExp(`(${CODE_SPAN.source})`));
  return parts
    .map((part) => {
      if (CODE_SPAN.test(part) && part.startsWith('`')) {
        return `<code>${part.slice(1, -1)}</code>`;
      }
      return renderInlineMarks(part);
    })
    .join('');
}

/** Emphasis, links and hard line breaks for one non-code segment. */
function renderInlineMarks(text: string): string {
  // Links. The href is quote-escaped so it cannot break out of the attribute;
  // DOMPurify downstream rejects `javascript:` and friends.
  let s = text.replace(
    /\[([^\]\n]+)\]\(([^)\s]+)(?:\s+"[^"]*")?\)/g,
    (_match, label: string, href: string) =>
      `<a href="${href.replace(/"/g, '%22')}">${label}</a>`
  );

  s = s.replace(/\*\*([^*\n]+)\*\*/g, '<strong>$1</strong>');
  s = s.replace(/__([^_\n]+)__/g, '<strong>$1</strong>');
  s = s.replace(/(^|[^*\w])\*([^*\n]+)\*(?!\*)/g, '$1<em>$2</em>');
  s = s.replace(/(^|[^_\w])_([^_\n]+)_(?!\w)/g, '$1<em>$2</em>');

  // GFM `breaks: true` - a single newline inside a block is a visible break,
  // which is what the module text assumes.
  return s.replace(/\n/g, '<br />');
}
