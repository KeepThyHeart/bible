/**
 * Behavioural contract of `createMockApi().reminders` and its driver.
 */

import { describe, it, expect, vi } from 'vitest';

import { createMockApi, getMockReminders } from '../createMockApi';

const soon = () => Date.now() + 60_000;
const item = (key: string, fireAt = soon()) => ({ key, fireAt, title: `T ${key}`, body: `B ${key}` });

describe('createMockApi().reminders', () => {
  it('replaceAll stores sanitised items and list returns them earliest first', async () => {
    const api = createMockApi();
    const t = soon();
    const res = await api.reminders.replaceAll([
      item('b', t + 1000),
      item('a', t),
      { key: '', fireAt: t, title: 'x', body: 'y' } as never, // invalid: dropped
      item('a', t + 5), // duplicate key: dropped
    ]);
    expect(res).toEqual({ accepted: 2 });
    expect((await api.reminders.list()).map((i) => i.key)).toEqual(['a', 'b']);
  });

  it('replaceAll replaces rather than appends, and is capped at 64', async () => {
    const api = createMockApi();
    await api.reminders.replaceAll([item('old')]);
    const many = Array.from({ length: 100 }, (_, i) => item(`k${i}`, soon() + i));
    await expect(api.reminders.replaceAll(many)).resolves.toEqual({ accepted: 64 });
    const keys = (await api.reminders.list()).map((i) => i.key);
    expect(keys).toHaveLength(64);
    expect(keys).not.toContain('old');
  });

  it('rejects a non-array', async () => {
    const api = createMockApi();
    await expect(api.reminders.replaceAll('nope' as never)).rejects.toThrow(TypeError);
  });

  it('capabilities default to granted / never / no actions; requestPermission follows the driver', async () => {
    const api = createMockApi();
    await expect(api.reminders.capabilities()).resolves.toEqual({
      permission: 'granted',
      whenClosed: 'never',
      actions: false,
    });
    getMockReminders(api).setCapabilities({ permission: 'prompt' });
    getMockReminders(api).setPermissionResult('denied');
    expect((await api.reminders.capabilities()).permission).toBe('prompt');
    await expect(api.reminders.requestPermission()).resolves.toBe('denied');
    expect((await api.reminders.capabilities()).permission).toBe('denied');
  });

  it('fireActivation calls onActivated handlers and does not queue', async () => {
    const api = createMockApi();
    const handler = vi.fn();
    await api.reminders.onActivated(handler);
    const evt = { key: 'a', keys: ['a'], firedAt: 5, data: { n: 1 } };
    await getMockReminders(api).fireActivation(evt);
    expect(handler).toHaveBeenCalledWith(evt);
    await expect(api.reminders.takeActivations()).resolves.toEqual([]);
  });

  it('fireActivation with no handler queues for takeActivations, which drains', async () => {
    const api = createMockApi();
    await getMockReminders(api).fireActivation({ key: 'a', keys: ['a'], firedAt: 1 });
    await getMockReminders(api).fireActivation({ key: 'b', keys: ['b'], firedAt: 2 });
    expect((await api.reminders.takeActivations()).map((e) => e.key)).toEqual(['a', 'b']);
    await expect(api.reminders.takeActivations()).resolves.toEqual([]);
  });

  it('caps the queue at 20, dropping the oldest', async () => {
    const api = createMockApi();
    for (let i = 0; i < 25; i++) {
      await getMockReminders(api).fireActivation({ key: `k${i}`, keys: [`k${i}`], firedAt: i });
    }
    const q = await api.reminders.takeActivations();
    expect(q).toHaveLength(20);
    expect(q[0]!.key).toBe('k5');
  });

  it('a disposed onActivated handler stops receiving and activations queue again', async () => {
    const api = createMockApi();
    const handler = vi.fn();
    const handle = await api.reminders.onActivated(handler);
    await handle.dispose();
    await getMockReminders(api).fireActivation({ key: 'a', keys: ['a'], firedAt: 1 });
    expect(handler).not.toHaveBeenCalled();
    expect(await api.reminders.takeActivations()).toHaveLength(1);
  });

  it('fireMissed reaches onMissed handlers and is dropped otherwise', async () => {
    const api = createMockApi();
    await getMockReminders(api).fireMissed({ keys: ['x'], dropped: [] }); // no handler: no throw
    const handler = vi.fn();
    await api.reminders.onMissed(handler);
    await getMockReminders(api).fireMissed({ keys: ['x'], dropped: ['y'] });
    expect(handler).toHaveBeenCalledWith({ keys: ['x'], dropped: ['y'] });
  });

  it('getMockReminders throws for an api not built by createMockApi', () => {
    expect(() => getMockReminders({} as never)).toThrow(/createMockApi/);
  });
});
