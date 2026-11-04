/**
 * What runs inside the Piper worker, with every outside dependency injected so
 * it can be tested without a browser: the cache, `fetch`, and the two dynamic
 * imports (ONNX Runtime and the espeak-ng phonemizer). `piperWorker.ts` supplies
 * the real ones.
 *
 * ## The algorithm (ported from `@diffusionstudio/vits-web` 1.0.3, MIT)
 *
 * 1. Phonemize: run the Emscripten build of `piper_phonemize` with
 *    `-l <espeak voice> --input [{"text": ...}, ...] --espeak_data /espeak-ng-data`,
 *    one entry per sentence. It prints one JSON line per entry with the espeak
 *    `phonemes`. (It also prints `phoneme_ids`, but from a default table:
 *    `vits-web` feeds those to the model, which fails for a voice trained with
 *    a different symbol table, e.g. `en_US-amy-low` has 130 symbols. We map the
 *    phonemes through the voice's own `phoneme_id_map`, as Piper itself does:
 *    BOS, PAD, then each phoneme followed by PAD, then EOS, per sentence.)
 * 2. Infer: feed `input` (int64 [1, n]), `input_lengths` (int64 [n]) and `scales`
 *    (float32 [noise_scale, length_scale, noise_w]), plus `sid` for a
 *    multi-speaker model, to an ONNX Runtime session over the voice's `.onnx`.
 *    `output` is float32 PCM at the voice's sample rate.
 * 3. Speed is `length_scale / rate`: the model stretches phonemes, so there are
 *    no pitch artefacts.
 *
 * The phonemizer module is created afresh for every request (`callMain` may run
 * once per instance). Its wasm and espeak data are handed over as bytes we
 * already hold, so a request touches neither the network nor the cache.
 *
 * ## Storage
 *
 * The runtime's binary files and the voice files live in the models cache
 * (keyed by URL, the same key `PiperEngine` checks), so a voice downloaded once
 * works offline and across reloads. Only the two small JavaScript modules are
 * loaded by URL (the browser's HTTP cache, or the service worker in a PWA build).
 */

import {
  parsePhonemizerLines, parseVoiceConfig, phonemesToIds, piperPhonemizerArgs, piperScales, piperSilenceSamples, splitSentences,
  type AudioError, type IAssetCache, type LoadProgress, type PiperVoiceConfig, type SynthesisRequest,
} from '@bible/core/browser';
import type { SynthesizeValue, TtsWorkerHandlers } from '../ttsWorkerProtocol';
import { PIPER_RUNTIME_DIR, PIPER_RUNTIME_FILES, joinUrl } from './piperConfig';

export interface PiperInitPayload { assetBase: string }
export interface PiperPreparePayload { files: string[] }

// -- the slices of ONNX Runtime and the phonemizer this file uses ------------

export interface OrtSessionLike {
  run(feeds: Record<string, unknown>): Promise<Record<string, { data: unknown }>>;
  release?(): Promise<void> | void;
}

export interface OrtLike {
  env: { wasm: { numThreads?: number; wasmPaths?: string; wasmBinary?: ArrayBuffer | Uint8Array } };
  InferenceSession: { create(bytes: Uint8Array, options?: unknown): Promise<OrtSessionLike> };
  Tensor: new (type: string, data: unknown, dims?: readonly number[]) => unknown;
}

export interface PhonemizerModuleLike { callMain(args: string[]): unknown }

export interface PhonemizerOptions {
  print(line: string): void;
  printErr(line: string): void;
  locateFile(file: string): string;
  wasmBinary: ArrayBuffer;
  getPreloadedPackage(name: string, size: number): ArrayBuffer | null;
}
export type CreatePhonemizer = (options: PhonemizerOptions) => Promise<PhonemizerModuleLike>;

export interface PiperDeps {
  cache: IAssetCache;
  fetchFn(url: string, init?: { signal?: AbortSignal }): Promise<Response>;
  importOrt(url: string): Promise<OrtLike>;
  importPhonemizer(url: string): Promise<CreatePhonemizer>;
  /** Threads for ONNX Runtime; more than one needs cross-origin isolation. Default 1. */
  threads?: number;
}

// The pure Piper pieces (voice config, phoneme ids, scales) live in core, shared with the native build tool.
export { parseVoiceConfig, phonemesToIds, splitSentences };
export type { PiperVoiceConfig };

interface LoadedVoice { session: OrtSessionLike; config: PiperVoiceConfig }

const engineError = (message: string, retryable = true): AudioError => ({ code: 'engine', message, retryable });

const aborted = (): AudioError => ({ code: 'aborted', message: 'Aborted', retryable: false });

export function createPiperHandlers(deps: PiperDeps): TtsWorkerHandlers {
  let base: string | null = null;
  let ort: OrtLike | null = null;
  let createPhonemizer: CreatePhonemizer | null = null;
  let phonemizerWasm: ArrayBuffer | null = null;
  let phonemizerData: ArrayBuffer | null = null;
  let ortWasm: ArrayBuffer | null = null;
  /** The voice in memory. Kept to one: a session is 60 MB or more, and only one voice speaks at a time. */
  let loaded: (LoadedVoice & { id: string }) | null = null;
  const voiceFiles = new Map<string, string[]>();

  const url = (file: string): string => {
    if (!base) throw engineError('The speech engine has not been initialised.');
    return joinUrl(base, file);
  };

  /** Bytes of `url` from the models cache; otherwise download, store and return them. */
  async function download(
    urls: string[],
    progress: ((p: LoadProgress) => void) | null,
    signal: AbortSignal | null,
  ): Promise<Map<string, ArrayBuffer>> {
    const out = new Map<string, ArrayBuffer>();
    const misses: string[] = [];
    for (const u of urls) {
      const hit = await deps.cache.get(u);
      if (hit?.ok) out.set(u, await hit.arrayBuffer());
      else misses.push(u);
    }
    if (misses.length === 0) return out;

    const responses = await Promise.all(misses.map(async u => {
      const res = await deps.fetchFn(u, signal ? { signal } : undefined);
      if (!res.ok) {
        throw { code: res.status === 404 ? 'not-found' : 'network', message: `Could not download ${u.split('/').pop()} (${res.status}).`, retryable: res.status !== 404 } satisfies AudioError;
      }
      return { u, res };
    }));
    const sizes = responses.map(({ res }) => Number(res.headers.get('Content-Length')));
    const total = sizes.every(s => Number.isFinite(s) && s > 0) ? sizes.reduce((a, b) => a + b, 0) : undefined;
    let got = 0;
    let lastReport = 0;
    const report = () => {
      const now = Date.now();
      if (now - lastReport < 100) return;
      lastReport = now;
      progress?.({ phase: 'voice', loaded: got, total });
    };

    await Promise.all(responses.map(async ({ u, res }) => {
      const chunks: Uint8Array[] = [];
      if (res.body) {
        const reader = res.body.getReader();
        for (;;) {
          if (signal?.aborted) { void reader.cancel(); throw aborted(); }
          const { done, value } = await reader.read();
          if (done) break;
          chunks.push(value);
          got += value.byteLength;
          report();
        }
      } else {
        const bytes = new Uint8Array(await res.arrayBuffer());
        chunks.push(bytes);
        got += bytes.byteLength;
      }
      if (signal?.aborted) throw aborted();
      const blob = new Blob(chunks as BlobPart[]);
      await deps.cache.put(u, new Response(blob, { headers: { 'Content-Type': res.headers.get('Content-Type') ?? 'application/octet-stream' } }));
      out.set(u, await blob.arrayBuffer());
    }));
    progress?.({ phase: 'voice', loaded: got, total: total ?? got });
    return out;
  }

  async function ensureRuntime(progress: ((p: LoadProgress) => void) | null, signal: AbortSignal | null): Promise<void> {
    if (ort && createPhonemizer && phonemizerWasm && phonemizerData && ortWasm) return;
    const urls = [PIPER_RUNTIME_FILES.ortWasm, PIPER_RUNTIME_FILES.phonemizerWasm, PIPER_RUNTIME_FILES.phonemizerData].map(url);
    const bytes = await download(urls, progress, signal);
    ortWasm = bytes.get(urls[0])!;
    phonemizerWasm = bytes.get(urls[1])!;
    phonemizerData = bytes.get(urls[2])!;
    if (!ort) {
      ort = await deps.importOrt(url(PIPER_RUNTIME_FILES.ortModule));
      ort.env.wasm.numThreads = deps.threads ?? 1;
      ort.env.wasm.wasmPaths = `${url(PIPER_RUNTIME_DIR)}/`;
      ort.env.wasm.wasmBinary = ortWasm;
    }
    if (!createPhonemizer) createPhonemizer = await deps.importPhonemizer(url(PIPER_RUNTIME_FILES.phonemizerModule));
  }

  async function loadVoice(voiceId: string, files: string[], progress: ((p: LoadProgress) => void) | null, signal: AbortSignal | null): Promise<void> {
    if (loaded?.id === voiceId) return;
    const onnxUrl = files.find(f => /\.onnx$/i.test(f));
    const jsonUrl = files.find(f => /\.onnx\.json$/i.test(f));
    if (!onnxUrl || !jsonUrl) throw engineError('The voice is missing its model or configuration file.', false);
    await ensureRuntime(progress, signal);
    const bytes = await download([onnxUrl, jsonUrl], progress, signal);
    if (signal?.aborted) throw aborted();
    let config: PiperVoiceConfig;
    try {
      config = parseVoiceConfig(JSON.parse(new TextDecoder().decode(bytes.get(jsonUrl)!)));
    } catch (e) {
      if ((e as AudioError)?.code) throw e;
      throw engineError('The voice configuration could not be read.', false);
    }
    const session = await ort!.InferenceSession.create(new Uint8Array(bytes.get(onnxUrl)!), { executionProviders: ['wasm'] });
    await releaseLoaded();
    loaded = { id: voiceId, session, config };
  }

  async function releaseLoaded(): Promise<void> {
    const old = loaded;
    loaded = null;
    try { await old?.session.release?.(); } catch { /* best effort */ }
  }

  /** The phonemes of each sentence, in order. */
  function phonemize(text: string, espeakVoice: string): Promise<string[][]> {
    const create = createPhonemizer!;
    return new Promise<string[][]>((resolve, reject) => {
      const lines: string[] = [];
      const errors: string[] = [];
      create({
        print: line => { lines.push(line); },
        printErr: line => { errors.push(line); },
        locateFile: file => url(file.endsWith('.wasm') ? PIPER_RUNTIME_FILES.phonemizerWasm : file.endsWith('.data') ? PIPER_RUNTIME_FILES.phonemizerData : `${PIPER_RUNTIME_DIR}/${file}`),
        wasmBinary: phonemizerWasm!,
        // The espeak data package, from the bytes we already hold.
        getPreloadedPackage: name => (name.endsWith('.data') ? phonemizerData : null),
      }).then(mod => {
        // callMain is synchronous and prints while it runs.
        mod.callMain(piperPhonemizerArgs(espeakVoice, text));
        const out = parsePhonemizerLines(lines);
        if (out.length === 0) reject(engineError(errors.at(-1) || 'The phonemizer produced no output.'));
        else resolve(out);
      }).catch(reject);
    });
  }

  return {
    async init(payload) {
      const p = payload as PiperInitPayload | undefined;
      if (!p || typeof p.assetBase !== 'string') throw engineError('The speech engine was not given its file location.', false);
      base = p.assetBase;
    },

    async prepare(voiceId, payload, progress, signal) {
      const files = (payload as PiperPreparePayload | undefined)?.files;
      if (!Array.isArray(files) || files.length === 0) throw engineError('The voice has no files configured.', false);
      voiceFiles.set(voiceId, files);
      await loadVoice(voiceId, files, progress, signal);
    },

    async synthesize(req: SynthesisRequest, signal: AbortSignal): Promise<SynthesizeValue> {
      // Another voice was prepared since (only one is kept in memory): load this one from
      // the cache. Never from the network: downloading is `prepare`'s job, with progress.
      if (loaded?.id !== req.voiceId) {
        const files = voiceFiles.get(req.voiceId);
        if (!files) throw { code: 'unsupported', message: 'The voice has not been prepared.', retryable: false } satisfies AudioError;
        await loadVoice(req.voiceId, files, null, signal);
      }
      const voice = loaded!;
      if (signal.aborted) throw aborted();
      const text = req.text.trim();
      if (!text) return { pcm: new Float32Array(piperSilenceSamples(voice.config)), sampleRate: voice.config.sampleRate };

      const ids = phonemesToIds(await phonemize(text, voice.config.espeakVoice), voice.config.phonemeIdMap);
      if (signal.aborted) throw aborted();
      if (ids.length === 0) return { pcm: new Float32Array(piperSilenceSamples(voice.config)), sampleRate: voice.config.sampleRate };

      const { Tensor } = ort!;
      const c = voice.config;
      const feeds: Record<string, unknown> = {
        input: new Tensor('int64', BigInt64Array.from(ids, n => BigInt(n)), [1, ids.length]),
        input_lengths: new Tensor('int64', BigInt64Array.from([BigInt(ids.length)]), [1]),
        scales: new Tensor('float32', piperScales(c, req.rate), [3]),
      };
      if (c.multiSpeaker) feeds.sid = new Tensor('int64', BigInt64Array.from([0n]), [1]);
      const result = await voice.session.run(feeds);
      const data = result.output?.data;
      if (!(data instanceof Float32Array)) throw engineError('The voice produced no audio.');
      // Own the buffer: it is transferred to the page, and ORT's may be a view onto wasm memory.
      return { pcm: new Float32Array(data), sampleRate: c.sampleRate };
    },

    async evict(voiceId) {
      voiceFiles.delete(voiceId);
      if (loaded?.id === voiceId) await releaseLoaded();
    },
  };
}
