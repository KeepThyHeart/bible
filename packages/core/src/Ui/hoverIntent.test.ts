import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { createHoverIntent } from './hoverIntent';

describe('createHoverIntent', () => {
  beforeEach(() => { vi.useFakeTimers(); });
  afterEach(() => { vi.useRealTimers(); });

  function make() {
    const onShow = vi.fn();
    const onHide = vi.fn();
    return { onShow, onHide, hi: createHoverIntent<string>({ onShow, onHide }) };
  }

  it('shows after the delay with the latest value', () => {
    const { hi, onShow } = make();
    hi.scheduleShow('a');
    vi.advanceTimersByTime(299);
    expect(onShow).not.toHaveBeenCalled();
    hi.scheduleShow('b');
    vi.advanceTimersByTime(300);
    expect(onShow).toHaveBeenCalledTimes(1);
    expect(onShow).toHaveBeenCalledWith('b');
  });

  it('leaving before the show delay cancels the show and, after it, hides later', () => {
    const { hi, onShow, onHide } = make();
    hi.scheduleShow('a');
    hi.scheduleHide();
    vi.advanceTimersByTime(1000);
    expect(onShow).not.toHaveBeenCalled();
    expect(onHide).toHaveBeenCalledTimes(1);
  });

  it('cancelHide lets the pointer reach the popup', () => {
    const { hi, onHide } = make();
    hi.scheduleHide();
    vi.advanceTimersByTime(150);
    hi.cancelHide();
    vi.advanceTimersByTime(1000);
    expect(onHide).not.toHaveBeenCalled();
  });

  it('hideNow hides immediately and clears timers; dispose is silent', () => {
    const { hi, onShow, onHide } = make();
    hi.scheduleShow('a');
    hi.hideNow();
    vi.advanceTimersByTime(1000);
    expect(onShow).not.toHaveBeenCalled();
    expect(onHide).toHaveBeenCalledTimes(1);
    hi.scheduleHide();
    hi.dispose();
    vi.advanceTimersByTime(1000);
    expect(onHide).toHaveBeenCalledTimes(1);
    expect(hi.isPending()).toBe(false);
  });

  it('honours custom delays', () => {
    const onShow = vi.fn();
    const hi = createHoverIntent<number>({ showDelay: 10, hideDelay: 20, onShow, onHide: vi.fn() });
    hi.scheduleShow(1);
    vi.advanceTimersByTime(10);
    expect(onShow).toHaveBeenCalledWith(1);
  });
});
