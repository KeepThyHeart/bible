/**
 * A typed reference seeds the new panel with its verse.
 *
 * "John 5:5" in the New Tab box was parsed, and then the verse was dropped
 * one line later when the content key was built - so the panel opened John 5
 * with nothing selected and no scroll to verse 5. The parse and the seed have
 * to carry the same information end to end.
 */
import { describe, it, expect } from 'vitest';
import { parseVerseReference } from '../../utils/verseParser';
import { encodeBibleContentKey, decodeBibleContentKey } from './contentKey';

describe('a parsed reference seeding a Bible panel', () => {
  it('carries the verse through encode/decode', () => {
    const parsed = parseVerseReference('John 5:5');
    expect(parsed).toBeDefined();

    const contentKey = encodeBibleContentKey({
      abbreviation: 'KJV',
      book: parsed!.bookNumber,
      chapter: parsed!.chapter,
      selectedVerseId: parsed!.verseIdStart,
    });

    expect(decodeBibleContentKey(contentKey)).toMatchObject({
      abbreviation: 'KJV',
      book: 43,
      chapter: 5,
      selectedVerseId: 43005005,
    });
  });

  it('leaves no verse selected for a chapter-only reference', () => {
    const contentKey = encodeBibleContentKey({ abbreviation: 'KJV', book: 43, chapter: 5 });
    expect(decodeBibleContentKey(contentKey)?.selectedVerseId).toBeNull();
  });
});
