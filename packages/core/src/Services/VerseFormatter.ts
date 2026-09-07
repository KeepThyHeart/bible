import { BibleVerse } from '../Data/Models/Bible/BibleVerse';

export interface FormattedVerse {
  textHtml: string;
  isParagraphStart: boolean;
  sectionHeading?: string;
}

/**
 * Regex to strip OSIS/SWORD XML tags that browsers render as unknown elements.
 * These tags come from SWORD-format module conversions and have no meaning in HTML.
 *
 * NOTE: `divineName` is included here (and left here) because stripOsisTags()
 * is used in plain-text-only contexts (e.g. the interlinear original-word field,
 * section headings) where no styled span is wanted - just clean text. It's safe
 * to keep `divineName` in this alternation even for formatVerseText() below,
 * because DIVINE_NAME_PATTERN always runs first and converts every well-formed
 * `<divineName>...</divineName>` pair into a `<span>`, leaving no bare
 * `<divineName>` tags for this pattern to match by the time it runs.
 *
 * `w` is the OSIS word tag - the most common tag in a SWORD module, since it
 * is what carries Strong's numbers and lemmas (`<w savlm="strong:G3588 ..."/>`).
 * It was missing from this alternation, so stripOsisTags() was a no-op on the
 * interlinear original-word and gloss fields and the raw markup rendered as
 * literal text in the reader. Nothing downstream reads `<w>` back out of
 * formatted text - Strong's data reaches the UI through interlinear_word
 * columns, not by re-parsing markup - so stripping it here is safe, and the
 * trailing `(\s[^>]*)?` already covers the self-closing `.../>` form.
 */
const OSIS_TAG_PATTERN = /<\/?(divineName|transChange|catchWord|rdg|seg|hi|foreign|inscription|mentioned|name|note|title|q|w)(\s[^>]*)?>/g;

/**
 * Regex to match `<divineName>...</divineName>` (OSIS tag wrapping the
 * Tetragrammaton, conventionally rendered "LORD"/"GOD"), capturing the inner
 * text so it can be re-wrapped in a styled `<span>` instead of being stripped
 * to bare text. Handles attributes on the opening tag (e.g. a `type="..."`
 * variant some SWORD sources use) and nested markup inside the content, since
 * `[\s\S]*?` doesn't stop at inner tag boundaries - any nested OSIS tags are
 * cleaned up afterward by the generic OSIS_TAG_PATTERN strip.
 */
const DIVINE_NAME_PATTERN = /<divineName(?:\s[^>]*)?>([\s\S]*?)<\/divineName>/g;

/**
 * Control-character placeholders standing in for the divine-name span's open/close
 * tags while Words of Christ processing runs (see formatVerseText). They are not
 * expected to occur in real Bible text, and - critically - they don't look like
 * `<...>` markup, so the WoC word-splitting step's blanket tag strip
 * (`text.replace(/<[^>]*>/g, ' ')`) passes them through untouched instead of
 * silently discarding the divine-name styling. They're swapped for the real
 * `<span>`/`</span>` tags as the very last step before returning.
 */
const DIVINE_NAME_OPEN_MARKER = String.fromCharCode(1);
const DIVINE_NAME_CLOSE_MARKER = String.fromCharCode(2);

/**
 * Normalize a divine-name word to initial-capital form ("LORD"/"lord" -> "Lord").
 *
 * The casing convention is applied here rather than in CSS because
 * `::first-letter` only matches block containers - on an inline `<span>` it is
 * silently ignored, so the usual `text-transform: lowercase` +
 * `::first-letter { text-transform: uppercase }` trick renders as uniform small
 * capitals with no full-height initial. Normalizing here lets the stylesheet be
 * a bare `font-variant-caps: small-caps`, which renders the capital at full
 * height and the rest as small capitals - and it makes the result identical
 * whether the source module wrote "Lord" (CrossWire KJV, casing left to the
 * renderer) or "LORD" (modules that bake the convention into the text).
 *
 * Leading punctuation is skipped so quoted or parenthesized occurrences still
 * capitalize the first *letter*, not the quote mark.
 */
function toDivineNameCase(word: string): string {
  const lower = word.toLowerCase();
  const firstLetter = lower.search(/[a-z]/);
  if (firstLetter === -1) return lower;
  return lower.slice(0, firstLetter) + lower[firstLetter].toUpperCase() + lower.slice(firstLetter + 1);
}

/**
 * Formats a BibleVerse's raw text into display-ready HTML.
 *
 * Handles three concerns:
 * 1. Tag cleanup - strips legacy <font> tags and OSIS/SWORD XML tags
 * 2. Paragraph detection - checks both the pilcrow character (¶) and formattingData
 * 3. Words of Christ - wraps red-letter ranges in <span class="christ-words">
 *
 * The word-offset system for Words of Christ works by stripping all HTML,
 * splitting into words, then rebuilding with span boundaries at the
 * positions specified in formattingData.wordsOfChrist.
 */
export function formatVerseText(verse: BibleVerse): FormattedVerse {
  let text = verse.text;
  let isParagraphStart = false;

  // Strip legacy HTML formatting tags (from older module conversions)
  text = text.replace(/<font[^>]*>/g, '');
  text = text.replace(/<\/font>/g, '');

  // Convert <divineName> into placeholder markers (not real <span> tags yet) BEFORE
  // the generic OSIS strip below, so the small-caps CSS treatment (see .divine-name
  // in the theme stylesheets) survives instead of being reduced to bare text.
  // Real tags aren't used here because the Words of Christ block further down
  // does a blanket `<[^>]*>` strip while splitting text into words, which would
  // silently swallow an actual <span> before it could reach the output. The
  // markers aren't tag-shaped, so they ride along with their word through that
  // step untouched, and get swapped for real <span>/</span> tags at the very end.
  text = text.replace(DIVINE_NAME_PATTERN, `${DIVINE_NAME_OPEN_MARKER}$1${DIVINE_NAME_CLOSE_MARKER}`);

  // Strip OSIS/SWORD XML tags that have no HTML rendering equivalent
  text = text.replace(OSIS_TAG_PATTERN, '');

  // Detect paragraph boundaries from pilcrow character
  if (text.includes('\u00B6')) {
    text = text.replace(/\u00B6/g, '');
    isParagraphStart = true;
  }

  // Detect paragraph boundaries from formatting metadata (handles both camelCase and snake_case)
  const fd = verse.formattingData as Record<string, unknown> | undefined;
  if (fd?.paragraphStart || fd?.paragraph_start) {
    isParagraphStart = true;
  }

  // Apply the word-indexed spans: Words of Christ (red-letter editions) and the
  // divine name (small caps). Both address words by index into the tag-free word
  // sequence, so they share one rebuild pass - running two passes would break the
  // second one's indices, since the first pass inserts <span> markup.
  const woc = (fd?.wordsOfChrist || fd?.words_of_christ) as Array<{ start: number; end: number }> | undefined;
  const divine = (fd?.divineName || fd?.divine_name) as Array<{ start: number; end: number }> | undefined;

  if ((woc && woc.length > 0) || (divine && divine.length > 0)) {
    const strippedText = text.replace(/<[^>]*>/g, ' ');
    const words = strippedText.split(/\s+/).filter(w => w.length > 0);

    const mark = (ranges: Array<{ start: number; end: number }> | undefined): boolean[] => {
      const flags: boolean[] = new Array(words.length).fill(false);
      for (const range of ranges ?? []) {
        for (let i = range.start; i <= range.end && i < words.length; i++) {
          if (i >= 0) flags[i] = true;
        }
      }
      return flags;
    };

    const isChristWord = mark(woc);
    const isDivineWord = mark(divine);

    // christ-words is the outer span and divine-name the inner one, so that
    // overlapping ranges (Jesus quoting an OT passage containing the
    // Tetragrammaton) still nest legally. Whenever the christ-words boundary
    // moves while a divine-name span is open, the inner span is closed and
    // reopened around it rather than being left to straddle the boundary.
    const parts: string[] = [];
    let inChrist = false;
    let inDivine = false;

    // Order within each iteration is close -> separator -> open, so the space
    // between two words always lands *outside* both spans. Emitting the
    // separator right after its word instead would trap it inside a span that
    // closes on the next word, giving `Lord </span>` - a trailing space inside
    // small-caps or red-letter styling, which is visible.
    for (let i = 0; i < words.length; i++) {
      const wantChrist = isChristWord[i];
      const wantDivine = isDivineWord[i];

      if (inDivine && (!wantDivine || wantChrist !== inChrist)) {
        parts.push('</span>');
        inDivine = false;
      }
      if (inChrist && !wantChrist) {
        parts.push('</span>');
        inChrist = false;
      }
      if (i > 0) parts.push(' ');
      if (!inChrist && wantChrist) {
        parts.push('<span class="christ-words">');
        inChrist = true;
      }
      if (!inDivine && wantDivine) {
        parts.push('<span class="divine-name">');
        inDivine = true;
      }

      parts.push(wantDivine ? toDivineNameCase(words[i]) : words[i]);
    }

    if (inDivine) parts.push('</span>');
    if (inChrist) parts.push('</span>');
    text = parts.join('');

    // Collapse spaces before trailing punctuation. The strip-tags-with-space
    // approach above can isolate punctuation tokens from their preceding word
    // (e.g. `them<note>x</note>.` -> `them   .` -> words `them`, `.`), which
    // produces ` .` after rejoining and lets the period wrap to its own line.
    text = text.replace(/(<\/span>|\w)\s+([.,;:?!])/g, '$1$2');
  }

  // Swap the divine-name placeholder markers for real <span> tags now that Words
  // of Christ processing (which strips actual <...> HTML tags but leaves these
  // non-tag markers alone) has had a chance to run. A plain split() is safe here
  // since the markers are single characters, not regex metacharacters.
  // Casing is normalized here rather than at the DIVINE_NAME_PATTERN replace
  // above because the captured content may still hold nested OSIS tags at that
  // point; by now the generic strip has removed them, so only real words remain.
  if (text.includes(DIVINE_NAME_OPEN_MARKER)) {
    const markedSpan = new RegExp(`${DIVINE_NAME_OPEN_MARKER}([^${DIVINE_NAME_CLOSE_MARKER}]*)${DIVINE_NAME_CLOSE_MARKER}`, 'g');
    text = text.replace(markedSpan, (_match, inner: string) => {
      const cased = inner.split(/(\s+)/).map(part => (/\s/.test(part) ? part : toDivineNameCase(part))).join('');
      return `<span class="divine-name">${cased}</span>`;
    });
  }

  // Extract section heading if present, stripping any residual XML/HTML tags
  const rawHeading = verse.getSectionHeading();
  const sectionHeading = rawHeading ? rawHeading.replace(/<[^>]*>/g, '').trim() || undefined : undefined;

  return { textHtml: text, isParagraphStart, sectionHeading };
}

/**
 * Strip OSIS/SWORD XML tags from text. Useful when only tag cleanup is needed
 * without the full formatting pipeline (e.g., for search result snippets).
 */
export function stripOsisTags(text: string): string {
  return text.replace(OSIS_TAG_PATTERN, '');
}

/**
 * Apply search term highlighting to HTML text.
 * Wraps matched terms in <strong><u> tags, using word boundaries
 * to avoid partial-word matches.
 */
export function highlightSearchTerms(html: string, terms: string[]): string {
  if (!terms || terms.length === 0) return html;

  let result = html;
  const unique = Array.from(new Set(terms));

  for (const term of unique) {
    const escaped = term.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const regex = new RegExp(`\\b(${escaped})\\b`, 'gi');
    result = result.replace(regex, '<strong><u>$1</u></strong>');
  }

  return result;
}
