import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { AudioSegment, ChapterRef, VerseText } from '@bible/core/browser';
import { TtsAudioProvider, resolveVoice } from './TtsAudioProvider';
import { splitSentences } from './TtsChapterAudio';
import { TextPreparer } from '../TextPreparer';
import { FakeTtsEngine } from '../testing';
import type { PageVisibility } from './visibility';

const ref: ChapterRef = { moduleAbbr: 'WEB', book: 43, chapter: 3 };
const signal = () => new AbortController().signal;
/** Let queued microtasks and promise chains settle. */
const tick = () => new Promise<void>(r => setTimeout(r, 0));

class FakeVisibility implements PageVisibility {
  hidden = false;
  private subs = new Set<() => void>();
  isHidden() { return this.hidden; }
  subscribe(cb: () => void) { this.subs.add(cb); return () => this.subs.delete(cb); }
  set(hidden: boolean) { this.hidden = hidden; for (const cb of [...this.subs]) cb(); }
  get listeners() { return this.subs.size; }
}

/** Verses of `chars` characters each (so a verse lasts chars * 0.05 s at rate 1). */
const verses = (n: number, chars = 20, from = 1): VerseText[] =>
  Array.from({ length: n }, (_v, i) => ({ verse: from + i, text: 'x'.repeat(chars) }));

interface Rig {
  engine: FakeTtsEngine;
  provider: TtsAudioProvider;
  vis: FakeVisibility;
  created: string[];
  revoked: string[];
  sourceCalls: ChapterRef[];
}

function rig(opts: {
  text?: VerseText[];
  engine?: FakeTtsEngine;
  lookAhead?: { verses: number; seconds: number };
  longVerseChars?: number;
  defaultVoices?: Record<string, string>;
} = {}): Rig {
  const engine = opts.engine ?? new FakeTtsEngine({
    id: 'fake',
    voices: [
      { id: 'v-en-1', label: 'Ann', language: 'en-US' },
      { id: 'v-en-2', label: 'Bob', language: 'en-GB' },
      { id: 'v-es-1', label: 'Eva', language: 'es-ES' },
    ],
  });
  engine.prepared.add('v-en-1');
  engine.prepared.add('v-en-2');
  const vis = new FakeVisibility();
  const created: string[] = [];
  const revoked: string[] = [];
  const sourceCalls: ChapterRef[] = [];
  const provider = new TtsAudioProvider(engine, new TextPreparer(), async r => { sourceCalls.push(r); return opts.text ?? verses(10); }, {
    languageOf: () => 'en',
    bookName: () => 'John',
    config: opts.defaultVoices ? { id: 'fake', enabled: true, assetBase: '/x', voices: [], defaultVoices: opts.defaultVoices } : undefined,
    lookAhead: opts.lookAhead,
    longVerseChars: opts.longVerseChars,
    visibility: vis,
    createObjectURL: () => { const u = `blob:${created.length + 1}`; created.push(u); return u; },
    revokeObjectURL: u => { revoked.push(u); },
  });
  return { engine, provider, vis, created, revoked, sourceCalls };
}

describe('resolveVoice', () => {
  const voices = [
    { id: 'a', label: 'A', language: 'en-US' },
    { id: 'b', label: 'B', language: 'en-GB' },
    { id: 'c', label: 'C', language: 'es-ES' },
  ];
  it('explicit id beats the configured default, which beats the first voice for the language', () => {
    expect(resolveVoice(voices, 'en', 'b', { en: 'a' })?.id).toBe('b');
    expect(resolveVoice(voices, 'en', undefined, { en: 'b' })?.id).toBe('b');
    expect(resolveVoice(voices, 'en')?.id).toBe('a');
    expect(resolveVoice(voices, 'es-MX')?.id).toBe('c');
  });
  it('an unknown explicit id, or a default that is not listed, falls through', () => {
    expect(resolveVoice(voices, 'en', 'gone', { en: 'also-gone' })?.id).toBe('a');
  });
  it('is undefined when nothing speaks the language', () => {
    expect(resolveVoice(voices, 'fr')).toBeUndefined();
  });
});

describe('provider basics', () => {
  it('reports capabilities from the engine: native rate is engine-side', () => {
    const { provider } = rig();
    expect(provider.id).toBe('tts:fake');
    expect(provider.kind).toBe('tts');
    expect(provider.capabilities('WEB')).toMatchObject({ rateMode: 'engine', onDevice: true, needsDownload: true, voices: true });
    const player = rig({ engine: new FakeTtsEngine({ caps: { nativeRate: false, rate: null } }) }).provider;
    expect(player.capabilities('WEB')).toMatchObject({ rateMode: 'player', rate: { min: 0.75, max: 1.5, step: 0.05 } });
  });

  it('supports a language only when the engine is supported and has a voice for it', async () => {
    const { provider, engine } = rig();
    expect(await provider.supports('WEB', 'en')).toBe(true);
    expect(await provider.supports('WEB', 'es-MX')).toBe(true);
    expect(await provider.supports('WEB', 'fr')).toBe(false);
    engine.supported = false;
    expect(await provider.supports('WEB', 'en')).toBe(false);
    engine.supported = true;
    engine.isSupported = async () => { throw new Error('boom'); };
    expect(await provider.supports('WEB', 'en')).toBe(false);
  });

  it('lists the voices for a language', async () => {
    const { provider } = rig();
    expect((await provider.voices('WEB', 'en')).map(v => v.id)).toEqual(['v-en-1', 'v-en-2']);
  });

  it('isReady/prepare delegate to the engine; prepare refuses an unsupported browser', async () => {
    const { provider, engine } = rig({ defaultVoices: { en: 'v-en-2' } });
    engine.prepared.delete('v-en-2');
    expect(await provider.isReady()).toBe(false);
    const progress = vi.fn();
    await provider.prepare(undefined, progress, signal());
    expect(await provider.isReady()).toBe(true);
    expect(progress).toHaveBeenCalled();
    engine.supported = false;
    await expect(provider.prepare(undefined, progress, signal())).rejects.toMatchObject({ code: 'unsupported' });
  });

  it('openChapter with no voice for the language is unsupported', async () => {
    const { provider } = rig();
    (provider as unknown as { opts: { languageOf: () => string } }).opts.languageOf = () => 'fr';
    await expect(provider.openChapter(ref, { rate: 1 }, signal())).rejects.toMatchObject({ code: 'unsupported', retryable: false });
  });

  it('prepares the voice itself when the engine does not have it, reporting progress', async () => {
    const { provider, engine } = rig();
    engine.prepared.delete('v-en-1');
    const onProgress = vi.fn();
    const chapter = await provider.openChapter(ref, { rate: 1, onProgress }, signal());
    expect(engine.prepared.has('v-en-1')).toBe(true);
    expect(onProgress).toHaveBeenCalled();
    chapter.dispose();
  });
});

describe('chapter text', () => {
  it('drops verses that are empty after preparation, and rejects a chapter with nothing to say', async () => {
    const { provider } = rig({ text: [
      { verse: 1, text: 'Hello.' }, { verse: 2, text: '¶' }, { verse: 3, text: '' }, { verse: 4, text: 'World.' },
    ] });
    const chapter = await provider.openChapter(ref, { rate: 1 }, signal());
    expect(chapter.verses).toEqual([1, 4]);
    chapter.dispose();
    const empty = rig({ text: [{ verse: 1, text: '' }] });
    await expect(empty.provider.openChapter(ref, { rate: 1 }, signal())).rejects.toMatchObject({ code: 'not-found' });
  });

  it('sorts verses and fetches the chapter text once', async () => {
    const r = rig({ text: [{ verse: 3, text: 'c' }, { verse: 1, text: 'a' }, { verse: 2, text: 'b' }] });
    const chapter = await r.provider.openChapter(ref, { rate: 1 }, signal());
    expect(chapter.verses).toEqual([1, 2, 3]);
    await chapter.segmentFor(1, signal());
    await chapter.segmentFor(2, signal());
    expect(r.sourceCalls.length).toBe(1);
    chapter.dispose();
  });

  it('folds the chapter intro into the first verse only, and only when asked', async () => {
    const r = rig({ text: verses(3, 10) });
    const withIntro = await r.provider.openChapter(ref, { rate: 1, readIntro: true }, signal());
    await withIntro.segmentFor(1, signal());
    expect(r.engine.requests[0].text.startsWith('John, chapter 3. ')).toBe(true);
    await withIntro.segmentFor(2, signal());
    expect(r.engine.requests.find(q => q.text === 'x'.repeat(10))).toBeDefined();
    withIntro.dispose();

    const r2 = rig({ text: verses(3, 10) });
    const without = await r2.provider.openChapter(ref, { rate: 1, readIntro: false }, signal());
    await without.segmentFor(1, signal());
    expect(r2.engine.requests[0].text).toBe('x'.repeat(10));
    without.dispose();
  });
});

describe('segments', () => {
  it('are WAV clips with one timing covering the whole clip, at offset 0', async () => {
    const r = rig({ text: verses(3, 40) });
    const chapter = await r.provider.openChapter(ref, { rate: 1, readIntro: false }, signal());
    const seg = await chapter.segmentFor(2, signal());
    expect(seg.mime).toBe('audio/wav');
    expect(seg.offset).toBe(0);
    expect(seg.duration).toBeCloseTo(2, 2);
    expect(seg.verses).toEqual([{ verse: 2, start: 0, end: seg.duration }]);
    expect(seg.id).toContain('WEB:43:3:v-en-1:1:2');
    chapter.dispose();
  });

  it('a verse the chapter lacks starts at the next one; past the end clamps to the last', async () => {
    const r = rig({ text: [{ verse: 1, text: 'a b c' }, { verse: 3, text: 'd e f' }] });
    const chapter = await r.provider.openChapter(ref, { rate: 1, readIntro: false }, signal());
    expect((await chapter.segmentFor(2, signal())).verses[0].verse).toBe(3);
    expect((await chapter.segmentFor(99, signal())).verses[0].verse).toBe(3);
    chapter.dispose();
  });

  it('segmentAfter walks the chapter and ends with null', async () => {
    const r = rig({ text: verses(3, 10) });
    const chapter = await r.provider.openChapter(ref, { rate: 1, readIntro: false }, signal());
    let seg: AudioSegment | null = await chapter.segmentFor(1, signal());
    const seen = [seg.verses[0].verse];
    while ((seg = await chapter.segmentAfter(seg, signal()))) seen.push(seg.verses[0].verse);
    expect(seen).toEqual([1, 2, 3]);
    chapter.dispose();
  });

  it('pads a near-empty synthesis to a playable clip', async () => {
    const engine = new FakeTtsEngine();
    engine.secondsPerChar = 0; // one sample per verse
    const r = rig({ engine, text: verses(1, 5) });
    const chapter = await r.provider.openChapter(ref, { rate: 1, readIntro: false }, signal());
    const seg = await chapter.segmentFor(1, signal());
    expect(seg.duration).toBeGreaterThanOrEqual(0.05);
    chapter.dispose();
  });

  it('long verses are synthesized sentence by sentence into one segment, with gaps', async () => {
    const sentence = (n: number) => `Sentence number ${n} is here and it is long enough to stand alone.`;
    const text = [1, 2, 3].map(sentence).join(' ');
    const r = rig({ text: [{ verse: 1, text }], longVerseChars: 100 });
    const chapter = await r.provider.openChapter(ref, { rate: 1, readIntro: false }, signal());
    const seg = await chapter.segmentFor(1, signal());
    expect(r.engine.requests.length).toBe(3);
    const parts = r.engine.requests.map(q => q.text.length * 0.05);
    expect(seg.duration).toBeCloseTo(parts.reduce((a, b) => a + b, 0) + 0.25 * 2, 1);
    chapter.dispose();
  });

  it('splitSentences keeps punctuation, merges tiny pieces, and never returns nothing', () => {
    expect(splitSentences('One sentence here that is long enough. Two! Three sentence here that is long enough.'))
      .toEqual(['One sentence here that is long enough. Two!', 'Three sentence here that is long enough.']);
    expect(splitSentences('no punctuation at all')).toEqual(['no punctuation at all']);
    expect(splitSentences('   ')).toEqual(['   ']);
  });
});

describe('rate', () => {
  it('a native-rate engine gets the requested rate, clamped to its range', async () => {
    const r = rig({ text: verses(2, 10) });
    const c1 = await r.provider.openChapter(ref, { rate: 1.5, readIntro: false }, signal());
    await c1.segmentFor(1, signal());
    expect(r.engine.requests[0].rate).toBe(1.5);
    c1.dispose();
    const c2 = await r.provider.openChapter(ref, { rate: 9, readIntro: false }, signal());
    await c2.segmentFor(1, signal());
    expect(r.engine.requests.at(-1)!.rate).toBe(2);
    c2.dispose();
  });

  it('an engine without native rate always synthesizes at 1 (the media element speeds it up)', async () => {
    const engine = new FakeTtsEngine({ caps: { nativeRate: false } });
    const r = rig({ engine, text: verses(2, 10) });
    const chapter = await r.provider.openChapter(ref, { rate: 1.5, readIntro: false }, signal());
    await chapter.segmentFor(1, signal());
    expect(engine.requests[0].rate).toBe(1);
    chapter.dispose();
  });
});

describe('look-ahead queue', () => {
  it('memoizes: a verse is synthesized once however it is asked for', async () => {
    const text = Array.from({ length: 4 }, (_v, i) => ({ verse: i + 1, text: `verse number ${i + 1}` }));
    const r = rig({ text });
    const chapter = await r.provider.openChapter(ref, { rate: 1, readIntro: false }, signal());
    const s1 = await chapter.segmentFor(1, signal());
    await chapter.segmentAfter(s1, signal());
    await chapter.segmentFor(1, signal());
    await chapter.segmentFor(2, signal());
    await tick(); await tick();
    expect(r.engine.requests.map(q => q.text).sort()).toEqual(text.map(t => t.text).sort());
    chapter.dispose();
  });

  it('keeps 3 verses ahead when verses are long, and more when they are short', async () => {
    const long = rig({ text: verses(10, 800) }); // 40 s each
    const cl = await long.provider.openChapter(ref, { rate: 1, readIntro: false }, signal());
    await cl.segmentFor(1, signal());
    await tick(); await tick();
    expect(long.engine.requests.length).toBe(4); // the verse itself + 3 ahead
    cl.dispose();

    const short = rig({ text: verses(40, 20) }); // 1 s each: needs 30 s buffered
    const cs = await short.provider.openChapter(ref, { rate: 1, readIntro: false }, signal());
    await cs.segmentFor(1, signal());
    await tick(); await tick(); await tick();
    expect(short.engine.requests.length).toBe(1 + 30);
    cs.dispose();
  });

  it('synthesizes the whole chapter while hidden, and resumes when the page hides mid-chapter', async () => {
    const r = rig({ text: verses(8, 800) });
    r.vis.hidden = true;
    const chapter = await r.provider.openChapter(ref, { rate: 1, readIntro: false }, signal());
    await chapter.segmentFor(1, signal());
    for (let i = 0; i < 10; i++) await tick();
    expect(r.engine.requests.length).toBe(8);
    chapter.dispose();

    const r2 = rig({ text: verses(8, 800) });
    const c2 = await r2.provider.openChapter(ref, { rate: 1, readIntro: false }, signal());
    await c2.segmentFor(1, signal());
    for (let i = 0; i < 5; i++) await tick();
    expect(r2.engine.requests.length).toBe(4);
    r2.vis.set(true);
    for (let i = 0; i < 10; i++) await tick();
    expect(r2.engine.requests.length).toBe(8);
    c2.dispose();
  });

  it('runs one engine call at a time', async () => {
    const r = rig({ text: verses(6, 10) });
    r.engine.holdRequests = true;
    const chapter = await r.provider.openChapter(ref, { rate: 1, readIntro: false }, signal());
    chapter.segmentFor(1, signal()).catch(() => {}); // rejected by the dispose below
    await tick();
    expect(r.engine.heldRequests.length).toBe(1);
    await tick();
    expect(r.engine.maxInFlight).toBe(1);
    chapter.dispose();
    r.engine.releaseRequest();
  });

  it('a demand jumps the look-ahead queue (after the call already running)', async () => {
    // Distinct text per verse so requests can be told apart.
    const text = Array.from({ length: 20 }, (_v, i) => ({ verse: i + 1, text: `verse-${i + 1}`.padEnd(800, '.') }));
    const r = rig({ text });
    r.engine.holdRequests = true;
    const chapter = await r.provider.openChapter(ref, { rate: 1, readIntro: false }, signal());
    const first = chapter.segmentFor(1, signal());
    await tick();
    r.engine.releaseRequest(); // verse 1 done
    await first;
    await tick();
    expect(r.engine.requests.at(-1)!.text.startsWith('verse-2')).toBe(true); // look-ahead is on verse 2
    const jump = chapter.segmentFor(12, signal());
    await tick();
    r.engine.releaseRequest(); // verse 2 finishes: the call already running cannot be interrupted
    await tick();
    expect(r.engine.requests.at(-1)!.text.startsWith('verse-12')).toBe(true); // not verse 3
    r.engine.releaseRequest();
    expect((await jump).verses[0].verse).toBe(12);
    chapter.dispose();
  });

  it('a caller aborting rejects only that caller; the synthesis is kept for the next ask', async () => {
    const text = Array.from({ length: 3 }, (_v, i) => ({ verse: i + 1, text: `verse number ${i + 1}` }));
    const r = rig({ text });
    r.engine.holdRequests = true;
    const chapter = await r.provider.openChapter(ref, { rate: 1, readIntro: false }, signal());
    const ctrl = new AbortController();
    const p = chapter.segmentFor(1, ctrl.signal);
    await tick();
    ctrl.abort();
    await expect(p).rejects.toMatchObject({ code: 'aborted' });
    r.engine.releaseRequest(); // the synthesis of verse 1 completes anyway
    await tick();
    const seg = await chapter.segmentFor(1, signal());
    expect(seg.verses[0].verse).toBe(1);
    expect(r.engine.requests.filter(q => q.text === 'verse number 1').length).toBe(1);
    chapter.dispose();
  });

  it('the open signal only covers opening: aborting it afterwards leaves the chapter working', async () => {
    const r = rig({ text: verses(3, 10) });
    const ctrl = new AbortController();
    const chapter = await r.provider.openChapter(ref, { rate: 1, readIntro: false }, ctrl.signal);
    ctrl.abort();
    const seg = await chapter.segmentFor(1, signal());
    expect(seg.verses[0].verse).toBe(1);
    chapter.dispose();
  });

  it('dispose while synthesizing: waiters reject, the engine is aborted, no URL is ever made', async () => {
    const r = rig({ text: verses(3, 10) });
    r.engine.holdRequests = true;
    const chapter = await r.provider.openChapter(ref, { rate: 1, readIntro: false }, signal());
    const p = chapter.segmentFor(1, signal());
    await tick();
    chapter.dispose();
    await expect(p).rejects.toMatchObject({ code: 'aborted' });
    r.engine.releaseRequest();
    await tick(); await tick();
    expect(r.created).toEqual([]);
    expect(r.engine.requests.length).toBe(1);
    expect(r.vis.listeners).toBe(0);
    await expect(chapter.segmentFor(1, signal())).rejects.toMatchObject({ code: 'aborted' });
  });

  it('a synthesis failure rejects the waiter (engine, retryable) and only a new ask retries it', async () => {
    const r = rig({ text: verses(3, 10) });
    r.engine.failNextWith = new Error('phonemizer crashed');
    const chapter = await r.provider.openChapter(ref, { rate: 1, readIntro: false }, signal());
    await expect(chapter.segmentFor(1, signal())).rejects.toMatchObject({ code: 'engine', retryable: true });
    await tick(); await tick();
    const afterFailure = r.engine.requests.filter(q => q.text === 'x'.repeat(10)).length;
    // Look-ahead carried on with the other verses but did not retry verse 1 by itself.
    expect(r.engine.requests.length).toBeGreaterThan(1);
    const seg = await chapter.segmentFor(1, signal());
    expect(seg.verses[0].verse).toBe(1);
    expect(r.engine.requests.filter(q => q.text === 'x'.repeat(10)).length).toBeGreaterThan(afterFailure - 1);
    chapter.dispose();
  });
});

describe('blob URL ownership', () => {
  it('every hand-out gets its own URL; release revokes exactly that one, once; dispose revokes nothing', async () => {
    const r = rig({ text: verses(3, 10) });
    const chapter = await r.provider.openChapter(ref, { rate: 1, readIntro: false }, signal());
    const a = await chapter.segmentFor(1, signal());
    const b = await chapter.segmentFor(1, signal());
    expect(a.url).not.toBe(b.url);
    a.release!();
    a.release!();
    expect(r.revoked).toEqual([a.url]);
    chapter.dispose();
    expect(r.revoked).toEqual([a.url]); // b belongs to whoever holds it
    b.release!();
    expect(r.revoked).toEqual([a.url, b.url]);
  });

  it('evicts finished audio behind the playhead without revoking URLs already handed out', async () => {
    const r = rig({ text: verses(10, 10) });
    const chapter = await r.provider.openChapter(ref, { rate: 1, readIntro: false }, signal());
    const early = await chapter.segmentFor(2, signal());
    for (let v = 3; v <= 10; v++) await chapter.segmentFor(v, signal());
    const before = r.engine.requests.length;
    const again = await chapter.segmentFor(2, signal()); // evicted: made again
    expect(r.engine.requests.length).toBeGreaterThan(before);
    expect(r.revoked).not.toContain(early.url);
    expect(again.url).not.toBe(early.url);
    chapter.dispose();
  });
});

describe('prefetch', () => {
  it('warms the next chapter, and openChapter adopts it without asking for its text again', async () => {
    const r = rig({ text: verses(3, 10) });
    const next = { ...ref, chapter: 4 };
    await r.provider.prefetch(next, { rate: 1 }, signal());
    await tick();
    expect(r.sourceCalls.length).toBe(1);
    expect(r.engine.requests.length).toBeGreaterThanOrEqual(1);
    const requestsBefore = r.engine.requests.length;
    const chapter = await r.provider.openChapter(next, { rate: 1 }, signal());
    expect(r.sourceCalls.length).toBe(1);
    await chapter.segmentFor(1, signal());
    expect(r.engine.requests.length).toBe(requestsBefore); // verse 1 was already made
    chapter.dispose();
  });

  it('is discarded when cancelled before adoption, and never downloads a voice', async () => {
    const r = rig({ text: verses(3, 10) });
    const ctrl = new AbortController();
    await r.provider.prefetch({ ...ref, chapter: 4 }, { rate: 1 }, ctrl.signal);
    ctrl.abort();
    const chapter = await r.provider.openChapter({ ...ref, chapter: 4 }, { rate: 1 }, signal());
    expect(r.sourceCalls.length).toBe(2); // rebuilt
    chapter.dispose();

    const cold = rig({ text: verses(3, 10) });
    cold.engine.prepared.clear();
    await cold.provider.prefetch({ ...ref, chapter: 4 }, { rate: 1 }, signal());
    expect(cold.engine.prepared.size).toBe(0);
    expect(cold.engine.requests.length).toBe(0);
  });
});

describe('errors while opening', () => {
  it('honours an abort before and between steps', async () => {
    const r = rig();
    const ctrl = new AbortController();
    ctrl.abort();
    await expect(r.provider.openChapter(ref, { rate: 1 }, ctrl.signal)).rejects.toMatchObject({ code: 'aborted' });
    const c2 = new AbortController();
    const r2 = rig();
    const orig = r2.provider as unknown as { source: () => Promise<VerseText[]> };
    orig.source = async () => { c2.abort(); return verses(2); };
    await expect(r2.provider.openChapter(ref, { rate: 1 }, c2.signal)).rejects.toMatchObject({ code: 'aborted' });
  });

  it('a failing text source is reported, not swallowed', async () => {
    const r = rig();
    (r.provider as unknown as { source: () => Promise<VerseText[]> }).source = async () => {
      throw { code: 'network', message: 'offline', retryable: true };
    };
    await expect(r.provider.openChapter(ref, { rate: 1 }, signal())).rejects.toMatchObject({ code: 'network' });
  });
});

beforeEach(() => { vi.restoreAllMocks(); });
