import { describe, expect, it } from 'vitest';
import { placePopup, quoteFromText, selectionActions, trimRange, type SelectionFacts } from './SelectionPopup';

const facts = (over: Partial<SelectionFacts> = {}): SelectionFacts => ({
  text: 'grace and peace', nonEmpty: true, sameBlock: true, dragging: false, insideItem: false, dismissed: false, chooserOpen: false, ...over,
});

describe('selectionActions', () => {
  it('offers hymn and quote for plain text, verse only for a reference', () => {
    expect(selectionActions(facts())).toEqual({ verse: null, hymn: true, quote: true });
    const ref = selectionActions(facts({ text: ' Jn 3:16 ' }))!;
    expect(ref.verse).toMatchObject({ book: 43, chapter: 3, verseStart: 16 });
    expect(ref.hymn && ref.quote).toBe(true);
  });

  it('shows no popup when the selection is empty, spans blocks, is mid-drag, sits on an item, was dismissed, or the chooser is open', () => {
    for (const over of [
      { nonEmpty: false }, { sameBlock: false }, { dragging: true }, { insideItem: true }, { dismissed: true }, { chooserOpen: true },
      { text: '   ' }, { text: ' — ' },
    ]) expect(selectionActions(facts(over))).toBeNull();
  });
});

describe('trimRange', () => {
  it('drops surrounding whitespace from the range', () => {
    expect(trimRange('  abc ', 10, 16)).toEqual({ from: 12, to: 15 });
    expect(trimRange('abc', 1, 4)).toEqual({ from: 1, to: 4 });
  });
});

describe('quoteFromText', () => {
  it('drops wrapping quote marks and reads a dash attribution', () => {
    expect(quoteFromText('“Grace is free.” – Spurgeon')).toEqual({ kind: 'quote', text: 'Grace is free.', attribution: 'Spurgeon' });
    expect(quoteFromText('"Be still"')).toEqual({ kind: 'quote', text: 'Be still' });
    expect(quoteFromText('plain  words\nhere')).toEqual({ kind: 'quote', text: 'plain words here' });
  });
});

describe('placePopup', () => {
  const vp = { width: 1000, height: 800 };
  const size = { width: 300, height: 40 };
  it('goes above the selection, centred, when there is room', () => {
    const r = { top: 200, bottom: 220, left: 400, right: 400 };
    expect(placePopup(r, { ...r, left: 500, right: 500 }, size, vp)).toEqual({ top: 152, left: 300 });
  });
  it('goes below near the top and stays inside the viewport', () => {
    const start = { top: 10, bottom: 30, left: 980, right: 980 };
    const pos = placePopup(start, start, size, vp);
    expect(pos.top).toBe(38);
    expect(pos.left).toBe(1000 - 300 - 8);
    expect(placePopup({ top: 10, bottom: 30, left: 0, right: 0 }, { top: 790, bottom: 810, left: 0, right: 0 }, size, vp).top).toBe(800 - 40 - 8);
  });
});
