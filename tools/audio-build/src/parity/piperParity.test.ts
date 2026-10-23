/**
 * The native Piper engine must feed the model exactly what the browser's Piper worker does.
 * Both are run here with the same fake phonemizer and a fake ONNX Runtime that records its inputs;
 * the recorded `input`, `input_lengths`, `scales` and `sid` tensors must be identical for the same
 * verses and voice. (This file is excluded from the tool's tsc run because it imports the web app's
 * source; vitest runs it.)
 */

import { describe, expect, it } from 'vitest';
import { MemoryAssetCache } from '../../../../apps/web/src/modules/audio/lib/AssetCache';
import { createPiperHandlers, type CreatePhonemizer } from '../../../../apps/web/src/modules/audio/lib/tts/piper/piperHandlers';
import { PiperNodeEngine, type PhonemizerAssets, phonemizeWith } from '../engines/piper';

const BASE = 'https://site.test/audio/tts/piper';
const VOICE_FILES = [`${BASE}/voices/v.onnx`, `${BASE}/voices/v.onnx.json`];

const voiceJson = (multi: boolean) => ({
  espeak: { voice: 'en-us' },
  audio: { sample_rate: 22050 },
  inference: { noise_scale: 0.667, length_scale: 1, noise_w: 0.8 },
  speaker_id_map: multi ? { a: 0, b: 1 } : {},
  // A realistic spread: single and multi-id symbols, some phonemes the table lacks.
  phoneme_id_map: { _: [0], '^': [1], $: [2], ' ': [3], ',': [4], '.': [5], '?': [6], '!': [7], ð: [20], ə: [21], l: [22], ɔ: [23], ɹ: [24], d: [25], ɪ: [26, 27] },
});

/** A fake espeak: one JSON line per sentence, phonemes are the sentence's characters mapped to a few IPA ones. */
const IPA: Record<string, string> = { t: 'ð', h: 'ə', e: 'l', L: 'ɔ', o: 'ɹ', r: 'd', d: 'ɪ' };
function fakeLines(args: string[]): string[] {
  const sentences = JSON.parse(args[args.indexOf('--input') + 1]) as Array<{ text: string }>;
  return sentences.map(s => JSON.stringify({ phonemes: [...s.text].map(ch => IPA[ch] ?? ch), phoneme_ids: [999] }));
}

type Feed = Record<string, { type: string; data: unknown; dims?: readonly number[] }>;
class Tensor { constructor(public type: string, public data: unknown, public dims?: readonly number[]) {} }
const normalize = (f: Feed) => Object.fromEntries(Object.entries(f).map(([k, t]) => [k, { type: t.type, dims: t.dims, data: Array.from(t.data as ArrayLike<number | bigint>).map(String) }]));

function recordingOrt(feeds: Feed[]) {
  return {
    env: { wasm: {} },
    InferenceSession: { async create() { return { async run(f: Feed) { feeds.push(f); return { output: { data: new Float32Array([0.1, 0.2]) } }; } }; } },
    Tensor,
  };
}

async function browserFeeds(json: unknown, requests: Array<{ text: string; rate: number }>): Promise<Feed[]> {
  const feeds: Feed[] = [];
  const cache = new MemoryAssetCache();
  const files: Record<string, BodyInit> = {
    [`${BASE}/runtime/ort-wasm-simd-threaded.wasm`]: new Uint8Array(8).buffer,
    [`${BASE}/runtime/piper_phonemize.wasm`]: new Uint8Array(4).buffer,
    [`${BASE}/runtime/piper_phonemize.data`]: new Uint8Array(6).buffer,
    [VOICE_FILES[0]]: new Uint8Array(16).buffer,
    [VOICE_FILES[1]]: JSON.stringify(json),
  };
  const create: CreatePhonemizer = async o => ({ callMain(args: string[]) { for (const l of fakeLines(args)) o.print(l); } });
  const h = createPiperHandlers({
    cache,
    fetchFn: async (url: string) => (files[url] === undefined ? new Response('', { status: 404 }) : new Response(files[url], { status: 200 })),
    importOrt: async () => recordingOrt(feeds) as never,
    importPhonemizer: async () => create,
  });
  const sig = new AbortController().signal;
  await h.init({ assetBase: BASE });
  await h.prepare('v', { files: VOICE_FILES }, () => {}, sig);
  for (const r of requests) await h.synthesize({ text: r.text, voiceId: 'v', rate: r.rate }, sig);
  return feeds;
}

async function nativeFeeds(json: unknown, requests: Array<{ text: string; rate: number }>): Promise<Feed[]> {
  const feeds: Feed[] = [];
  const assets: PhonemizerAssets = {
    create: (async o => ({ callMain(args: string[]) { for (const l of fakeLines(args)) o.print(l); } })) as PhonemizerAssets['create'],
    wasm: new ArrayBuffer(4), data: new ArrayBuffer(6), dir: '.',
  };
  const engine = new PiperNodeEngine(
    { cacheDir: '.', threads: 1, quantization: 'q8', log: () => {} },
    {
      ort: () => recordingOrt(feeds) as never,
      phonemizer: async () => assets,
      voiceFiles: async () => ({ onnx: 'v.onnx', json: 'v.onnx.json' }),
      readJson: async () => json,
      phonemize: phonemizeWith,
    },
  );
  const sig = new AbortController().signal;
  await engine.prepare('en_US-test-low', () => {}, sig);
  for (const r of requests) await engine.synthesize({ text: r.text, voiceId: 'en_US-test-low', rate: r.rate }, sig);
  return feeds;
}

const VERSES = [
  { text: 'For God so loved the world, that he gave his only begotten Son.', rate: 1 },
  { text: 'The Lord is my shepherd; I shall not want. He maketh me to lie down?', rate: 1.25 },
  { text: 'Hold!', rate: 0.8 },
  { text: 'No terminator here', rate: 2 },
];

describe('native Piper matches the browser handler', () => {
  for (const multi of [false, true]) {
    it(`feeds identical tensors for the same verses and voice (${multi ? 'multi' : 'single'}-speaker)`, async () => {
      const json = voiceJson(multi);
      const browser = (await browserFeeds(json, VERSES)).map(normalize);
      const native = (await nativeFeeds(json, VERSES)).map(normalize);
      expect(native).toEqual(browser);
      expect(browser).toHaveLength(VERSES.length);
      expect(browser[0].input.data.length).toBeGreaterThan(10);
      expect('sid' in browser[0]).toBe(multi);
    });
  }
});
