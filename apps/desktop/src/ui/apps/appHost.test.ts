import { describe, it, expect, vi } from 'vitest';

vi.mock('./StudyView', () => ({ StudyView: () => null }));

import { appHost, appRegistry, addAppBinding, restoreActiveApp, isAppActive, getAppView } from './appHost';
import { registerBuiltinApps } from './builtinApps';

describe('desktop app host', () => {
  it('registers Study idempotently and activates it first; it stays mounted', async () => {
    registerBuiltinApps();
    registerBuiltinApps();
    expect(appRegistry.list().map((d) => d.id)).toEqual(['study']);
    await appHost.activate('study', { source: 'boot' });
    expect(isAppActive('study')).toBe(true);
    expect(appHost.getSnapshot().mounted).toEqual(['study']);
    expect(getAppView('study')).toBeTypeOf('function');
  });

  it('activates a fixture app while Study stays mounted, and restores it after Study', async () => {
    const View = () => null;
    appRegistry.register(
      { id: 'dev.fixture', title: { key: 'k', fallback: 'Fixture' }, icon: { kind: 'builtin', name: 'app' }, order: 20, lifecycle: { keepAlive: 'always', restore: 'reopen' } },
      { kind: 'builtin', moduleId: 'dev.fixture' },
    );
    addAppBinding({ id: 'dev.fixture', load: async () => ({ View }) });
    await appHost.activate('dev.fixture');
    expect(appHost.getSnapshot().activeId).toBe('dev.fixture');
    expect(appHost.getSnapshot().mounted).toEqual(['study', 'dev.fixture']);

    await appHost.activate('study');
    restoreActiveApp({ v: 1, activeId: 'dev.fixture', routes: {} });
    await vi.waitFor(() => expect(appHost.getSnapshot().activeId).toBe('dev.fixture'));
    expect(appHost.getSnapshot().mounted).toContain('study');
  });

  it('ignores garbage when restoring', () => {
    const before = appHost.getSnapshot().activeId;
    restoreActiveApp('nonsense');
    expect(appHost.getSnapshot().activeId).toBe(before);
  });

  it('serializes the active app for the session', () => {
    expect(appHost.serialize()).toMatchObject({ v: 1, activeId: expect.any(String) });
  });
});
