import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('./StudyView', () => ({ StudyView: () => null }));

import { useSessionStore } from '../stores/useSessionStore';
import { appHost, appRegistry, addAppBinding } from './appHost';
import { registerBuiltinApps } from './builtinApps';
import {
  installAppSession,
  setPendingAppRestore,
  hasPendingAppRestore,
  restoreActiveApp,
  resetAppSessionForTest,
} from './appSession';

const descriptor = (id: string) => ({
  id,
  title: { key: 'k', fallback: id },
  icon: { kind: 'builtin' as const, name: 'app' },
  order: 20,
  lifecycle: { keepAlive: 'always' as const, restore: 'reopen' as const },
});

function registerApp(id: string): { dispose(): void } {
  const reg = appRegistry.register(descriptor(id), { kind: 'builtin', moduleId: id });
  const bind = addAppBinding({ id, load: async () => ({ View: () => null }) });
  return { dispose: () => { bind.dispose(); reg.dispose(); } };
}

describe('app session: pending restore (autosave race)', () => {
  beforeEach(async () => {
    resetAppSessionForTest();
    registerBuiltinApps();
    installAppSession();
    await appHost.activate('study', { source: 'boot' });
  });

  it('saves the session blob, not the boot-time Study, until the restore settles', async () => {
    const reg = registerApp('fx.a');
    const saved = { v: 1, activeId: 'fx.a', routes: {} };
    setPendingAppRestore(saved);
    // An autosave before restoreActiveApp ran keeps the saved app.
    expect(useSessionStore.getState().getSessionData().appHost).toEqual(saved);

    await restoreActiveApp(saved);
    expect(hasPendingAppRestore()).toBe(false);
    expect(appHost.getSnapshot().activeId).toBe('fx.a');
    expect(useSessionStore.getState().getSessionData().appHost).toMatchObject({ activeId: 'fx.a' });
    expect(useSessionStore.getState().isDirty).toBe(true);

    await appHost.activate('study');
    reg.dispose();
  });

  it('waits for an app that registers late (extension apps), then opens it', async () => {
    const saved = { v: 1, activeId: 'fx.late', routes: {} };
    setPendingAppRestore(saved);
    const done = restoreActiveApp(saved, { timeoutMs: 5_000 });
    expect(hasPendingAppRestore()).toBe(true);
    expect(useSessionStore.getState().getSessionData().appHost).toEqual(saved);

    const reg = registerApp('fx.late');
    await done;
    expect(appHost.getSnapshot().activeId).toBe('fx.late');
    expect(hasPendingAppRestore()).toBe(false);

    await appHost.activate('study');
    reg.dispose();
  });

  it('gives up after the timeout and keeps Study', async () => {
    vi.useFakeTimers();
    try {
      const saved = { v: 1, activeId: 'fx.never', routes: {} };
      setPendingAppRestore(saved);
      const done = restoreActiveApp(saved, { timeoutMs: 1_000 });
      await vi.advanceTimersByTimeAsync(1_001);
      await done;
      expect(hasPendingAppRestore()).toBe(false);
      expect(appHost.getSnapshot().activeId).toBe('study');
    } finally {
      vi.useRealTimers();
    }
  });

  it('stops waiting when the user opens another app first', async () => {
    const reg = registerApp('fx.user');
    const saved = { v: 1, activeId: 'fx.missing', routes: {} };
    setPendingAppRestore(saved);
    const done = restoreActiveApp(saved, { timeoutMs: 5_000 });
    await appHost.activate('fx.user');
    await done;
    expect(hasPendingAppRestore()).toBe(false);
    expect(appHost.getSnapshot().activeId).toBe('fx.user');
    // The live state is saved again.
    expect(useSessionStore.getState().getSessionData().appHost).toMatchObject({ activeId: 'fx.user' });

    // A late registration of the saved app no longer steals the screen.
    const late = registerApp('fx.missing');
    await Promise.resolve();
    expect(appHost.getSnapshot().activeId).toBe('fx.user');

    await appHost.activate('study');
    late.dispose();
    reg.dispose();
  });

  it('a session saved on Study clears the pending blob at once', async () => {
    const saved = { v: 1, activeId: 'study', routes: {} };
    setPendingAppRestore(saved);
    await restoreActiveApp(saved);
    expect(hasPendingAppRestore()).toBe(false);
  });
});
