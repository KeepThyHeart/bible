import { describe, it, expect, vi } from 'vitest';
import {
  shouldGateDrag,
  gateDragEvent,
  exceedsDragThreshold,
  DRAG_GATE_THRESHOLD_PX,
} from './AdvancedPaneManagerGate';

describe('shouldGateDrag', () => {
  it('gates the drag when Advanced Pane Manager mode is off', () => {
    expect(shouldGateDrag(false)).toBe(true);
  });

  it('lets the drag through when Advanced Pane Manager mode is on', () => {
    expect(shouldGateDrag(true)).toBe(false);
  });
});

describe('gateDragEvent', () => {
  it('cancels the event and reports the drag as gated when the mode is off', () => {
    const cancel = vi.fn();
    const onGated = vi.fn();

    const intercepted = gateDragEvent(false, cancel, onGated);

    expect(intercepted).toBe(true);
    expect(cancel).toHaveBeenCalledOnce();
    expect(onGated).toHaveBeenCalledOnce();
  });

  it('leaves the event alone and reports nothing gated when the mode is on', () => {
    const cancel = vi.fn();
    const onGated = vi.fn();

    const intercepted = gateDragEvent(true, cancel, onGated);

    expect(intercepted).toBe(false);
    expect(cancel).not.toHaveBeenCalled();
    expect(onGated).not.toHaveBeenCalled();
  });

  it('cancels but stays quiet while the pointer is still under the threshold', () => {
    // The whole point of the threshold: a nudge on a tab must not throw a modal
    // in the user's face. The drag is still refused - only the dialog waits.
    const cancel = vi.fn();
    const onGated = vi.fn();

    const intercepted = gateDragEvent(false, cancel, onGated, {
      origin: { x: 100, y: 100 },
      current: { x: 103, y: 100 },
    });

    expect(intercepted).toBe(true);
    expect(cancel).toHaveBeenCalledOnce();
    expect(onGated).not.toHaveBeenCalled();
  });

  it('reports the drag once the pointer has moved past the threshold', () => {
    const cancel = vi.fn();
    const onGated = vi.fn();

    gateDragEvent(false, cancel, onGated, {
      origin: { x: 100, y: 100 },
      current: { x: 140, y: 100 },
    });

    expect(cancel).toHaveBeenCalledOnce();
    expect(onGated).toHaveBeenCalledOnce();
  });

  it('honours a caller-supplied threshold', () => {
    const onGated = vi.fn();
    gateDragEvent(false, vi.fn(), onGated, {
      origin: { x: 0, y: 0 },
      current: { x: 3, y: 0 },
      thresholdPx: 2,
    });
    expect(onGated).toHaveBeenCalledOnce();
  });

  it('never gates when the preference is on, threshold or not', () => {
    const cancel = vi.fn();
    const onGated = vi.fn();

    const intercepted = gateDragEvent(true, cancel, onGated, {
      origin: { x: 0, y: 0 },
      current: { x: 500, y: 500 },
    });

    expect(intercepted).toBe(false);
    expect(cancel).not.toHaveBeenCalled();
    expect(onGated).not.toHaveBeenCalled();
  });
});

describe('exceedsDragThreshold', () => {
  const origin = { x: 100, y: 100 };

  it('is false for movement below the threshold', () => {
    expect(exceedsDragThreshold(origin, { x: 105, y: 100 })).toBe(false);
    expect(exceedsDragThreshold(origin, { x: 100, y: 100 })).toBe(false);
  });

  it('is true for movement past the threshold', () => {
    expect(exceedsDragThreshold(origin, { x: 109, y: 100 })).toBe(true);
    expect(exceedsDragThreshold(origin, { x: 100, y: 91 })).toBe(true);
  });

  it('treats exactly the threshold as not yet a drag', () => {
    expect(exceedsDragThreshold(origin, { x: 100 + DRAG_GATE_THRESHOLD_PX, y: 100 })).toBe(false);
  });

  it('measures straight-line distance, not each axis separately', () => {
    // 6px right and 6px down is 8.49px of travel - over the threshold - even
    // though neither axis alone is.
    expect(exceedsDragThreshold(origin, { x: 106, y: 106 })).toBe(true);
    // 3-4-5 triangle: exactly 5px of travel, comfortably under.
    expect(exceedsDragThreshold(origin, { x: 103, y: 104 })).toBe(false);
  });

  it('is direction-agnostic', () => {
    expect(exceedsDragThreshold(origin, { x: 80, y: 100 })).toBe(true);
    expect(exceedsDragThreshold(origin, { x: 100, y: 130 })).toBe(true);
  });

  it('reports false when no pointerdown origin was seen', () => {
    // Nothing to measure against - the caller still cancels the drag, it just
    // doesn't raise a modal the user cannot connect to a gesture of theirs.
    expect(exceedsDragThreshold(null, { x: 9999, y: 9999 })).toBe(false);
    expect(exceedsDragThreshold(null, { x: 0, y: 0 }, 0)).toBe(false);
  });

  it('respects a custom threshold', () => {
    expect(exceedsDragThreshold(origin, { x: 120, y: 100 }, 50)).toBe(false);
    expect(exceedsDragThreshold(origin, { x: 102, y: 100 }, 1)).toBe(true);
  });
});
