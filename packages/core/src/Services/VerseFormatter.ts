import { BibleVerse } from '../Data/Models/Bible/BibleVerse';
import { formatVerseFields, type FormattedVerse, type VerseFormattingData } from './VerseTextFormatter';

// The pure formatting engine lives in `VerseTextFormatter.ts` so the browser
// barrel can export it without reaching the BibleVerse model. Re-exported here
// so existing `./VerseFormatter` imports keep working.
export { stripOsisTags, highlightSearchTerms, formatVerseFields, hasWordsOfChrist, getFootnotes } from './VerseTextFormatter';
export type { FormattedVerse, VerseFormattingData, VerseWordRange } from './VerseTextFormatter';

/**
 * Formats a BibleVerse's raw text into display-ready HTML.
 * See {@link formatVerseFields} for what is handled.
 */
export function formatVerseText(verse: BibleVerse): FormattedVerse {
  return formatVerseFields(
    verse.text,
    verse.formattingData as VerseFormattingData | undefined,
    verse.getSectionHeading(),
  );
}
