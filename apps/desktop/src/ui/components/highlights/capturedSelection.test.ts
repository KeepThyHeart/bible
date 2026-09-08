/**
 * The one implementation of "map a DOM selection to verse/word indices".
 *
 * These tests drive `wordSelectionFromElements` directly with element runs
 * rather than through a live `Selection`, because jsdom's selection support is
 * too thin to build a trustworthy multi-element `Range`; the range-to-elements
 * half is covered by `floatingAnnotationFlow.test.tsx` and by
 * `e2e/tests/highlight-diagnosis.spec.ts` with real mouse events.
 */
import { describe, it, expect } from 'vitest';
import { wordSelectionFromElements } from './capturedSelection';

function build(html: string): HTMLElement {
  const root = document.createElement('div');
  root.innerHTML = html;
  return root;
}

function wordsOf(root: HTMLElement): HTMLElement[] {
  return Array.from(root.querySelectorAll<HTMLElement>('.word'));
}

describe('wordSelectionFromElements', () => {
  it('returns null for an empty run', () => {
    expect(wordSelectionFromElements([])).toBeNull();
  });

  it('returns null when the words have no verse to anchor them to', () => {
    const root = build('<span class="word" data-word-index="0">For</span>');
    expect(wordSelectionFromElements(wordsOf(root))).toBeNull();
  });

  it('maps a run inside a single verse, leaving endVerseId undefined', () => {
    const root = build(`
      <div data-verse-id="43003016">
        <span class="word" data-word-index="0">For</span>
        <span class="word" data-word-index="1">God</span>
        <span class="word" data-word-index="2">so</span>
      </div>
    `);
    expect(wordSelectionFromElements(wordsOf(root))).toEqual({
      startVerseId: 43003016,
      startWordIndex: 0,
      endVerseId: undefined,
      endWordIndex: 2,
    });
  });

  it('carries both verse ids when the run crosses a verse boundary', () => {
    const root = build(`
      <div>
        <div data-verse-id="43003016"><span class="word" data-word-index="23">everlasting</span></div>
        <div data-verse-id="43003017"><span class="word" data-word-index="1">God</span></div>
      </div>
    `);
    expect(wordSelectionFromElements(wordsOf(root))).toEqual({
      startVerseId: 43003016,
      startWordIndex: 23,
      endVerseId: 43003017,
      endWordIndex: 1,
    });
  });

  it('prefers data-word-index-end on the last element when present', () => {
    // A renderer whose last element covers several words must be able to say
    // so, or the selection would silently stop at that element's first word.
    const root = build(`
      <div data-verse-id="1001001">
        <span class="word" data-word-index="0">In</span>
        <span class="word" data-word-index="1" data-word-index-end="3">the beginning God</span>
      </div>
    `);
    expect(wordSelectionFromElements(wordsOf(root))).toMatchObject({
      startVerseId: 1001001,
      startWordIndex: 0,
      endWordIndex: 3,
    });
  });

  it('falls back to data-word-index when data-word-index-end is absent', () => {
    const root = build(`
      <div data-verse-id="1001001">
        <span class="word" data-word-index="0">In</span>
        <span class="word" data-word-index="1">the</span>
      </div>
    `);
    expect(wordSelectionFromElements(wordsOf(root))).toMatchObject({ endWordIndex: 1 });
  });

  it('ignores data-word-index-end on anything but the last element', () => {
    const root = build(`
      <div data-verse-id="1001001">
        <span class="word" data-word-index="0" data-word-index-end="9">In</span>
        <span class="word" data-word-index="1">the</span>
      </div>
    `);
    expect(wordSelectionFromElements(wordsOf(root))).toMatchObject({
      startWordIndex: 0,
      endWordIndex: 1,
    });
  });
});
