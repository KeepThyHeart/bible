/**
 * Test support for the audio components: a real `AudioStore` wired to fake ports, fake providers and a fake
 * output (nothing makes a sound or touches the network), a seeded Bible pane, and a render helper with the app's
 * i18n and the pane context. Test files mock `../audioState` with `audioStateMock()` so the components use this store.
 */
import React from 'react';
import { useSyncExternalStore } from 'react';
import { act, render } from '@testing-library/react';
import { Registry } from '@bible/core/browser';
import type { AudioCapabilities, AudioVoice, IAudioProvider, ITtsEngine } from '@bible/core/browser';
import { AudioPlayer, AudioSourceResolver, AudioStore } from '@bible/audio';
import type { AudioReaderTab, AudioSystem, FollowStore, PositionStore } from '@bible/audio';
import { FakeOutput, FakeProvider, FakeTtsEngine } from '@bible/audio/testing';
import { ContextProvider, type AppServices } from '../../../contexts/ContextProvider';
import { BiblePaneProvider, type BiblePaneContextValue } from '../../../components/BiblePaneContext';
import { I18nService } from '../../../services/I18nService';
import { useBibleStore } from '../../../stores/useBibleStore';
import { createDefaultPanelState } from '../../../stores/bible/types';
import type { BibleTab, BibleVerse } from '../../../stores/useBibleStore';
import enAudio from '../../../../../locales/en/audio.json';

export const PANEL = 'pane-1';
export const flush = async (n = 3) => { for (let i = 0; i < n; i++) await new Promise<void>((r) => setTimeout(r, 0)); };

// ---- the store the components see (through the mocked ../audioState)

const tabs = new Map<string, AudioReaderTab>();
const readerListeners = new Set<() => void>();
const reader = {
  subscribe: (fn: () => void) => { readerListeners.add(fn); return () => { readerListeners.delete(fn); }; },
  tab: (id: string) => tabs.get(id),
  activeTab: () => tabs.values().next().value as AudioReaderTab | undefined,
  selectionStart: () => null,
  followTo: () => {},
};
export const store = new AudioStore({ reader, modules: { subscribe: () => () => {}, languageOf: () => 'en' } });

/** The replacement for `../audioState` (use inside `vi.mock('../audioState', async () => (await import('./audioTestRig')).audioStateMock())`). */
export function audioStateMock() {
  return {
    audioStore: store,
    useAudio: <T,>(select: (s: AudioStore) => T): T => { useSyncExternalStore(store.subscribe, () => store.version); return select(store); },
    usePosition: (): Pick<PositionStore, 'position' | 'duration'> => {
      const p = store.position; useSyncExternalStore(p.subscribe, () => p.version);
      return { position: p.position, duration: p.duration };
    },
    useFollow: (): Pick<FollowStore, 'tabId' | 'verseId'> => {
      const f = store.follow; useSyncExternalStore(f.subscribe, () => f.version);
      return { tabId: f.tabId, verseId: f.verseId };
    },
  };
}

// ---- fakes

const next = (r: { moduleAbbr: string; book: number; chapter: number }) =>
  r.book === 43 && r.chapter < 3 ? { ...r, chapter: r.chapter + 1 } : r.book === 43 ? { ...r, book: 44, chapter: 1 } : null;
const prev = (r: { moduleAbbr: string; book: number; chapter: number }) => (r.book === 43 && r.chapter > 1 ? { ...r, chapter: r.chapter - 1 } : null);

/** A TTS-flavoured provider with voices and an optional download requirement. */
export class UiTts extends FakeProvider {
  needsDownload = false;
  voiceList: AudioVoice[] = [{ id: 'amy', label: 'Amy', language: 'en-US', quality: 'medium', downloadBytes: 63_000_000 }];
  capabilities(): AudioCapabilities { return { ...super.capabilities(), voices: true, needsDownload: this.needsDownload, onDevice: true }; }
  async voices() { return this.voiceList; }
}

export interface Rig {
  out: FakeOutput;
  player: AudioPlayer;
  recorded: FakeProvider;
  tts: UiTts;
  engine: FakeTtsEngine;
  storage: Map<string, string>;
}

export function buildRig(opts: { recordings?: boolean; engine?: boolean } = {}): Rig {
  const out = new FakeOutput();
  const player = new AudioPlayer(out, { nextChapter: next, prevChapter: prev });
  const recorded = new FakeProvider('recorded', 'player', 'Recorded');
  if (!opts.recordings) recorded.supports = async () => false;
  const tts = new UiTts('tts:fake', 'engine', 'Fake');
  const engine = new FakeTtsEngine({ id: 'fake', label: 'Fake', voices: tts.voiceList });
  const providers = new Registry<IAudioProvider>();
  providers.register(recorded);
  const withEngine = opts.engine !== false;
  if (withEngine) providers.register(tts);
  const resolver = new AudioSourceResolver({ providers, engineOrder: withEngine ? ['fake'] : [], engineSupported: async () => true, defaultVoice: () => undefined });
  const storage = new Map<string, string>();
  const system: AudioSystem = {
    player, resolver, config: { base: '/audio', recorded: true, engines: [] }, languageOf: () => 'en',
    engines: withEngine ? new Map<string, ITtsEngine>([['fake', engine]]) : new Map(),
  };
  store.reset();
  store.init(system, { getItem: (k) => storage.get(k) ?? null, setItem: (k, v) => { storage.set(k, v); } });
  return { out, player, recorded, tts, engine, storage };
}

const verse = (book: number, chapter: number, v: number): BibleVerse => ({
  verse_id: book * 1_000_000 + chapter * 1_000 + v, book_number: book, chapter, verse: v, text: `Text of verse ${v}`,
});
export const chapterVerses = (book = 43, chapter = 3) => [1, 2, 3, 4, 5].map((v) => verse(book, chapter, v));

/** Seed pane `PANEL` showing John 3 in KJV (both the Bible store the components read and the audio reader port). */
export function seedPane(opts: { selectedVerseId?: number | null } = {}) {
  const verses = chapterVerses();
  const tab = {
    tabId: 'tab-1', abbreviation: 'KJV', name: 'King James', displayMode: 'standard', book: 43, chapter: 3, bookName: 'John',
    selectedVerseId: opts.selectedVerseId ?? null, history: [], historyIndex: -1,
  } as unknown as BibleTab;
  const state = { ...createDefaultPanelState(), openTabs: [tab], currentBook: 43, currentChapter: 3, currentBookName: 'John', selectedVerseId: opts.selectedVerseId ?? null, versesByTab: new Map([['tab-1', verses]]) };
  useBibleStore.setState({ panels: new Map([[PANEL, state]]) } as never);
  tabs.clear();
  tabs.set(PANEL, { id: PANEL, moduleAbbr: 'KJV', book: 43, chapter: 3, loading: false, verses, studyVerse: opts.selectedVerseId ?? null });
  readerListeners.forEach((fn) => fn());
  return { verses, tab };
}

export async function playNow() {
  await act(async () => {
    const p = store.play(PANEL);
    await flush();
    await p;
    await flush();
  });
}

// ---- rendering

export function createAudioI18n(): I18nService {
  const i18n = new I18nService({ initialLocale: 'en' });
  i18n.loadCatalog('en', 'en', enAudio as Record<string, string>);
  return i18n;
}

export function renderAudio(ui: React.ReactElement, opts: { pane?: boolean; loading?: boolean } = {}) {
  const services = { registry: {}, whenContext: {}, keybindings: {}, i18n: createAudioI18n() } as unknown as AppServices;
  const verses = chapterVerses();
  const pane = {
    panelId: PANEL, activeTab: { tabId: 'tab-1', abbreviation: 'KJV' }, currentVerses: verses, isLoading: opts.loading ?? false,
  } as unknown as BiblePaneContextValue;
  const body = opts.pane === false ? ui : <BiblePaneProvider value={pane}>{ui}</BiblePaneProvider>;
  return render(<ContextProvider services={services}>{body}</ContextProvider>);
}
