/**
 * Kokoro voice blends and clear speech. A stand-in kokoro-js instance records what reaches the
 * tokenizer and the model; the real voice files of the kokoro-js package are read for the blend
 * maths. No model runs.
 */

import { describe, expect, it } from 'vitest';
import type { SynthesisRequest } from '../core';
import { voiceLanguage } from '../pronunciation';
import {
  KOKORO_STYLE_DIM, KOKORO_STYLE_ROWS, KokoroNodeEngine, blendKokoroStyles, checkKokoroVoice, kokoroDefinition, kokoroStyleRow,
  kokoroVoiceLabel, kokoroVoiceLanguage, kokoroVoiceSlug, parseKokoroVoice, readKokoroVoiceData,
  type KokoroIds, type KokoroInstance,
} from './kokoro';

describe('Kokoro voice specs', () => {
  it('parses one voice and normalises blend weights', () => {
    expect(parseKokoroVoice('am_michael')).toEqual({ parts: [{ id: 'am_michael', weight: 1 }] });
    expect(parseKokoroVoice('am_michael:0.5+bm_george:0.5')).toEqual({ parts: [{ id: 'am_michael', weight: 0.5 }, { id: 'bm_george', weight: 0.5 }] });
    expect(parseKokoroVoice('am_michael:3+bm_george:1')).toEqual({ parts: [{ id: 'am_michael', weight: 0.75 }, { id: 'bm_george', weight: 0.25 }] });
    expect(parseKokoroVoice('am_michael+bm_george')).toEqual({ parts: [{ id: 'am_michael', weight: 0.5 }, { id: 'bm_george', weight: 0.5 }] });
  });

  it.each(['am_nobody', 'am_michael:0+bm_george', 'am_michael+am_michael', 'am_michael:x', 'am_michael:0.5+', ''])('rejects %j', spec => {
    expect(parseKokoroVoice(spec)).toHaveProperty('error');
    expect(checkKokoroVoice(spec)).toBeTypeOf('string');
  });

  it('names a blend for the narrator id and for readers; the first voice sets the accent', () => {
    const spec = 'am_michael:0.5+bm_george:0.5';
    expect(kokoroVoiceSlug(spec)).toBe('michael50-george50');
    expect(kokoroVoiceLabel(spec)).toBe('Michael 50% + George 50%');
    expect(kokoroVoiceLanguage(spec)).toBe('en-US');
    expect(kokoroVoiceLanguage('bm_george+am_michael')).toBe('en-GB');
    expect(voiceLanguage(kokoroDefinition, spec)).toBe('en-US');
    expect(kokoroVoiceSlug('am_michael')).toBe('am_michael');
  });
});

describe('Kokoro style blending', () => {
  it('reads the voice files kokoro-js ships (510 rows of 256)', () => {
    const d = readKokoroVoiceData('am_michael');
    expect(d.length).toBe(KOKORO_STYLE_ROWS * KOKORO_STYLE_DIM);
    expect(d.every(Number.isFinite)).toBe(true);
  });

  it('averages by weight; one voice at weight 1 is that voice exactly', () => {
    const m = readKokoroVoiceData('am_michael');
    const g = readKokoroVoiceData('bm_george');
    expect(blendKokoroStyles([{ id: 'am_michael', weight: 1 }], readKokoroVoiceData)).toEqual(m);
    const b = blendKokoroStyles([{ id: 'am_michael', weight: 0.5 }, { id: 'bm_george', weight: 0.5 }], readKokoroVoiceData);
    for (const i of [0, 1000, b.length - 1]) expect(b[i]).toBeCloseTo((m[i] + g[i]) / 2, 6);
  });

  it('picks the style row by input length, as kokoro-js does', () => {
    const s = Float32Array.from({ length: KOKORO_STYLE_ROWS * KOKORO_STYLE_DIM }, (_, i) => Math.floor(i / KOKORO_STYLE_DIM));
    expect(kokoroStyleRow(s, 2)[0]).toBe(0);
    expect(kokoroStyleRow(s, 12)[0]).toBe(10);
    expect(kokoroStyleRow(s, 9999)[0]).toBe(KOKORO_STYLE_ROWS - 1);
    expect(kokoroStyleRow(s, 12)).toHaveLength(KOKORO_STYLE_DIM);
  });
});

describe('Kokoro engine paths (stand-in kokoro-js)', () => {
  /** espeak-like phonemes for a few words, standing in for kokoro-js's phonemizer. */
  const IPA: Record<string, string> = { the: 'ðə', begotten: 'bᵻɡˈɑːʔn̩', son: 'sˈʌn', city: 'sˈɪɾi' };
  const phonemize = (text: string): string => text.split(/\s+/).map(w => IPA[w.toLowerCase()] ?? w.toUpperCase()).join(' ');

  function fake() {
    const log = { generate: [] as Array<{ text: string; voice: string }>, tokens: [] as string[], fromIds: [] as string[], model: [] as Array<Record<string, unknown>> };
    const tokenizer = Object.assign((text: string): { input_ids: KokoroIds } => {
      log.tokens.push(text);
      return { input_ids: { dims: [1, text.length + 2] } };
    }, {});
    const tts: KokoroInstance = {
      tokenizer,
      async generate(this: KokoroInstance, text, o) {
        log.generate.push({ text, voice: o.voice });
        const { input_ids } = this.tokenizer!(phonemize(text));
        return this.generate_from_ids!(input_ids, o);
      },
      async generate_from_ids(_ids, o) { log.fromIds.push(o.voice); return { audio: new Float32Array(10), sampling_rate: 24000 }; },
      async model(inputs) { log.model.push(inputs); return { waveform: { data: new Float32Array(10) } }; },
    };
    // The real kokoro-js path calls generate() on a probe copy whose tokenizer is replaced; record the final tokenizer calls only.
    return { tts, log };
  }
  class T { constructor(readonly type: string, readonly data: Float32Array | number[], readonly dims: number[]) {} }
  const ctx = (clearSpeech: boolean) => ({ cacheDir: '/nonexistent', threads: 1, quantization: 'q8' as const, clearSpeech, log: () => {} });
  const say = (e: KokoroNodeEngine, text: string, voiceId: string) =>
    e.synthesize({ text, voiceId, rate: 0.9 } satisfies SynthesisRequest, new AbortController().signal);

  it('a plain voice without clear speech goes through kokoro-js as before', async () => {
    const { tts, log } = fake();
    await say(KokoroNodeEngine.withInstance(ctx(false), tts, T), 'the begotten Son', 'am_michael');
    expect(log.generate).toEqual([{ text: 'the begotten Son', voice: 'am_michael' }]);
    expect(log.tokens).toEqual(['ðə bᵻɡˈɑːʔn̩ sˈʌn']);
  });

  it('clear speech rewrites the phonemes before the tokenizer', async () => {
    const { tts, log } = fake();
    await say(KokoroNodeEngine.withInstance(ctx(true), tts, T), 'the begotten Son', 'am_michael');
    expect(log.tokens.at(-1)).toBe('ðʌ bɪɡˈɑːtən sˈʌn');
    expect(log.fromIds.at(-1)).toBe('am_michael');
  });

  it('clear speech also applies to pronunciation corrections', async () => {
    const { tts, log } = fake();
    await say(KokoroNodeEngine.withInstance(ctx(true), tts, T), 'the ⟦Melchisedec|mɛlkˈɪzᵻdɛk⟧ city', 'am_michael');
    expect(log.tokens.at(-1)).toBe('ðʌ mɛlkˈɪzɪdɛk sˈɪti');
  });

  it('a blend is phonemized in the first voice\'s accent and run with the blended style row', async () => {
    const { tts, log } = fake();
    const spec = 'am_michael:0.5+bm_george:0.5';
    await say(KokoroNodeEngine.withInstance(ctx(true), tts, T), 'the ⟦Melchisedec|mɛlkˈɪzᵻdɛk⟧', spec);
    expect(log.generate.every(g => g.voice === 'am_michael')).toBe(true); // only the phoneme probe, in Michael's accent
    expect(log.fromIds).toEqual([]);
    const tokens = log.tokens.at(-1)!;
    expect(tokens).toBe('ðʌ mɛlkˈɪzɪdɛk');
    const inputs = log.model[0] as { style: T; speed: T };
    const { parts } = parseKokoroVoice(spec) as { parts: Array<{ id: string; weight: number }> };
    const expected = kokoroStyleRow(blendKokoroStyles(parts, readKokoroVoiceData), tokens.length + 2);
    expect(inputs.style.dims).toEqual([1, KOKORO_STYLE_DIM]);
    expect(inputs.style.data).toEqual(expected);
    expect(inputs.speed.data).toEqual([0.9]);
  });

  it('a blend led by a British voice gets the words, not the American corrections', async () => {
    const { tts, log } = fake();
    await say(KokoroNodeEngine.withInstance(ctx(false), tts, T), 'the ⟦Melchisedec|mɛlkˈɪzᵻdɛk⟧', 'bm_george:0.5+am_michael:0.5');
    expect(log.tokens.at(-1)).toBe('ðə MELCHISEDEC');
    expect(log.generate.every(g => g.voice === 'bm_george')).toBe(true);
  });
});
