import { describe, it, expect, vi } from 'vitest';
import { IpcReadingPlanStore } from './readingPlansAPI';

describe('IpcReadingPlanStore', () => {
  it('maps every store method onto its channel and unwraps results', async () => {
    const invoke = vi.fn(async (channel: string) => ({ ok: true as const, value: channel.startsWith('reading-plans:list') ? [] : undefined }));
    const store = new IpcReadingPlanStore(invoke as never);
    expect(await store.listPlans()).toEqual([]);
    await store.removePlan('user:x');
    await store.removeEnrollment('e1');
    expect(await store.listCompletions('e1')).toEqual([]);
    await store.setCompletions([]);
    expect(invoke.mock.calls).toEqual([
      ['reading-plans:list-plans'], ['reading-plans:remove-plan', 'user:x'], ['reading-plans:remove-enrollment', 'e1'],
      ['reading-plans:list-completions', 'e1'], ['reading-plans:set-completions', []],
    ]);
  });

  it('throws on an error result', async () => {
    const invoke = vi.fn(async () => ({ ok: false as const, error: { code: 'invalid_input', message: 'bad' } }));
    await expect(new IpcReadingPlanStore(invoke as never).listPlans()).rejects.toThrow();
  });
});
