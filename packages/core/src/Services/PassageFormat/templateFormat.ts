/**
 * Template Format - user-editable Handlebars-style copy template.
 *
 * Uses the CopyService.renderTemplate engine from this same package.
 *
 * Supported template syntax:
 *   {{variable}}                 - variable interpolation
 *   {{#each items}}...{{/each}}  - loop with @index / @first / @last
 *   {{#if var}}...{{else}}...{{/if}}
 *   {{#unless var}}...{{/unless}}
 *   {{#blockquote}}...{{/blockquote}} - prefix every line of the region with "> "
 *   {{separator "\n"}}
 *
 * A mistyped section helper (`{{#blockqoute}}`) throws rather than rendering
 * empty; `renderCopyTemplate` below turns that into a visible
 * `[Template error: ...]` in the dialog's live preview.
 *
 * Available context variables:
 *   reference, book, chapter, verse, version (a.k.a. moduleAbbr / moduleName)
 *   verses          - array of { verse, verse_id, chapter, book_number, text,
 *                                 isChristWords, isParagraphStart }
 *   paragraphs      - verses grouped by paragraph start:  { verses: [...] }[]
 *   verseCount      - number
 */

import { renderTemplate } from '../CopyService';
import type { CopyFormat, PassageVerse, VerseContext, FormatOptions } from './types';
import { getVerseTextForFormat, buildReference, truncateForPreview } from './formatHelpers';
import { resolveCopyFormatSettings, type CopyFormatSettings } from './settings';

interface TemplateVerseItem {
  verse: number;
  verse_id: number;
  chapter: number;
  book_number: number;
  text: string;
  isChristWords: boolean;
  isParagraphStart: boolean;
  // Convenience aliases matching alternative variable names
  book: string;
  reference: string;
  moduleAbbr: string;
  moduleName: string;
}

interface TemplateContext {
  reference: string;
  book: string;
  chapter: number;
  verse: number;
  version: string;
  moduleAbbr: string;
  moduleName: string;
  verses: TemplateVerseItem[];
  paragraphs: { verses: TemplateVerseItem[] }[];
  verseCount: number;
  // Index signature required to match the TemplateContext accepted by
  // CopyService's renderTemplate (which uses a generic string-keyed record).
  [key: string]: unknown;
}

/** Detect whether a verse contains "words of Christ" markup */
function verseHasChristWords(v: PassageVerse): boolean {
  const html = v.text_html || v.text || '';
  return /christ-words|<font color="red"|<font color="#[Ff]{2}0000"/.test(html);
}

/**
 * `reference` is always built WITHOUT the translation, regardless of
 * `options.displayVersionNumber`: a template composes its own reference line and
 * has `{{version}}` available separately, so baking the version into
 * `{{reference}}` would give templates that use both a duplicated version.
 * `wordsOfChristInRed` *is* honoured - it changes the verse text itself, which a
 * template cannot reconstruct on its own.
 */
export function buildTemplateContext(
  verses: PassageVerse[],
  context: VerseContext,
  options: FormatOptions
): TemplateContext {
  const reference = buildReference(verses, context, false);
  const moduleAbbr = context.translation || '';

  const items: TemplateVerseItem[] = verses.map(v => ({
    verse: v.verse,
    verse_id: v.verse_id,
    chapter: v.chapter,
    book_number: v.book_number,
    text: getVerseTextForFormat(v, options.wordsOfChristInRed),
    isChristWords: verseHasChristWords(v),
    isParagraphStart: !!v.is_paragraph_start,
    book: context.bookName,
    reference,
    moduleAbbr,
    moduleName: moduleAbbr,
  }));

  // Group into paragraphs (uses is_paragraph_start markers).
  const paragraphs: { verses: TemplateVerseItem[] }[] = [];
  let current: TemplateVerseItem[] = [];
  for (const it of items) {
    if (it.isParagraphStart && current.length > 0) {
      paragraphs.push({ verses: current });
      current = [];
    }
    current.push(it);
  }
  if (current.length > 0) {
    paragraphs.push({ verses: current });
  }

  return {
    reference,
    book: context.bookName,
    chapter: context.chapter,
    verse: verses[0]?.verse ?? 0,
    version: moduleAbbr,
    moduleAbbr,
    moduleName: moduleAbbr,
    verses: items,
    paragraphs,
    verseCount: items.length,
  };
}

/** Render an arbitrary template string against verses (used by the editor preview). */
export function renderCopyTemplate(
  template: string,
  verses: PassageVerse | PassageVerse[],
  context: VerseContext,
  options: FormatOptions
): string {
  const arr = Array.isArray(verses) ? verses : [verses];
  if (arr.length === 0) return '';
  try {
    return renderTemplate(template, buildTemplateContext(arr, context, options));
  } catch (e) {
    const msg = e instanceof Error ? e.message : 'Template error';
    return `[Template error: ${msg}]`;
  }
}

const templateFormat: CopyFormat = {
  id: 'template',
  name: 'Custom Template',
  description: 'User-editable Handlebars-style template',

  format(
    verses: PassageVerse | PassageVerse[],
    context: VerseContext,
    options: FormatOptions,
    settings?: CopyFormatSettings
  ): string {
    return renderCopyTemplate(
      resolveCopyFormatSettings(settings).templateText,
      verses,
      context,
      options
    );
  },

  preview(
    verses: PassageVerse | PassageVerse[],
    context: VerseContext,
    options: FormatOptions,
    settings?: CopyFormatSettings
  ): string {
    return truncateForPreview(
      renderCopyTemplate(
        resolveCopyFormatSettings(settings).templateText,
        verses,
        context,
        options
      ),
      150
    );
  },
};

export default templateFormat;
