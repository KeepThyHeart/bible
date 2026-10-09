import { describe, it, expect, vi, afterEach } from 'vitest';
import { installTestService, uninstallTestService } from './ReadingPlans/testSupport';
import { useReadingPlanStore } from './useReadingPlanStore';

afterEach(() => { uninstallTestService(); vi.useRealTimers(); });

describe('useReadingPlanStore day rollover', () => {
  it('refreshes on window focus and at the rollover boundary', async () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'Date'] });
    vi.setSystemTime(new Date(2026, 9, 1, 12, 0));
    const { service } = installTestService();
    const spy = vi.spyOn(service, 'todayViews');
    await useReadingPlanStore.getState().refresh();
    expect(spy).toHaveBeenCalledTimes(1);
    window.dispatchEvent(new Event('focus'));
    await vi.advanceTimersByTimeAsync(0);
    expect(spy).toHaveBeenCalledTimes(2);
    await vi.advanceTimersByTimeAsync(16 * 3600_000);
    expect(spy).toHaveBeenCalledTimes(3);
  });
});
