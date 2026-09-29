import { describe, it, expect } from 'vitest';
import { computePopupPosition } from './popupPosition';

const vp = { width: 1000, height: 800 };

describe('computePopupPosition: point anchor (legacy desktop preview)', () => {
  it('sits 20px below the point when there is room', () => {
    const r = computePopupPosition({ anchor: { x: 100, y: 100 }, width: 380, height: 220, viewport: vp });
    expect(r).toMatchObject({ left: 100, top: 120, width: 380, placement: 'below' });
    expect(r.maxHeight).toBe(800 - 120 - 16);
  });

  it('flips above with a 10px gap and constrains height when there is no room below', () => {
    const r = computePopupPosition({ anchor: { x: 100, y: 700 }, width: 380, height: 220, viewport: vp });
    expect(r.placement).toBe('above');
    expect(r.top).toBe(700 - 220 - 10);
    expect(r.maxHeight).toBe(220);
  });

  it('never shrinks a flipped popup under 80px and never leaves the top padding', () => {
    const r = computePopupPosition({ anchor: { x: 100, y: 40 }, width: 380, height: 900, viewport: { width: 1000, height: 100 } });
    expect(r.placement).toBe('above');
    expect(r.top).toBe(16);
    expect(r.maxHeight).toBe(80);
  });

  it('clamps horizontally and to the viewport width', () => {
    expect(computePopupPosition({ anchor: { x: 900, y: 10 }, width: 380, height: 100, viewport: vp }).left).toBe(1000 - 380 - 16);
    expect(computePopupPosition({ anchor: { x: 0, y: 10 }, width: 380, height: 100, viewport: vp }).left).toBe(16);
    expect(computePopupPosition({ anchor: { x: 10, y: 10 }, width: 380, height: 100, viewport: { width: 300, height: 800 } }).width).toBe(268);
  });

  it('honours an explicit offset', () => {
    const r = computePopupPosition({ anchor: { x: 100, y: 100 }, width: 100, height: 50, viewport: vp, offset: 4 });
    expect(r.top).toBe(104);
  });
});

describe('computePopupPosition: rectangle anchor', () => {
  const rect = { left: 300, right: 360, top: 200, bottom: 216 };

  it('LTR: starts at the anchor left edge, 4px below', () => {
    const r = computePopupPosition({ anchor: rect, width: 200, height: 100, viewport: vp });
    expect(r).toMatchObject({ left: 300, top: 220, placement: 'below' });
  });

  it('RTL: the popup right edge lines up with the anchor right edge', () => {
    const r = computePopupPosition({ anchor: rect, width: 200, height: 100, viewport: vp, dir: 'rtl' });
    expect(r.left).toBe(160);
  });

  it('align end mirrors align start', () => {
    expect(computePopupPosition({ anchor: rect, width: 200, height: 100, viewport: vp, align: 'end' }).left).toBe(160);
    expect(computePopupPosition({ anchor: rect, width: 200, height: 100, viewport: vp, align: 'end', dir: 'rtl' }).left).toBe(300);
  });

  it('center aligns on the anchor centre', () => {
    expect(computePopupPosition({ anchor: rect, width: 200, height: 100, viewport: vp, align: 'center' }).left).toBe(230);
  });

  it('flips above the rectangle with a 4px gap', () => {
    const low = { left: 300, right: 360, top: 740, bottom: 756 };
    const r = computePopupPosition({ anchor: low, width: 200, height: 120, viewport: vp });
    expect(r.placement).toBe('above');
    expect(r.top).toBe(740 - 4 - 120);
  });

  it('can be forced above or below', () => {
    expect(computePopupPosition({ anchor: rect, width: 200, height: 100, viewport: vp, placement: 'above' }).placement).toBe('above');
  });

  it('clamps RTL near the left edge and reports an in-popup arrow offset', () => {
    const r = computePopupPosition({ anchor: { left: 20, right: 40, top: 100, bottom: 116 }, width: 300, height: 100, viewport: vp, dir: 'rtl' });
    expect(r.left).toBe(16);
    expect(r.arrowOffset).toBeGreaterThanOrEqual(12);
    expect(r.arrowOffset).toBeLessThanOrEqual(r.width - 12);
  });
});
