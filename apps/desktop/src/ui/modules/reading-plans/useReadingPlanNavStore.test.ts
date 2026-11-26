import { describe, it, expect, vi, afterEach } from 'vitest';

const openApp = vi.fn().mockResolvedValue(undefined);
vi.mock('../../apps/appHost', () => ({ openApp: (...a: unknown[]) => openApp(...a) }));

import { useReadingPlanNavStore, viewPlanReading, resetReadingPlanNavForTests, validScheduleUndo } from './useReadingPlanNavStore';

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

  it('keeps the move-the-dates undo only until the next reading day or a schedule edit', () => {
    const undo = { enrollmentId: 'e1', oldStartDate: '2026-11-01', oldCatchUp: null, newStartDate: '2026-11-10', movedOn: '2026-11-10' };
    useReadingPlanNavStore.getState().setScheduleUndo(undo);
    expect(useReadingPlanNavStore.getState().scheduleUndo).toEqual(undo);
    expect(validScheduleUndo(undo, { id: 'e1', startDate: '2026-11-10' }, '2026-11-10')).toBe(undo);
    expect(validScheduleUndo(undo, { id: 'e1', startDate: '2026-11-10' }, null)).toBe(undo);
    expect(validScheduleUndo(undo, { id: 'e1', startDate: '2026-11-10' }, '2026-11-11')).toBeNull();
    expect(validScheduleUndo(undo, { id: 'e1', startDate: '2026-11-12' }, '2026-11-10')).toBeNull();
    expect(validScheduleUndo(undo, { id: 'e2', startDate: '2026-11-10' }, '2026-11-10')).toBeNull();
    expect(validScheduleUndo(null, { id: 'e1', startDate: '2026-11-10' }, '2026-11-10')).toBeNull();
  });
});
