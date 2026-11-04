import { describe, expect, it } from 'vitest';
import { WebSpeechSpeaker } from './WebSpeechSpeaker';
import { FakeAudioContext, FakeSynth, FakeUtterance } from './fakes.testutil';

const v = (name: string, lang: string, localService: boolean) => ({ name, voiceURI: name, lang, localService });
const make = (voices: unknown[], mode: 'ok' | 'error' | 'hang' = 'ok') => {
  const synth = new FakeSynth(voices);
  synth.mode = mode;
  const ctx = new FakeAudioContext();
  const speaker = new WebSpeechSpeaker({
    synth: synth as unknown as SpeechSynthesis,
    Utterance: FakeUtterance as never,
    audioContext: () => ctx as unknown as AudioContext,
    voicesTimeoutMs: 10,
  });
  return { synth, speaker, ctx };
};
const o = { language: 'en-US' };

describe('WebSpeechSpeaker', () => {
  it('prefers a local voice of the language, honours voiceId', async () => {
    const { synth, speaker } = make([v('remote', 'en-US', false), v('de', 'de-DE', true), v('local', 'en-GB', true)]);
    await speaker.speak('Hello there.', o, new AbortController().signal);
    expect((synth.spoken[0].voice as { name: string }).name).toBe('local');
    await speaker.speak('Hi.', { ...o, voiceId: 'remote', rate: 1.5 }, new AbortController().signal);
    expect((synth.spoken[1].voice as { name: string }).name).toBe('remote');
    expect(synth.spoken[1].rate).toBe(1.5);
  });

  it('available() reflects voices (after the voiceschanged timeout)', async () => {
    expect(await make([v('de', 'de-DE', true)]).speaker.available('en')).toBe(false);
    expect(await make([]).speaker.available()).toBe(false);
    expect(await make([v('en', 'en-US', true)]).speaker.available('en-GB')).toBe(true);
  });

  it('splits into sentence utterances in order', async () => {
    const { synth, speaker } = make([v('en', 'en-US', true)]);
    await speaker.speak('One. Two! Three?', o, new AbortController().signal);
    expect(synth.spoken.map((u) => u.text)).toEqual(['One. Two! Three?']);
    await speaker.speak(`${'word '.repeat(30)}end. ${'more '.repeat(30)}fin.`, o, new AbortController().signal);
    expect(synth.spoken.length).toBeGreaterThan(2);
  });

  it('rejects on error, rejects when no voice', async () => {
    await expect(make([v('en', 'en-US', true)], 'error').speaker.speak('Hi.', o, new AbortController().signal)).rejects.toThrow();
    await expect(make([]).speaker.speak('Hi.', o, new AbortController().signal)).rejects.toThrow(/no voice/);
  });

  it('abort cancels and resolves quietly', async () => {
    const { synth, speaker } = make([v('en', 'en-US', true)], 'hang');
    const ac = new AbortController();
    const p = speaker.speak('Hold on.', o, ac.signal);
    await new Promise((r) => setTimeout(r, 5));
    ac.abort();
    await expect(p).resolves.toBeUndefined();
    expect(synth.cancelled).toBe(1);
  });

  it('earcon plays on the context', async () => {
    const { speaker, ctx } = make([]);
    await speaker.earcon('done');
    expect(ctx.nodes).toHaveLength(3);
  });
});
