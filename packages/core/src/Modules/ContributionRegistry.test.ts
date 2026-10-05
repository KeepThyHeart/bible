import { describe, it, expect, vi } from 'vitest';
import { ContributionRegistry, DuplicateContributionError } from './ContributionRegistry';
import { CONTRIBUTION_ORDER, lazyOnce } from './types';
import {
  ORDER_BUILTIN_MAX,
  ORDER_BUILTIN_MIN,
  ORDER_DEFAULT,
  ORDER_PLUGIN_MAX,
  ORDER_PLUGIN_MIN,
} from '../Extensions/Permissions';

const b = (moduleId: string) => ({ kind: 'builtin' as const, moduleId });
const x = (extensionId: string) => ({ kind: 'extension' as const, extensionId });

describe('ContributionRegistry', () => {
  it('sorts by clamped order, then id, and keeps a stable snapshot', () => {
    const r = new ContributionRegistry<{ id: string; order?: number }>('things');
    r.register({ id: 'b', order: 10 }, b('m'));
    r.register({ id: 'a', order: 10 }, b('m'));
    r.register({ id: 'ext.p.n.z', order: 5 }, x('ext.p.n')); // clamped up to 100
    r.register({ id: 'c', order: 500 }, b('m')); // clamped down to 99
    expect(r.list().map((i) => i.id)).toEqual(['a', 'b', 'c', 'ext.p.n.z']);
    expect(r.getSnapshot()).toBe(r.getSnapshot());
    expect(r.getEntry('ext.p.n.z')?.order).toBe(100);
  });

  it('rejects duplicates and foreign extension ids', () => {
    const r = new ContributionRegistry<{ id: string }>('things');
    r.register({ id: 'a' }, b('m'));
    expect(() => r.register({ id: 'a' }, b('n'))).toThrow(DuplicateContributionError);
    expect(() => r.register({ id: 'a2' }, x('ext.p.n'))).toThrow(/may only register/);
  });

  it('disposeBySource removes one source in a single change event', () => {
    const r = new ContributionRegistry<{ id: string }>('things');
    r.register({ id: 'a' }, b('m'));
    r.register({ id: 'b' }, b('m'));
    r.register({ id: 'c' }, b('n'));
    const listener = vi.fn();
    r.subscribe(listener);
    r.disposeBySource(b('m'));
    expect(listener).toHaveBeenCalledTimes(1);
    expect(r.list().map((i) => i.id)).toEqual(['c']);
  });

  it('a stale handle does not remove a re-registered item', () => {
    const r = new ContributionRegistry<{ id: string }>('things');
    const first = r.register({ id: 'a' }, b('m'));
    r.disposeBySource(b('m'));
    r.register({ id: 'a' }, b('m'));
    first.dispose();
    expect(r.has('a')).toBe(true);
  });

  it('order bands mirror the extension constants', () => {
    expect(CONTRIBUTION_ORDER.builtinMin).toBe(ORDER_BUILTIN_MIN);
    expect(CONTRIBUTION_ORDER.builtinMax).toBe(ORDER_BUILTIN_MAX);
    expect(CONTRIBUTION_ORDER.extensionMin).toBe(ORDER_PLUGIN_MIN);
    expect(CONTRIBUTION_ORDER.extensionMax).toBe(ORDER_PLUGIN_MAX);
    expect(CONTRIBUTION_ORDER.extensionDefault).toBe(ORDER_DEFAULT);
  });
});

describe('lazyOnce', () => {
  it('loads once, exposes peek(), and retries after a failure', async () => {
    let calls = 0;
    const load = lazyOnce(async () => {
      calls++;
      if (calls === 1) throw new Error('flaky');
      return 42;
    });
    await expect(load()).rejects.toThrow('flaky');
    expect(load.peek()).toBeUndefined();
    expect(await load()).toBe(42);
    expect(await load()).toBe(42);
    expect(calls).toBe(2);
    expect(load.peek()).toBe(42);
  });
});
