import { describe, it, expect, vi } from 'vitest';
import { MemoryAssetCache } from '../../AssetCache';
import {
  createPiperHandlers, parseVoiceConfig, phonemesToIds, splitSentences,
  type CreatePhonemizer, type OrtLike, type PhonemizerOptions,
} from './piperHandlers';
import { PiperEngine } from './PiperEngine';
import type { WorkerLike } from '../WorkerTtsEngine';
import { serveTtsWorker, type WorkerScopeLike } from '../serveTtsWorker';
import type { TtsWorkerReply, TtsWorkerRequest } from '../ttsWorkerProtocol';
import type { LoadProgress } from '@bible/core/browser';

const BASE = 'https://site.test/audio/tts/piper';
const VOICE_FILES = [`${BASE}/voices/v.onnx`, `${BASE}/voices/v.onnx.json`];
const signal = () => new AbortController().signal;

const voiceJson = {
  espeak: { voice: 'en-us' },
  audio: { sample_rate: 16000 },
  inference: { noise_scale: 0.5, length_scale: 1.2, noise_w: 0.8 },
  speaker_id_map: {},
  phoneme_id_map: { _: [0], '^': [1], $: [2], ' ': [3], a: [10], b: [11, 12] },
};

function fakeFetch(files: Record<string, BodyInit>, calls: string[] = []) {
  return vi.fn(async (url: string) => {
    calls.push(url);
    const body = files[url];
    if (body === undefined) return new Response('nope', { status: 404 });
    const size = typeof body === 'string' ? new TextEncoder().encode(body).length : (body as ArrayBuffer).byteLength;
    return new Response(body, { status: 200, headers: { 'Content-Length': String(size) } });
  });
}

function allFiles(json: unknown = voiceJson): Record<string, BodyInit> {
  return {
    [`${BASE}/runtime/ort-wasm-simd-threaded.wasm`]: new Uint8Array(8).buffer,
    [`${BASE}/runtime/piper_phonemize.wasm`]: new Uint8Array(4).buffer,
    [`${BASE}/runtime/piper_phonemize.data`]: new Uint8Array(6).buffer,
    [VOICE_FILES[0]]: new Uint8Array(16).buffer,
    [VOICE_FILES[1]]: JSON.stringify(json),
  };
}

interface Rig {
  handlers: ReturnType<typeof createPiperHandlers>;
  cache: MemoryAssetCache;
  fetchFn: ReturnType<typeof fakeFetch>;
  fetched: string[];
  feeds: Array<Record<string, { type: string; data: unknown; dims?: readonly number[] }>>;
  ort: OrtLike;
  phonemizerCalls: Array<{ args: string[]; options: PhonemizerOptions }>;
  sessionsCreated: number;
  released: number;
}

function rig(opts: { files?: Record<string, BodyInit>; phonemizerLines?: string[]; output?: unknown } = {}): Rig {
  const cache = new MemoryAssetCache();
  const fetched: string[] = [];
  const fetchFn = fakeFetch(opts.files ?? allFiles(), fetched);
  const r = { cache, fetchFn, fetched, feeds: [], phonemizerCalls: [], sessionsCreated: 0, released: 0 } as unknown as Rig;
  class Tensor { constructor(public type: string, public data: unknown, public dims?: readonly number[]) {} }
  r.ort = {
    env: { wasm: {} },
    InferenceSession: {
      async create() {
        r.sessionsCreated++;
        return {
          async run(feeds: Record<string, never>) { r.feeds.push(feeds); return { output: { data: opts.output ?? new Float32Array([0.1, -0.2, 0.3, 0.4]) } }; },
          release() { r.released++; },
        };
      },
    },
    Tensor,
  } as unknown as OrtLike;
  const lines = opts.phonemizerLines ?? [JSON.stringify({ phonemes: ['a', ' ', 'b', '?'] })];
  const createPhonemizer: CreatePhonemizer = async options => ({
    callMain(args) { r.phonemizerCalls.push({ args, options }); for (const l of lines) options.print(l); },
  });
  r.handlers = createPiperHandlers({
    cache, fetchFn, importOrt: async () => r.ort, importPhonemizer: async () => createPhonemizer,
  });
  return r;
}

describe('phoneme helpers', () => {
  it('maps phonemes through the voice table: BOS, PAD, (phoneme, PAD)*, EOS per sentence, skipping unknown ones', () => {
    const map = voiceJson.phoneme_id_map;
    expect(phonemesToIds([['a', 'b', 'zz']], map)).toEqual([1, 0, 10, 0, 11, 12, 0, 2]);
    expect(phonemesToIds([['a'], ['b']], map)).toEqual([1, 0, 10, 0, 2, 1, 0, 11, 12, 0, 2]);
    expect(phonemesToIds([], map)).toEqual([]);
  });

  it('splits sentences on terminators followed by space, keeping unterminated text whole', () => {
    expect(splitSentences('In the beginning. And God said! Why? Because')).toEqual(['In the beginning.', 'And God said!', 'Why?', 'Because']);
    expect(splitSentences('  one  ')).toEqual(['one']);
    expect(splitSentences('   ')).toEqual([]);
  });

  it('reads a voice file and rejects one that is not a Piper voice', () => {
    const c = parseVoiceConfig(voiceJson);
    expect(c).toMatchObject({ espeakVoice: 'en-us', sampleRate: 16000, noiseScale: 0.5, lengthScale: 1.2, noiseW: 0.8, multiSpeaker: false });
    expect(parseVoiceConfig({ ...voiceJson, speaker_id_map: { a: 0 } }).multiSpeaker).toBe(true);
    expect(() => parseVoiceConfig({})).toThrow();
    expect(() => parseVoiceConfig({ ...voiceJson, phoneme_id_map: { a: [1] } })).toThrow();
  });
});

describe('createPiperHandlers', () => {
  it('prepare downloads runtime and voice once, reports progress, and stores them in the cache', async () => {
    const r = rig();
    await r.handlers.init({ assetBase: BASE });
    const progress: LoadProgress[] = [];
    await r.handlers.prepare('v', { files: VOICE_FILES }, p => progress.push(p), signal());
    expect(r.fetched.length).toBe(5);
    for (const url of [...VOICE_FILES, `${BASE}/runtime/piper_phonemize.data`]) expect(await r.cache.has(url)).toBe(true);
    expect(progress.at(-1)).toMatchObject({ phase: 'voice' });
    expect(progress.at(-1)!.loaded).toBeGreaterThan(0);
    expect(r.sessionsCreated).toBe(1);
    // The runtime is configured for self-hosting, one thread, with the wasm bytes we hold.
    expect(r.ort.env.wasm.wasmPaths).toBe(`${BASE}/runtime/`);
    expect(r.ort.env.wasm.numThreads).toBe(1);
    expect((r.ort.env.wasm.wasmBinary as ArrayBuffer).byteLength).toBe(8);
    // Preparing the same voice again downloads and creates nothing.
    await r.handlers.prepare('v', { files: VOICE_FILES }, () => {}, signal());
    expect(r.fetched.length).toBe(5);
    expect(r.sessionsCreated).toBe(1);
  });

  it('a second engine start finds everything in the cache and never touches the network', async () => {
    const first = rig();
    await first.handlers.init({ assetBase: BASE });
    await first.handlers.prepare('v', { files: VOICE_FILES }, () => {}, signal());
    const second = rig();
    const again = createPiperHandlers({
      cache: first.cache, fetchFn: vi.fn(async () => { throw new TypeError('offline'); }) as never,
      importOrt: async () => second.ort, importPhonemizer: async () => async () => ({ callMain() {} }),
    });
    await again.init({ assetBase: BASE });
    await expect(again.prepare('v', { files: VOICE_FILES }, () => {}, signal())).resolves.toBeUndefined();
  });

  it('a failed download is an error the caller can show, and stores nothing', async () => {
    const files = allFiles();
    delete files[VOICE_FILES[0]];
    const r = rig({ files });
    await r.handlers.init({ assetBase: BASE });
    await expect(r.handlers.prepare('v', { files: VOICE_FILES }, () => {}, signal())).rejects.toMatchObject({ code: 'not-found' });
    expect(await r.cache.has(VOICE_FILES[1])).toBe(false);
  });

  it('synthesize phonemizes per sentence and feeds the model with the voice scales divided by the rate', async () => {
    const r = rig({ phonemizerLines: [JSON.stringify({ phonemes: ['a', 'b'] }), JSON.stringify({ phonemes: ['b'] })] });
    await r.handlers.init({ assetBase: BASE });
    await r.handlers.prepare('v', { files: VOICE_FILES }, () => {}, signal());
    const out = await r.handlers.synthesize({ text: 'One. Two.', voiceId: 'v', rate: 2 }, signal());
    expect(out.sampleRate).toBe(16000);
    expect(Array.from(out.pcm)).toEqual([expect.closeTo(0.1), expect.closeTo(-0.2), expect.closeTo(0.3), expect.closeTo(0.4)]);
    const call = r.phonemizerCalls[0];
    expect(call.args.slice(0, 2)).toEqual(['-l', 'en-us']);
    expect(JSON.parse(call.args[3])).toEqual([{ text: 'One.' }, { text: 'Two.' }]);
    const feeds = r.feeds[0];
    expect(Array.from(feeds.input.data as BigInt64Array)).toEqual([1n, 0n, 10n, 0n, 11n, 12n, 0n, 2n, 1n, 0n, 11n, 12n, 0n, 2n]);
    expect(feeds.input.dims).toEqual([1, 14]);
    expect(Array.from(feeds.input_lengths.data as BigInt64Array)).toEqual([14n]);
    expect(Array.from(feeds.scales.data as Float32Array)).toEqual([expect.closeTo(0.5), expect.closeTo(0.6), expect.closeTo(0.8)]);
    expect(feeds.sid).toBeUndefined();
    // The phonemizer gets our bytes, not a URL to fetch.
    expect(call.options.getPreloadedPackage('piper_phonemize.data', 0)!.byteLength).toBe(6);
    expect(call.options.getPreloadedPackage('other', 0)).toBeNull();
    expect(call.options.wasmBinary.byteLength).toBe(4);
  });

  it('a multi-speaker voice gets a speaker id', async () => {
    const r = rig({ files: allFiles({ ...voiceJson, speaker_id_map: { p1: 0, p2: 1 } }) });
    await r.handlers.init({ assetBase: BASE });
    await r.handlers.prepare('v', { files: VOICE_FILES }, () => {}, signal());
    await r.handlers.synthesize({ text: 'One.', voiceId: 'v', rate: 1 }, signal());
    expect(r.feeds[0].sid).toBeDefined();
  });

  it('returns silence for empty text without running the model, and an error when the phonemizer says nothing', async () => {
    const r = rig({ phonemizerLines: [] });
    await r.handlers.init({ assetBase: BASE });
    await r.handlers.prepare('v', { files: VOICE_FILES }, () => {}, signal());
    const silent = await r.handlers.synthesize({ text: '   ', voiceId: 'v', rate: 1 }, signal());
    expect(silent.pcm.length).toBeGreaterThan(0);
    expect(r.feeds.length).toBe(0);
    await expect(r.handlers.synthesize({ text: 'Hello.', voiceId: 'v', rate: 1 }, signal())).rejects.toMatchObject({ code: 'engine' });
  });

  it('an aborted request does not run the model', async () => {
    const r = rig();
    await r.handlers.init({ assetBase: BASE });
    await r.handlers.prepare('v', { files: VOICE_FILES }, () => {}, signal());
    const ctrl = new AbortController();
    ctrl.abort();
    await expect(r.handlers.synthesize({ text: 'Hello.', voiceId: 'v', rate: 1 }, ctrl.signal)).rejects.toMatchObject({ code: 'aborted' });
    expect(r.feeds.length).toBe(0);
  });

  it('an unprepared voice is refused; evict releases the session', async () => {
    const r = rig();
    await r.handlers.init({ assetBase: BASE });
    await expect(r.handlers.synthesize({ text: 'Hi.', voiceId: 'v', rate: 1 }, signal())).rejects.toMatchObject({ code: 'unsupported' });
    await r.handlers.prepare('v', { files: VOICE_FILES }, () => {}, signal());
    await r.handlers.evict('v');
    expect(r.released).toBe(1);
    await expect(r.handlers.synthesize({ text: 'Hi.', voiceId: 'v', rate: 1 }, signal())).rejects.toMatchObject({ code: 'unsupported' });
  });

  it('keeps one voice in memory and reloads another from the cache without downloading', async () => {
    const files = allFiles();
    const otherFiles = [`${BASE}/voices/w.onnx`, `${BASE}/voices/w.onnx.json`];
    files[otherFiles[0]] = new Uint8Array(16).buffer;
    files[otherFiles[1]] = JSON.stringify(voiceJson);
    const r = rig({ files });
    await r.handlers.init({ assetBase: BASE });
    await r.handlers.prepare('v', { files: VOICE_FILES }, () => {}, signal());
    await r.handlers.prepare('w', { files: otherFiles }, () => {}, signal());
    expect(r.released).toBe(1);
    const before = r.fetched.length;
    await r.handlers.synthesize({ text: 'Hi.', voiceId: 'v', rate: 1 }, signal());
    expect(r.fetched.length).toBe(before);
    expect(r.sessionsCreated).toBe(3);
  });
});

describe('PiperEngine', () => {
  class FakeWorker implements WorkerLike {
    onmessage: ((e: { data: TtsWorkerReply }) => void) | null = null;
    onerror = null; onmessageerror = null;
    private listeners: Array<(e: { data: TtsWorkerRequest }) => void> = [];
    scope: WorkerScopeLike = {
      postMessage: m => { queueMicrotask(() => this.onmessage?.({ data: m })); },
      addEventListener: (_t, l) => { this.listeners.push(l); },
    };
    postMessage(m: TtsWorkerRequest) { queueMicrotask(() => this.listeners.forEach(l => l({ data: m }))); }
    terminate() {}
  }

  it('drives the real handlers through the real worker protocol: download, ready, synthesize, evict', async () => {
    const r = rig();
    const worker = new FakeWorker();
    serveTtsWorker(worker.scope, r.handlers);
    const engine = new PiperEngine(
      { id: 'piper', enabled: true, assetBase: BASE, voices: [{ id: 'v', label: 'V', language: 'en-US', files: ['voices/v.onnx', 'voices/v.onnx.json'] }] },
      { createWorker: () => worker, cache: r.cache },
    );
    expect(await engine.isVoiceReady('v')).toBe(false);
    await engine.prepare('v', () => {}, signal());
    expect(await engine.isVoiceReady('v')).toBe(true);
    const out = await engine.synthesize({ text: 'One.', voiceId: 'v', rate: 1 }, signal());
    expect(out.pcm.length).toBe(4);
    await engine.evictVoice('v');
    expect(await r.cache.has(VOICE_FILES[0])).toBe(false);
    // The shared runtime stays, so the next voice does not download it again.
    expect(await r.cache.has(`${BASE}/runtime/piper_phonemize.data`)).toBe(true);
    expect(await engine.isVoiceReady('v')).toBe(false);
  });

  it('declares its capabilities without loading anything, and a voice with no files is never ready', async () => {
    const engine = new PiperEngine({ id: 'piper', enabled: true, assetBase: BASE, voices: [{ id: 'x', label: 'X', language: 'en', files: [] }] }, { cache: new MemoryAssetCache() });
    expect(engine.capabilities.rate).toEqual({ min: 0.5, max: 2, step: 0.1 });
    expect(engine.capabilities.nativeRate).toBe(true);
    expect(await engine.isVoiceReady('x')).toBe(false);
  });
});
