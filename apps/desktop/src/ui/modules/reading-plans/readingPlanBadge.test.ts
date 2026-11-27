import { describe, it, expect, afterEach, vi } from 'vitest';
import { appRegistry } from '../../apps/appHost';
import { installTestService, uninstallTestService } from './ReadingPlans/testSupport';
import { activateReadingPlanBadge } from './readingPlanBadge';
import { useReadingPlanStore } from './useReadingPlanStore';

vi.mock('../../services/electronAPI', () => ({ bibleAPI: { getAllBooks: vi.fn().mockResolvedValue([]) } }));


afterEach(() => { vi.restoreAllMocks(); vi.useRealTimers(); uninstallTestService(); appRegistry.setBadge('reading-plans', undefined); });

describe('activateReadingPlanBadge', () => {
  it('sets a dot labelled with the first unticked reading, clears when ticked and on dispose', async () => {
    const { service } = installTestService();
    const e = await service.startPlan('stock:gospels-30', { startDate: '2026-10-01', pacing: 'flexible' });
    const spy = vi.spyOn(appRegistry, 'setBadge');
    const d = activateReadingPlanBadge();
    await vi.waitFor(() => expect(spy).toHaveBeenCalledWith('reading-plans', expect.objectContaining({ kind: 'dot', tone: 'neutral' })));
    const set = spy.mock.calls.filter((c) => c[1]).at(-1)![1] as { label: string };
    expect(set.label).toMatch(/^Today: /);

    const detail = await service.detail(e.id);
    const count = detail.plan.days[0].readings.length;
    for (let i = 0; i < count; i++) await service.setReadingDone(e.id, 1, i, true);
    await useReadingPlanStore.getState().refresh();
    await vi.waitFor(() => expect(spy.mock.calls.at(-1)![1]).toBeUndefined());

    d.dispose();
    expect(spy.mock.calls.at(-1)).toEqual(['reading-plans', undefined]);
  });

  it('does nothing without plans', async () => {
    installTestService();
    const spy = vi.spyOn(appRegistry, 'setBadge');
    const d = activateReadingPlanBadge();
    await useReadingPlanStore.getState().ensureLoaded();
    expect(spy.mock.calls.every((c) => c[1] === undefined)).toBe(true);
    d.dispose();
  });
});
