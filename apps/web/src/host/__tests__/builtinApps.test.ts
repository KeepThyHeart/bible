import { describe, it, expect, vi } from 'vitest';

vi.mock('../../utils/bootGuard', () => ({ reloadForUpdateOnce: () => false }));
vi.mock('../../apps/study/StudyView', () => ({ StudyView: () => null, activateStudy: vi.fn(), deactivateStudy: vi.fn() }));
vi.mock('../../apps/present/PresenterApp', () => ({ PresenterApp: () => null }));
const run = vi.hoisted(() => vi.fn());
const handlerModule = vi.hoisted(() => vi.fn());
vi.mock('../../apps/present/presentVerseAction', () => {
  handlerModule();
  return { presentVerseHandler: { run } };
});
vi.mock('../presenterRuntime', () => ({ setPresenterBusySink: vi.fn(), ensurePresenterRuntime: vi.fn(async () => {}), hasStoredPresenterSession: () => false }));

import { appRegistry, appHost, setShellContext, verseActions, getAppCompanion } from '../appHost';
import { registerBuiltinApps } from '../builtinApps';
import { setPresenterBusySink, ensurePresenterRuntime } from '../presenterRuntime';
import { evalVerseWhen } from '../verseActionWhen';
import { resolveInitialApp } from '../../boot/runBoot';

vi.mock('../../boot/shellBoot', () => ({ bootShell: vi.fn() }));
vi.mock('../../components/ErrorBoundary', () => ({ ErrorBoundary: () => null }));
vi.mock('../AppShell', () => ({ AppShell: () => null }));

describe('builtin apps wiring', () => {
  it('registers study and present, wires the busy sink, activates lazily', async () => {
    registerBuiltinApps();
    registerBuiltinApps();
    expect(appRegistry.list().map((d) => d.id)).toEqual(['study', 'present']);
    const sink = vi.mocked(setPresenterBusySink).mock.calls[0][0]!;
    sink(true);
    expect(appRegistry.isBusy('present')).toBe(true);

    setShellContext({ adoptedSession: null, followCode: null } as never);
    const r = await appHost.activate('present');
    expect(r.status).toBe('activated');
    expect(ensurePresenterRuntime).toHaveBeenCalled();
    expect(appHost.getSnapshot().mounted).toEqual(['present']);
  });

  it('registers the Present verse action without loading its handler until run', async () => {
    registerBuiltinApps();
    const entry = verseActions.get('present.showVerse');
    expect(entry).toBeTruthy();
    expect(entry!.when).toBe('present.live');
    expect(entry!.appId).toBe('present');
    // not busy: `when` keeps it out of the menu
    appRegistry.setBusy('present', false);
    expect(evalVerseWhen(entry!.when!)).toBe(false);
    appRegistry.setBusy('present', true);
    expect(evalVerseWhen(entry!.when!)).toBe(true);
    expect(handlerModule).not.toHaveBeenCalled();
    await verseActions.run('present.showVerse', { verseId: 43003016, verseIds: [43003016], module: 'KJV', surface: 'reader' });
    expect(handlerModule).toHaveBeenCalledTimes(1);
    expect(run).toHaveBeenCalledOnce();
  });

  it('gives Present a PresentBar companion that applies only while busy', () => {
    registerBuiltinApps();
    expect(getAppCompanion('present')?.when).toBe('busy');
    expect(getAppCompanion('study')).toBeUndefined();
  });

  it('resolveInitialApp by boot path', () => {
    const none = { followCode: null, adoptedSession: null };
    expect(resolveInitialApp(none, '#/@present')).toBe('present');
    expect(resolveInitialApp(none, '#/@bogus')).toBe('study');
    expect(resolveInitialApp(none, '#/KJV/1/1')).toBe('study');
    expect(resolveInitialApp({ ...none, followCode: 'ABCDEFGH' }, '#/@present')).toBe('study');
    expect(resolveInitialApp({ ...none, adoptedSession: {} as never }, '')).toBe('present');
  });
});
