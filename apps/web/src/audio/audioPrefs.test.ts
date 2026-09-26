import { describe, it, expect } from 'vitest';
import { AUDIO_PREFS_KEY, DEFAULT_AUDIO_PREFS, defaultAudioPrefs, effectiveRate, loadAudioPrefs, sanitizeAudioPrefs, saveAudioPrefs } from './audioPrefs';

const store = (initial?: string) => {
  const data = new Map<string, string>();
  if (initial !== undefined) data.set(AUDIO_PREFS_KEY, initial);
  return { getItem: (k: string) => data.get(k) ?? null, setItem: (k: string, v: string) => { data.set(k, v); }, data };
};

describe('loadAudioPrefs', () => {
  it('gives the defaults when nothing is stored, or the JSON is corrupt', () => {
    expect(loadAudioPrefs(store())).toEqual(DEFAULT_AUDIO_PREFS);
    expect(loadAudioPrefs(store('{not json'))).toEqual(DEFAULT_AUDIO_PREFS);
    expect(loadAudioPrefs(store('null'))).toEqual(DEFAULT_AUDIO_PREFS);
    expect(loadAudioPrefs(store('[1,2]'))).toEqual(DEFAULT_AUDIO_PREFS);
  });

  it('gives the defaults when storage itself throws or is absent', () => {
    expect(loadAudioPrefs({ getItem: () => { throw new Error('denied'); } })).toEqual(DEFAULT_AUDIO_PREFS);
    expect(loadAudioPrefs(null)).toEqual(DEFAULT_AUDIO_PREFS);
  });

  it('keeps valid fields, drops unknown ones, and repairs bad ones individually', () => {
    const prefs = sanitizeAudioPrefs({
      v: 1,
      source: 'tts:',                     // invalid: falls back
      rate: 9,                            // clamped
      continueAfterChapter: 'sometimes',  // invalid
      followAlong: false,                 // valid
      autoScroll: 'yes',                  // wrong type
      mystery: true,                      // unknown
      perTranslation: {
        KJV: { source: 'recorded', voiceId: 'n1', extra: 1 },
        BAD: { source: 'nonsense' },
        NUM: 5,
        EMPTY: {},
      },
      voiceByEngineLang: { 'piper:en': 'amy', 'piper:es': 7, '': '' },
      phoneBatteryNoticeSeen: { piper: true, kokoro: false, x: 'true' },
    });
    expect(prefs).toEqual({
      ...DEFAULT_AUDIO_PREFS,
      rate: 2,
      followAlong: false,
      perTranslation: { KJV: { source: 'recorded', voiceId: 'n1' } },
      voiceByEngineLang: { 'piper:en': 'amy' },
      phoneBatteryNoticeSeen: { piper: true },
    });
  });

  it('rejects a non-finite rate and clamps a tiny one', () => {
    expect(sanitizeAudioPrefs({ rate: NaN }).rate).toBe(1);
    expect(sanitizeAudioPrefs({ rate: 'fast' }).rate).toBe(1);
    expect(sanitizeAudioPrefs({ rate: 0 }).rate).toBe(0.5);
  });

  it('caps the number of per-translation entries', () => {
    const perTranslation = Object.fromEntries(Array.from({ length: 500 }, (_v, i) => [`M${i}`, { voiceId: 'x' }]));
    expect(Object.keys(sanitizeAudioPrefs({ perTranslation }).perTranslation).length).toBe(200);
  });

  it('never shares mutable state between calls', () => {
    const a = defaultAudioPrefs();
    a.perTranslation.X = { voiceId: 'v' };
    a.phoneBatteryNoticeSeen.piper = true;
    expect(defaultAudioPrefs().perTranslation).toEqual({});
    expect(DEFAULT_AUDIO_PREFS.phoneBatteryNoticeSeen).toEqual({});
  });
});

describe('saveAudioPrefs', () => {
  it('round-trips', () => {
    const s = store();
    const prefs = { ...defaultAudioPrefs(), rate: 1.25, source: 'tts:piper' as const };
    saveAudioPrefs(prefs, s);
    expect(loadAudioPrefs(s)).toEqual(prefs);
    expect(JSON.parse(s.data.get(AUDIO_PREFS_KEY)!).v).toBe(1);
  });

  it('does not throw when storage is full or unavailable', () => {
    expect(() => saveAudioPrefs(defaultAudioPrefs(), { setItem: () => { throw new Error('quota'); } })).not.toThrow();
    expect(() => saveAudioPrefs(defaultAudioPrefs(), null)).not.toThrow();
  });
});

describe('effectiveRate', () => {
  const range = { min: 0.75, max: 1.5, step: 0.05 };
  it('clamps to the provider range and snaps to its step', () => {
    expect(effectiveRate(3, { rate: range })).toBe(1.5);
    expect(effectiveRate(0.1, { rate: range })).toBe(0.75);
    expect(effectiveRate(1.02, { rate: range })).toBe(1);
    expect(effectiveRate(1.13, { rate: range })).toBe(1.15);
  });
  it('is 1 when the provider has no speed control', () => {
    expect(effectiveRate(1.7, { rate: null })).toBe(1);
  });
  it('does not drift on repeated steps of 0.1', () => {
    const r = { min: 0.5, max: 2, step: 0.1 };
    expect(effectiveRate(1.3, { rate: r })).toBe(1.3);
    expect(effectiveRate(0.7, { rate: r })).toBe(0.7);
  });
});

