/**
 * Dictionary definition rendering (shared, environment-agnostic).
 *
 * ## Why this exists
 *
 * A dictionary `definition` is **plain text**, not HTML. The SWORD importer
 * (`tools/import/sword/dictionary/sword2dictionary.cpp`) runs every rendered
 * entry through `SwordCommon::stripMarkupClean`, which removes all markup - so
 * whatever the source module was (TEI, ThML, OSIS), what lands in the column is
 * prose. A survey of the 25 installed dictionary modules (~300k entries) found
 * exactly zero HTML tags and one lone `<`, in Webster 1913's *inequality*
 * entry: "the inequality 2 < 3".
 *
 * Every renderer nevertheless pushed the column straight into
 * `dangerouslySetInnerHTML`, which is the wrong filter for plain text twice
 * over:
 *
 * 1. **Newlines vanish.** HTML collapses them to spaces. Nave's Topical Bible
 *    uses a blank line to separate the numbered senses under a heading (14,586
 *    of them across 1,137 entries); on screen those ran together into one wall
 *    of text.
 * 2. **Stray angle brackets become markup.** `2 < 3` is at the mercy of the
 *    HTML parser rather than being shown as written.
 *
 * So the conversion belongs at render time, not in the stored data. This module
 * is that conversion, and it is shared so the desktop pane, the desktop single
 * panel, the web pane and the mobile study pane cannot drift apart.
 *
 * ## Who decides: the module, then the text
 *
 * The authority is a module-level declaration, because newline significance is
 * a property of how a module was produced, not of an individual entry:
 *
 *     module_info.metadata -> { "newline_handling": "significant" }
 *
 * `module_info` already carries a `metadata` JSON column for exactly this kind
 * of extension (the same place commentaries keep `content_format`; see
 * `scripts/set-commentary-format.js`). The value is a string rather than a
 * boolean so a third case - say a "paragraph" mode where a blank line opens a
 * paragraph and a single newline is a soft wrap - can be added without a
 * migration. An absent or unrecognised value means *not declared*.
 *
 * When nothing is declared, the text decides, per entry. That fallback is not
 * merely a bridge for unmigrated modules: it is what makes a mixed module -
 * some entries prose, some carrying markup - render correctly, since a
 * module-level flag cannot describe one. It mirrors the convention
 * `looksLikeMarkdown` already establishes for commentary content, erring
 * toward HTML whenever recognisable tags are present: running the plain-text
 * path over real HTML would show its tags to the reader, while running the
 * HTML path over prose only loses the line breaks.
 *
 * ## Escaping contract
 *
 * `dictionaryDefinitionToHtml` escapes the plain-text case itself and returns
 * the HTML case untouched. It is NOT a sanitiser: callers must still pass the
 * result through DOMPurify (`sanitizeHtml`) before `dangerouslySetInnerHTML`,
 * exactly as they did with the raw column.
 *
 * Callers that run their own link processing first - `processCommentaryLinks`
 * HTML-escapes each text segment as it inserts anchors - must NOT escape
 * twice. They use the two primitives instead:
 *
 *     const breaks = resolveNewlineHandling(raw, declared) === 'significant';
 *     let html = processCommentaryLinks(raw, ctx);    // escapes text segments
 *     if (breaks) html = newlinesToLineBreaks(html);  // breaks only, no escape
 */

/**
 * How a module's stored newlines are to be treated when rendering.
 *
 * - `significant` - the newline is content: it marks a sub-entry or sense
 *   boundary and becomes a `<br />`.
 * - `insignificant` - the newline is HTML source whitespace and is left alone,
 *   because the definition carries its own block markup.
 */
export type NewlineHandling = 'significant' | 'insignificant';

/** The `module_info.metadata` key that declares it. */
export const NEWLINE_HANDLING_KEY = 'newline_handling';

const NEWLINE_HANDLING_VALUES: readonly string[] = ['significant', 'insignificant'];

/**
 * Tags that mark a definition as real HTML. An allow-list rather than a
 * generic `<[a-z]...>` so that prose which merely happens to contain an angle
 * bracket ("2 < 3", "a<b and c>d") stays on the plain-text path, where it is
 * escaped and therefore displayed as written.
 */
const HTML_TAG_PATTERN =
  /<\/?(?:a|abbr|address|article|aside|b|big|blockquote|br|caption|center|cite|code|dd|del|dfn|div|dl|dt|em|figure|font|h[1-6]|hr|i|img|ins|kbd|li|mark|nav|ol|p|pre|q|s|samp|section|small|span|strike|strong|sub|sup|table|tbody|td|tfoot|th|thead|time|tr|tt|u|ul|var)\b[^>]*>/i;

/**
 * Read the module's declaration out of a `module_info.metadata` value.
 *
 * Accepts the parsed object or the raw JSON string, and tolerates the
 * camelCase spelling as well as the canonical snake_case one - module authors
 * write this by hand. Anything absent, misspelled or of the wrong shape is
 * *not declared*, which hands the decision to the per-entry fallback.
 */
export function readNewlineHandling(metadata: unknown): NewlineHandling | undefined {
  let source: unknown = metadata;
  if (typeof source === 'string') {
    try {
      source = JSON.parse(source);
    } catch {
      return undefined;
    }
  }
  if (typeof source !== 'object' || source === null) return undefined;

  const bag = source as Record<string, unknown>;
  const raw = bag[NEWLINE_HANDLING_KEY] ?? bag['newlineHandling'];
  if (typeof raw !== 'string') return undefined;

  const value = raw.trim().toLowerCase();
  return NEWLINE_HANDLING_VALUES.includes(value) ? (value as NewlineHandling) : undefined;
}

/**
 * Does this definition carry HTML markup of its own?
 *
 * The per-entry fallback used when the module declares nothing. When it does,
 * its newlines are insignificant whitespace and the text is left alone; when it
 * does not, the newlines are the only structure the entry has.
 */
export function definitionHasHtmlMarkup(definition: string): boolean {
  if (!definition) return false;
  return HTML_TAG_PATTERN.test(definition);
}

/**
 * Decide how one definition's newlines are to be treated: the module's
 * declaration when it made one, otherwise what the text itself looks like.
 */
export function resolveNewlineHandling(
  definition: string,
  declared?: NewlineHandling | undefined
): NewlineHandling {
  if (declared) return declared;
  return definitionHasHtmlMarkup(definition) ? 'insignificant' : 'significant';
}

/**
 * Turn the significant newlines of a definition into `<br />`.
 *
 * Expects a string that is already HTML-safe - either escaped by
 * `dictionaryDefinitionToHtml` or by a link processor. Trailing spaces before
 * a newline are absorbed, and the ends are trimmed, so the "\n \n" separator
 * Nave's uses renders as one blank line rather than a break, a space and
 * another break.
 *
 * The newline itself is kept after the tag: it is insignificant to the
 * rendered output, and keeping it means downstream passes that read line
 * context (`processCommentaryLinks` resolves a bare "8:9" against the last
 * book named on the same line) still see the line structure.
 */
export function newlinesToLineBreaks(html: string): string {
  if (!html) return '';
  return html
    .replace(/\r\n?/g, '\n')
    .trim()
    .replace(/[ \t]*\n/g, '<br />\n');
}

/**
 * Render a stored dictionary definition as display HTML.
 *
 * Plain text is escaped and its significant newlines become `<br />`; text
 * whose newlines are insignificant is returned unchanged. The result still has
 * to be sanitised before it reaches `dangerouslySetInnerHTML` - see the
 * escaping contract above.
 *
 * @param definition The stored column value.
 * @param declared   The module's `newline_handling`, when it declared one.
 */
export function dictionaryDefinitionToHtml(
  definition: string | null | undefined,
  declared?: NewlineHandling | undefined
): string {
  if (!definition) return '';
  // Escaping and break-insertion are separate questions. Whether the text has
  // to be escaped depends only on whether it is prose; whether its newlines
  // become breaks is what the module gets to declare. Keeping them apart means
  // a module that declares `significant` while shipping markup still gets its
  // markup, and one that declares `insignificant` over prose is still escaped.
  const html = definitionHasHtmlMarkup(definition) ? definition : escapeHtml(definition);
  if (resolveNewlineHandling(definition, declared) === 'insignificant') return html;
  return newlinesToLineBreaks(html);
}

/** Escape the five characters that would otherwise be read as markup. */
function escapeHtml(text: string): string {
  const escapeMap: Record<string, string> = {
    '&': '&amp;',
    '<': '&lt;',
    '>': '&gt;',
    '"': '&quot;',
    "'": '&#39;'
  };
  return text.replace(/[&<>"']/g, (char) => escapeMap[char] ?? char);
}
