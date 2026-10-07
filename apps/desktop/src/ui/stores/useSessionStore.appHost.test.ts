import { describe, it, expect, vi } from 'vitest';

vi.mock('../apps/StudyView', () => ({ StudyView: () => null }));

import { useSessionStore } from './useSessionStore';
import { installAppSession } from '../apps/appSession';
import { appHost, appRegistry, addAppBinding } from '../apps/appHost';
import { registerBuiltinApps } from '../apps/builtinApps';

describe('session blob: appHost', () => {
  it('serializes the app host next to dockviewState and round-trips through restore', async () => {
    registerBuiltinApps();
    installAppSession();
    appRegistry.register(
      { id: 'fx', title: { key: 'k', fallback: 'Fx' }, icon: { kind: 'builtin', name: 'app' }, order: 20, lifecycle: { keepAlive: 'always', restore: 'reopen' } },
      { kind: 'builtin', moduleId: 'fx' },
    );
    addAppBinding({ id: 'fx', load: async () => ({ View: () => null }) });
    await appHost.activate('study', { source: 'boot' });
    await appHost.activate('fx');

    const data = useSessionStore.getState().getSessionData();
    expect(data.appHost).toMatchObject({ v: 1, activeId: 'fx' });
    const json = JSON.parse(JSON.stringify(data.appHost));
    expect(appHost.restore(json)).toBe('fx');
  });
});
