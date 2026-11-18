import { describe, it, expect, vi, afterEach } from 'vitest';

const openApp = vi.fn().mockResolvedValue(undefined);
vi.mock('../../apps/appHost', () => ({ openApp: (...a: unknown[]) => openApp(...a) }));

import { useReadingPlanNavStore, viewPlanReading, resetReadingPlanNavForTests } from './useReadingPlanNavStore';

describe('useReadingPlanNavStore', () => {
  afterEach(() => { resetReadingPlanNavForTests(); openApp.mockClear(); });

  it('records a request with a fresh nonce and consumes it once', () => {
    const { show, consume } = useReadingPlanNavStore.getState();
    show({ enrollmentId: 'e1', day: 2, index: 1 });
    const first = useReadingPlanNavStore.getState().request;
    expect(first).toMatchObject({ enrollmentId: 'e1', day: 2, index: 1 });
    expect(consume()).toEqual(first);
    expect(consume()).toBeNull();
    show({ enrollmentId: 'e1', day: 2, index: 1 });
    expect(useReadingPlanNavStore.getState().request?.nonce).not.toBe(first?.nonce);
  });

  it('viewPlanReading shows the request and opens the app', () => {
    viewPlanReading({ enrollmentId: 'e2', day: 3, index: 0 });
    expect(useReadingPlanNavStore.getState().request).toMatchObject({ enrollmentId: 'e2', day: 3, index: 0 });
    expect(openApp).toHaveBeenCalledWith('reading-plans');
  });
});
