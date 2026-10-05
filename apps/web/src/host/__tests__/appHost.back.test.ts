import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../../utils/bootGuard', () => ({ reloadForUpdateOnce: () => false }));

import { appHost, appRegistry, addAppBinding, activateWithRecovery, noteAppPop, studyShouldIgnoreBack } from '../appHost';

const desc = (id: string) => ({
  id, title: { key: id, fallback: id }, icon: { kind: 'builtin' as const, name: 'x' }, order: 0,
  lifecycle: { keepAlive: 'always' as const, restore: 'default' as const },
});

describe('studyShouldIgnoreBack', () => {
  beforeEach(() => noteAppPop(false));

  it('stands down for a Back that changed the app, once', () => {
    noteAppPop(true);
    expect(studyShouldIgnoreBack()).toBe(true);
    expect(studyShouldIgnoreBack()).toBe(false); // consumed (Study is nothing/active)
  });

  it('stands down while any non-Study app is on screen, and takes its own step when Study is', async () => {
    appRegistry.register(desc('study'), { kind: 'builtin', moduleId: 'study' });
    appRegistry.register(desc('other'), { kind: 'builtin', moduleId: 'other' });
    addAppBinding({ id: 'study', load: async () => ({ View: () => null }) });
    addAppBinding({ id: 'other', load: async () => ({ View: () => null }) });
    await activateWithRecovery('study');
    expect(studyShouldIgnoreBack()).toBe(false);
    await activateWithRecovery('other');
    expect(appHost.getSnapshot().activeId).toBe('other');
    expect(studyShouldIgnoreBack()).toBe(true);
    await activateWithRecovery('study');
    expect(studyShouldIgnoreBack()).toBe(false);
  });
});
