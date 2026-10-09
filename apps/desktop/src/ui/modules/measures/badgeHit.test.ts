import { describe, it, expect } from 'vitest';
import { isMeasureHit, isFallbackOnlyWord, pointerInText, isInterlinearOriginalTarget } from './badgeHit';

function wordWithRects(rects: Array<[number, number, number, number]>): HTMLElement {
  const el = document.createElement('span');
  el.textContent = 'cubits';
  document.body.appendChild(el);
  Range.prototype.getClientRects = function () {
    return rects.map(([left, top, right, bottom]) => ({ left, top, right, bottom })) as unknown as DOMRectList;
  };
  return el;
}

const kinds: Record<string, string> = { a: 'verse', b: 'tokens', c: 'verse' };
const index = {
  at: () => [] as string[],
  occurrence: (id: string) => ({ anchor: { target: { kind: kinds[id] } } }),
};

describe('badgeHit', () => {
  it('detects pointer inside text rects', () => {
    const el = wordWithRects([[0, 0, 50, 20]]);
    expect(pointerInText(el, 10, 10)).toBe(true);
    expect(pointerInText(el, 60, 10)).toBe(false);
  });
  it('fallback-only word: text is not a hit, badge is', () => {
    const el = wordWithRects([[0, 0, 50, 20]]);
    expect(isFallbackOnlyWord(index, ['a', 'c'])).toBe(true);
    expect(isMeasureHit(el, index, ['a'], 10, 10)).toBe(false);
    expect(isMeasureHit(el, index, ['a'], 58, 10)).toBe(true);
  });
  it('mixed word is always a hit', () => {
    const el = wordWithRects([[0, 0, 50, 20]]);
    expect(isMeasureHit(el, index, ['a', 'b'], 10, 10)).toBe(true);
  });
  it('recognizes interlinear original elements', () => {
    const d = document.createElement('div');
    d.innerHTML = '<span id="o" data-testid="interlinear-original" class="verse__interlinear-original"><i id="i">x</i></span><b id="p">y</b>';
    document.body.appendChild(d);
    expect(isInterlinearOriginalTarget(d.querySelector('#i'))).toBe(true);
    expect(isInterlinearOriginalTarget(d.querySelector('#p'))).toBe(false);
  });
});
