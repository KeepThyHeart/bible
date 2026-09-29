import { describe, it, expect, vi, beforeEach } from 'vitest';

const getInterlinear = vi.fn();
vi.mock('../stores/keywordMarkStore', () => ({ keywordMarkStore: { getInterlinear: (k: string) => getInterlinear(k) } }));
vi.mock('../stores/bibleStore', () => ({
  bibleStore: { getActiveTab: () => ({ moduleAbbr: 'KJV', book: 43, chapter: 3 }) },
}));

import { wordAround, wordAtPoint, strongsForWord } from './wordAtPoint';

describe('wordAround', () => {
  it('finds the word at an offset and trims punctuation', () => {
    expect(wordAround('For God so loved, the world', 12)).toBe('loved');
    expect(wordAround('For God', 0)).toBe('For');
    expect(wordAround('...', 1)).toBe('');
  });

  it('keeps inner apostrophes', () => {
    expect(wordAround("God's love", 2)).toBe("God's");
  });
});

describe('strongsForWord', () => {
  beforeEach(() => getInterlinear.mockReset());

  it('reads the span covering the word from the store cache', () => {
    getInterlinear.mockReturnValue([{ verseId: 43003016, start: 3, end: 4, strongs: 'G25' }]);
    expect(strongsForWord(43003016, 4)).toBe('G25');
    expect(getInterlinear).toHaveBeenCalledWith('KJV:43:3');
    expect(strongsForWord(43003016, 5)).toBeUndefined();
  });

  it('is undefined when no rows are loaded', () => {
    getInterlinear.mockReturnValue(undefined);
    expect(strongsForWord(43003016, 1)).toBeUndefined();
  });
});

describe('wordAtPoint', () => {
  it('uses a painted word span, with its Strong\'s number', () => {
    getInterlinear.mockReturnValue([{ verseId: 43003016, start: 2, end: 2, strongs: 'G4102' }]);
    const span = document.createElement('span');
    span.className = 'word';
    span.dataset.wordIndex = '2';
    span.textContent = 'faith,';
    document.body.appendChild(span);
    expect(wordAtPoint(span, 0, 0, 43003016)).toEqual({ text: 'faith', strongs: 'G4102' });
    span.remove();
  });

  it('is null off a word when the browser has no caret API', () => {
    const el = document.createElement('div');
    expect(wordAtPoint(el, 0, 0, 43003016)).toBeNull();
  });

  it('falls back to the caret position in plain verse text', () => {
    const verse = document.createElement('div');
    verse.dataset.verseId = '43003016';
    verse.textContent = 'For God so loved';
    document.body.appendChild(verse);
    const doc = document as unknown as { caretPositionFromPoint: unknown };
    doc.caretPositionFromPoint = () => ({ offsetNode: verse.firstChild, offset: 12 });
    expect(wordAtPoint(verse, 0, 0, 43003016)).toEqual({ text: 'loved' });
    delete (doc as { caretPositionFromPoint?: unknown }).caretPositionFromPoint;
    verse.remove();
  });
});
