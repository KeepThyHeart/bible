import { describe, it, expect, vi } from 'vitest';

vi.mock('../../utils/bootGuard', () => ({ reloadForUpdateOnce: () => false }));
vi.mock('../../apps/study/StudyView', () => ({ StudyView: () => null, activateStudy: vi.fn(), deactivateStudy: vi.fn() }));

import { appRegistry, appHost, setShellContext, getAppCompanion } from '../appHost';
import { registerBuiltinApps } from '../builtinApps';

// The Presenter is a feature module now: its wiring is checked in
// modules/present/__tests__/binding.test.ts.
describe('builtin apps wiring', () => {
  it('registers only Study (once) and activates it lazily', async () => {
    registerBuiltinApps();
    registerBuiltinApps();
    expect(appRegistry.list().map((d) => d.id)).toEqual(['study']);

    setShellContext({} as never);
    const r = await appHost.activate('study');
    expect(r.status).toBe('activated');
    expect(appHost.getSnapshot().mounted).toEqual(['study']);
  });

  it('contributes no Presenter app, verse action or companion', async () => {
    registerBuiltinApps();
    expect(appRegistry.has('present')).toBe(false);
    expect(getAppCompanion('present')).toBeUndefined();
    expect(getAppCompanion('study')).toBeUndefined();
    const { verseActions } = await import('../appHost');
    expect(verseActions.get('present.showVerse')).toBeUndefined();
  });
});
