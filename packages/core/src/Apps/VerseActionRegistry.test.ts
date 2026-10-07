import { describe, it, expect, vi } from 'vitest';
import { VerseActionRegistry, selectVerseActions } from './VerseActionRegistry';
import type { VerseActionContext, VerseActionContribution, VerseActionHandler } from './VerseActions';
import { deferred } from '../__tests__/Apps/appTestUtils';

const b = (moduleId: string) => ({ kind: 'builtin' as const, moduleId });
const ctx: VerseActionContext = { verseId: 1, verseIds: [1], module: 'KJV', surface: 'reader' };
const contribution = (id: string, extra: Partial<VerseActionContribution> = {}): VerseActionContribution => ({
  id,
  title: { key: `va.${id}`, fallback: id },
  ...extra,
});

describe('VerseActionRegistry.run', () => {
  it('fires the activation event, loads once, runs each time', async () => {
    const activate = vi.fn();
    const r = new VerseActionRegistry({ activate });
    r.register(contribution('present.send'), b('present'));
    const run = vi.fn();
    const load = vi.fn(async (): Promise<VerseActionHandler> => ({ run }));
    r.bindHandler({ id: 'present.send', load });
    await r.run('present.send', ctx);
    await r.run('present.send', ctx);
    expect(activate).toHaveBeenCalledWith('onVerseAction:present.send');
    expect(activate).toHaveBeenCalledTimes(2);
    expect(load).toHaveBeenCalledTimes(1);
    expect(run).toHaveBeenCalledTimes(2);
    expect(run).toHaveBeenCalledWith(ctx);
  });

  it('activates before loading', async () => {
    const order: string[] = [];
    const r = new VerseActionRegistry({ activate: () => void order.push('activate') });
    r.register(contribution('a'), b('m'));
    r.bindHandler({
      id: 'a',
      load: async () => {
        order.push('load');
        return { run: () => void order.push('run') };
      },
    });
    await r.run('a', ctx);
    expect(order).toEqual(['activate', 'load', 'run']);
  });

  it('concurrent runs share one load', async () => {
    const r = new VerseActionRegistry();
    r.register(contribution('a'), b('m'));
    const gate = deferred<VerseActionHandler>();
    const load = vi.fn(() => gate.promise);
    r.bindHandler({ id: 'a', load });
    const run = vi.fn();
    const p1 = r.run('a', ctx);
    const p2 = r.run('a', ctx);
    await Promise.resolve();
    gate.resolve({ run });
    await Promise.all([p1, p2]);
    expect(load).toHaveBeenCalledTimes(1);
    expect(run).toHaveBeenCalledTimes(2);
  });

  it('clears the cache when the load fails so a retry works', async () => {
    const r = new VerseActionRegistry();
    r.register(contribution('a'), b('m'));
    const run = vi.fn();
    const load = vi
      .fn<() => Promise<VerseActionHandler>>()
      .mockRejectedValueOnce(new Error('chunk failed'))
      .mockResolvedValue({ run });
    r.bindHandler({ id: 'a', load });
    await expect(r.run('a', ctx)).rejects.toThrow('chunk failed');
    await r.run('a', ctx);
    expect(load).toHaveBeenCalledTimes(2);
    expect(run).toHaveBeenCalledTimes(1);
  });

  it('rejects an unknown id and a missing binding', async () => {
    const r = new VerseActionRegistry();
    await expect(r.run('nope', ctx)).rejects.toThrow(/unknown action "nope"/);
    r.register(contribution('a'), b('m'));
    await expect(r.run('a', ctx)).rejects.toThrow(/no handler/);
  });

  it('rejects a duplicate binding; disposing unbinds', async () => {
    const r = new VerseActionRegistry();
    r.register(contribution('a'), b('m'));
    const load = async () => ({ run: () => {} });
    const d = r.bindHandler({ id: 'a', load });
    expect(() => r.bindHandler({ id: 'a', load })).toThrow(/already bound/);
    d.dispose();
    await expect(r.run('a', ctx)).rejects.toThrow(/no handler/);
    r.bindHandler({ id: 'a', load });
  });

  it('drops the cached handler when the contribution is removed', async () => {
    const r = new VerseActionRegistry();
    const load = vi.fn(async (): Promise<VerseActionHandler> => ({ run: () => {} }));
    r.register(contribution('a'), b('m'));
    r.bindHandler({ id: 'a', load });
    await r.run('a', ctx);
    r.disposeBySource(b('m'));
    r.register(contribution('a'), b('m'));
    await r.run('a', ctx);
    expect(load).toHaveBeenCalledTimes(2);
    r.unregister('a');
    r.register(contribution('a'), b('m'));
    await r.run('a', ctx);
    expect(load).toHaveBeenCalledTimes(3);
  });
});

describe('selectVerseActions', () => {
  it('applies when and sorts by order then id without regrouping', () => {
    const r = new VerseActionRegistry();
    r.register(contribution('c', { order: 1, group: 'copy' }), b('m'));
    r.register(contribution('b', { order: 2, group: 'app' }), b('m'));
    r.register(contribution('a', { order: 2, group: 'copy' }), b('m'));
    r.register(contribution('d', { order: 3, when: 'x' }), b('m'));
    const entries = r.getSnapshot();
    expect(selectVerseActions(entries, { evalWhen: () => false }).map((i) => i.id)).toEqual(['c', 'a', 'b']);
    expect(selectVerseActions(entries).map((i) => i.id)).toEqual(['c', 'a', 'b', 'd']);
    expect(selectVerseActions(entries, { group: 'copy' }).map((i) => i.id)).toEqual(['c', 'a']);
  });
});
