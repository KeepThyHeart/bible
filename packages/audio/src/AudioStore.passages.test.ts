import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import type { ChapterRef, VerseRef } from '@bible/core/browser';
import { AudioStore } from './AudioStore';
import type { AudioSystem } from './AudioStore';
import { AudioPlayer } from './AudioPlayer';
import type { AudioSourceResolver } from './AudioSourceResolver';
import type { AudioPassage } from './passageQueue';
import { FakeAudioReader, FakeOutput, FakeProvider } from './testing';

// John (43) has chapters 1-3 of five verses each (10 s per verse: verse n ends at n * 10); Acts follows.
const nextChapter = (r: ChapterRef): ChapterRef | null =>
  r.book === 43 && r.chapter < 3 ? { ...r, chapter: r.chapter + 1 } : r.book === 43 ? { ...r, book: 44, chapter: 1 } : null;
const prevChapter = (r: ChapterRef): ChapterRef | null =>
  r.book === 43 && r.chapter > 1 ? { ...r, chapter: r.chapter - 1 } : null;

let reader: FakeAudioReader;
let out: FakeOutput;
let provider: FakeProvider;
let player: AudioPlayer;
let store: AudioStore;

const flush = async () => { for (let i = 0; i < 4; i++) await new Promise<void>(r => setTimeout(r, 0)); };
const at = (verse: number, chapter = 1, book = 43): VerseRef => ({ moduleAbbr: 'KJV', book, chapter, verse });
const cur = () => player.state.current;
/** Let the recording play to the end of verse `v` of the chapter in hand. */
const readTo = async (v: number) => { out.tick(v * 10); await flush(); };
const endChapter = async () => { out.end(); await flush(); };

function build(providerId = 'recorded'): void {
  reader = new FakeAudioReader();
  reader.addTab('A');
  out = new FakeOutput();
  provider = new FakeProvider(providerId);
  player = new AudioPlayer(out, { nextChapter, prevChapter });
  store = new AudioStore({ reader, modules: { subscribe: () => () => {}, languageOf: () => 'en' } });
  const resolver = {
    resolve: async () => ({ provider, reason: 'preferred' as const }),
    cachedAvailability: () => true,
    options: async () => [],
    invalidate: () => {},
    sourceStatus: async () => [],
  } as unknown as AudioSourceResolver;
  const system: AudioSystem = { player, resolver, config: {} as AudioSystem['config'] };
  store.init(system, null);
}

const range = (p: Partial<AudioPassage> & { chapter: number }): AudioPassage => ({ book: 43, ...p });

beforeEach(() => build());
afterEach(() => { store.reset(); player.dispose(); });

describe('typed list', () => {
  it('has a reactive queue while playing and none when idle', async () => {
    await store.playPassages('A', [range({ chapter: 1, verse: 2, endVerse: 3 }), range({ chapter: 2 })]);
    await flush();
    expect(store.queue).toMatchObject({ kind: 'list', index: 0 });
    expect(store.queue?.passages).toHaveLength(2);
    expect(cur()).toEqual(at(2));
    store.stop();
    expect(store.queue).toBeNull();
  });

  it('turns the page for a passage elsewhere and starts at its first verse', async () => {
    await store.playPassages('A', [range({ chapter: 2, verse: 3 })]);
    await flush();
    expect(reader.followCalls[0]).toEqual(['A', 43, 2]);
    expect(cur()).toEqual(at(3, 2));
    expect(store.status).toBe('playing');
  });

  it('continues into later chapters of a passage even with continue-after-chapter off', async () => {
    store.setContinueAfterChapter(false);
    await store.playPassages('A', [range({ chapter: 1, verse: 4, endChapter: 2, endVerse: 2 })]);
    await flush();
    await endChapter();
    expect(cur()).toEqual(at(1, 2));
    expect(store.status).toBe('playing');
    expect(reader.followCalls).toContainEqual(['A', 43, 2]);
    await readTo(2); // the stop verse
    expect(store.status).toBe('idle');
  });

  it("'once' ends after the last passage: bookmark cleared, selection untouched", async () => {
    await store.playPassages('A', [range({ chapter: 1, verse: 1, endVerse: 2 }), range({ chapter: 1, verse: 4, endVerse: 4 })]);
    await flush();
    await readTo(2);
    expect(store.queue?.index).toBe(1);
    expect(cur()).toEqual(at(4));
    await readTo(4);
    expect(store.status).toBe('idle');
    expect(store.queue).toBeNull();
    expect(store.bookmarkFor('A')).toBeNull();
    expect(reader.markStopped).not.toHaveBeenCalled();
  });

  it("'list' wraps to the first passage", async () => {
    store.setPassageLoop('list');
    await store.playPassages('A', [range({ chapter: 1, verse: 1, endVerse: 1 }), range({ chapter: 1, verse: 3, endVerse: 3 })]);
    await flush();
    await readTo(1);
    expect(store.queue?.index).toBe(1);
    await readTo(3);
    expect(store.queue?.index).toBe(0);
    expect(cur()).toEqual(at(1));
    expect(store.status).toBe('playing');
  });

  it("'passage' repeats the same passage", async () => {
    store.setPassageLoop('passage');
    await store.playPassages('A', [range({ chapter: 1, verse: 2, endVerse: 2 }), range({ chapter: 2 })]);
    await flush();
    await readTo(2);
    expect(store.queue?.index).toBe(0);
    expect(cur()).toEqual(at(2));
    expect(store.status).toBe('playing');
    expect(out.loaded).toHaveLength(1); // looped by seeking inside the open recording, not by reopening
  });

  it('a passage ending at the chapter end moves on through chapterEnd', async () => {
    await store.playPassages('A', [range({ chapter: 1, verse: 4 }), range({ chapter: 2, verse: 5 })]);
    await flush();
    await endChapter();
    expect(store.queue?.index).toBe(1);
    expect(cur()).toEqual(at(5, 2));
  });

  it('a stop verse missing from the chapter is treated as the passage end', async () => {
    await store.playPassages('A', [range({ chapter: 1, verse: 4, endVerse: 9 }), range({ chapter: 2, verse: 1, endVerse: 1 })]);
    await flush();
    await endChapter(); // no verse 9: chapterEnd fires
    expect(store.queue?.index).toBe(1);
    expect(cur()).toEqual(at(1, 2));
  });

  it('nextPassage / prevPassage move through the list and are no-ops at its ends', async () => {
    await store.playPassages('A', [range({ chapter: 1, verse: 1, endVerse: 2 }), range({ chapter: 2, verse: 2, endVerse: 3 })]);
    await flush();
    store.prevPassage();
    await flush();
    expect(store.queue?.index).toBe(0);
    store.nextPassage();
    await flush();
    expect(store.queue?.index).toBe(1);
    expect(cur()).toEqual(at(2, 2));
    const loads = out.loaded.length;
    store.nextPassage();
    await flush();
    expect(store.queue?.index).toBe(1);
    expect(out.loaded.length).toBe(loads);
    store.prevPassage();
    await flush();
    expect(store.queue?.index).toBe(0);
    expect(cur()).toEqual(at(1));
  });

  it('seekVerse(+1) on the stop verse goes to the next passage; seekVerse(-1) on the first verse restarts it', async () => {
    await store.playPassages('A', [range({ chapter: 1, verse: 1, endVerse: 2 }), range({ chapter: 1, verse: 4, endVerse: 5 })]);
    await flush();
    store.seekVerse(-1);
    await flush();
    expect(store.queue?.index).toBe(0);
    expect(cur()).toEqual(at(1));
    store.seekVerse(1);
    await flush();
    expect(cur()).toEqual(at(2));
    store.seekVerse(1);
    await flush();
    expect(store.queue?.index).toBe(1);
    expect(cur()).toEqual(at(4));
  });

  it('useChapterList continues from the verse in hand to the chapter end', async () => {
    store.setContinueAfterChapter(false);
    await store.playPassages('A', [range({ chapter: 1, verse: 2, endVerse: 3 })]);
    await flush();
    store.useChapterList();
    expect(store.queue).toMatchObject({ kind: 'chapter', passages: [{ book: 43, chapter: 1 }] });
    await readTo(3); // the old stop verse no longer stops
    expect(store.status).toBe('playing');
    expect(cur()).toEqual(at(4));
    await endChapter();
    expect(store.status).toBe('idle'); // continue is off
  });
});

describe('default chapter list', () => {
  it('continue on: goes to the next chapter and the queue follows the page', async () => {
    await store.play('A');
    await flush();
    expect(store.queue).toEqual({ kind: 'chapter', passages: [{ book: 43, chapter: 1 }], index: 0 });
    await endChapter();
    expect(cur()).toEqual(at(1, 2));
    expect(store.queue?.passages[0]).toEqual({ book: 43, chapter: 2 });
    expect(store.status).toBe('playing');
  });

  it('continue off: stops at the chapter end and clears the bookmark', async () => {
    store.setContinueAfterChapter(false);
    expect(store.prefs.continueAfterChapter).toBe('stop');
    await store.play('A');
    await flush();
    await endChapter();
    expect(store.status).toBe('idle');
    expect(store.bookmarkFor('A')).toBeNull();
    expect(reader.markStopped).not.toHaveBeenCalled();
    // The player can offer the next chapter; playing again clears the offer.
    expect(store.finished).toEqual({ tabId: 'A', moduleAbbr: 'KJV', book: 43, chapter: 1 });
    await store.play('A');
    expect(store.finished).toBeNull();
  });

  it('a stop is not a finish: no next-chapter offer', async () => {
    await store.play('A');
    await flush();
    store.stop();
    expect(store.finished).toBeNull();
  });

  it('loop "passage" replays the chapter even with continue on', async () => {
    store.setPassageLoop('passage');
    await store.play('A');
    await flush();
    await endChapter();
    expect(cur()).toEqual(at(1));
    expect(store.status).toBe('playing');
    expect(reader.followCalls).toHaveLength(0);
  });

  it('loop "list" with continue off repeats the chapter', async () => {
    store.setPassageLoop('list');
    store.setContinueAfterChapter(false);
    await store.play('A');
    await flush();
    await endChapter();
    expect(cur()).toEqual(at(1));
    expect(store.status).toBe('playing');
  });

  it('loop "list" with continue on reads on, then starts the book again after its last chapter', async () => {
    store.setPassageLoop('list');
    await store.play('A');
    await flush();
    await endChapter();
    expect(cur()).toEqual(at(1, 2));
    await endChapter();
    expect(cur()).toEqual(at(1, 3));
    await endChapter();
    expect(cur()).toEqual(at(1, 1));
    expect(store.status).toBe('playing');
  });
});

describe('Stop and Pause keep the place', () => {
  it('stop saves a bookmark with the verse just read and selects it', async () => {
    await store.playPassages('A', [range({ chapter: 1, verse: 1, endVerse: 5 })]);
    await flush();
    out.tick(25); // verse 3
    await flush();
    store.stop();
    expect(store.status).toBe('idle');
    expect(store.queue).toBeNull();
    expect(reader.markStopped).toHaveBeenCalledWith('A', 43_001_003);
    const bm = store.bookmarkFor('A');
    expect(bm).toMatchObject({ moduleAbbr: 'KJV', book: 43, chapter: 1, verse: 3 });
    expect(bm?.queue?.kind).toBe('list');
  });

  it('pause saves the same place', async () => {
    await store.play('A');
    await flush();
    out.tick(15);
    await flush();
    store.pause();
    expect(reader.markStopped).toHaveBeenCalledWith('A', 43_001_002);
    expect(store.bookmarkFor('A')).toMatchObject({ verse: 2 });
    expect(store.status).toBe('paused');
  });

  it('Listen after Stop resumes from the selected verse and from a typed list', async () => {
    await store.playPassages('A', [range({ chapter: 1, verse: 1, endVerse: 4 }), range({ chapter: 2 })]);
    await flush();
    out.tick(15);
    await flush();
    store.stop();
    await store.play('A');
    await flush();
    expect(cur()).toEqual(at(2));
    expect(store.queue).toMatchObject({ kind: 'list', index: 0 });
    expect(store.queue?.passages).toHaveLength(2);
  });

  it('a selection outside the current passage drops the queue and plays the plain chapter from it', async () => {
    await store.playPassages('A', [range({ chapter: 1, verse: 1, endVerse: 2 })]);
    await flush();
    store.stop();
    reader.selection.set('A', 43_001_005);
    await store.play('A');
    await flush();
    expect(store.queue?.kind).toBe('chapter');
    expect(cur()).toEqual(at(5));
  });

  it('a chapter bookmark without a selection resumes at the saved verse (no markStopped port)', async () => {
    await store.play('A');
    await flush();
    out.tick(35);
    await flush();
    store.stop();
    reader.selection.clear();
    await store.play('A');
    await flush();
    expect(cur()).toEqual(at(4));
  });

  it('a cancelled gate is not a natural end: an earlier bookmark survives', async () => {
    build('tts:fake');
    store.setLayout('phone');
    store.restoreBookmarks(new Map([['A', { moduleAbbr: 'KJV', book: 43, chapter: 1, verse: 3 }]]));
    reader.selection.clear();
    void store.play('A');
    await flush();
    expect(store.pendingGate?.kind).toBe('battery');
    store.cancelGate();
    await flush();
    expect(store.status).toBe('idle');
    expect(store.bookmarkFor('A')).toMatchObject({ verse: 3 });
  });

  it('stopping while still resolving keeps the place without selecting', async () => {
    build('tts:fake');
    store.setLayout('phone');
    void store.play('A');
    await flush();
    expect(store.status).toBe('resolving');
    store.stop();
    expect(store.bookmarkFor('A')).toMatchObject({ book: 43, chapter: 1, verse: 1 });
    expect(reader.markStopped).not.toHaveBeenCalled();
  });
});

describe('several tabs', () => {
  it('Listen on B while A plays saves A without selecting, and A resumes with its queue', async () => {
    reader.addTab('B', 43, 3);
    await store.playPassages('A', [range({ chapter: 1, verse: 1, endVerse: 5 })]);
    await flush();
    out.tick(15);
    await flush();
    await store.play('B');
    await flush();
    expect(store.playingTabId).toBe('B');
    expect(reader.markStopped).not.toHaveBeenCalled();
    expect(store.bookmarkFor('A')).toMatchObject({ chapter: 1, verse: 2, queue: { kind: 'list' } });
    store.stop();
    reader.markStopped.mockClear();
    await store.play('A');
    await flush();
    expect(store.playingTabId).toBe('A');
    expect(cur()).toEqual(at(2));
    expect(store.queue?.kind).toBe('list');
  });

  it('navigating the playing tab away saves the place (no selection) and stops', async () => {
    await store.play('A');
    await flush();
    out.tick(15);
    await flush();
    reader.navigate('A', 43, 3);
    expect(store.status).toBe('idle');
    expect(reader.markStopped).not.toHaveBeenCalled();
    expect(store.bookmarkFor('A')).toMatchObject({ chapter: 1, verse: 2 });
  });

  it('navigating another tab triggers nothing', async () => {
    reader.addTab('B');
    await store.play('A');
    await flush();
    reader.navigate('B', 43, 3);
    expect(store.status).toBe('playing');
    expect(store.playingTabId).toBe('A');
  });

  it('closing the playing tab stops and drops its bookmark; closing an idle tab drops its bookmark', async () => {
    reader.addTab('B');
    store.restoreBookmarks({ B: { moduleAbbr: 'KJV', book: 43, chapter: 1, verse: 2 } });
    await store.play('A');
    await flush();
    reader.tabs.delete('B');
    reader.emit();
    expect(store.bookmarkFor('B')).toBeNull();
    reader.tabs.delete('A');
    reader.emit();
    expect(store.status).toBe('idle');
    expect(store.bookmarkFor('A')).toBeNull();
  });

  it('revealPlayingTab asks the reader to show the playing tab', async () => {
    reader.addTab('B');
    await store.play('B');
    await flush();
    store.revealPlayingTab();
    expect(reader.reveal).toHaveBeenCalledWith('B');
  });
});

describe('bookmarks', () => {
  it('bookmarkFor / allBookmarks give the live place of the playing tab', async () => {
    await store.play('A');
    await flush();
    out.tick(25);
    await flush();
    expect(store.bookmarkFor('A')).toMatchObject({ verse: 3 });
    expect(store.allBookmarks().get('A')).toMatchObject({ verse: 3, queue: { kind: 'chapter' } });
  });

  it('bookmarksChanged notifies on save and drop', async () => {
    const seen = vi.fn();
    store.bookmarksChanged.subscribe(seen);
    await store.play('A');
    await flush();
    store.stop();
    expect(seen).toHaveBeenCalled();
    const n = seen.mock.calls.length;
    store.restoreBookmarks({ A: { moduleAbbr: 'KJV', book: 43, chapter: 2, verse: 1 } });
    expect(seen.mock.calls.length).toBe(n + 1);
  });

  it('restoreBookmarks skips garbage and sanitizes queues', () => {
    store.restoreBookmarks(null);
    store.restoreBookmarks('nope' as unknown as Record<string, unknown>);
    store.restoreBookmarks({
      bad1: 5, bad2: { moduleAbbr: '', book: 1, chapter: 1, verse: 1 }, bad3: { moduleAbbr: 'KJV', book: 'x' },
      ok: { moduleAbbr: 'KJV', book: 43, chapter: 1, verse: 2, queue: { kind: 'list', passages: [{ book: 43 }], index: 9 } },
    });
    expect([...store.allBookmarks().keys()]).toEqual(['ok']);
    expect(store.bookmarkFor('ok')).toEqual({ moduleAbbr: 'KJV', book: 43, chapter: 1, verse: 2 });
  });

  it('dispose keeps bookmarks, including the place that was playing', async () => {
    await store.play('A');
    await flush();
    out.tick(15);
    await flush();
    store.dispose();
    expect(store.bookmarkFor('A')).toMatchObject({ verse: 2 });
  });
});

describe('prefs', () => {
  it('continue-after-chapter is the shared pref', () => {
    store.setContinueAfterChapter(false);
    expect(store.prefs.continueAfterChapter).toBe('stop');
    store.setContinueAfterChapter(true);
    expect(store.prefs.continueAfterChapter).toBe('next-chapter');
  });
});

describe('review fixes', () => {
  it('transport controls without a tab act on the playing tab, not the active one', async () => {
    reader.addTab('B', 43, 2);
    await store.play('A');
    await flush();
    reader.activeId = 'B';
    store.togglePlay();
    expect(store.status).toBe('paused');
    expect(store.playingTabId).toBe('A');
    store.togglePlay();
    expect(store.status).not.toBe('paused');
    expect(store.playingTabId).toBe('A');
    store.togglePlay('B'); // an explicit tab (its Listen button) may retarget
    await flush();
    expect(store.playingTabId).toBe('B');
  });

  it('a stale selection does not override the saved place; a new one does', async () => {
    await store.play('A');
    await flush();
    out.tick(25);
    await flush();
    reader.selection.set('A', 43_001_001); // what the reader had selected before
    store.stop(); // select: markStopped sets verse 3
    expect(reader.selection.get('A')).toBe(43_001_003);
    reader.selection.set('A', 43_001_001); // the app resets the selection (e.g. a chapter reload)
    store.restoreBookmarks({ A: { ...store.bookmarkFor('A')!, selAtSave: 43_001_001 } });
    await store.play('A');
    await flush();
    expect(cur()).toEqual(at(3)); // the stale selection (== selAtSave) is not a new choice
    store.stop();
    reader.selection.set('A', 43_001_005);
    await store.play('A');
    await flush();
    expect(cur()).toEqual(at(5));
  });

  it('media-key pause and stop (straight on the player) keep the place', async () => {
    await store.play('A');
    await flush();
    out.tick(15);
    await flush();
    player.pause();
    expect(reader.markStopped).toHaveBeenCalledWith('A', 43_001_002);
    expect(store.bookmarkFor('A')).toMatchObject({ verse: 2 });
    reader.markStopped.mockClear();
    out.tick(25);
    player.resume();
    await flush();
    out.tick(25);
    await flush();
    player.stop();
    expect(store.status).toBe('idle');
    expect(store.bookmarkFor('A')).toMatchObject({ verse: 3 });
    expect(reader.markStopped).toHaveBeenCalledWith('A', 43_001_003);
  });

  it('the bookmark names the playing translation', async () => {
    await store.play('A');
    await flush();
    store.stop();
    expect(store.bookmarkFor('A')?.moduleAbbr).toBe('KJV');
  });

  it('jumping or chapter-stepping out of a typed passage turns it into the plain chapter list', async () => {
    await store.playPassages('A', [range({ chapter: 1, verse: 1, endVerse: 2 })]);
    await flush();
    expect(store.canSeekChapter).toBe(false);
    store.jumpToVerse(4);
    await flush();
    expect(store.queue?.kind).toBe('chapter');
    expect(store.canSeekChapter).toBe(true);
    await readTo(4); // no stop at verse 2 any more
    expect(cur()).toEqual(at(5));
    expect(store.status).toBe('playing');
  });

  it('a passage the translation lacks is skipped with a notice', async () => {
    await store.playPassages('A', [range({ chapter: 1, verse: 1, endVerse: 1 }), range({ chapter: 2 }), range({ chapter: 3, verse: 2, endVerse: 2 })]);
    await flush();
    provider.openFails = { code: 'not-found', message: 'x', retryable: false };
    await readTo(1);
    await flush();
    expect(store.queue?.index).toBe(2);
    expect(cur()).toEqual(at(2, 3));
    expect(store.notice?.key).toBe('audio.notice.passageSkipped');
    expect(store.status).toBe('playing');
  });

  it('a list with nothing playable does not spin, even looping', async () => {
    store.setPassageLoop('list');
    provider.openChapter = () => Promise.reject({ code: 'not-found', message: 'x', retryable: false });
    await store.playPassages('A', [range({ chapter: 1 }), range({ chapter: 2 })]);
    await flush();
    expect(store.status).toBe('idle'); // ended cleanly, not left in an error state
    expect(store.notice?.key).toBe('audio.notice.passageSkipped');
  });

  it('a missing last passage ends cleanly (idle, notice), not in an error state', async () => {
    await store.playPassages('A', [range({ chapter: 1, verse: 1, endVerse: 1 }), range({ chapter: 2 })]);
    await flush();
    provider.openFails = { code: 'not-found', message: 'x', retryable: false };
    await readTo(1);
    await flush();
    expect(store.status).toBe('idle');
    expect(store.notice?.key).toBe('audio.notice.passageSkipped');
  });

  it('restored bookmarks for unknown tabs survive; a seen tab that closes loses its bookmark', () => {
    store.restoreBookmarks({ ghost: { moduleAbbr: 'KJV', book: 43, chapter: 1, verse: 2 } });
    reader.emit();
    reader.emit();
    expect(store.bookmarkFor('ghost')).not.toBeNull();
    reader.addTab('ghost');
    reader.emit();
    reader.tabs.delete('ghost');
    reader.emit();
    expect(store.bookmarkFor('ghost')).toBeNull();
  });

  it('stopping closes the player pop-up state', async () => {
    store.openPlayer();
    await store.play('A');
    await flush();
    expect(store.playerOpen).toBe(true);
    store.stop();
    expect(store.playerOpen).toBe(false);
  });
});

describe('review round 1', () => {
  const sel = (verse: number, chapter = 1) => 43_000_000 + chapter * 1_000 + verse;

  it('the live bookmark carries the live selection, so a restored one resumes at the live verse', async () => {
    reader.selection.set('A', sel(1)); // the navigation default
    await store.play('A');
    await flush();
    out.tick(25);
    await flush();
    const saved = new Map(store.allBookmarks());
    expect(saved.get('A')).toMatchObject({ verse: 3, selAtSave: sel(1) });
    store.dispose();
    build();
    reader.selection.set('A', sel(1));
    store.restoreBookmarks(saved);
    await store.play('A');
    await flush();
    expect(cur()).toEqual(at(3));
  });

  it('a verse clicked during play is the live selection too', async () => {
    await store.play('A');
    await flush();
    out.tick(25);
    await flush();
    reader.selection.set('A', sel(5));
    const saved = new Map(store.allBookmarks());
    expect(saved.get('A')).toMatchObject({ verse: 3, selAtSave: sel(5) });
    store.dispose();
    build();
    reader.selection.set('A', sel(5));
    store.restoreBookmarks(saved);
    await store.play('A');
    await flush();
    expect(cur()).toEqual(at(3));
  });

  it('Listen on a pane picked with setTargetTab retargets and keeps the first pane\'s place', async () => {
    reader.addTab('B', 43, 2);
    await store.play('A');
    await flush();
    out.tick(15);
    await flush();
    store.openPlayer();
    store.setTargetTab('B');
    await store.playPassages('B', [range({ chapter: 2, verse: 3, endVerse: 3 })]);
    await flush();
    expect(store.playingTabId).toBe('B');
    expect(store.targetTabId).toBeNull();
    expect(store.bookmarkFor('A')).toMatchObject({ chapter: 1, verse: 2 });
    expect(reader.markStopped).not.toHaveBeenCalled();
    store.setTargetTab('A');
    store.closePlayer();
    expect(store.targetTabId).toBeNull();
  });

  it('useChapterList while idle acts on the target tab\'s bookmark', () => {
    reader.addTab('B');
    store.restoreBookmarks({ B: { moduleAbbr: 'KJV', book: 43, chapter: 2, verse: 1, queue: { kind: 'list', index: 0, passages: [{ book: 43, chapter: 2 }] } } });
    store.setTargetTab('B');
    store.useChapterList();
    expect(store.bookmarkFor('B')?.queue?.kind).toBe('chapter');
  });

  it('coming back to a chapter: the default verse-1 selection does not beat the remembered verse, a click elsewhere does', async () => {
    await store.play('A');
    await flush();
    out.tick(25);
    await flush();
    reader.navigate('A', 43, 3); // leave mid-chapter: quiet bookmark, playback stops
    reader.navigate('A', 43, 1); // come back; the app selects verse 1 by itself
    reader.selection.set('A', sel(1));
    await store.play('A');
    await flush();
    expect(cur()).toEqual(at(3));
    store.stop();
    reader.selection.set('A', sel(4));
    await store.play('A');
    await flush();
    expect(cur()).toEqual(at(4));
  });

  it('a loop that cannot seek (verse not shown) reopens synchronously and keeps playing', async () => {
    store.setPassageLoop('passage');
    await store.playPassages('A', [range({ chapter: 1, verse: 4, endVerse: 4 })]);
    await flush();
    reader.tab('A')!.verses = [{ verse: 1 }, { verse: 2 }];
    const opened = provider.openCalls.length;
    await readTo(4);
    expect(provider.openCalls.length).toBe(opened + 1);
    expect(store.status).toBe('playing');
    await flush();
    expect(provider.openCalls.length).toBe(opened + 1); // nothing started late
  });
});
