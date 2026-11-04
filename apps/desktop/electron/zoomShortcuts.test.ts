import { describe, expect, it } from 'vitest';
import { isZoomInAlias } from './zoomShortcuts';

describe('isZoomInAlias (B-045)', () => {
  it('matches Ctrl/Cmd + "+" on key down', () => {
    expect(isZoomInAlias({ type: 'keyDown', key: '+', control: true })).toBe(true);
    expect(isZoomInAlias({ type: 'keyDown', key: '+', meta: true })).toBe(true);
  });
  it('does not match "=" (the menu accelerator already handles it)', () => {
    expect(isZoomInAlias({ type: 'keyDown', key: '=', control: true })).toBe(false);
  });
  it('needs a modifier and a key down', () => {
    expect(isZoomInAlias({ type: 'keyDown', key: '+' })).toBe(false);
    expect(isZoomInAlias({ type: 'keyUp', key: '+', control: true })).toBe(false);
  });
});
