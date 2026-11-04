import { describe, it, expect } from 'vitest';
import { divineRangesFromHtml, markUp } from './SearchMarkup';

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
