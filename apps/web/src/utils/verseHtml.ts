/**
 * Display-side handling of the formatted verse HTML the server sends.
 *
 * `text_html` comes out of core's `formatVerseText`, which emits exactly two
 * styled spans — `christ-words` (red letter) and `divine-name` (small caps).
 * Everything here is about presenting those consistently wherever a verse is
 * shown, so the reading pane and the hover preview cannot drift apart.
 *
 * The red-letter switch is applied to the *markup*, not with a container class,
 * because the `.christ-words` colour rule in `_bible-content.scss` is scoped
 * under `.verse` — a preview popup outside that subtree would never inherit an
 * "off" override.
 */

/**
 * Spans that survive `toPreviewHtml`. Anything else is markup the compact
 * preview has no room to honour (footnote markers, paragraph wrappers), and
 * passing arbitrary tags through into `dangerouslySetInnerHTML` is how an
 * attribute like `onerror` gets a chance to run.
 *
 * This is why the hover-preview sink is the one place that does not also call
 * `sanitizeHtml`. `toPreviewHtml` re-emits its output from the class name it
 * matched rather than passing the source tag through, so it is a stricter
 * filter than DOMPurify is — it admits two spans and nothing else. Loosen it
 * and that stops being true: sanitize at the sink instead.
 */
const PREVIEW_SPAN_CLASSES = new Set(['christ-words', 'divine-name']);

/**
 * Honour the "Words of Christ in red" setting.
 *
 * When it is off the span is kept but stripped of its class rather than
 * removed: dropping the tag would require finding its matching `</span>`, and
 * a bare `<span>` styles as nothing while keeping the markup balanced.
 */
export function applyRedLetterSetting(textHtml: string, wordsOfChristInRed: boolean): string {
  return wordsOfChristInRed
    ? textHtml
    : textHtml.replace(/<span class="christ-words">/g, '<span>');
}

/**
 * Pull trailing punctuation inside the closing tag, so a mark such as the
 * colon after a red-letter clause cannot wrap onto a line of its own.
 */
export function tuckTrailingPunctuation(html: string): string {
  return html.replace(/<\/span>([.:;,!?])/g, '$1</span>');
}

/**
 * Reduce formatted verse HTML to a single run of inline text that still carries
 * red-letter and divine-name styling.
 *
 * This replaces a blanket `replace(/<[^>]*>/g, '')`, which flattened the verse
 * to plain text and so showed the words of Christ in black inside a preview
 * that sat right beside a red-letter reading pane.
 */
export function toPreviewHtml(textHtml: string, wordsOfChristInRed: boolean): string {
  const withSetting = applyRedLetterSetting(textHtml, wordsOfChristInRed);

  const allowlisted = withSetting.replace(/<[^>]*>/g, (tag) => {
    if (/^<\/span\s*>$/i.test(tag)) return '</span>';

    // Dropped outright (not replaced with a space), matching the plain-text
    // strip this grew out of: verse markup routinely butts a tag up against
    // the word it qualifies, and a space there reads as a typo.
    const open = /^<span\b([^>]*?)\/?>$/i.exec(tag);
    if (!open) return '';

    const className = /class\s*=\s*"([^"]*)"/i.exec(open[1])?.[1].trim() ?? '';
    // Re-emitted from the matched class name rather than passed through, so no
    // other attribute on the source tag can reach the DOM.
    return PREVIEW_SPAN_CLASSES.has(className) ? `<span class="${className}">` : '<span>';
  });

  return tuckTrailingPunctuation(allowlisted.replace(/\s+/g, ' ')).trim();
}
