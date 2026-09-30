import { describe, expect, it } from 'vitest';
import { pinchStep } from './pointerGestures';

describe('pinchStep', () => {
  it('reports the distance ratio and midpoint', () => {
    expect(pinchStep([100, 200], [80, 240])).toEqual({ ratio: 1.6, mid: 160, midDelta: 10 });
  });
  it('ignores pointers that are almost on top of each other', () => {
    expect(pinchStep([100, 103], [100, 200])).toBeNull();
  });
});
