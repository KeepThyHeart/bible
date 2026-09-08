import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { activateWhenContentReady, PANE_HANDOFF_CAP_MS } from './paneHandoff';

describe('activateWhenContentReady', () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it('switches as soon as the content settles, without waiting out the cap', async () => {
    const activate = vi.fn();
    activateWhenContentReady(activate, Promise.resolve('loaded'));

    expect(activate).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(0);
    expect(activate).toHaveBeenCalledTimes(1);
  });

  it('switches at the cap when the content is still loading', async () => {
    const activate = vi.fn();
    let settle: () => void = () => {};
    activateWhenContentReady(activate, new Promise<void>(resolve => { settle = resolve; }));

    await vi.advanceTimersByTimeAsync(PANE_HANDOFF_CAP_MS - 1);
    expect(activate).not.toHaveBeenCalled();

    await vi.advanceTimersByTimeAsync(1);
    expect(activate).toHaveBeenCalledTimes(1);

    // The late arrival must not switch a second time.
    settle();
    await vi.advanceTimersByTimeAsync(100);
    expect(activate).toHaveBeenCalledTimes(1);
  });

  it('still switches when the content fails to load', async () => {
    const activate = vi.fn();
    activateWhenContentReady(activate, Promise.reject(new Error('no such topic')));

    await vi.advanceTimersByTimeAsync(0);
    expect(activate).toHaveBeenCalledTimes(1);
  });

  it('honours an explicit cap', async () => {
    const activate = vi.fn();
    activateWhenContentReady(activate, new Promise(() => {}), 200);

    await vi.advanceTimersByTimeAsync(PANE_HANDOFF_CAP_MS);
    expect(activate).not.toHaveBeenCalled();

    await vi.advanceTimersByTimeAsync(200);
    expect(activate).toHaveBeenCalledTimes(1);
  });
});
