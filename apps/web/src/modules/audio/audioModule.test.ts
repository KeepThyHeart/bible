/**
 * The Audio module through the REAL web host (task 0128): manifest, the flag and dev-override
 * off switches, "nothing loaded" at boot, activation on Study's reader boot, the host slots it
 * fills and empties, and the verse decorator. Each test boots a fresh module graph, like
 * builtinModules.test.ts.
 */
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { validateBuiltinManifest } from '@bible/core/browser';
import { audioManifest } from './manifest';

// The first activation transforms the whole audio graph; allow for a cold, busy machine.
vi.setConfig({ testTimeout: 60_000 });

const loaded = vi.fn();
const undoInit = vi.fn();
const initAudio = vi.fn(() => undoInit);

vi.mock('../../i18n', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../i18n')>()),
  loadNamespace: async () => {},
}));

const AUDIO_BLOCK = { dir: 'audio', base: '/audio', recorded: true };

async function boot(opts: { override?: string; flag?: boolean; block?: unknown; offlineBible?: boolean; disabledByServer?: boolean } = {}) {
  vi.resetModules();
  localStorage.setItem('kth.modules', opts.override ?? '');
  vi.doMock('./lib/initAudio', () => { loaded('initAudio'); return { initAudio }; });
  vi.doMock('../../boot/offlineBible', () => ({ peekOfflineBible: () => (opts.offlineBible === false ? null : Promise.resolve({})) }));
  const { setClientConfig } = await import('../../utils/clientConfig');
  setClientConfig({
    features: { audio: opts.flag ?? true },
    ...(opts.block === undefined ? { audio: AUDIO_BLOCK } : opts.block === null ? {} : { audio: opts.block }),
    ...(opts.disabledByServer ? { modules: { disabled: ['audio'] } } : {}),
  } as never);
  const { registerBuiltinModules } = await import('../builtinModules');
  const host = await import('../moduleHost');
  const slots = await import('../../host/slots');
  const { READER_BOOT_EVENT } = await import('../host/readerHooks');
  registerBuiltinModules();
  return { ...host, slots, READER_BOOT_EVENT };
}

beforeEach(() => {
  localStorage.clear();
  vi.clearAllMocks();
});

describe('manifest', () => {
  it('validates and keeps the persisted ids, order and label key', () => {
    expect(validateBuiltinManifest(audioManifest)).toEqual([]);
    expect(audioManifest.flag).toBe('audio');
    expect(audioManifest.platforms).toEqual(['web']);
    expect(audioManifest.contributes.preferencesSections).toEqual([
      { id: 'audio', title: { key: 'settings.tabs.audio', fallback: 'Audio' }, icon: { kind: 'builtin', name: 'fa-headphones' }, order: 50 },
    ]);
    expect(audioManifest.contributes.i18nNamespace).toBe('audio');
    expect(audioManifest.contributes.serverRoutes?.map((r) => r.path)).toEqual(['/audio']);
  });
});

describe('flag off (the default)', () => {
  it('contributes nothing, activates nothing and loads no code', async () => {
    const h = await boot({ flag: false });
    expect(h.modulePoints.preferencesSections.has('audio')).toBe(false);
    expect(h.modulePoints.views.resolve('preferences:audio')).toBeUndefined();
    expect(JSON.stringify(h.modulePoints.i18nNamespace.list())).not.toContain('audio');
    expect(h.featureModules.isEnabled('audio')).toBe(false);
    await h.featureModules.fire(h.READER_BOOT_EVENT);
    expect(h.featureModules.isActive('audio')).toBe(false);
    expect(loaded).not.toHaveBeenCalled();
    expect(h.slots.readerToolbarActions.list()).toEqual([]);
    expect(h.slots.studyLayoutItems.list()).toEqual([]);
  });
});

describe('flag on', () => {
  it('contributes the Settings tab, its view and the namespace, and loads nothing at boot', async () => {
    const h = await boot();
    expect(h.modulePoints.preferencesSections.get('audio')).toMatchObject({ id: 'audio', order: 50 });
    expect(h.modulePoints.views.resolve('preferences:audio')).toBeDefined();
    expect(JSON.stringify(h.modulePoints.i18nNamespace.list())).toContain('audio');
    expect(h.featureModules.isActive('audio')).toBe(false);
    expect(h.runBootProbes().activate).not.toContain('audio');
    expect(loaded).not.toHaveBeenCalled();
    expect(h.slots.readerToolbarActions.list()).toEqual([]);
  });

  it('activates on the reader boot event and fills the host slots', async () => {
    const h = await boot();
    await h.featureModules.fire(h.READER_BOOT_EVENT);
    expect(h.featureModules.isActive('audio')).toBe(true);
    expect(initAudio).toHaveBeenCalledTimes(1);
    expect(h.slots.readerToolbarActions.list()).toHaveLength(1);
    expect(h.slots.readerTabBadges.list()).toHaveLength(1);
    expect(h.slots.readerTransport.list()).toHaveLength(1);
    expect(h.slots.readerPaneEffects.list()).toHaveLength(1);
    expect(h.slots.helpShortcutRows.list()).toHaveLength(1);
    expect(h.slots.phoneBackHandlers.list()).toHaveLength(1);
    expect(h.slots.verseDecorators.list()).toHaveLength(1);
    const items = h.slots.studyLayoutItems.list();
    expect(items.filter((i) => i.layout === 'desktop').map((i) => i.placement)).toEqual(['overlay', 'overlay']);
    expect(items.filter((i) => i.layout === 'phone').map((i) => i.placement).sort()).toEqual(['dock', 'overlay', 'overlay']);
    expect(items.filter((i) => i.placement === 'dialogs' && i.layout === 'both')).toHaveLength(2);
  });

  it('with no usable audio block it registers nothing and never starts the player', async () => {
    const h = await boot({ block: null });
    await h.featureModules.fire(h.READER_BOOT_EVENT);
    expect(initAudio).not.toHaveBeenCalled();
    expect(h.slots.readerToolbarActions.list()).toEqual([]);
  });

  it('the phone Back handler closes the settings sheet, then the player, then stands aside', async () => {
    const h = await boot();
    await h.featureModules.fire(h.READER_BOOT_EVENT);
    const { audioStore } = await import('./audioStore');
    const [back] = h.slots.phoneBackHandlers.list();
    expect(back()).toBe(false);
    audioStore.openPlayer();
    audioStore.openQuickSettings();
    expect(back()).toBe(true);
    expect(audioStore.quickSettingsOpen).toBe(false);
    expect(audioStore.playerOpen).toBe(true);
    expect(back()).toBe(true);
    expect(audioStore.playerOpen).toBe(false);
    expect(back()).toBe(false);
  });
});

describe('switching off', () => {
  it('the dev override removes the tab, view and namespace and never activates', async () => {
    const h = await boot({ override: '-audio' });
    expect(h.modulePoints.preferencesSections.has('audio')).toBe(false);
    expect(h.modulePoints.views.resolve('preferences:audio')).toBeUndefined();
    await h.featureModules.fire(h.READER_BOOT_EVENT);
    expect(loaded).not.toHaveBeenCalled();
  });

  it('a server that reports the module off wins over the flag', async () => {
    const h = await boot({ disabledByServer: true });
    expect(h.modulePoints.preferencesSections.has('audio')).toBe(false);
    await h.featureModules.fire(h.READER_BOOT_EVENT);
    expect(loaded).not.toHaveBeenCalled();
  });

  it('at runtime it empties every slot, undoes the player wiring and removes the tab', async () => {
    const h = await boot();
    await h.featureModules.fire(h.READER_BOOT_EVENT);
    expect(h.slots.readerToolbarActions.list()).toHaveLength(1);
    localStorage.setItem('kth.modules', '-audio');
    h.reconcileModules();
    expect(undoInit).toHaveBeenCalledTimes(1);
    for (const slot of [h.slots.readerToolbarActions, h.slots.readerTabBadges, h.slots.readerTransport, h.slots.readerPaneEffects, h.slots.helpShortcutRows, h.slots.phoneBackHandlers, h.slots.verseDecorators, h.slots.studyLayoutItems]) {
      expect(slot.list()).toEqual([]);
    }
    expect(h.modulePoints.preferencesSections.has('audio')).toBe(false);
  });

  it('another module is unaffected', async () => {
    const h = await boot({ override: '-audio' });
    expect(h.modulePoints.preferencesSections.has('about')).toBe(true);
  });
});

describe('the verse being read', () => {
  it('is decorated only on the playing tab while follow-along is on, and the reader is asked to re-render only on a change', async () => {
    vi.resetModules();
    const { audioStore } = await import('./audioStore');
    const { playingVerseDecorator, watchFollow, PLAYING_VERSE } = await import('./verseDecorator');
    const ctx = (tabId: string, verseId: number) => ({ tabId, verseId, moduleAbbr: 'KJV', book: 43, chapter: 3, verse: verseId % 1000, html: '', isActive: false });
    audioStore.prefs = { ...audioStore.prefs, followAlong: true };
    audioStore.follow.set('tab-1', 43003017);
    expect(playingVerseDecorator(ctx('tab-1', 43003017))).toBe(PLAYING_VERSE);
    expect(PLAYING_VERSE.classes).toEqual(['verse--playing']);
    expect(playingVerseDecorator(ctx('tab-1', 43003016))).toBeUndefined();
    expect(playingVerseDecorator(ctx('tab-2', 43003017))).toBeUndefined();
    audioStore.prefs = { ...audioStore.prefs, followAlong: false };
    expect(playingVerseDecorator(ctx('tab-1', 43003017))).toBeUndefined();

    audioStore.prefs = { ...audioStore.prefs, followAlong: true };
    const invalidate = vi.fn();
    const off = watchFollow(invalidate);
    audioStore.follow.set('tab-1', 43003018);
    expect(invalidate).toHaveBeenCalledTimes(1);
    audioStore.follow.set('tab-1', 43003018); // same verse again
    expect(invalidate).toHaveBeenCalledTimes(1);
    off();
    audioStore.follow.set(null, null);
    expect(invalidate).toHaveBeenCalledTimes(1);
  });
});
