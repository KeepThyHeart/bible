/**
 * Core reader events and `settings.changed` through the REAL web host (task
 * 0123): nothing is built or delivered until an active module subscribes, and
 * nothing again once the module is switched off. A fixture module stands in
 * for a feature; the Presenter's own `reader.chapterRendered` hook is checked
 * with the real module.
 */
import { describe, it, expect, beforeEach, vi } from 'vitest';
import type { VerseData } from '../../types';

vi.mock('../../utils/bootGuard', () => ({ reloadForUpdateOnce: () => false }));
vi.mock('../../i18n', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../i18n')>()),
  loadNamespace: async () => {},
}));

function makeVerse(verse: number, book: number, chapter: number): VerseData {
  return {
    verse_id: book * 1000000 + chapter * 1000 + verse,
    book_number: book,
    chapter,
    verse,
    text: `verse ${verse}`,
    text_html: `verse ${verse}`,
    is_paragraph_start: false,
    words_of_christ: false,
  };
}

function stubProvider() {
  return {
    getChapter: vi.fn(async (_m: string, book: number, chapter: number) => ({
      verses: [1, 2, 3, 4].map((v) => makeVerse(v, book, chapter)),
      hasInterlinearData: false,
      coveredBooks: undefined,
    })),
    getVerseOfTheDay: vi.fn(async () => null),
  } as never;
}

async function boot() {
  vi.resetModules();
  localStorage.clear();
  const host = await import('../moduleHost');
  const hooks = await import('./readerHooks');
  const { bibleStore } = await import('../../stores/bibleStore');
  const { settingsStore } = await import('../../stores/settingsStore');
  bibleStore.tabs = [];
  bibleStore.activeTabId = '';
  bibleStore.init(stubProvider());
  hooks.resetReaderHookMemory();
  return { ...host, ...hooks, bibleStore, settingsStore };
}

const flush = async () => {
  for (let i = 0; i < 5; i++) await Promise.resolve();
};

describe('watchReaderStore: payload getters', () => {
  it('does not read the tab while nobody listens, reads it once somebody does', async () => {
    const h = await boot();
    let notify = () => {};
    const getActiveTab = vi.fn(() => ({ moduleAbbr: 'KJV', studyVerse: 43003001, selectionEndVerse: 43003003 }));
    h.watchReaderStore({ subscribe: (fn) => ((notify = fn), () => {}), getActiveTab });
    notify();
    expect(getActiveTab).not.toHaveBeenCalled();

    h.addWebModule({
      manifest: { id: 'fx', contributes: {}, hooks: [{ event: 'reader.selectionChanged' }], activationEvents: ['onStartupFinished'] },
      binding: { id: 'fx', load: async () => ({ hooks: { 'reader.selectionChanged': () => {} } }) },
    });
    h.reconcileModules();
    notify(); // enabled but inactive: still free
    expect(getActiveTab).not.toHaveBeenCalled();
    await h.featureModules.fire('onStartupFinished');
    notify();
    expect(getActiveTab).toHaveBeenCalled();
  }, 60_000);

  it('emitSelectionChanged never runs its getter without an active subscriber', async () => {
    const h = await boot();
    const getter = vi.fn(() => [1, 2]);
    h.emitSelectionChanged(getter, 'KJV');
    expect(getter).not.toHaveBeenCalled();
    h.addWebModule({
      manifest: { id: 'fx', contributes: {}, hooks: [{ event: 'reader.selectionChanged' }], activationEvents: ['onStartupFinished'] },
      binding: { id: 'fx', load: async () => ({ hooks: { 'reader.selectionChanged': () => {} } }) },
    });
    h.reconcileModules();
    h.emitSelectionChanged(getter, 'KJV');
    expect(getter).not.toHaveBeenCalled(); // enabled, not yet active
    await h.featureModules.fire('onStartupFinished');
    h.emitSelectionChanged(getter, 'KJV');
    expect(getter).toHaveBeenCalledTimes(1);
  }, 60_000);
});

describe('core events from the real sites', () => {
  it('reach an active module only, and stop when the module is switched off', async () => {
    const h = await boot();
    const got = {
      verse: vi.fn(),
      selection: vi.fn(),
      chapter: vi.fn(),
      setting: vi.fn(),
    };
    h.addWebModule({
      manifest: {
        id: 'fx',
        contributes: {},
        activationEvents: ['onStartupFinished'],
        hooks: [
          { event: 'reader.verseChanged' },
          { event: 'reader.selectionChanged' },
          { event: 'reader.chapterRendered' },
          { event: 'settings.changed' },
        ],
      },
      binding: {
        id: 'fx',
        load: async () => ({
          hooks: {
            'reader.verseChanged': got.verse,
            'reader.selectionChanged': got.selection,
            'reader.chapterRendered': got.chapter,
            'settings.changed': got.setting,
          },
        }),
      },
    });
    h.reconcileModules();
    const { bibleStore, settingsStore } = h;

    const drive = async (verse: number, endVerse?: number) => {
      await bibleStore.navigateTo(43, 3, verse);
      if (endVerse) bibleStore.extendSelectionTo(43003000 + endVerse);
      h.emitChapterRendered(43, 3, 'KJV');
      settingsStore.setWordsOfChristInRed(!settingsStore.wordsOfChristInRed);
      await flush();
    };

    // Not active yet: nothing is delivered.
    await drive(1, 3);
    for (const fn of Object.values(got)) expect(fn).not.toHaveBeenCalled();

    // Active: payloads arrive from the real sites.
    await h.featureModules.fire('onStartupFinished');
    expect(h.featureModules.isActive('fx')).toBe(true);
    h.resetReaderHookMemory();
    await drive(2, 4); // seeds the settings snapshot
    expect(got.verse).toHaveBeenCalledWith({ verseId: 43003002, module: bibleStore.getActiveTab()!.moduleAbbr });
    expect(got.selection).toHaveBeenCalledWith({ verseIds: [43003002, 43003003, 43003004], module: bibleStore.getActiveTab()!.moduleAbbr });
    expect(got.chapter).toHaveBeenCalledWith({ book: 43, chapter: 3, module: 'KJV' });
    got.setting.mockClear();
    settingsStore.setWordsOfChristInRed(!settingsStore.wordsOfChristInRed);
    expect(got.setting).toHaveBeenCalledWith({ key: 'wordsOfChristInRed' });

    // Consecutive identical values are dropped.
    got.chapter.mockClear();
    h.emitChapterRendered(43, 3, 'KJV');
    expect(got.chapter).not.toHaveBeenCalled();
    h.emitChapterRendered(43, 4, 'KJV');
    expect(got.chapter).toHaveBeenCalledWith({ book: 43, chapter: 4, module: 'KJV' });

    // Switched off at runtime: silent again.
    localStorage.setItem('kth.modules', '-fx');
    h.reconcileModules();
    expect(h.featureModules.isActive('fx')).toBe(false);
    for (const fn of Object.values(got)) fn.mockClear();
    h.resetReaderHookMemory();
    await drive(3, 4);
    h.emitChapterRendered(43, 9, 'KJV');
    for (const fn of Object.values(got)) expect(fn).not.toHaveBeenCalled();
  }, 60_000);
});

describe('the Presenter\'s reader.chapterRendered hook', () => {
  it('pauses following when the reader renders another chapter, only while the module is active', async () => {
    const h = await boot();
    const { registerBuiltinModules } = await import('../builtinModules');
    const { followStore } = await import('../present/stores/followStore');

    // A stand-in for EventSource: the follower's stream.
    const sources: { emit(type: string, data: unknown): void }[] = [];
    class FakeEventSource {
      listeners = new Map<string, (e: MessageEvent<string>) => void>();
      onerror: (() => void) | null = null;
      constructor() {
        sources.push(this);
      }
      addEventListener(t: string, fn: (e: MessageEvent<string>) => void) {
        this.listeners.set(t, fn);
      }
      close() {}
      emit(t: string, data: unknown) {
        this.listeners.get(t)?.({ data: JSON.stringify(data) } as MessageEvent<string>);
      }
    }
    (globalThis as unknown as { EventSource: unknown }).EventSource = FakeEventSource;

    registerBuiltinModules();
    followStore.start('ABCD2345');
    sources[0].emit('state', {
      version: 1,
      live: { kind: 'passage', module: 'KJV', book: 43, chapter: 3 },
      position: { index: 16, highlights: [] },
      display: { fontStep: 5, blanked: false, theme: 'dark' },
      session: { id: 'SESSION000000000', joinCode: 'ABCD2345', joinsLocked: false, viewerCount: 1 },
    });
    await flush();
    expect(followStore.paused).toBe(false);

    // The reader wanders to chapter 4 (what the follower's own navigation never does).
    await h.bibleStore.navigateTo(43, 4, 1);
    await flush();

    // Module not active: the event reaches nobody.
    h.featureModules.dispatch('reader.chapterRendered', { book: 43, chapter: 4, module: 'KJV' });
    expect(followStore.paused).toBe(false);

    await h.featureModules.activateNow('present', 'test');
    expect(h.featureModules.isActive('present')).toBe(true);
    h.featureModules.dispatch('reader.chapterRendered', { book: 43, chapter: 4, module: 'KJV' });
    expect(followStore.paused).toBe(true);

    followStore.stop();
  }, 60_000);
});
