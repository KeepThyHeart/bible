import { describe, it, expect } from 'vitest';
import {
  clampPiperRate,
  parsePhonemizerLines,
  parseVoiceConfig,
  phonemesToIds,
  piperPhonemizerArgs,
  piperScales,
  piperSilenceSamples,
  splitSentences,
} from '../audio/piperPhonemes';

const voiceJson = {
  audio: { sample_rate: 16000 },
  espeak: { voice: 'en-us' },
  inference: { noise_scale: 0.5, length_scale: 1.2, noise_w: 0.9 },
  phoneme_id_map: { '^': [1], $: [2], _: [0], a: [10], b: [11, 12] },
};

describe('Piper phoneme mapping (shared by the browser worker and the build tool)', () => {
  it('frames each sentence with BOS, PAD ... EOS and skips unknown phonemes', () => {
    const map = voiceJson.phoneme_id_map;
    expect(phonemesToIds([['a', 'b', 'zz']], map)).toEqual([1, 0, 10, 0, 11, 12, 0, 2]);
    expect(phonemesToIds([['a'], ['b']], map)).toEqual([1, 0, 10, 0, 2, 1, 0, 11, 12, 0, 2]);
    expect(phonemesToIds([], map)).toEqual([]);
  });

  it('splits sentences at terminators and keeps unterminated text whole', () => {
    expect(splitSentences('In the beginning. And God said! Why? Because')).toEqual(['In the beginning.', 'And God said!', 'Why?', 'Because']);
    expect(splitSentences('   ')).toEqual([]);
  });

  it('builds the phonemizer command line, one entry per sentence', () => {
    expect(piperPhonemizerArgs('en-us', 'One. Two.')).toEqual([
      '-l', 'en-us', '--input', JSON.stringify([{ text: 'One.' }, { text: 'Two.' }]), '--espeak_data', '/espeak-ng-data',
    ]);
  });

  it('reads phonemes from the printed lines and ignores other output', () => {
    expect(parsePhonemizerLines(['{"phonemes":["a","b"],"phoneme_ids":[1]}', 'warning: x', '{"phonemes":["c"]}', '{"nope":1}'])).toEqual([['a', 'b'], ['c']]);
  });

  it('reads a voice configuration and rejects other files', () => {
    const c = parseVoiceConfig(voiceJson);
    expect(c).toMatchObject({ espeakVoice: 'en-us', sampleRate: 16000, noiseScale: 0.5, lengthScale: 1.2, noiseW: 0.9, multiSpeaker: false });
    expect(parseVoiceConfig({ ...voiceJson, speaker_id_map: { a: 0 } }).multiSpeaker).toBe(true);
    expect(() => parseVoiceConfig({})).toThrow();
    expect(() => parseVoiceConfig({ ...voiceJson, phoneme_id_map: { a: [1] } })).toThrow();
  });

  it('scales speed through length_scale and clamps the rate', () => {
    const c = parseVoiceConfig(voiceJson);
    expect(Array.from(piperScales(c, 2))).toEqual([Math.fround(0.5), Math.fround(0.6), Math.fround(0.9)]);
    expect(clampPiperRate(100)).toBe(4);
    expect(clampPiperRate(0.01)).toBe(0.25);
    expect(clampPiperRate(undefined)).toBe(1);
    expect(piperSilenceSamples(c)).toBe(1600);
  });
});
