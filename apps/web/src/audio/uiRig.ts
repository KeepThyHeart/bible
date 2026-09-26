/**
 * Test support for the audio UI: the real audio store, player, resolver and Bible
 * store wired to fake providers and a fake output, plus a helper that opens a
 * chapter. Nothing here makes a sound or touches the network.
 */

import { vi } from 'vitest';
import { Registry } from '@bible/core/browser';
import type { AudioCapabilities, AudioVoice, IAudioProvider, ITtsEngine } from '@bible/core/browser';
import { audioStore } from '../stores/audioStore';
import type { AudioSystem } from '../stores/audioStore';
import { bibleStore } from '../stores/bibleStore';
import { AudioPlayer } from './AudioPlayer';
import { AudioSourceResolver } from './AudioSourceResolver';
import { FakeOutput, FakeProvider, FakeTtsEngine } from './testing';
import type { VerseData } from '../types';

export const flush = async (n = 3) => { for (let i = 0; i < n; i++) await new Promise<void>(r => setTimeout(r, 0)); };

function verse(book: number, chapter: number, v: number): VerseData {
  return {
    verse_id: book * 1_000_000 + chapter * 1_000 + v, book_number: book, chapter, verse: v,
    text: `Text of verse ${v}`, text_html: `Text of verse ${v}`, is_paragraph_start: false, words_of_christ: false,
  };
}
export const chapterVerses = (book: number, chapter: number) => [1, 2, 3, 4, 5].map(v => verse(book, chapter, v));

const next = (r: { moduleAbbr: string; book: number; chapter: number }) =>
  r.book === 43 && r.chapter < 3 ? { ...r, chapter: r.chapter + 1 } : r.book === 43 ? { ...r, book: 44, chapter: 1 } : null;
const prev = (r: { moduleAbbr: string; book: number; chapter: number }) => (r.book === 43 && r.chapter > 1 ? { ...r, chapter: r.chapter - 1 } : null);

/** A TTS-flavoured provider with voices and a download requirement, backed by a fake engine for the settings screen. */
export class UiTts extends FakeProvider {
  needsDownload = false;
  voiceList: AudioVoice[] = [{ id: 'amy', label: 'Amy', language: 'en-US', quality: 'medium', downloadBytes: 63_000_000 }];
  capabilities(): AudioCapabilities { return { ...super.capabilities(), voices: true, needsDownload: this.needsDownload, onDevice: true }; }
  async voices() { return this.voiceList; }
}

export interface UiRig {
  out: FakeOutput;
  player: AudioPlayer;
  recorded: FakeProvider;
  tts: UiTts;
  engine: FakeTtsEngine;
  resolver: AudioSourceResolver;
  storage: Map<string, string>;
}

export function buildUiRig(opts: { recordings?: boolean; engine?: boolean; layout?: 'desktop' | 'phone' } = {}): UiRig {
  const out = new FakeOutput();
  const player = new AudioPlayer(out, { nextChapter: next, prevChapter: prev });
  const recorded = new FakeProvider('recorded', 'player', 'Recorded');
  if (!opts.recordings) vi.spyOn(recorded, 'supports').mockResolvedValue(false);
  const tts = new UiTts('tts:fake', 'engine', 'Fake');
  const engine = new FakeTtsEngine({ id: 'fake', label: 'Fake', voices: tts.voiceList });
  const providers = new Registry<IAudioProvider>();
  providers.register(recorded);
  const withEngine = opts.engine !== false;
  if (withEngine) providers.register(tts);
  const resolver = new AudioSourceResolver({
    providers, engineOrder: withEngine ? ['fake'] : [], engineSupported: async () => true, defaultVoice: () => undefined,
  });
  const storage = new Map<string, string>();
  const system: AudioSystem = {
    player, resolver, config: { base: '/audio', recorded: true, engines: [] }, languageOf: () => 'en',
    engines: withEngine ? new Map<string, ITtsEngine>([['fake', engine]]) : new Map(),
  };
  audioStore.init(system, { getItem: k => storage.get(k) ?? null, setItem: (k, v) => { storage.set(k, v); } });
  if (opts.layout) audioStore.setLayout(opts.layout);
  return { out, player, recorded, tts, engine, resolver, storage };
}

/** Open John 3 (or another chapter) in a fresh Bible store. */
export async function openChapter(book = 43, chapter = 3, module = 'KJV') {
  bibleStore.tabs = [];
  bibleStore.activeTabId = '';
  localStorage.clear();
  bibleStore.init({
    getChapter: vi.fn(async (_m: string, b: number, c: number) => ({ verses: chapterVerses(b, c), hasInterlinearData: false, coveredBooks: undefined })),
    getVerseOfTheDay: vi.fn(async () => null),
  } as never, module);
  await bibleStore.navigateTo(book, chapter);
  bibleStore.setShowHome(false);
  return bibleStore.getActiveTab()!;
}
