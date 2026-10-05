import { describe, it, expect } from 'vitest';
import { AppRegistry } from './AppRegistry';
import { createAppHostState } from './AppHostState';
import type { AppHostOptions } from './AppHostState';
import { app, deferred, fakeTimers, flush } from '../__tests__/Apps/appTestUtils';

const builtin = (moduleId: string) => ({ kind: 'builtin' as const, moduleId });

function setup(extra: Partial<AppHostOptions> = {}) {
  const registry = new AppRegistry();
  registry.register(app('study', 'always'), builtin('study'));
  registry.register(app('present', 'while-busy', 'while-busy'), builtin('present'));
  registry.register(app('quiz', 'never', 'default'), builtin('quiz'));
  const timers = fakeTimers();
  const host = createAppHostState({ registry, timers, idleGraceMs: 1000, ...extra });
  return { registry, timers, host };
}

describe('AppHostState: mounting', () => {
  it('mounts nothing until the first activation, then only that app (lean cold boot)', async () => {
    const { host } = setup();
    expect(host.getSnapshot()).toMatchObject({ activeId: null, mounted: [] });
    expect(await host.activate('present', { source: 'link' })).toEqual({ status: 'activated', id: 'present' });
    expect(host.getSnapshot()).toMatchObject({ activeId: 'present', mounted: ['present'] });
    await host.activate('study');
    expect(host.getSnapshot().mounted).toEqual(['present', 'study']);
  });

  it('reports firstMount to listeners and fires onDidMount once', async () => {
    const { host } = setup();
    const seen: boolean[] = [];
    const mounted: string[] = [];
    host.onWillActivate((e) => {
      if (e.id === 'study') seen.push(e.firstMount);
    });
    host.onDidMount((id) => mounted.push(id));
    await host.activate('study');
    await host.activate('present');
    await host.activate('study');
    expect(seen).toEqual([true, false]);
    expect(mounted).toEqual(['study', 'present']);
  });

  it('rejects unknown and unavailable apps without changing state', async () => {
    const { host } = setup({ isAvailable: (d) => d.id !== 'quiz' });
    await host.activate('study');
    expect((await host.activate('nope')).status).toBe('unavailable');
    expect((await host.activate('quiz')).status).toBe('unavailable');
    expect(host.getSnapshot().activeId).toBe('study');
  });
});

describe('AppHostState: racing activations', () => {
  it('latest request wins; the earlier one resolves superseded', async () => {
    const { host } = setup();
    const gates: Record<string, ReturnType<typeof deferred<void>>> = { present: deferred<void>(), quiz: deferred<void>() };
    host.onWillActivate((e) => gates[e.id]?.promise);
    const a = host.activate('present');
    const b = host.activate('quiz');
    expect(host.getSnapshot().pendingId).toBe('quiz');
    gates.quiz.resolve();
    expect(await b).toEqual({ status: 'activated', id: 'quiz' });
    gates.present.resolve();
    expect(await a).toEqual({ status: 'superseded', id: 'present' });
    expect(host.getSnapshot()).toMatchObject({ activeId: 'quiz', mounted: ['quiz'], pendingId: null });
  });

  it('a slow earlier request finishing first still does not commit', async () => {
    const { host } = setup();
    const gate = deferred();
    host.onWillActivate((e) => (e.id === 'present' ? gate.promise : undefined));
    const a = host.activate('present');
    const b = host.activate('quiz');
    expect((await b).status).toBe('activated');
    gate.resolve();
    expect((await a).status).toBe('superseded');
    expect(host.getSnapshot().activeId).toBe('quiz');
  });

  it('asking for the active app cancels a pending switch', async () => {
    const { host } = setup();
    await host.activate('study');
    const gate = deferred();
    host.onWillActivate((e) => (e.id === 'present' ? gate.promise : undefined));
    const a = host.activate('present');
    expect(await host.activate('study')).toEqual({ status: 'already', id: 'study' });
    expect(host.getSnapshot().pendingId).toBeNull();
    gate.resolve();
    expect((await a).status).toBe('superseded');
    expect(host.getSnapshot()).toMatchObject({ activeId: 'study', mounted: ['study'] });
  });

  it('isCurrent() turns false once superseded', async () => {
    const { host } = setup();
    let check: (() => boolean) | undefined;
    const gate = deferred();
    host.onWillActivate((e) => {
      if (e.id !== 'present') return undefined;
      check = e.isCurrent;
      return gate.promise;
    });
    const a = host.activate('present');
    expect(check?.()).toBe(true);
    await host.activate('quiz');
    expect(check?.()).toBe(false);
    gate.resolve();
    await a;
  });

  it('a failing listener fails the activation and leaves state unchanged', async () => {
    const { host } = setup();
    await host.activate('study');
    const err = new Error('chunk failed');
    host.onWillActivate((e) => {
      if (e.id === 'present') throw err;
    });
    expect(await host.activate('present')).toEqual({ status: 'failed', id: 'present', error: err });
    expect(host.getSnapshot()).toMatchObject({ activeId: 'study', pendingId: null, mounted: ['study'] });
  });

  it('an app switched off while loading resolves unavailable', async () => {
    const { host, registry } = setup();
    const gate = deferred();
    host.onWillActivate(() => gate.promise);
    const a = host.activate('present');
    registry.disposeBySource(builtin('present'));
    gate.resolve();
    expect((await a).status).toBe('unavailable');
    expect(host.getSnapshot().mounted).toEqual([]);
  });
});

describe('AppHostState: keep-alive and eviction', () => {
  it("'never' apps unmount as soon as another app commits", async () => {
    const { host } = setup();
    const gone: string[] = [];
    host.onDidUnmount((id) => gone.push(id));
    await host.activate('quiz');
    await host.activate('study');
    expect(host.getSnapshot().mounted).toEqual(['study']);
    expect(gone).toEqual(['quiz']);
  });

  it("'while-busy' apps unmount after the idle grace only while idle and hidden", async () => {
    const { host, registry, timers } = setup();
    await host.activate('present');
    registry.setBusy('present', true);
    await host.activate('study');
    timers.advance(5000);
    expect(host.getSnapshot().mounted).toContain('present'); // busy: kept
    registry.setBusy('present', false);
    timers.advance(999);
    expect(host.getSnapshot().mounted).toContain('present');
    timers.advance(1);
    expect(host.getSnapshot().mounted).toEqual(['study']);
  });

  it('turning busy again cancels the idle timer', async () => {
    const { host, registry, timers } = setup();
    await host.activate('present');
    await host.activate('study');
    expect(timers.pending()).toBe(1);
    registry.setBusy('present', true);
    expect(timers.pending()).toBe(0);
    timers.advance(10_000);
    expect(host.getSnapshot().mounted).toContain('present');
  });

  it('a pending activation protects the app from its idle timer', async () => {
    const { host, timers } = setup();
    await host.activate('present');
    await host.activate('study');
    const gate = deferred();
    host.onWillActivate(() => gate.promise);
    const a = host.activate('present');
    timers.advance(10_000);
    expect(host.getSnapshot().mounted).toContain('present');
    gate.resolve();
    expect((await a).status).toBe('activated');
    expect(host.getSnapshot().mounted).toEqual(['present', 'study']);
  });

  it('a superseded activation restarts the idle timer', async () => {
    const { host, timers } = setup();
    await host.activate('present');
    await host.activate('study');
    const gate = deferred();
    host.onWillActivate((e) => (e.id === 'present' ? gate.promise : undefined));
    const a = host.activate('present');
    await host.activate('study');
    gate.resolve();
    expect((await a).status).toBe('superseded');
    timers.advance(1000);
    expect(host.getSnapshot().mounted).toEqual(['study']);
  });

  it("'always' apps are never evicted", async () => {
    const { host, timers } = setup();
    await host.activate('study');
    await host.activate('present');
    timers.advance(1e9);
    expect(host.getSnapshot().mounted).toContain('study');
  });

  it('removing the active app unmounts it and falls back to the default app', async () => {
    const { host, registry } = setup();
    await host.activate('present');
    registry.disposeBySource(builtin('present'));
    expect(host.getSnapshot().mounted).toEqual([]);
    await flush();
    expect(host.getSnapshot()).toMatchObject({ activeId: 'study', mounted: ['study'] });
  });

  it('revalidate() unmounts apps whose `when` turned false', async () => {
    let presentOn = true;
    const { host } = setup({ isAvailable: (d) => d.id !== 'present' || presentOn });
    await host.activate('present');
    await host.activate('study');
    presentOn = false;
    host.revalidate();
    expect(host.getSnapshot().mounted).toEqual(['study']);
  });
});

describe('AppHostState: back, routes, persistence', () => {
  it('back() walks the host stack, then falls back to the default app', async () => {
    const { host } = setup();
    await host.activate('present');
    await host.activate('quiz');
    expect(host.getSnapshot().canGoBack).toBe(true);
    expect((await host.back()).id).toBe('present');
    expect((await host.back()).id).toBe('study');
    expect(await host.back()).toEqual({ status: 'already', id: 'study' });
    expect(host.getSnapshot().canGoBack).toBe(false);
  });

  it('keeps per-app routes and round-trips through serialize/restore', async () => {
    const { host, registry } = setup();
    await host.activate('present', { route: 'service/today' });
    await host.activate('study');
    expect(host.getSnapshot().routes).toEqual({ present: 'service/today' });
    const saved = JSON.parse(JSON.stringify(host.serialize()));
    expect(saved).toEqual({ v: 1, activeId: 'study', routes: { present: 'service/today' } });

    const fresh = createAppHostState({ registry, timers: fakeTimers() });
    expect(fresh.restore(saved)).toBe('study');
    expect(fresh.getSnapshot().routes).toEqual({ present: 'service/today' });
    // Activating without a route uses the restored one.
    let route = '';
    fresh.onWillActivate((e) => {
      route = e.route;
    });
    await fresh.activate('present');
    expect(route).toBe('service/today');
  });

  it('restore() follows each app’s restore policy', () => {
    const { registry } = setup();
    const host = createAppHostState({ registry, timers: fakeTimers() });
    const p = (activeId: string) => ({ v: 1, activeId, routes: {} });
    expect(host.restore(p('present'))).toBe('study'); // while-busy, not busy
    registry.setBusy('present', true);
    expect(host.restore(p('present'))).toBe('present');
    expect(host.restore(p('quiz'))).toBe('study'); // restore: default
    expect(host.restore(p('gone'))).toBe('study');
    expect(host.restore({ v: 2 })).toBe('study');
    expect(host.restore('garbage')).toBe('study');
  });
});
