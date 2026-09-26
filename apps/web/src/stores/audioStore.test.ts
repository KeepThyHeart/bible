/**
 * The audio store against the real AudioPlayer, resolver, prefs and Bible store,
 * with fake providers and a fake output: nothing here makes a sound or touches
 * the network. Every test that needs a recording uses a fixture provider; the
 * default rig has none, which is the state the app ships in.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { Registry } from '@bible/core/browser';
import type { AudioCapabilities, IAudioProvider } from '@bible/core/browser';
import { audioStore } from './audioStore';
import type { AudioSystem } from './audioStore';
import { bibleStore } from './bibleStore';
import { eventBus } from '../events/eventBus';
import { AudioPlayer } from '../audio/AudioPlayer';
import { AudioSourceResolver } from '../audio/AudioSourceResolver';
import { AUDIO_PREFS_KEY } from '../audio/audioPrefs';
import { FakeOutput, FakeProvider } from '../audio/testing';
import type { VerseData } from '../types';

const flush = async () => { for (let i = 0; i < 3; i++) await new Promise<void>(r => setTimeout(r, 0)); };

function verse(book: number, chapter: number, v: number): VerseData {
  return {
    verse_id: book * 1_000_000 + chapter * 1_000 + v, book_number: book, chapter, verse: v,
    text: `verse ${v}`, text_html: `verse ${v}`, is_paragraph_start: false, words_of_christ: false,
  };
}
const chapterVerses = (book: number, chapter: number) => [1, 2, 3, 4, 5].map(v => verse(book, chapter, v));

const next = (r: { moduleAbbr: string; book: number; chapter: number }) =>
  r.book === 43 && r.chapter < 3 ? { ...r, chapter: r.chapter + 1 } : r.book === 43 ? { ...r, book: 44, chapter: 1 } : null;
const prev = (r: { moduleAbbr: string; book: number; chapter: number }) => (r.book === 43 && r.chapter > 1 ? { ...r, chapter: r.chapter - 1 } : null);

/** A TTS-flavoured fake whose capabilities can require a voice download. */
class GatedTts extends FakeProvider {
  needsDownload = true;
  capabilities(): AudioCapabilities { return { ...super.capabilities(), needsDownload: this.needsDownload, onDevice: true }; }
  async voices() { return [{ id: 'v1', label: 'Amy', language: 'en', downloadBytes: 63_000_000 }]; }
}

interface Rig {
  out: FakeOutput;
  player: AudioPlayer;
  recorded: FakeProvider;
  tts: GatedTts;
  providers: Registry<IAudioProvider>;
  resolver: AudioSourceResolver;
  storage: Map<string, string>;
}

let rig: Rig;

function build(opts: { recordings?: boolean; engine?: boolean } = {}): Rig {
  const out = new FakeOutput();
  const player = new AudioPlayer(out, { nextChapter: next, prevChapter: prev });
  const recorded = new FakeProvider('recorded', 'player');
  if (!opts.recordings) vi.spyOn(recorded, 'supports').mockResolvedValue(false);
  const tts = new GatedTts('tts:fake', 'engine');
  const providers = new Registry<IAudioProvider>();
  providers.register(recorded);
  const engines = opts.engine === false ? [] : ['fake'];
  if (opts.engine !== false) providers.register(tts);
  const resolver = new AudioSourceResolver({ providers, engineOrder: engines, engineSupported: async () => true, defaultVoice: () => undefined });
  const storage = new Map<string, string>();
  const system: AudioSystem = { player, resolver, config: { base: '/audio', recorded: true, engines: [] }, languageOf: () => 'en' };
  audioStore.init(system, {
    getItem: k => storage.get(k) ?? null,
    setItem: (k, v) => { storage.set(k, v); },
  });
  return { out, player, recorded, tts, providers, resolver, storage };
}

async function openTab(book = 43, chapter = 3, module = 'KJV') {
  bibleStore.tabs = [];
  bibleStore.activeTabId = '';
  localStorage.clear();
  bibleStore.init({
    getChapter: vi.fn(async (_m: string, b: number, c: number) => ({ verses: chapterVerses(b, c), hasInterlinearData: false, coveredBooks: undefined })),
    getVerseOfTheDay: vi.fn(async () => null),
  } as never, module);
  await bibleStore.navigateTo(book, chapter);
  return bibleStore.getActiveTab()!;
}

async function playNow() {
  const p = audioStore.play();
  await flush();
  await p;
  await flush();
}

beforeEach(async () => {
  audioStore.reset();
  await openTab();
});
afterEach(() => { audioStore.reset(); vi.restoreAllMocks(); });

describe('with zero recordings (the shipped state)', () => {
  it('and no engine: nothing can play, Play stays disabled and never reaches the player', async () => {
    rig = build({ engine: false });
    const tab = bibleStore.getActiveTab()!;
    expect(audioStore.canPlay(tab)).toBe(false);
    await flush();
    expect(audioStore.availability('KJV')).toBe('none');
    const open = vi.spyOn(rig.recorded, 'openChapter');
    await playNow();
    expect(open).not.toHaveBeenCalled();
    expect(audioStore.status).toBe('idle');
  });

  it('with an on-device engine: plays on-device speech from the selected verse', async () => {
    rig = build();
    expect(audioStore.availability('KJV')).toBe('unknown'); // first ask starts the check
    await flush();
    expect(audioStore.availability('KJV')).toBe('ok');
    rig.tts.needsDownload = false;
    await playNow();
    expect(audioStore.status).toBe('playing');
    expect(audioStore.providerId).toBe('tts:fake');
    expect(rig.tts.openCalls[0].ref).toMatchObject({ book: 43, chapter: 3 });
  });

  it('a stated preference for recordings falls back with a notice', async () => {
    rig = build();
    rig.tts.needsDownload = false;
    audioStore.setPrefs({ source: 'recorded' });
    await playNow();
    expect(audioStore.providerId).toBe('tts:fake');
    expect(audioStore.notice?.key).toBe('audio.notice.preferredUnavailable');
  });
});

describe('with a fixture recording', () => {
  beforeEach(() => { rig = build({ recordings: true }); });

  it('plays the recording, at the requested verse', async () => {
    const tab = bibleStore.getActiveTab()!;
    tab.studyVerse = 43003004;
    await flush();
    await playNow();
    expect(audioStore.providerId).toBe('recorded');
    expect(rig.recorded.openCalls[0].ref).toMatchObject({ book: 43, chapter: 3 });
    expect(rig.out.loaded[0].offset).toBe(30); // verse 4 at 10 s a verse
    expect(audioStore.follow.verseId).toBe(43003004);
  });

  it('starts at the first verse when nothing (or another chapter) is selected', async () => {
    const tab = bibleStore.getActiveTab()!;
    tab.studyVerse = null;
    await flush();
    await playNow();
    expect(rig.out.loaded[0].offset).toBe(0);
    audioStore.stop();
    tab.studyVerse = 43002009; // a leftover selection from another chapter
    await playNow();
    expect(rig.out.loaded.at(-1)!.offset).toBe(0);
  });

  it('starts at the start of a shift-click range', async () => {
    const tab = bibleStore.getActiveTab()!;
    tab.studyVerse = 43003005;
    tab.selectionEndVerse = 43003002;
    await flush();
    await playNow();
    expect(rig.out.loaded[0].offset).toBe(10); // verse 2
  });

  it('a loading tab with no verses cannot play', async () => {
    const tab = bibleStore.getActiveTab()!;
    await flush();
    tab.verses = [];
    expect(audioStore.canPlay(tab)).toBe(false);
    await playNow();
    expect(audioStore.status).toBe('idle');
  });

  it('two quick clicks start one playback; toggling pauses and resumes', async () => {
    await flush();
    const a = audioStore.play();
    const b = audioStore.play();
    await Promise.all([a, b]);
    await flush();
    expect(rig.recorded.openCalls.length).toBe(1);
    audioStore.togglePlay();
    expect(audioStore.status).toBe('paused');
    audioStore.togglePlay();
    expect(audioStore.status).toBe('playing');
  });

  it('playing on another tab replaces the current playback (one player app-wide)', async () => {
    await flush();
    await playNow();
    const first = bibleStore.getActiveTab()!;
    bibleStore.addTab('KJV');
    const second = bibleStore.getActiveTab()!;
    await bibleStore.navigateTo(43, 1);
    await flush();
    await playNow();
    expect(audioStore.playingTabId).toBe(second.id);
    expect(audioStore.playingTabId).not.toBe(first.id);
    expect(rig.recorded.openCalls.at(-1)!.ref).toMatchObject({ chapter: 1 });
  });
});

describe('gates', () => {
  beforeEach(() => { rig = build(); });

  it('phone: the battery notice appears once per engine, persists, and does not block later plays', async () => {
    rig.tts.needsDownload = false;
    audioStore.setLayout('phone');
    await flush();
    const p = audioStore.play();
    await flush();
    expect(audioStore.pendingGate).toMatchObject({ kind: 'battery', engineId: 'fake' });
    expect(rig.tts.openCalls.length).toBe(0);
    audioStore.confirmGate();
    await p;
    await flush();
    expect(rig.tts.openCalls.length).toBe(1);
    expect(JSON.parse(rig.storage.get(AUDIO_PREFS_KEY)!).phoneBatteryNoticeSeen).toEqual({ fake: true });
    audioStore.stop();
    await playNow();
    expect(audioStore.pendingGate).toBeNull();
    expect(rig.tts.openCalls.length).toBe(2);
  });

  it('desktop, or a recording: no battery notice', async () => {
    rig.tts.needsDownload = false;
    await flush();
    await playNow();
    expect(audioStore.pendingGate).toBeNull();
    audioStore.stop();
    audioStore.setLayout('phone');
    rig.recorded.supports = async () => true;
    rig.resolver.invalidate();
    await playNow();
    expect(audioStore.providerId).toBe('recorded');
    expect(audioStore.pendingGate).toBeNull();
  });

  it('a voice that is not downloaded asks first (with its size); cancel downloads nothing, confirm does', async () => {
    rig.tts.ready = false;
    await flush();
    const p = audioStore.play();
    await flush();
    expect(audioStore.pendingGate).toMatchObject({ kind: 'download', voiceLabel: 'Amy', bytes: 63_000_000 });
    audioStore.cancelGate();
    await p;
    expect(rig.tts.prepareCalls).toBe(0);
    expect(audioStore.status).toBe('idle');

    const q = audioStore.play();
    await flush();
    audioStore.confirmGate();
    await q;
    await flush();
    expect(rig.tts.prepareCalls).toBe(1);
    expect(audioStore.status).toBe('playing');
  });

  it('phone: one notice covers battery and download (with the size); an already downloaded voice drops the size', async () => {
    rig.tts.ready = false;
    audioStore.setLayout('phone');
    await flush();
    const p = audioStore.play();
    await flush();
    expect(audioStore.pendingGate).toMatchObject({ kind: 'battery', voiceLabel: 'Amy', bytes: 63_000_000 });
    audioStore.confirmGate();
    await p;
    await flush();
    // No second question: confirming "Download and play" downloaded and played.
    expect(rig.tts.prepareCalls).toBe(1);
    expect(audioStore.status).toBe('playing');

    // A voice that is already on the phone: the notice has no size.
    audioStore.stop();
    audioStore.setPrefs({ phoneBatteryNoticeSeen: {} });
    rig.tts.ready = true;
    const q = audioStore.play();
    await flush();
    expect(audioStore.pendingGate).toMatchObject({ kind: 'battery', bytes: undefined });
    audioStore.stop();
    await q;
  });

  it('stop() during a gate cancels the play', async () => {
    rig.tts.ready = false;
    await flush();
    const p = audioStore.play();
    await flush();
    expect(audioStore.pendingGate?.kind).toBe('download');
    audioStore.stop();
    await p;
    expect(audioStore.pendingGate).toBeNull();
    expect(rig.tts.prepareCalls).toBe(0);
  });
});

describe('follow-along is a highlight only', () => {
  beforeEach(async () => {
    await openTab(43, 1);
    rig = build({ recordings: true });
    await flush();
  });

  it('turning the page at the chapter end leaves the selection, commentary and history alone', async () => {
    const tab = bibleStore.getActiveTab()!;
    tab.studyVerse = 43001005;
    const historyLength = tab.history.length;
    await playNow();
    const emit = vi.spyOn(eventBus, 'emit');
    rig.out.end(); // the recording of John 1 ends
    await flush(); await flush();
    expect(tab.chapter).toBe(2);
    expect(tab.studyVerse).toBe(43001005); // untouched: the panes keep the reader's verse
    expect(tab.pendingScrollVerse).toBeNull();
    expect(emit).not.toHaveBeenCalledWith('commentary:load-chapter', expect.anything());
    expect(tab.history.length).toBe(historyLength); // replaced, not pushed
    expect(audioStore.status).toBe('playing');
    expect(audioStore.follow.verseId).toBe(43002001);
  });

  it('advancing verse by verse never touches the selection', async () => {
    const tab = bibleStore.getActiveTab()!;
    tab.studyVerse = 43001001;
    const setStudy = vi.spyOn(bibleStore, 'setStudyVerse');
    const scroll = vi.spyOn(bibleStore, 'scrollToVerse');
    const notify = vi.fn();
    await playNow();
    bibleStore.subscribe(notify);
    rig.out.tick(15);
    rig.out.tick(25);
    expect(audioStore.follow.verseId).toBe(43001003);
    expect(tab.studyVerse).toBe(43001001);
    expect(setStudy).not.toHaveBeenCalled();
    expect(scroll).not.toHaveBeenCalled();
    expect(notify).not.toHaveBeenCalled(); // the Bible store was not even notified
  });

  it('with continue set to stop, or at the end of the book, playback ends without turning the page', async () => {
    audioStore.setPrefs({ continueAfterChapter: 'stop' });
    const tab = bibleStore.getActiveTab()!;
    await playNow();
    rig.out.end();
    await flush();
    expect(audioStore.status).toBe('idle');
    expect(tab.chapter).toBe(1);

    audioStore.setPrefs({ continueAfterChapter: 'next-chapter' });
    await bibleStore.navigateTo(43, 3);
    await flush();
    await playNow();
    rig.out.end(); // end of John: the next chapter is in another book
    await flush();
    expect(audioStore.status).toBe('idle');
    expect(tab.book).toBe(43);
    expect(tab.chapter).toBe(3);
  });

  it('an inactive playing tab turns its own page; the active tab and the hash are untouched', async () => {
    const playing = bibleStore.getActiveTab()!;
    await playNow();
    bibleStore.addTab('KJV');
    await bibleStore.navigateTo(43, 2);
    const other = bibleStore.getActiveTab()!;
    window.location.hash = '#/KJV/43/2';
    rig.out.end();
    await flush(); await flush();
    expect(playing.chapter).toBe(2);
    expect(other.chapter).toBe(2);
    expect(other.id).toBe(bibleStore.activeTabId);
    expect(window.location.hash).toBe('#/KJV/43/2');
    expect(audioStore.playingTabId).toBe(playing.id);
  });
});

describe('the reader is in charge', () => {
  beforeEach(async () => {
    await openTab(43, 1);
    rig = build({ recordings: true });
    await flush();
    await playNow();
  });

  it('navigating the playing tab to another chapter stops playback', async () => {
    await bibleStore.navigateTo(43, 3);
    await flush();
    expect(audioStore.status).toBe('idle');
    expect(audioStore.follow.verseId).toBeNull();
  });

  it('clicking a verse, or working in another tab, does not stop it', async () => {
    const playing = bibleStore.getActiveTab()!;
    bibleStore.setStudyVerse(43001004);
    expect(audioStore.status).toBe('playing');
    bibleStore.addTab('KJV');
    await bibleStore.navigateTo(43, 3);
    bibleStore.setActiveTab(playing.id);
    expect(audioStore.status).toBe('playing');
  });

  it('closing the playing tab stops it', async () => {
    bibleStore.addTab('KJV');
    await bibleStore.navigateTo(43, 2);
    bibleStore.removeTab(audioStore.playingTabId!);
    await flush();
    expect(audioStore.status).toBe('idle');
  });

  it('changing the translation resumes at the same verse in the new one; no audio there stops with a notice', async () => {
    rig.out.tick(15); // verse 2
    await bibleStore.setTabTranslation(bibleStore.getActiveTab()!.id, 'WEB');
    await flush(); await flush();
    expect(audioStore.playingModule).toBe('WEB');
    expect(rig.recorded.openCalls.at(-1)!.ref).toMatchObject({ moduleAbbr: 'WEB' });
    expect(audioStore.follow.verseId).toBe(43001002);

    vi.spyOn(rig.recorded, 'supports').mockResolvedValue(false);
    vi.spyOn(rig.tts, 'supports').mockResolvedValue(false);
    rig.resolver.invalidate();
    await bibleStore.setTabTranslation(bibleStore.getActiveTab()!.id, 'RV');
    await flush(); await flush();
    expect(audioStore.status).toBe('idle');
    expect(audioStore.notice?.key).toBe('audio.notice.noAudio');
  });
});

describe('errors and alternatives', () => {
  beforeEach(async () => {
    await openTab(43, 1);
    rig = build({ recordings: true });
    rig.tts.needsDownload = false;
    await flush();
  });

  it('a retryable failure offers Retry (and On-device, since one exists) and resumes from the failed verse', async () => {
    await playNow();
    rig.out.tick(15);
    rig.out.error({ code: 'network', message: 'lost', retryable: true });
    expect(audioStore.error?.code).toBe('network');
    await flush();
    expect(audioStore.notice).toMatchObject({ key: 'audio.error.network', tone: 'error' });
    expect(audioStore.notice?.actions).toContain('retry');
    expect(audioStore.notice?.actions).toContain('useOnDevice'); // an on-device provider exists for this language
    audioStore.retry();
    await flush();
    expect(audioStore.status).toBe('playing');
  });

  it('a blocked autoplay offers Resume, not Retry', async () => {
    rig.out.playFails = { code: 'autoplay', message: 'blocked', retryable: true };
    await playNow();
    expect(audioStore.notice?.actions).toEqual(['resume']);
  });

  it('"use on-device speech" plays the on-device provider this session, without changing stored prefs', async () => {
    rig.recorded.openFails = { code: 'not-found', message: 'not recorded', retryable: false };
    await playNow();
    expect(audioStore.status).toBe('error');
    const stored = rig.storage.get(AUDIO_PREFS_KEY);
    await audioStore.useOnDeviceInstead();
    await flush();
    expect(audioStore.providerId).toBe('tts:fake');
    expect(audioStore.status).toBe('playing');
    expect(rig.storage.get(AUDIO_PREFS_KEY)).toBe(stored);
  });
});

describe('preferences while playing', () => {
  beforeEach(async () => {
    await openTab(43, 1);
    rig = build({ recordings: true });
    rig.tts.needsDownload = false;
    await flush();
    await playNow();
  });

  it('speed is clamped to what the provider supports and applied at once', () => {
    audioStore.setPrefs({ rate: 3 });
    expect(rig.out.rate).toBe(2); // FakeProvider range is 0.5-2
    audioStore.setPrefs({ rate: 1.26 });
    expect(rig.out.rate).toBe(1.3); // snapped to the provider's 0.1 step
    expect(audioStore.prefs.rate).toBe(1.26); // the wish itself is kept
  });

  it('switching source restarts on the new provider from the current verse', async () => {
    rig.out.tick(15);
    audioStore.setPrefs({ source: 'tts:fake' });
    await flush(); await flush();
    expect(audioStore.providerId).toBe('tts:fake');
    expect(rig.tts.openCalls.at(-1)!.ref).toMatchObject({ chapter: 1 });
    expect(audioStore.follow.verseId).toBe(43001002);
  });

  it('while paused the change waits until Resume', async () => {
    audioStore.pause();
    audioStore.setPrefs({ source: 'tts:fake' });
    await flush();
    expect(audioStore.providerId).toBe('recorded');
    audioStore.resume();
    await flush(); await flush();
    expect(audioStore.providerId).toBe('tts:fake');
  });

  it('follow and scroll switches are read live and never restart anything', () => {
    const opens = rig.recorded.openCalls.length;
    audioStore.setPrefs({ followAlong: false, autoScroll: false });
    expect(rig.recorded.openCalls.length).toBe(opens);
    expect(audioStore.prefs.followAlong).toBe(false);
  });
});

describe('notifications', () => {
  it('position ticks do not notify the store or the follow store; a verse change notifies follow once', async () => {
    await openTab(43, 1);
    rig = build({ recordings: true });
    await flush();
    await playNow();
    const main = vi.fn();
    const follow = vi.fn();
    const position = vi.fn();
    audioStore.subscribe(main);
    audioStore.follow.subscribe(follow);
    audioStore.position.subscribe(position);
    rig.out.tick(1);
    rig.out.tick(2);
    rig.out.tick(3);
    expect(main).not.toHaveBeenCalled();
    expect(follow).not.toHaveBeenCalled();
    expect(position).toHaveBeenCalled();
    rig.out.tick(12);
    expect(follow).toHaveBeenCalledTimes(1);
  });
});

describe('review fixes', () => {
  beforeEach(async () => {
    await openTab(43, 1);
    rig = build({ recordings: true });
    rig.tts.needsDownload = false;
    await flush();
    await playNow();
  });

  it('a translation change while paused waits for Resume, then plays the new translation', async () => {
    audioStore.pause();
    const opens = rig.recorded.openCalls.length;
    await bibleStore.setTabTranslation(bibleStore.getActiveTab()!.id, 'WEB');
    await flush();
    expect(audioStore.status).toBe('paused');
    expect(rig.recorded.openCalls.length).toBe(opens);
    audioStore.resume();
    await flush(); await flush();
    expect(audioStore.status).toBe('playing');
    expect(rig.recorded.openCalls.at(-1)!.ref).toMatchObject({ moduleAbbr: 'WEB' });
  });

  it('a translation change starts one restart, and a Stop right after is not overridden', async () => {
    const opens = rig.recorded.openCalls.length;
    const change = bibleStore.setTabTranslation(bibleStore.getActiveTab()!.id, 'WEB');
    audioStore.stop();
    await change;
    await flush(); await flush();
    expect(audioStore.status).toBe('idle');
    expect(rig.recorded.openCalls.length).toBe(opens);
  });

  it('the old playback is paused while a new source waits behind a gate', async () => {
    rig.tts.needsDownload = true;
    rig.tts.ready = false;
    audioStore.setPrefs({ source: 'tts:fake' });
    await flush(); await flush();
    expect(audioStore.pendingGate?.kind).toBe('download');
    expect(rig.out.pauseCalls).toBeGreaterThan(0);
    audioStore.cancelGate();
  });

  it('a check that failed is asked again later instead of leaving Play unknown for the session', async () => {
    audioStore.reset();
    rig = build({ engine: false });
    let calls = 0;
    vi.spyOn(rig.recorded, 'supports').mockImplementation(async () => { calls++; if (calls === 1) throw new Error('offline'); return true; });
    vi.useFakeTimers({ toFake: ['Date'] });
    try {
      expect(audioStore.availability('KJV')).toBe('unknown');
      await flush();
      expect(audioStore.availability('KJV')).toBe('unknown'); // failed; throttled
      expect(calls).toBe(1);
      vi.setSystemTime(Date.now() + 31_000);
      audioStore.availability('KJV');
      await flush();
      expect(audioStore.availability('KJV')).toBe('ok');
    } finally {
      vi.useRealTimers();
    }
  });
});

describe('sources, voices and the phone player', () => {
  beforeEach(() => { rig = build({ recordings: true }); rig.tts.needsDownload = false; });

  it('sources() lists every provider with whether it can play; invalidateSources bumps the version', async () => {
    const list = await audioStore.sources('KJV');
    expect(list.map(s => [s.provider.id, s.usable])).toEqual([['recorded', true], ['tts:fake', true]]);
    const v = audioStore.sourcesVersion;
    audioStore.invalidateSources('KJV');
    expect(audioStore.sourcesVersion).toBe(v + 1);
  });

  it('per-translation source and voice are stored, and clearing them removes the entry', () => {
    audioStore.setTranslationSource('KJV', 'tts:fake');
    audioStore.setTranslationVoice('KJV', 'v1');
    expect(audioStore.prefs.perTranslation.KJV).toEqual({ source: 'tts:fake', voiceId: 'v1' });
    audioStore.setTranslationSource('KJV', undefined);
    expect(audioStore.prefs.perTranslation.KJV).toEqual({ voiceId: 'v1' });
    audioStore.setTranslationVoice('KJV', undefined);
    expect(audioStore.prefs.perTranslation.KJV).toBeUndefined();
    expect(JSON.parse(rig.storage.get(AUDIO_PREFS_KEY)!).perTranslation).toEqual({});
  });

  it('the engine voice is keyed by engine and language subtag', () => {
    audioStore.setEngineVoice('piper', 'en-US', 'amy');
    expect(audioStore.prefs.voiceByEngineLang).toEqual({ 'piper:en': 'amy' });
  });

  it('jumpToVerse restarts at that verse in the same source', async () => {
    await flush();
    await playNow();
    audioStore.jumpToVerse(4);
    await flush();
    expect(rig.recorded.openCalls.at(-1)!.ref).toMatchObject({ chapter: 3 });
    expect(audioStore.follow.verseId).toBe(43003004);
    expect(audioStore.providerId).toBe('recorded');
  });

  it('the phone player opens and closes, and a stopped playback closes it', async () => {
    audioStore.setLayout('phone');
    audioStore.openPlayer();
    expect(audioStore.playerOpen).toBe(true);
    audioStore.closePlayer();
    expect(audioStore.playerOpen).toBe(false);
    await flush();
    await playNow();
    audioStore.openPlayer();
    audioStore.stop();
    expect(audioStore.playerOpen).toBe(false);
  });
});
