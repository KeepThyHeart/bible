import { describe, it, expect } from 'vitest';
import { divineRangesFromHtml, christRangesFromHtml, markUp } from './SearchMarkup';

const html = 'In the mount of <span class="divine-name">Lord</span> it shall be seen. O Lord.';
const plain = 'In the mount of Lord it shall be seen. O Lord.';

describe('search divine-name markup (B-167)', () => {
  it('finds the YHWH range and not the Adonai one', () => {
    expect(divineRangesFromHtml(html, plain)).toEqual([{ start: 16, end: 20 }]);
  });
  it('refuses offsets it cannot trust', () => {
    expect(divineRangesFromHtml(html, plain + ' extra')).toBeNull();
  });
  it('lays divine and match markup together, well formed', () => {
    const out = markUp(plain, 0, plain.length, [{ start: 13, end: 20 }], [{ start: 16, end: 20 }]);
    expect(out).toContain('<span class="divine-name"><strong><u>Lord</u></strong></span>');
    expect(out.startsWith('In the mount <strong><u>of </u></strong>')).toBe(true);
    expect(out.endsWith('O Lord.')).toBe(true);
  });
  it('clips to a window', () => {
    expect(markUp(plain, 13, 23, [], [{ start: 16, end: 20 }])).toBe('of <span class="divine-name">Lord</span> it');
  });
});

describe('search red-letter markup', () => {
  const h = 'And he said, <span class="christ-words">Follow me, and I will make you fishers</span> of men.';
  const p = 'And he said, Follow me, and I will make you fishers of men.';
  it('finds the Words of Christ range', () => {
    expect(christRangesFromHtml(h, p)).toEqual([{ start: 13, end: 51 }]);
    expect(christRangesFromHtml(p, p)).toEqual([]);
    expect(christRangesFromHtml(h, p + 'x')).toBeNull();
  });
  it('wraps christ-words around divine-name and match markup, well formed', () => {
    const out = markUp(p, 0, p.length, [{ start: 20, end: 22 }], [{ start: 13, end: 19 }], [{ start: 13, end: 51 }]);
    expect(out).toContain('<span class="christ-words"><span class="divine-name">Follow</span></span>');
    expect(out).toContain('<span class="christ-words"><strong><u>me</u></strong></span>');
    expect(out.startsWith('And he said, ')).toBe(true);
    expect(out.endsWith(' of men.')).toBe(true);
  });
});
