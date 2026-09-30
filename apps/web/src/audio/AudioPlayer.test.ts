import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import type { ChapterRef, PlayerState, VerseRef } from '@bible/core/browser';
import { AudioPlayer, verseAt } from './AudioPlayer';
import { FakeOutput, FakeProvider, FakeChapterAudio, FakeMediaElement, asAudioElement, mkSeg } from './testing';
import { HtmlAudioOutput } from './HtmlAudioOutput';

// A tiny Bible: John (43) has chapters 1-3, and 44 (Acts) follows it.
const next = (r: ChapterRef): ChapterRef | null =>
  r.book === 43 && r.chapter < 3 ? { ...r, chapter: r.chapter + 1 }
    : r.book === 43 ? { ...r, book: 44, chapter: 1 } : null;
const prev = (r: ChapterRef): ChapterRef | null =>
  r.book === 43 && r.chapter > 1 ? { ...r, chapter: r.chapter - 1 } : null;

const at = (verse: number, chapter = 1, book = 43): VerseRef => ({ moduleAbbr: 'KJV', book, chapter, verse });

let out: FakeOutput;
let provider: FakeProvider;
let player: AudioPlayer;
let states: PlayerState[];
let verses: number[];

function setup(id = 'recorded', rateMode: 'player' | 'engine' = 'player') {
  out = new FakeOutput();
  provider = new FakeProvider(id, rateMode);
  player = new AudioPlayer(out, { nextChapter: next, prevChapter: prev });
  states = [];
  verses = [];
  player.on('state', s => states.push(s));
  player.on('verse', v => verses.push(v.verse));
}
const statuses = () => states.map(s => s.status);
const flush = async () => { for (let i = 0; i < 5; i++) await Promise.resolve(); };

beforeEach(() => setup());
afterEach(() => { player.dispose(); vi.useRealTimers(); });

describe('verseAt', () => {
  const seg = mkSeg('s', [[1, 0, 5], [2, 5, 9], [3, 12, 20]]);
  it('uses start <= t < end, with a hair of tolerance for exact starts', () => {
    expect(verseAt(seg, 0)).toBe(1);
    expect(verseAt(seg, 4.98)).toBe(1);
    expect(verseAt(seg, 5)).toBe(2);
    expect(verseAt(seg, 4.995)).toBe(2); // float noise before a boundary
  });
  it('is null in gaps and outside the segment', () => {
    expect(verseAt(seg, 10)).toBeNull();
    expect(verseAt(seg, 25)).toBeNull();
  });
});

describe('play (recorded, one segment per chapter)', () => {
  it('starts at the requested verse and announces it once', async () => {
    await player.play(at(3), provider, { rate: 1 });
    const seg = out.loaded[0];
    expect(seg.offset).toBe(20);
    expect(player.state).toMatchObject({ status: 'playing', current: at(3), duration: 50, providerId: 'recorded' });
    expect(verses).toEqual([3]);
    expect(out.playCalls).toBe(1);
  });

  it('follows the clock: boundaries change the verse once, without duplicates', async () => {
    await player.play(at(3), provider, { rate: 1 });
    out.tick(29.999);
    out.tick(30);
    out.tick(30);
    out.tick(30.5);
    expect(verses).toEqual([3, 4]);
    expect(player.state.current?.verse).toBe(4);
  });

  it('keeps the previous verse through gaps, the intro, and after the last verse', async () => {
    provider.factory = ref => new FakeChapterAudio(ref, [1, 2], 'whole', 5, 3);
    await player.play(at(1), provider, { rate: 1 });
    expect(out.loaded[0].offset).toBe(0); // intro first
    out.tick(1); // in the intro
    expect(verses).toEqual([1]);
    out.tick(3); // verse 1 starts
    out.tick(8); // verse 2
    out.tick(50); // past the end
    expect(verses).toEqual([1, 2]);
    expect(player.state.current?.verse).toBe(2);
  });

  it('ignores the clock reset a load causes until the new segment is ready', async () => {
    await player.play(at(3), provider, { rate: 1 });
    out.holdLoads = true;
    player.seekVerse(-1); // slow? no: recorded fast path, never loads
    await flush();
    expect(out.loaded.length).toBe(1);

    // A real reload (retry after an error): timeupdate at 0 must not yank the verse.
    out.error({ code: 'network', message: 'x', retryable: true });
    player.resume();
    await flush();
    const before = verses.length;
    out.tick(0);
    expect(verses.length).toBe(before);
    out.releaseLoad();
    await flush();
  });

  it('reports position, and throttles tiny changes', async () => {
    await player.play(at(1), provider, { rate: 1 });
    out.tick(1);
    const n = states.length;
    out.tick(1.05);
    expect(states.length).toBe(n);
    out.tick(2);
    expect(states.length).toBeGreaterThan(n);
    expect(player.state.position).toBe(2);
  });
});

describe('seekVerse', () => {
  it('recorded: moves inside the loaded segment without loading, keeping play state', async () => {
    await player.play(at(2), provider, { rate: 1 });
    await player.seekVerse(1);
    expect(out.loaded.length).toBe(1);
    expect(out.seeks).toEqual([20]);
    expect(player.state).toMatchObject({ status: 'playing', current: at(3) });
    expect(verses).toEqual([2, 3]);
    player.pause();
    await player.seekVerse(1);
    expect(player.state).toMatchObject({ status: 'paused', current: at(4) });
  });

  it('previous verse restarts the current one when more than 2 s in, else goes back', async () => {
    await player.play(at(4), provider, { rate: 1 });
    out.tick(30 + 3.5);
    await player.seekVerse(-1);
    expect(player.state.current?.verse).toBe(4);
    expect(out.seeks.at(-1)).toBe(30);
    out.tick(30 + 1);
    await player.seekVerse(-1);
    expect(player.state.current?.verse).toBe(3);
  });

  it('per-verse (TTS): loads the neighbour verse and plays it', async () => {
    setup('tts:fake', 'engine');
    await player.play(at(2), provider, { rate: 1 });
    await player.seekVerse(1);
    expect(out.loaded.map(s => s.verses[0].verse)).toEqual([2, 3]);
    expect(player.state).toMatchObject({ status: 'playing', current: at(3) });
  });

  it('rapid presses accumulate and the earlier fetches are aborted', async () => {
    setup('tts:fake', 'engine');
    await player.play(at(1), provider, { rate: 1 });
    const chapter = provider.chapter(43, 1);
    chapter.hold = true;
    const a = player.seekVerse(1);
    const b = player.seekVerse(1);
    const c = player.seekVerse(1);
    expect(chapter.segmentForCalls.map(x => x.verse)).toEqual([1, 2, 3, 4]);
    expect(chapter.segmentForCalls[1].signal.aborted).toBe(true);
    expect(chapter.segmentForCalls[2].signal.aborted).toBe(true);
    expect(chapter.segmentForCalls[3].signal.aborted).toBe(false);
    chapter.settle(0 + chapter.held.length - 1);
    await Promise.all([a, b, c]);
    expect(player.state.current?.verse).toBe(4);
    expect(out.loaded.length).toBe(2);
  });

  it('a stale segment arriving after a newer request is released and never loaded', async () => {
    setup('tts:fake', 'engine');
    await player.play(at(1), provider, { rate: 1 });
    const chapter = provider.chapter(43, 1);
    chapter.hold = true;
    chapter.ignoreAbort = true; // a provider that delivers anyway, after being aborted
    const first = player.seekVerse(1);
    const second = player.seekVerse(1);
    const stale = chapter.held[0];
    const seg = mkSeg('stale', [[2, 0, 5]]);
    stale.d.resolve(seg);
    chapter.settle(1);
    await Promise.all([first, second]);
    expect(seg.release).toHaveBeenCalledTimes(1);
    expect(out.loaded.some(s => s.id === 'stale')).toBe(false);
    expect(player.state.current?.verse).toBe(3);
  });

  it('at the last verse, next goes to the first verse of the next chapter', async () => {
    await player.play(at(5), provider, { rate: 1 });
    await player.seekVerse(1);
    expect(provider.openCalls.at(-1)!.ref).toMatchObject({ chapter: 2 });
    expect(player.state.current).toMatchObject({ chapter: 2, verse: 1 });
    expect(provider.chapter(43, 1).disposed).toBe(1);
  });

  it('at verse 1, previous goes to the last verse of the previous chapter', async () => {
    await player.play(at(1, 2), provider, { rate: 1 });
    out.tick(0.5);
    await player.seekVerse(-1);
    expect(provider.openCalls.at(-1)!.ref).toMatchObject({ chapter: 1 });
    expect(player.state.current).toMatchObject({ chapter: 1, verse: 5 });
  });

  it('at verse 1 of the first chapter, previous restarts the verse', async () => {
    await player.play(at(1, 1), provider, { rate: 1 });
    out.tick(0.5);
    await player.seekVerse(-1);
    expect(player.state.current).toMatchObject({ chapter: 1, verse: 1 });
    expect(provider.openCalls.length).toBe(1);
  });

  it('does nothing when idle', async () => {
    await player.seekVerse(1);
    expect(states).toEqual([]);
  });

  it('steps over verses the chapter lacks', async () => {
    provider.factory = ref => new FakeChapterAudio(ref, [1, 3, 4], 'whole');
    await player.play(at(1), provider, { rate: 1 });
    await player.seekVerse(1);
    expect(player.state.current?.verse).toBe(3);
  });
});

describe('seekChapter and chapter end', () => {
  it('seekChapter opens the neighbouring chapter and plays its first verse', async () => {
    await player.play(at(3, 1), provider, { rate: 1 });
    await player.seekChapter(1);
    expect(player.state).toMatchObject({ status: 'playing', current: at(1, 2) });
    await player.seekChapter(-1);
    expect(player.state.current).toMatchObject({ chapter: 1, verse: 1 });
  });

  it('is a no-op at the ends of the Bible', async () => {
    await player.play(at(1, 1, 44), provider, { rate: 1 });
    const before = states.length;
    await player.seekChapter(1);
    expect(states.length).toBe(before);
    expect(provider.openCalls.length).toBe(1);
  });

  it('a chapter change while the old one is still opening: the stale chapter is disposed and never asked for a segment', async () => {
    provider.holdOpen = true;
    const first = player.play(at(1, 1), provider, { rate: 1 });
    await flush();
    const second = player.seekChapter(1); // chapter 2
    await flush();
    const a = provider.settleOpen(0);
    await flush();
    const b = provider.settleOpen(0);
    await Promise.all([first, second]);
    expect(a.disposed).toBe(1);
    expect(a.segmentForCalls).toEqual([]);
    expect(b.segmentForCalls.length).toBe(1);
    expect(player.state).toMatchObject({ status: 'playing', current: { chapter: 2 } });
  });

  it('chapter end with a listener that continues never passes through idle', async () => {
    const ends: Array<ChapterRef | null> = [];
    player.on('chapterEnd', n => { ends.push(n); void player.seekChapter(1); });
    await player.play(at(5, 1), provider, { rate: 1 });
    out.end();
    await flush();
    await flush();
    expect(ends).toEqual([{ moduleAbbr: 'KJV', book: 43, chapter: 2 }]);
    expect(statuses()).not.toContain('idle');
    expect(player.state).toMatchObject({ status: 'playing', current: { chapter: 2, verse: 1 } });
  });

  it('chapter end with no continuation stops, keeping the last verse, releasing everything', async () => {
    await player.play(at(5, 1), provider, { rate: 1 });
    const seg = out.loaded[0] as ReturnType<typeof mkSeg>;
    out.end();
    await flush();
    expect(player.state.status).toBe('idle');
    expect(player.state.current).toMatchObject({ chapter: 1, verse: 5 });
    expect(seg.release).toHaveBeenCalledTimes(1);
    expect(provider.chapter(43, 1).disposed).toBe(1);
  });

  it('end of the Bible: chapterEnd(null) then idle', async () => {
    const ends: Array<ChapterRef | null> = [];
    player.on('chapterEnd', n => ends.push(n));
    await player.play(at(5, 1, 44), provider, { rate: 1 });
    out.end();
    await flush();
    expect(ends).toEqual([null]);
    expect(player.state.status).toBe('idle');
  });

  it('per-verse: the end of a verse loads the next one without flapping to buffering', async () => {
    vi.useFakeTimers();
    setup('tts:fake', 'engine');
    await player.play(at(1), provider, { rate: 1 });
    const from = states.length;
    out.end();
    await vi.advanceTimersByTimeAsync(100);
    expect(player.state).toMatchObject({ status: 'playing', current: at(2) });
    expect(statuses().slice(from)).not.toContain('buffering');
  });

  it('per-verse: a slow next segment shows buffering after the delay', async () => {
    vi.useFakeTimers();
    setup('tts:fake', 'engine');
    await player.play(at(1), provider, { rate: 1 });
    provider.chapter(43, 1).hold = true;
    out.end();
    await vi.advanceTimersByTimeAsync(400);
    expect(player.state.status).toBe('buffering');
    provider.chapter(43, 1).settle();
    await vi.advanceTimersByTimeAsync(0);
    expect(player.state).toMatchObject({ status: 'playing', current: at(2) });
  });
});

describe('the gap between two synthesized verses', () => {
  /** Verse 2 has ended; the next segment is still being made. */
  async function inGap() {
    setup('tts:fake', 'engine');
    await player.play(at(2), provider, { rate: 1 });
    const chapter = provider.chapter(43, 1);
    chapter.hold = true;
    out.end();
    return chapter;
  }

  it('a pause in the gap stays paused (no buffering spinner), and the next verse loads paused', async () => {
    vi.useFakeTimers();
    const chapter = await inGap();
    player.pause();
    await vi.advanceTimersByTimeAsync(500);
    expect(player.state.status).toBe('paused');
    chapter.settle();
    await vi.advanceTimersByTimeAsync(0);
    expect(player.state).toMatchObject({ status: 'paused', current: at(3) });
    expect(out.playCalls).toBe(1);
    player.resume();
    expect(out.playCalls).toBe(2);
  });

  it('resume() in the gap does not replay the verse that just ended; the next one plays when it lands', async () => {
    vi.useFakeTimers();
    const chapter = await inGap();
    player.pause();
    player.resume();
    expect(out.playCalls).toBe(1); // still only the original play()
    expect(player.state.status).toBe('buffering');
    chapter.settle();
    await vi.advanceTimersByTimeAsync(0);
    expect(out.playCalls).toBe(2);
    expect(player.state).toMatchObject({ status: 'playing', current: at(3) });
  });

  it('a second ended event in the gap does not start a second wait', async () => {
    vi.useFakeTimers();
    const chapter = await inGap();
    out.end();
    expect(chapter.held.length).toBe(1);
  });

  it('seeking to another verse in the gap loads that verse and plays it', async () => {
    vi.useFakeTimers();
    const chapter = await inGap();
    const p = player.seekVerse(-1);
    chapter.settle(chapter.held.length - 1);
    await vi.advanceTimersByTimeAsync(0);
    await p;
    expect(player.state).toMatchObject({ status: 'playing', current: at(1) });
  });

  it('a failed next verse is retried at that verse, not by replaying the finished one', async () => {
    vi.useFakeTimers();
    setup('tts:fake', 'engine');
    await player.play(at(2), provider, { rate: 1 });
    const chapter = provider.chapter(43, 1);
    chapter.hold = true;
    out.end();
    chapter.held[0].d.reject({ code: 'engine', message: 'synthesis failed', retryable: true });
    await vi.advanceTimersByTimeAsync(0);
    expect(player.state).toMatchObject({ status: 'error', current: at(2) });
    chapter.hold = false;
    player.resume();
    await vi.advanceTimersByTimeAsync(0);
    expect(chapter.segmentForCalls.at(-1)!.verse).toBe(3);
    expect(player.state).toMatchObject({ status: 'playing', current: at(3) });
  });
});

describe('seeking while a play() is pending', () => {
  it('re-issues play() after a fast seek, so a rejected earlier play() is not lost', async () => {
    await player.play(at(1), provider, { rate: 1 });
    const before = out.playCalls;
    await player.seekVerse(1);
    expect(out.playCalls).toBe(before + 1);
    // ...and a blocked autoplay on that re-issued play() is reported.
    out.playFails = { code: 'autoplay', message: 'blocked', retryable: true };
    await player.seekVerse(1);
    await flush();
    expect(player.state).toMatchObject({ status: 'error', error: { code: 'autoplay' } });
  });

  it('does not start sound after a fast seek while paused', async () => {
    await player.play(at(1), provider, { rate: 1 });
    player.pause();
    const before = out.playCalls;
    await player.seekVerse(1);
    expect(out.playCalls).toBe(before);
  });
});

describe('a failed move to the previous chapter', () => {
  it('is retried to its last verse, not verse 1', async () => {
    await player.play(at(1, 2), provider, { rate: 1 });
    out.tick(0.5);
    provider.openFails = { code: 'network', message: 'offline', retryable: true };
    await player.seekVerse(-1);
    expect(player.state.status).toBe('error');
    player.resume();
    await flush();
    expect(player.state).toMatchObject({ status: 'playing', current: { chapter: 1, verse: 5 } });
  });
});

describe('pause, resume, stop', () => {
  it('pausing during buffering: the load finishes into paused without playing; resume plays synchronously', async () => {
    out.holdLoads = true;
    const p = player.play(at(1), provider, { rate: 1 });
    await flush();
    player.pause();
    out.releaseLoad();
    await p;
    expect(out.playCalls).toBe(0);
    expect(player.state).toMatchObject({ status: 'paused', current: at(1) });
    player.resume();
    expect(out.playCalls).toBe(1); // no await needed: still inside the gesture
    expect(player.state.status).toBe('playing');
  });

  it('a blocked autoplay is an error that keeps the segment; resume() plays it without reloading', async () => {
    out.playFails = { code: 'autoplay', message: 'blocked', retryable: true };
    await player.play(at(1), provider, { rate: 1 });
    await flush();
    expect(player.state).toMatchObject({ status: 'error', error: { code: 'autoplay' } });
    const seg = out.loaded[0] as ReturnType<typeof mkSeg>;
    expect(seg.release).not.toHaveBeenCalled();
    player.resume();
    expect(out.loaded.length).toBe(1);
    expect(out.playCalls).toBe(2);
    expect(player.state.status).toBe('playing');
  });

  it('an interrupted play() (a pause) is not an error', async () => {
    out.playFails = { code: 'aborted', message: 'x', retryable: false };
    await player.play(at(1), provider, { rate: 1 });
    await flush();
    expect(statuses()).not.toContain('error');
    expect(player.state.status).toBe('playing');
  });

  it('a load aborted by the caller (a newer request) never surfaces; one aborted by itself ends in a retryable error, not a hang', async () => {
    out.holdLoads = true;
    const first = player.play(at(2), provider, { rate: 1 });
    await flush();
    const second = player.play(at(3), provider, { rate: 1 });
    await flush();
    out.failLoad(0, { code: 'aborted', message: 'superseded', retryable: false }); // the stale one
    out.releaseLoad(0);
    await Promise.all([first, second]);
    expect(statuses()).not.toContain('error');
    expect(player.state).toMatchObject({ status: 'playing', current: at(3) });

    // Now the current load aborts with nothing having superseded it.
    out.holdLoads = true;
    const third = player.play(at(4), provider, { rate: 1 });
    await flush();
    const seg = out.pendingLoads[0].seg as ReturnType<typeof mkSeg>;
    out.failLoad(0, { code: 'aborted', message: 'worker terminated', retryable: false });
    await third;
    expect(player.state).toMatchObject({ status: 'error', error: { retryable: true } });
    expect(player.state.error?.code).not.toBe('aborted');
    expect(seg.release).toHaveBeenCalledTimes(1);
  });

  it('a retryable mid-stream error keeps the verse; resume() reloads and seeks back to its start', async () => {
    await player.play(at(4), provider, { rate: 1 });
    out.tick(35);
    out.error({ code: 'network', message: 'lost', retryable: true });
    expect(player.state).toMatchObject({ status: 'error', current: at(4) });
    player.resume();
    await flush();
    expect(out.loaded.length).toBe(2);
    expect(out.loaded[1].offset).toBe(30);
    expect(player.state.status).toBe('playing');
  });

  it('a non-retryable error stays put on resume()', async () => {
    await player.play(at(4), provider, { rate: 1 });
    out.error({ code: 'decode', message: 'bad', retryable: false });
    player.resume();
    await flush();
    expect(player.state.status).toBe('error');
    expect(out.loaded.length).toBe(1);
  });

  it('surfaces an unrecorded chapter as a non-retryable error and can be replayed', async () => {
    provider.openFails = { code: 'not-found', message: 'none', retryable: false };
    await player.play(at(1), provider, { rate: 1 });
    expect(player.state).toMatchObject({ status: 'error', error: { code: 'not-found' } });
    await player.play(at(1), provider, { rate: 1 });
    expect(player.state.status).toBe('playing');
  });

  it('stop() aborts in-flight work, releases the segment exactly once and disposes the chapter', async () => {
    await player.play(at(1), provider, { rate: 1 });
    const seg = out.loaded[0] as ReturnType<typeof mkSeg>;
    const signal = provider.openCalls[0].signal;
    player.stop();
    player.stop();
    expect(signal.aborted).toBe(true);
    expect(seg.release).toHaveBeenCalledTimes(1);
    expect(provider.chapter(43, 1).disposed).toBe(1);
    expect(player.state).toMatchObject({ status: 'idle', current: null, position: 0 });
  });

  it('playing the same verse again after stop() announces it again', async () => {
    await player.play(at(2), provider, { rate: 1 });
    player.stop();
    await player.play(at(2), provider, { rate: 1 });
    expect(verses).toEqual([2, 2]);
  });

  it('a preparing voice reports progress and plays when ready', async () => {
    setup('tts:fake', 'engine');
    provider.ready = false;
    await player.play(at(1), provider, { rate: 1 });
    expect(provider.prepareCalls).toBe(1);
    expect(states.some(s => s.status === 'preparing' && s.progress?.phase === 'voice')).toBe(true);
    expect(player.state).toMatchObject({ status: 'playing', progress: null });
  });
});

describe('setRate', () => {
  it('player-mode providers change the output speed; idle just stores it', async () => {
    player.setRate(1.25);
    expect(player.state.rate).toBe(1.25);
    expect(out.rate).toBe(1.25);
    await player.play(at(1), provider, { rate: 1 });
    expect(out.rate).toBe(1);
    player.setRate(0.8);
    expect(out.rate).toBe(0.8);
    expect(out.loaded.length).toBe(1);
  });

  it('engine-mode providers remake the audio from the current verse at the new rate', async () => {
    setup('tts:fake', 'engine');
    await player.play(at(3), provider, { rate: 1 });
    player.setRate(1.5);
    await flush();
    expect(out.rate).toBe(1);
    expect(provider.openCalls.at(-1)!.opts.rate).toBe(1.5);
    expect(out.loaded.at(-1)!.verses[0].verse).toBe(3);
    expect(player.state).toMatchObject({ status: 'playing', rate: 1.5 });
  });
});

describe('prefetch', () => {
  it('prefetches the next chapter once, 30 s before the end, and keeps it when playback moves on', async () => {
    await player.play(at(1), provider, { rate: 1 });
    out.tick(10);
    expect(provider.prefetchCalls.length).toBe(0);
    out.tick(21);
    out.tick(40);
    expect(provider.prefetchCalls.map(c => c.ref.chapter)).toEqual([2]);
    await player.seekChapter(1);
    expect(provider.prefetchCalls[0].signal.aborted).toBe(false);
  });

  it('is aborted when playback stops or goes somewhere else', async () => {
    await player.play(at(1), provider, { rate: 1 });
    out.tick(25);
    const signal = provider.prefetchCalls[0].signal;
    await player.play(at(1, 3), provider, { rate: 1 });
    expect(signal.aborted).toBe(true);
    out.tick(25);
    const second = provider.prefetchCalls[1].signal;
    player.stop();
    expect(second.aborted).toBe(true);
  });

  it('per-verse providers prefetch when the last verse starts', async () => {
    setup('tts:fake', 'engine');
    await player.play(at(4), provider, { rate: 1 });
    expect(provider.prefetchCalls.length).toBe(0);
    out.end();
    await flush();
    out.tick(0.1);
    expect(provider.prefetchCalls.map(c => c.ref.chapter)).toEqual([2]);
  });
});

describe('dispose', () => {
  it('detaches from the output, drops listeners, and ignores later calls', async () => {
    await player.play(at(1), provider, { rate: 1 });
    const n = states.length;
    player.dispose();
    expect(out.listenerCount).toBe(0);
    out.tick(30);
    out.end();
    await player.play(at(2), provider, { rate: 1 });
    player.resume();
    expect(states.length).toBe(n + 1); // only the stop() inside dispose() emitted
    expect(provider.openCalls.length).toBe(1);
  });

  it('listener errors do not break the player, and unsubscribing works mid-emit', async () => {
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {});
    const seen: number[] = [];
    const off = player.on('verse', () => { off(); throw new Error('boom'); });
    player.on('verse', v => seen.push(v.verse));
    await player.play(at(2), provider, { rate: 1 });
    expect(seen).toEqual([2]);
    expect(player.state.status).toBe('playing');
    spy.mockRestore();
  });
});

describe('with the real HtmlAudioOutput', () => {
  it('plays a chapter end to end and follows the media element clock', async () => {
    vi.useFakeTimers();
    const el = new FakeMediaElement();
    const real = new HtmlAudioOutput(asAudioElement(el));
    const p = new AudioPlayer(real, { nextChapter: next, prevChapter: prev });
    const seen: number[] = [];
    p.on('verse', v => seen.push(v.verse));
    const started = p.play(at(2), provider, { rate: 1 });
    await vi.advanceTimersByTimeAsync(0);
    await started;
    expect(p.state.status).toBe('playing');
    expect(el.currentTime).toBe(10);
    el.advanceTo(21);
    expect(seen).toEqual([2, 3]);
    p.dispose();
    real.dispose();
  });
});
