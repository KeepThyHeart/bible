import { describe, expect, it } from 'vitest';
import { computeStyle } from './ToolbarMenu';

const rect = (l: number, t: number, w: number, h: number) =>
  ({ left: l, top: t, width: w, height: h, right: l + w, bottom: t + h, x: l, y: t, toJSON() {} }) as DOMRect;

describe('ToolbarMenu placement (B-188)', () => {
  const anchor = rect(600, 270, 40, 16);
  const panel = rect(0, 0, 160, 100);
  it('places below the trigger in viewport coordinates by default', () => {
    const s = computeStyle(anchor, panel, 'ltr');
    expect(s.top).toBe(290);
    expect(s.insetInlineStart).toBe(600);
  });
  it('subtracts a containing block (e.g. contain: layout) so the menu stays beside its button', () => {
    const s = computeStyle(anchor, panel, 'ltr', rect(48, 100, 1300, 700));
    expect(s.top).toBe(190);
    expect(s.insetInlineStart).toBe(552);
  });
});
