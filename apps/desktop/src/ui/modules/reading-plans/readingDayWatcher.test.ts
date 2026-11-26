import { describe, it, expect, vi, afterEach } from 'vitest';
import { msUntilNextRollover, watchReadingDay } from './readingDayWatcher';

afterEach(() => { vi.useRealTimers(); });

describe('msUntilNextRollover', () => {
  it('targets the next rollover hour, today or tomorrow', () => {
    expect(msUntilNextRollover(new Date(2026, 9, 1, 1, 0), 3)).toBe(2 * 3600_000);
    expect(msUntilNextRollover(new Date(2026, 9, 1, 12, 0), 3)).toBe(15 * 3600_000);
    expect(msUntilNextRollover(new Date(2026, 9, 1, 3, 0), 3)).toBe(24 * 3600_000);
  });
});

describe('watchReadingDay', () => {
  it('ticks at the rollover boundary, re-arms, and ticks on focus', () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date(2026, 9, 1, 22, 0));
    const onTick = vi.fn();
    const stop = watchReadingDay(onTick, () => 3);
    vi.advanceTimersByTime(4 * 3600_000);
    expect(onTick).not.toHaveBeenCalled();
    vi.advanceTimersByTime(1 * 3600_000);
    expect(onTick).toHaveBeenCalledTimes(1);
    vi.advanceTimersByTime(24 * 3600_000);
    expect(onTick).toHaveBeenCalledTimes(2);
    window.dispatchEvent(new Event('focus'));
    expect(onTick).toHaveBeenCalledTimes(3);
    stop();
    window.dispatchEvent(new Event('focus'));
    vi.advanceTimersByTime(48 * 3600_000);
    expect(onTick).toHaveBeenCalledTimes(3);
  });
});

describe('watchReadingDay re-arming', () => {
  it('re-aims the timeout when the rollover preference changes', async () => {
    const { usePreferencesStore } = await import('../../stores/usePreferencesStore');
    vi.useFakeTimers();
    vi.setSystemTime(new Date(2026, 9, 1, 22, 0));
    let hour = 3;
    usePreferencesStore.setState({ readingPlanRolloverHour: 3 });
    const onTick = vi.fn();
    const stop = watchReadingDay(onTick, () => hour);
    hour = 23; // would fire in 1 hour, not 5
    usePreferencesStore.setState({ readingPlanRolloverHour: 23 });
    expect(onTick).toHaveBeenCalledTimes(1); // the change itself ticks at once
    vi.advanceTimersByTime(3600_000);
    expect(onTick).toHaveBeenCalledTimes(2);
    stop();
    usePreferencesStore.setState({ readingPlanRolloverHour: 4 });
    vi.advanceTimersByTime(48 * 3600_000);
    expect(onTick).toHaveBeenCalledTimes(2);
  });
});
