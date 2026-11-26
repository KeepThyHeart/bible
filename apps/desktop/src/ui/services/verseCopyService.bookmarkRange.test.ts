import { describe, it, expect } from 'vitest';
import { getBookmarkRange } from './verseCopyService';

describe('getBookmarkRange', () => {
  it('is null with nothing selected', () => {
    expect(getBookmarkRange(null, null)).toBeNull();
  });

  it('is a single verse without an end', () => {
    expect(getBookmarkRange(43003016, null)).toEqual({ start: 43003016 });
  });

  it('orders a shift-click range', () => {
    expect(getBookmarkRange(43003018, 43003016)).toEqual({ start: 43003016, end: 43003018 });
  });

  it('uses a mouse-drag selection across verses', () => {
    document.body.innerHTML =
      '<div id="r"><span data-verse-id="43003016">a one</span><span data-verse-id="43003017">b two</span><span data-verse-id="43003018">c three</span></div>';
    const r = document.createRange();
    const root = document.getElementById('r')!;
    r.setStart(root.children[0].firstChild!, 0);
    r.setEnd(root.children[2].firstChild!, 3);
    const sel = window.getSelection()!;
    sel.removeAllRanges();
    sel.addRange(r);
    expect(getBookmarkRange(43003016, null)).toEqual({ start: 43003016, end: 43003018 });
    sel.removeAllRanges();
  });
});
