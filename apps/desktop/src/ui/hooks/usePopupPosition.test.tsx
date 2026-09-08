/**
 * Tests for the shared popup positioning hook (5.1 - hover popup placement).
 *
 * jsdom returns a fixed 1024x768 `window.innerWidth`/`innerHeight` and all-zero
 * `getBoundingClientRect()`/`scrollHeight` results, so collision branches never
 * trigger unless the viewport is mocked to near-edge values - an easy gap for
 * edge-collision behavior to go untested. These tests mock
 * `window.innerWidth`/`innerHeight` directly to exercise the right-edge and
 * bottom-edge collision paths.
 */
import { describe, it, expect, afterEach } from 'vitest';
import { render } from '@testing-library/react';
import { usePopupPosition, type PopupPositionInput, type PopupPositionOptions } from './usePopupPosition';

function Harness({ position, options }: { position: PopupPositionInput; options: PopupPositionOptions }) {
  const { ref, style } = usePopupPosition(position, options);
  return (
    <div ref={ref} data-testid="popup" style={style}>
      popup content
    </div>
  );
}

function setViewport(width: number, height: number) {
  Object.defineProperty(window, 'innerWidth', { writable: true, configurable: true, value: width });
  Object.defineProperty(window, 'innerHeight', { writable: true, configurable: true, value: height });
}

const DEFAULT_VIEWPORT = { width: 1024, height: 768 };

describe('usePopupPosition', () => {
  afterEach(() => {
    setViewport(DEFAULT_VIEWPORT.width, DEFAULT_VIEWPORT.height);
  });

  it('places the popup at the trigger point (offset below) when there is room', () => {
    setViewport(1024, 768);
    const { getByTestId } = render(
      <Harness position={{ x: 100, y: 100 }} options={{ width: 380, estimatedHeight: 200 }} />,
    );
    const el = getByTestId('popup');
    expect(el.style.left).toBe('100px');
    expect(el.style.top).toBe('120px'); // default offsetY = 20
  });

  it('shifts left when the trigger point is near the right edge', () => {
    setViewport(800, 600);
    const { getByTestId } = render(
      <Harness position={{ x: 780, y: 100 }} options={{ width: 380, estimatedHeight: 200 }} />,
    );
    const el = getByTestId('popup');
    const left = parseFloat(el.style.left);
    // Popup must fully fit within the viewport width, padding included.
    expect(left + 380).toBeLessThanOrEqual(800 - 16);
    // And it must actually have moved off the raw trigger x to make that fit.
    expect(left).toBeLessThan(780);
  });

  it('flips above the trigger point with a maxHeight when there is no room below', () => {
    setViewport(800, 400);
    const { getByTestId } = render(
      <Harness position={{ x: 100, y: 380 }} options={{ width: 280, estimatedHeight: 200 }} />,
    );
    const el = getByTestId('popup');
    const top = parseFloat(el.style.top);
    // Flipped: sits above the trigger point instead of being pushed off-screen below it.
    expect(top).toBeLessThan(380);
    expect(top).toBeGreaterThanOrEqual(16); // still respects top padding
    // Height is constrained, not just repositioned.
    expect(el.style.maxHeight).not.toBe('');
    expect(parseFloat(el.style.maxHeight)).toBeGreaterThan(0);
  });

  it('never renders outside the viewport regardless of trigger position', () => {
    setViewport(1024, 768);
    const { getByTestId } = render(
      <Harness position={{ x: 1020, y: 760 }} options={{ width: 380, estimatedHeight: 300 }} />,
    );
    const el = getByTestId('popup');
    const left = parseFloat(el.style.left);
    const top = parseFloat(el.style.top);
    const width = parseFloat(el.style.width);
    const maxHeight = parseFloat(el.style.maxHeight);

    expect(left).toBeGreaterThanOrEqual(0);
    expect(left + width).toBeLessThanOrEqual(1024);
    expect(top).toBeGreaterThanOrEqual(0);
    expect(top + maxHeight).toBeLessThanOrEqual(768);
  });

  it('clamps popup width to the viewport on very narrow windows', () => {
    setViewport(300, 600);
    const { getByTestId } = render(
      <Harness position={{ x: 50, y: 50 }} options={{ width: 380, estimatedHeight: 100 }} />,
    );
    const el = getByTestId('popup');
    const width = parseFloat(el.style.width);
    expect(width).toBeLessThanOrEqual(300 - 16 * 2);
  });
});
