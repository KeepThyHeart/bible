import { describe, it, expect, vi, beforeEach } from 'vitest';
import { Registry } from '@bible/core/browser';
import type { AudioVoice, IAudioProvider } from '@bible/core/browser';
import { AudioSourceResolver, NEGATIVE_TTL_MS } from './AudioSourceResolver';
import { defaultAudioPrefs } from './audioPrefs';
import { RecordedAudioProvider } from './RecordedAudioProvider';
import { CdnAudioLocator } from './CdnAudioLocator';
import { FakeManifestSource, FakeTtsEngine, deferred } from './testing';
import { TtsAudioProvider } from './tts/TtsAudioProvider';
import { TextPreparer } from './TextPreparer';

const en = (id: string, label = id): AudioVoice => ({ id, label, language: 'en-US' });

interface Rig {
  resolver: AudioSourceResolver;
  providers: Registry<IAudioProvider>;
  engine: FakeTtsEngine;
  tts: TtsAudioProvider;
  recorded: RecordedAudioProvider;
  engineSupported: ReturnType<typeof vi.fn>;
  setNow(t: number): void;
}

function rig(opts: { recordings?: boolean; voices?: AudioVoice[]; defaultVoices?: Record<string, string> } = {}): Rig {
  const providers = new Registry<IAudioProvider>();
  const source = opts.recordings
    ? FakeManifestSource.withChapters('KJV', [{ book: 43, chapter: 3, verseCount: 3 }])
    : new FakeManifestSource(); // zero recordings anywhere
  const recorded = new RecordedAudioProvider(source, new CdnAudioLocator('/audio'), { canPlay: () => true });
  const engine = new FakeTtsEngine({ id: 'piper', voices: opts.voices ?? [en('amy'), en('ben')] });
  const tts = new TtsAudioProvider(engine, new TextPreparer(), async () => [], { languageOf: () => 'en', bookName: () => 'John' });
  providers.register(recorded);
  providers.register(tts);
  let now = 0;
  const engineSupported = vi.fn(async () => true);
  const resolver = new AudioSourceResolver({
    providers, engineOrder: ['piper'], engineSupported,
    defaultVoice: (_e, lang) => opts.defaultVoices?.[lang], now: () => now,
  });
  return { resolver, providers, engine, tts, recorded, engineSupported, setNow: t => { now = t; } };
}

let r: Rig;
beforeEach(() => { r = rig(); });

describe('resolve: zero recordings (the starting state)', () => {
  it('falls back to on-device speech, using the configured default voice', async () => {
    r = rig({ defaultVoices: { en: 'ben' } });
    const res = await r.resolver.resolve('KJV', 'en', defaultAudioPrefs());
    expect(res).toMatchObject({ reason: 'auto-tts', voiceId: 'ben' });
    expect(res?.provider.id).toBe('tts:piper');
    expect(res?.notice).toBeUndefined();
  });

  it('is null (Play disabled) when nothing can speak the language', async () => {
    expect(await r.resolver.resolve('RV1909', 'fr', defaultAudioPrefs())).toBeNull();
  });

  it('is null with no engines at all and no recordings', async () => {
    const providers = new Registry<IAudioProvider>();
    providers.register(new RecordedAudioProvider(new FakeManifestSource(), new CdnAudioLocator('/audio'), { canPlay: () => true }));
    const resolver = new AudioSourceResolver({ providers, engineOrder: [], engineSupported: async () => true, defaultVoice: () => undefined });
    expect(await resolver.resolve('KJV', 'en', defaultAudioPrefs())).toBeNull();
    expect(await resolver.options('KJV', 'en')).toEqual([]);
  });

  it('a preference for recordings that do not exist falls back with a notice', async () => {
    const prefs = { ...defaultAudioPrefs(), source: 'recorded' as const };
    expect(await r.resolver.resolve('KJV', 'en', prefs)).toMatchObject({ reason: 'fallback', notice: 'audio.notice.preferredUnavailable' });
  });
});

describe('resolve: with a fixture manifest', () => {
  beforeEach(() => { r = rig({ recordings: true }); });

  it('automatic prefers the recording', async () => {
    const res = await r.resolver.resolve('KJV', 'en', defaultAudioPrefs());
    expect(res).toMatchObject({ reason: 'auto-recorded', voiceId: 'fixture-1' });
    expect(res?.provider.id).toBe('recorded');
  });

  it('an explicit on-device preference wins over the recording', async () => {
    const prefs = { ...defaultAudioPrefs(), source: 'tts:piper' as const };
    expect(await r.resolver.resolve('KJV', 'en', prefs)).toMatchObject({ reason: 'preferred' });
  });

  it('a per-translation source beats the global one, and a session override beats both', async () => {
    const prefs = { ...defaultAudioPrefs(), source: 'recorded' as const, perTranslation: { KJV: { source: 'tts:piper' as const } } };
    expect((await r.resolver.resolve('KJV', 'en', prefs))?.provider.id).toBe('tts:piper');
    expect((await r.resolver.resolve('KJV', 'en', prefs, 'recorded'))?.provider.id).toBe('recorded');
  });

  it('a preferred engine this browser cannot run falls back to the recording, with a notice', async () => {
    r.engineSupported.mockResolvedValue(false);
    const prefs = { ...defaultAudioPrefs(), source: 'tts:piper' as const };
    expect(await r.resolver.resolve('KJV', 'en', prefs)).toMatchObject({ reason: 'fallback', notice: 'audio.notice.preferredUnavailable' });
  });

  it('a preference naming an unregistered provider is treated the same way', async () => {
    const prefs = { ...defaultAudioPrefs(), source: 'tts:kokoro' as const };
    expect(await r.resolver.resolve('KJV', 'en', prefs)).toMatchObject({ reason: 'fallback' });
  });

  it('another translation in the same language is not covered by these recordings', async () => {
    expect((await r.resolver.resolve('WEB', 'en', defaultAudioPrefs()))?.provider.id).toBe('tts:piper');
  });
});

describe('voice choice', () => {
  beforeEach(() => { r = rig({ voices: [en('amy'), en('ben'), en('cat')], defaultVoices: { en: 'cat' } }); });

  it('per-translation voice, then per-engine/language, then configured default, then first', async () => {
    const p = defaultAudioPrefs();
    expect((await r.resolver.resolve('KJV', 'en', p))?.voiceId).toBe('cat');
    expect((await r.resolver.resolve('KJV', 'en', { ...p, voiceByEngineLang: { 'piper:en': 'ben' } }))?.voiceId).toBe('ben');
    expect((await r.resolver.resolve('KJV', 'en', {
      ...p, voiceByEngineLang: { 'piper:en': 'ben' }, perTranslation: { KJV: { voiceId: 'amy' } },
    }))?.voiceId).toBe('amy');
    const noDefault = rig({ voices: [en('amy'), en('ben')] });
    expect((await noDefault.resolver.resolve('KJV', 'en', p))?.voiceId).toBe('amy');
  });

  it('a stored voice that is no longer offered is skipped, with a notice', async () => {
    const prefs = { ...defaultAudioPrefs(), perTranslation: { KJV: { voiceId: 'gone' } } };
    expect(await r.resolver.resolve('KJV', 'en', prefs)).toMatchObject({ voiceId: 'cat', notice: 'audio.notice.voiceUnavailable' });
  });

  it('a source notice is not replaced by a voice notice', async () => {
    const prefs = { ...defaultAudioPrefs(), source: 'recorded' as const, perTranslation: { KJV: { voiceId: 'gone' } } };
    expect((await r.resolver.resolve('KJV', 'en', prefs))?.notice).toBe('audio.notice.preferredUnavailable');
  });
});

describe('options', () => {
  it('lists every usable provider with its voices, recorded first', async () => {
    r = rig({ recordings: true });
    const options = await r.resolver.options('KJV', 'en');
    expect(options.map(o => o.provider.id)).toEqual(['recorded', 'tts:piper']);
    expect(options[1].voices.map(v => v.id)).toEqual(['amy', 'ben']);
  });
});

describe('language', () => {
  it('an engine with only English voices is not usable for French', async () => {
    expect(await r.resolver.resolve('RV', 'fr-FR', defaultAudioPrefs())).toBeNull();
    expect((await r.resolver.resolve('X', 'EN_gb', defaultAudioPrefs()))?.provider.id).toBe('tts:piper');
  });
});

describe('caching', () => {
  it('concurrent resolves share one supports() call', async () => {
    const gate = deferred<boolean>();
    const spy = vi.spyOn(r.tts, 'supports').mockImplementation(() => gate.promise);
    const a = r.resolver.resolve('KJV', 'en', defaultAudioPrefs());
    const b = r.resolver.resolve('KJV', 'en', defaultAudioPrefs());
    gate.resolve(true);
    await Promise.all([a, b]);
    expect(spy).toHaveBeenCalledTimes(1);
  });

  it('a failing supports() counts as "no" and is not cached', async () => {
    const spy = vi.spyOn(r.tts, 'supports').mockRejectedValueOnce(new Error('boom'));
    expect(await r.resolver.resolve('KJV', 'en', defaultAudioPrefs())).toBeNull();
    expect((await r.resolver.resolve('KJV', 'en', defaultAudioPrefs()))?.provider.id).toBe('tts:piper');
    expect(spy).toHaveBeenCalledTimes(2);
  });

  it('a "no" expires after five minutes, a "yes" does not', async () => {
    let published = false;
    const spy = vi.spyOn(r.recorded, 'supports').mockImplementation(async () => published);
    await r.resolver.resolve('KJV', 'en', defaultAudioPrefs());
    published = true;
    await r.resolver.resolve('KJV', 'en', defaultAudioPrefs());
    expect(spy).toHaveBeenCalledTimes(1); // "no" still cached
    r.setNow(NEGATIVE_TTL_MS + 1);
    expect((await r.resolver.resolve('KJV', 'en', defaultAudioPrefs()))?.provider.id).toBe('recorded');
    r.setNow(10 * NEGATIVE_TTL_MS);
    await r.resolver.resolve('KJV', 'en', defaultAudioPrefs());
    expect(spy).toHaveBeenCalledTimes(2); // "yes" kept for the session
  });

  it('invalidate() asks again (one translation, or all); invalidateNegatives() only re-asks the "no"s', async () => {
    const rec = vi.spyOn(r.recorded, 'supports').mockResolvedValue(false);
    const tts = vi.spyOn(r.tts, 'supports');
    await r.resolver.resolve('KJV', 'en', defaultAudioPrefs());
    await r.resolver.resolve('WEB', 'en', defaultAudioPrefs());
    r.resolver.invalidate('KJV');
    await r.resolver.resolve('KJV', 'en', defaultAudioPrefs());
    await r.resolver.resolve('WEB', 'en', defaultAudioPrefs());
    expect(rec).toHaveBeenCalledTimes(3); // KJV twice, WEB once
    r.resolver.invalidateNegatives();
    await r.resolver.resolve('KJV', 'en', defaultAudioPrefs());
    expect(rec).toHaveBeenCalledTimes(4);
    expect(tts).toHaveBeenCalledTimes(3); // KJV, WEB, KJV again after invalidate(KJV); the last resolve kept its "yes"
  });

  it('cachedAvailability answers synchronously once known, and undefined before', async () => {
    expect(r.resolver.cachedAvailability('KJV', 'en')).toBeUndefined();
    await r.resolver.resolve('KJV', 'en', defaultAudioPrefs());
    expect(r.resolver.cachedAvailability('KJV', 'en')).toBe(true);
    expect(r.resolver.cachedAvailability('KJV', 'fr')).toBeUndefined();
    await r.resolver.resolve('KJV', 'fr', defaultAudioPrefs());
    expect(r.resolver.cachedAvailability('KJV', 'fr')).toBe(false);
  });
});

