import { describe, expect, it } from 'vitest';
import { renderChapter, trimSilence } from './render';
import { FAKE_RATE, FakeEngine } from './testing/fakeEngine';
import type { PreparedChapter } from './text';

const ctrl = new AbortController();
const chapter = (intro: string | null, verses: Array<[number, string]>): PreparedChapter => ({
  intro,
  verses: verses.map(([verse, text]) => ({ verse, text })),
  textHash: 'x',
});
const settings = { rate: 1, gapMs: 350, introGapMs: 700, trim: false };

describe('renderChapter timings', () => {
  it('computes exact times from sample counts, with gaps between verses', async () => {
    const e = new FakeEngine();
    // 10 chars = 0.10 s, 20 chars = 0.20 s, 30 chars = 0.30 s
    const r = await renderChapter(e, 'v1', chapter(null, [[1, 'a'.repeat(10)], [2, 'b'.repeat(20)], [3, 'c'.repeat(30)]]), settings, ctrl.signal);
    expect(r.verses).toEqual([[1, 0, 0.1], [2, 0.45, 0.65], [3, 1.0, 1.3]]);
    expect(r.intro).toBeUndefined();
    expect(r.duration).toBe(1.3); // no gap after the last verse
    expect(r.pcm.length).toBe(Math.round(1.3 * FAKE_RATE));
    expect(r.sampleRate).toBe(FAKE_RATE);
  });

  it('puts the intro in its own span and uses the longer gap after it', async () => {
    const r = await renderChapter(new FakeEngine(), 'v1', chapter('J'.repeat(20), [[1, 'a'.repeat(10)], [2, 'b'.repeat(10)]]), settings, new AbortController().signal);
    expect(r.intro).toEqual([0, 0.2]);
    expect(r.verses).toEqual([[1, 0.9, 1.0], [2, 1.35, 1.45]]);
    expect(r.duration).toBe(1.45);
  });

  it('keeps verse 0 (a Psalm title) first and ascending', async () => {
    const r = await renderChapter(new FakeEngine(), 'v1', chapter('Psalm 3.', [[0, 'A Psalm of David.'], [1, 'Lord, how are they increased']]), settings, ctrl.signal);
    expect(r.verses.map(v => v[0])).toEqual([0, 1]);
    expect(r.verses[0][1]).toBeGreaterThan(r.intro![1]);
  });

  it('honours a custom gap', async () => {
    const r = await renderChapter(new FakeEngine(), 'v1', chapter(null, [[1, 'a'.repeat(10)], [2, 'b'.repeat(10)]]), { ...settings, gapMs: 1000 }, ctrl.signal);
    expect(r.verses[1][1]).toBeCloseTo(1.1, 6);
  });

  it('passes the rate and voice to the engine', async () => {
    const e = new FakeEngine();
    await renderChapter(e, 'v2', chapter(null, [[1, 'hello']]), { ...settings, rate: 1.25 }, ctrl.signal);
    expect(e.calls).toEqual([{ text: 'hello', voiceId: 'v2', rate: 1.25 }]);
  });

  it('trims engine silence at the edges when asked', async () => {
    const e = new FakeEngine();
    e.edgeSilence = 0.5;
    const raw = await renderChapter(e, 'v1', chapter(null, [[1, 'a'.repeat(10)]]), { ...settings, trim: false }, ctrl.signal);
    const trimmed = await renderChapter(e, 'v1', chapter(null, [[1, 'a'.repeat(10)]]), { ...settings, trim: true }, ctrl.signal);
    expect(raw.verses[0][2] - raw.verses[0][1]).toBeCloseTo(1.1, 3);
    expect(trimmed.verses[0][2] - trimmed.verses[0][1]).toBeLessThan(0.3);
  });

  it('fails a chapter whose engine fails, and an empty one', async () => {
    const e = new FakeEngine();
    e.failOn = t => t.includes('boom');
    await expect(renderChapter(e, 'v1', chapter(null, [[1, 'boom']]), settings, ctrl.signal)).rejects.toThrow(/fake engine failure/);
    await expect(renderChapter(new FakeEngine(), 'v1', chapter(null, []), settings, ctrl.signal)).rejects.toThrow(/no speakable text/);
  });

  it('always keeps verses inside the duration and strictly ordered (validator rules)', async () => {
    const r = await renderChapter(new FakeEngine(), 'v1', chapter('Intro here.', Array.from({ length: 40 }, (_, i) => [i + 1, 'x'.repeat(3 + (i % 17))] as [number, string])), settings, ctrl.signal);
    let prev = r.intro![1];
    for (const [, s, en] of r.verses) { expect(s).toBeGreaterThanOrEqual(prev); expect(en).toBeGreaterThan(s); expect(en).toBeLessThanOrEqual(r.duration); prev = en; }
  });
});

describe('trimSilence', () => {
  it('returns an empty clip for pure silence', () => {
    expect(trimSilence(new Float32Array(1000), 16000).length).toBe(0);
  });
});
