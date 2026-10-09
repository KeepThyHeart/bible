import { describe, it, expect, vi } from 'vitest';
import { IpcReadingPlanStore } from './readingPlansAPI';
import { createModuleClient } from '../../services/moduleClient';
import type { ReadingPlansApi } from '../../../../electron/modules/reading-plans/types';

function storeOver(invoke: (ns: string, method: string, ...args: unknown[]) => Promise<unknown>) {
  return new IpcReadingPlanStore(createModuleClient<ReadingPlansApi>('reading-plans', () => ({ invoke, on: vi.fn() })));
}

describe('IpcReadingPlanStore', () => {
  it('maps every store method onto its module method and unwraps results', async () => {
    const invoke = vi.fn(async (_ns: string, method: string) => ({ ok: true as const, value: method.startsWith('list') ? [] : undefined }));
    const store = storeOver(invoke);
    expect(await store.listPlans()).toEqual([]);
    await store.removePlan('user:x');
    await store.removeEnrollment('e1');
    expect(await store.listCompletions('e1')).toEqual([]);
    await store.setCompletions([]);
    expect(invoke.mock.calls).toEqual([
      ['reading-plans', 'listPlans'], ['reading-plans', 'removePlan', 'user:x'], ['reading-plans', 'removeEnrollment', 'e1'],
      ['reading-plans', 'listCompletions', 'e1'], ['reading-plans', 'setCompletions', []],
    ]);
  });

  it('throws on an error result', async () => {
    const invoke = vi.fn(async () => ({ ok: false as const, error: { code: 'invalid_input', message: 'bad' } }));
    await expect(storeOver(invoke).listPlans()).rejects.toThrow();
  });
});
