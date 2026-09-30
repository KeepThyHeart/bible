import { describe, it, expect, vi } from 'vitest';
import { scrollToOccurrence, stepIndex, KEYWORD_FLASH_CLASS } from './keywordStep';
import { toSharedRows, toSharedSuggestions, suggestionToWord } from './keywordLegendModel';

describe('stepIndex', () => {
  it('wraps in both directions and starts from the ends', () => {
    expect(stepIndex(-1, 3, 'next')).toBe(0);
    expect(stepIndex(2, 3, 'next')).toBe(0);
    expect(stepIndex(-1, 3, 'prev')).toBe(2);
    expect(stepIndex(0, 3, 'prev')).toBe(2);
    expect(stepIndex(1, 3, 'prev')).toBe(0);
    expect(stepIndex(0, 0, 'next')).toBe(-1);
  });
});

describe('scrollToOccurrence', () => {
  it('scrolls to the word and flashes it, falling back to the verse', () => {
    vi.useFakeTimers();
    const root = document.createElement('div');
    root.innerHTML = '<div data-verse-id="5"><span class="word" data-word-index="2">x</span></div><div data-verse-id="6"></div>';
    const scroll = vi.fn();
    Element.prototype.scrollIntoView = scroll;
    const word = root.querySelector('.word')!;
    expect(scrollToOccurrence(root, { verseId: 5, start: 2, end: 2 })).toBe(true);
    expect(word.classList.contains(KEYWORD_FLASH_CLASS)).toBe(true);
    vi.advanceTimersByTime(2000);
    expect(word.classList.contains(KEYWORD_FLASH_CLASS)).toBe(false);
    expect(scrollToOccurrence(root, { verseId: 6, start: 0, end: 0 })).toBe(true);
    expect(scrollToOccurrence(root, { verseId: 9, start: 0, end: 0 })).toBe(false);
    vi.useRealTimers();
  });
});

describe('legend model', () => {
  const row = {
    markId: 'm', setId: 'builtin:x', setName: 'Set', hits: 3, verseCount: 2, hidden: false,
    mark: { id: 'm', label: 'therefore', rule: { kind: 'connective' as const, category: 'inference' as const }, style: { color: 'mark.2' as const, line: 'dashed' as const, symbol: 'star' as never }, enabled: true },
  };
  it('marks connective rows approximate without interlinear rows', () => {
    const [r] = toSharedRows([row], { showSetNames: true, hasInterlinear: false });
    expect(r).toMatchObject({ id: 'm', count: 3, approximate: true, setName: 'Set', color: 'mark.2' });
    expect(toSharedRows([row], { showSetNames: false, hasInterlinear: true })[0].approximate).toBeUndefined();
  });
  it('maps suggestions back to word or Strong\'s marks', () => {
    const list = [
      { label: 'faith', rule: { kind: 'word' as const, forms: ['faith'] }, count: 4, verses: [1] },
      { label: 'pistis', rule: { kind: 'strongs' as const, numbers: ['G4102'] }, count: 3, verses: [1] },
    ];
    expect(toSharedSuggestions(list).map((s) => s.key)).toEqual(['0', '1']);
    expect(suggestionToWord(list[0])).toEqual({ word: { text: 'faith' }, kind: 'word' });
    expect(suggestionToWord(list[1])).toEqual({ word: { text: 'pistis', strongs: 'G4102' }, kind: 'strongs' });
  });
});
