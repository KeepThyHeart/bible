import { describe, it, expect, vi } from 'vitest';
import { AppRegistry } from './AppRegistry';
import { createAppHostState } from './AppHostState';
import { createAppBindingController } from './AppBinding';
import type { AppBinding } from './AppBinding';
import { app, deferred, fakeTimers } from '../__tests__/Apps/appTestUtils';

function setup() {
  const registry = new AppRegistry();
  const src = { kind: 'builtin' as const, moduleId: 'm' };
  registry.register(app('study'), src);
  registry.register(app('present', 'never'), src);
  const host = createAppHostState({ registry, timers: fakeTimers() });
  return { registry, host };
}

function binding(id: string, gate?: Promise<void>) {
  const activate = vi.fn();
  const deactivate = vi.fn();
  const load = vi.fn(async () => {
    await gate;
    return { View: `<${id}>`, activate, deactivate };
  });
  const b: AppBinding<string> = { id, load };
  return { b, load, activate, deactivate };
}

describe('createAppBindingController', () => {
  it('loads the chunk and runs activate() before the activation commits', async () => {
    const { host } = setup();
    const present = binding('present');
    const ctl = createAppBindingController({ host, bindings: [present.b] });
    expect(ctl.getView('present')).toBeUndefined();
    let viewAtCommit: string | undefined;
    host.subscribe(() => {
      if (host.getSnapshot().activeId === 'present') viewAtCommit ??= ctl.getView('present');
    });
    await host.activate('present', { route: 'r' });
    expect(viewAtCommit).toBe('<present>');
    expect(present.activate).toHaveBeenCalledTimes(1);
    expect(present.activate.mock.calls[0][0]).toMatchObject({ appId: 'present', route: 'r' });
  });

  it('never loads an app that is not activated or prefetched', async () => {
    const { host } = setup();
    const present = binding('present');
    const study = binding('study');
    createAppBindingController({ host, bindings: [present.b, study.b] });
    await host.activate('study');
    expect(present.load).not.toHaveBeenCalled();
  });

  it('runs activate() once across racing requests for the same app', async () => {
    const { host } = setup();
    const gate = deferred();
    const present = binding('present', gate.promise);
    const study = binding('study');
    createAppBindingController({ host, bindings: [present.b, study.b] });
    const a = host.activate('present');
    const b = host.activate('study');
    const c = host.activate('present');
    gate.resolve();
    const results = await Promise.all([a, b, c]);
    expect(results.map((r) => r.status)).toEqual(['superseded', 'superseded', 'activated']);
    expect(present.load).toHaveBeenCalledTimes(1);
    expect(present.activate).toHaveBeenCalledTimes(1);
    expect(study.activate).not.toHaveBeenCalled(); // its request was stale before setup
  });

  it('deactivates on unmount and re-activates on the next mount', async () => {
    const { host } = setup();
    const present = binding('present');
    const study = binding('study');
    const ctl = createAppBindingController({ host, bindings: [present.b, study.b] });
    await host.activate('present');
    await host.activate('study'); // present is keepAlive 'never'
    await Promise.resolve();
    expect(present.deactivate).toHaveBeenCalledTimes(1);
    expect(ctl.isLive('present')).toBe(false);
    await host.activate('present');
    expect(present.activate).toHaveBeenCalledTimes(2);
    expect(present.load).toHaveBeenCalledTimes(1);
  });

  it('fires onApp:<id> before loading, and fails the activation when the load fails', async () => {
    const { host } = setup();
    const events: string[] = [];
    const bad: AppBinding<string> = { id: 'present', load: () => Promise.reject(new Error('offline')) };
    createAppBindingController({
      host,
      bindings: [bad],
      fireActivationEvent: async (e) => {
        events.push(e);
      },
    });
    const r = await host.activate('present');
    expect(r.status).toBe('failed');
    expect(events).toEqual(['onApp:present']);
  });

  it('prefetch loads without activating', async () => {
    const { host } = setup();
    const present = binding('present');
    const ctl = createAppBindingController({ host, bindings: [present.b] });
    ctl.prefetch('present');
    await Promise.resolve();
    await Promise.resolve();
    expect(present.load).toHaveBeenCalledTimes(1);
    expect(present.activate).not.toHaveBeenCalled();
    expect(ctl.getView('present')).toBe('<present>');
  });
});
