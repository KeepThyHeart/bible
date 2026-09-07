/**
 * Shared formatting helper utilities for copy templates
 */

import { PassageVerse, VerseContext } from './types';
import {
  decodeHtmlEntities,
  escapeStrayMarkup,
  stripHtmlTags,
} from './htmlText';

/**
 * Paragraph markers (¶) are a *display* affordance of the source modules, not
 * part of the verse. Copied text is pasted into sermons, documents and chat,
 * where a stray pilcrow reads as a typo - so no copy format emits one.
 *
 * This lives here rather than in each format because the marker used to survive
 * or vanish depending on which text-extraction helper a format happened to call:
 * `getCleanVerseText` kept it while `getVerseTextWithRed` did not, so toggling
 * "Words of Christ in red" appeared to toggle paragraph markers as a side effect.
 * Stripping at both extraction points is what makes the two paths agree.
 */
function stripParagraphMarkers(text: string): string {
  return text.replace(/¶/g, '');
}

/**
 * Strip HTML tags from text, leaving the characters they surrounded.
 *
 * Entities are decoded, because this returns *text*: `&amp;` has to read as
 * `&` in a clipboard, not as five characters. See `htmlText.ts` for what the
 * string implementation does and does not reproduce of the DOM round-trip it
 * replaced.
 */
export function stripHtml(text: string): string {
  const cleanText = decodeHtmlEntities(stripHtmlTags(text));
  // Strip markers before collapsing whitespace: removing "¶" leaves the space
  // that followed it, which the collapse then folds into the preceding gap.
  return stripParagraphMarkers(cleanText).replace(/\s+/g, ' ').trim();
}

/**
 * Get clean plain text from verse (no HTML)
 */
export function getCleanVerseText(verse: PassageVerse): string {
  if (verse.text) {
    return stripHtml(verse.text);
  }
  if (verse.text_html) {
    return stripHtml(verse.text_html);
  }
  return '';
}

/**
 * Get verse text with Words of Christ in red (for preview)
 * Preserves red color markup while cleaning other HTML
 */
export function getVerseTextWithRed(verse: PassageVerse): string {
  const html = verse.text_html || verse.text || '';

  // Replace christ-words class spans with inline red style (used by the app's backend)
  let processed = html.replace(/<span\s+class="christ-words">/gi, '<span style="color: #B71C1C;">');

  // Replace legacy font tags with red color with inline-styled spans
  processed = processed.replace(/<font color="red">(.*?)<\/font>/gi, '<span style="color: #B71C1C;">$1</span>');
  processed = processed.replace(/<font color="#[Ff]{2}0000">(.*?)<\/font>/gi, '<span style="color: #B71C1C;">$1</span>');

  // The result is markup, so an ampersand that is not already an entity is
  // escaped - the DOM round-trip this replaced did the same by parsing and
  // re-serialising. Safe to run the pilcrow strip over the whole string rather
  // than walking text nodes: "¶" cannot appear in a tag name, and no attribute
  // produced above contains one.
  return stripParagraphMarkers(escapeStrayMarkup(processed)).replace(/\s+/g, ' ').trim();
}

/**
 * Get verse text for preview (with or without red text)
 */
export function getVerseTextForPreview(verse: PassageVerse, wordsOfChristInRed: boolean): string {
  if (wordsOfChristInRed) {
    return getVerseTextWithRed(verse);
  }
  return getCleanVerseText(verse);
}

/**
 * Get verse text for format output, respecting wordsOfChristInRed option.
 * When wordsOfChristInRed is true, returns HTML with red spans (for preview display).
 * When false (plain mode), returns clean plain text.
 */
export function getVerseTextForFormat(verse: PassageVerse, wordsOfChristInRed: boolean): string {
  if (wordsOfChristInRed) {
    return getVerseTextWithRed(verse);
  }
  return getCleanVerseText(verse);
}

/**
 * How the translation is attached to the reference.
 *
 * - `parenthetical` - "John 3:16 (KJV)". For formats where the reference stands
 *   on its own (Standard, Plain).
 * - `appended` - "John 3:16, KJV". For formats that wrap the whole reference in
 *   parentheses themselves (Combined, Inline). Without this those produced
 *   "(Ephesians 2:1 (KJV))" - parentheses nested one inside the other.
 */
export type ReferenceVersionStyle = 'parenthetical' | 'appended';

/**
 * Build verse reference string
 *
 * @example
 * buildReference([verse16], context, true) => "John 3:16 (KJV)"
 * buildReference([verse16], context, true, 'appended') => "John 3:16, KJV"
 * buildReference([verse16, verse17], context, false) => "John 3:16-17"
 */
export function buildReference(
  verses: PassageVerse[],
  context: VerseContext,
  includeTranslation: boolean,
  versionStyle: ReferenceVersionStyle = 'parenthetical'
): string {
  if (verses.length === 0) {
    return '';
  }

  const firstVerse = verses[0];
  const lastVerse = verses[verses.length - 1];

  let reference: string;
  if (verses.length === 1 || firstVerse.verse === lastVerse.verse) {
    reference = `${context.bookName} ${context.chapter}:${firstVerse.verse}`;
  } else {
    reference = `${context.bookName} ${context.chapter}:${firstVerse.verse}-${lastVerse.verse}`;
  }

  if (includeTranslation && context.translation) {
    reference += versionStyle === 'appended'
      ? `, ${context.translation}`
      : ` (${context.translation})`;
  }

  return reference;
}

/**
 * Build a reference for a passage that may span chapters.
 *
 * `buildReference` above reads the chapter from `VerseContext`, which carries a
 * single chapter - correct for the fixed formats, which are only ever handed one
 * chapter's worth of verses, but wrong for the Advanced format, where the
 * passage box accepts "John 3-5" and whole books. This reads the chapter off the
 * verses themselves, so a cross-chapter range renders "John 3:16-5:12" rather
 * than splicing the start chapter onto the end verse.
 *
 * @example
 * buildPassageReference([jn3v16], ctx, true)              => "John 3:16 (KJV)"
 * buildPassageReference([jn3v16, jn5v12], ctx, true)      => "John 3:16-5:12 (KJV)"
 * buildPassageReference([jn3v16, jn3v17], ctx, true, 'appended') => "John 3:16-17, KJV"
 */
export function buildPassageReference(
  verses: PassageVerse[],
  context: VerseContext,
  includeTranslation: boolean,
  versionStyle: ReferenceVersionStyle = 'parenthetical'
): string {
  if (verses.length === 0) {
    return '';
  }

  const first = verses[0];
  const last = verses[verses.length - 1];

  let reference: string;
  if (first.chapter !== last.chapter) {
    reference = `${context.bookName} ${first.chapter}:${first.verse}-${last.chapter}:${last.verse}`;
  } else if (first.verse === last.verse) {
    reference = `${context.bookName} ${first.chapter}:${first.verse}`;
  } else {
    reference = `${context.bookName} ${first.chapter}:${first.verse}-${last.verse}`;
  }

  if (includeTranslation && context.translation) {
    reference += versionStyle === 'appended'
      ? `, ${context.translation}`
      : ` (${context.translation})`;
  }

  return reference;
}

/**
 * Truncate text for preview display
 */
export function truncateForPreview(text: string, maxLength: number = 100): string {
  if (text.length <= maxLength) {
    return text;
  }
  return text.substring(0, maxLength) + '...';
}
