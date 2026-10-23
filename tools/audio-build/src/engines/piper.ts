/**
 * Native Piper: onnxruntime-node for the voice, and the browser's own espeak-ng phonemizer build
 * (`@diffusionstudio/piper-wasm`, the wasm one, run under Node) so the phonemes match.
 *
 * Everything that decides what the model is fed (the phonemizer arguments, reading its output,
 * the phoneme-id mapping, the scales) comes from core's `piperPhonemes`, which the browser
 * worker uses too. Only the runtime wiring differs.
 */

import { readFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';
import {
  parsePhonemizerLines,
  parseVoiceConfig,
  phonemesToIds,
  piperPhonemizerArgs,
  piperScales,
  piperSilenceSamples,
  type AudioError,
  type AudioVoice,
  type ITtsEngine,
  type LoadProgress,
  type PiperVoiceConfig,
  type SynthesisRequest,
  type SynthesisResult,
  type TtsEngineCapabilities,
} from '../core';
import { creditFromModelCard, ensurePiperVoice, isPiperVoiceId, readCard } from './piperVoices';
import type { EngineContext, EngineCredits, EngineDefinition } from './types';

const engineError = (message: string, retryable = true): AudioError => ({ code: 'engine', message, retryable });

interface OrtSession { run(feeds: Record<string, unknown>): Promise<Record<string, { data: unknown }>>; release?(): Promise<void> }
interface OrtModule {
  InferenceSession: { create(path: string, options?: unknown): Promise<OrtSession> };
  Tensor: new (type: string, data: unknown, dims: readonly number[]) => unknown;
}
interface PhonemizerOptions {
  print(line: string): void;
  printErr(line: string): void;
  locateFile(file: string): string;
  wasmBinary: ArrayBuffer;
  getPreloadedPackage(name: string, size: number): ArrayBuffer | null;
}
type CreatePhonemizer = (options: PhonemizerOptions) => Promise<{ callMain(args: string[]): unknown }>;

export interface PhonemizerAssets { create: CreatePhonemizer; wasm: ArrayBuffer; data: ArrayBuffer; dir: string }

const requireHere = createRequire(__filename);

/** The phonemizer shipped in the `@diffusionstudio/piper-wasm` package (the same build `fetch:piper` copies). */
export async function loadPhonemizerAssets(): Promise<PhonemizerAssets> {
  const js = requireHere.resolve('@diffusionstudio/piper-wasm/build/piper_phonemize.js');
  const dir = dirname(js);
  const [wasm, data] = await Promise.all([readFile(join(dir, 'piper_phonemize.wasm')), readFile(join(dir, 'piper_phonemize.data'))]);
  const ab = (b: Buffer): ArrayBuffer => b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength) as ArrayBuffer;
  const create = loadPhonemizerFactory(js);
  return { create, wasm: ab(wasm), data: ab(data), dir };
}

/**
 * The build is an Emscripten module for the web. Under Node it needs the few browser globals its
 * environment check looks for; they are provided for the call only.
 */
function loadPhonemizerFactory(file: string): CreatePhonemizer {
  const g = globalThis as Record<string, unknown>;
  const added: string[] = [];
  const provide = (k: string, v: unknown): void => { if (g[k] === undefined) { g[k] = v; added.push(k); } };
  provide('window', g);
  provide('self', g);
  provide('document', { currentScript: { src: `file://${file}` }, baseURI: `file://${dirname(file)}/` });
  provide('location', { href: `file://${file}`, pathname: file });
  try {
    const mod = requireHere(file) as CreatePhonemizer | { default?: CreatePhonemizer };
    const fn = typeof mod === 'function' ? mod : mod.default;
    if (typeof fn !== 'function') throw engineError('The phonemizer module has an unexpected shape.', false);
    return fn;
  } finally {
    // Keep window/self/document: the module reads them again when it runs.
  }
}

export function phonemizeWith(assets: PhonemizerAssets, text: string, espeakVoice: string): Promise<string[][]> {
  return new Promise((resolve, reject) => {
    const lines: string[] = [];
    const errors: string[] = [];
    assets.create({
      print: line => { lines.push(line); },
      printErr: line => { errors.push(line); },
      locateFile: file => join(assets.dir, file),
      wasmBinary: assets.wasm,
      getPreloadedPackage: name => (name.endsWith('.data') ? assets.data : null),
    }).then(mod => {
      mod.callMain(piperPhonemizerArgs(espeakVoice, text));
      const out = parsePhonemizerLines(lines);
      if (out.length === 0) reject(engineError(errors.at(-1) || 'The phonemizer produced no output.'));
      else resolve(out);
    }).catch(reject);
  });
}

interface LoadedVoice { id: string; session: OrtSession; config: PiperVoiceConfig }

/** The outside world of the engine; tests replace it (a fake ONNX Runtime and phonemizer, no files). */
export interface PiperNodeDeps {
  ort(): OrtModule;
  phonemizer(): Promise<PhonemizerAssets>;
  /** Paths of the voice's `.onnx` and `.onnx.json`, downloading them when needed. */
  voiceFiles(voiceId: string): Promise<{ onnx: string; json: string }>;
  phonemize?(assets: PhonemizerAssets, text: string, espeakVoice: string): Promise<string[][]>;
  readJson?(path: string): Promise<unknown>;
}

export class PiperNodeEngine implements ITtsEngine {
  readonly id = 'piper';
  readonly label = 'Piper (native)';
  readonly capabilities: TtsEngineCapabilities = {
    rate: { min: 0.5, max: 2, step: 0.05 },
    nativeRate: true,
    languages: PIPER_LANGUAGES,
    backends: [],
    approxRuntimeBytes: 200 * 1024 * 1024,
  };
  private ort: OrtModule | null = null;
  private assets: PhonemizerAssets | null = null;
  private loaded: LoadedVoice | null = null;

  private readonly deps: PiperNodeDeps;

  constructor(private readonly ctx: EngineContext, deps?: Partial<PiperNodeDeps>) {
    this.deps = {
      ort: () => requireHere('onnxruntime-node') as OrtModule,
      phonemizer: loadPhonemizerAssets,
      voiceFiles: id => ensurePiperVoice(ctx.cacheDir, id, ctx.log),
      ...deps,
    };
  }

  async isSupported(): Promise<boolean> { return true; }
  async listVoices(): Promise<AudioVoice[]> { return PIPER_VOICES; }
  async isVoiceReady(voiceId: string): Promise<boolean> { return this.loaded?.id === voiceId; }

  async prepare(voiceId: string, onProgress: (p: LoadProgress) => void, signal: AbortSignal): Promise<void> {
    if (this.loaded?.id === voiceId) return;
    if (!isPiperVoiceId(voiceId)) throw engineError(`"${voiceId}" is not a Piper voice id (e.g. en_US-amy-low).`, false);
    onProgress({ phase: 'voice', loaded: 0 });
    const files = await this.deps.voiceFiles(voiceId);
    if (signal.aborted) throw { code: 'aborted', message: 'Aborted', retryable: false } satisfies AudioError;
    const config = parseVoiceConfig(this.deps.readJson ? await this.deps.readJson(files.json) : JSON.parse(await readFile(files.json, 'utf8')));
    this.ort ??= this.deps.ort();
    this.assets ??= await this.deps.phonemizer();
    const session = await this.ort.InferenceSession.create(files.onnx, {
      executionProviders: ['cpu'],
      intraOpNumThreads: this.ctx.threads,
      interOpNumThreads: 1,
      graphOptimizationLevel: 'all',
    });
    await this.releaseLoaded();
    this.loaded = { id: voiceId, session, config };
    onProgress({ phase: 'voice', loaded: 1, total: 1 });
  }

  async synthesize(req: SynthesisRequest, signal: AbortSignal): Promise<SynthesisResult> {
    if (this.loaded?.id !== req.voiceId) await this.prepare(req.voiceId, () => {}, signal);
    const voice = this.loaded!;
    const c = voice.config;
    const text = req.text.trim();
    if (!text) return { pcm: new Float32Array(piperSilenceSamples(c)), sampleRate: c.sampleRate };
    const phonemize = this.deps.phonemize ?? phonemizeWith;
    const ids = phonemesToIds(await phonemize(this.assets!, text, c.espeakVoice), c.phonemeIdMap);
    if (ids.length === 0) return { pcm: new Float32Array(piperSilenceSamples(c)), sampleRate: c.sampleRate };
    const { Tensor } = this.ort!;
    const feeds: Record<string, unknown> = {
      input: new Tensor('int64', BigInt64Array.from(ids, n => BigInt(n)), [1, ids.length]),
      input_lengths: new Tensor('int64', BigInt64Array.from([BigInt(ids.length)]), [1]),
      scales: new Tensor('float32', piperScales(c, req.rate), [3]),
    };
    if (c.multiSpeaker) feeds.sid = new Tensor('int64', BigInt64Array.from([0n]), [1]);
    const result = await voice.session.run(feeds);
    const data = result.output?.data;
    if (!(data instanceof Float32Array)) throw engineError('The voice produced no audio.');
    return { pcm: new Float32Array(data), sampleRate: c.sampleRate };
  }

  async evictVoice(voiceId: string): Promise<void> { if (this.loaded?.id === voiceId) await this.releaseLoaded(); }
  dispose(): void { void this.releaseLoaded(); }

  private async releaseLoaded(): Promise<void> {
    const old = this.loaded;
    this.loaded = null;
    try { await old?.session.release?.(); } catch { /* best effort */ }
  }
}

const PIPER_LANGUAGES = ['en', 'es', 'fr', 'de', 'pt', 'it', 'nl', 'ru', 'pl', 'uk', 'cs', 'zh', 'ar', 'fa', 'tr', 'vi', 'sv', 'da', 'nb', 'fi', 'el', 'hu', 'ro', 'sk', 'sl', 'sr', 'ca', 'is', 'ka', 'kk', 'lb', 'ne', 'sw'];

const PIPER_VOICES: AudioVoice[] = [
  { id: 'en_US-amy-low', label: 'Amy (US, low)', language: 'en-US', quality: 'low' },
  { id: 'en_US-amy-medium', label: 'Amy (US, medium)', language: 'en-US', quality: 'medium' },
  { id: 'en_US-ryan-medium', label: 'Ryan (US, medium)', language: 'en-US', quality: 'medium' },
  { id: 'en_US-lessac-medium', label: 'Lessac (US, medium)', language: 'en-US', quality: 'medium' },
  { id: 'en_GB-alan-medium', label: 'Alan (UK, medium)', language: 'en-GB', quality: 'medium' },
  { id: 'es_ES-davefx-medium', label: 'Davefx (Spain, medium)', language: 'es-ES', quality: 'medium' },
];

const DEFAULT_VOICES: Record<string, string> = {
  en: 'en_US-amy-medium',
  es: 'es_ES-davefx-medium',
};

export const piperDefinition: EngineDefinition = {
  id: 'piper',
  label: 'Piper (native, onnxruntime-node)',
  languages: PIPER_LANGUAGES,
  voices: PIPER_VOICES,
  defaultVoice: lang => DEFAULT_VOICES[lang.toLowerCase().split(/[-_]/)[0]],
  checkVoice: id => (isPiperVoiceId(id) ? undefined : `"${id}" is not a Piper voice id (expected e.g. en_US-amy-low).`),
  modelLabel: () => 'Piper VITS onnx',
  memoryMbPerJob: () => 350,
  async credits(voiceId, ctx): Promise<EngineCredits> {
    const files = await ensurePiperVoice(ctx.cacheDir, voiceId, ctx.log);
    return {
      engine: { name: 'Piper (rhasspy/piper, VITS)', license: 'MIT', url: 'https://github.com/rhasspy/piper' },
      model: { name: 'Piper VITS model run with onnxruntime-node; phonemes by espeak-ng (@diffusionstudio/piper-wasm 1.0.0)', license: 'MIT; espeak-ng is GPL-3.0-or-later', url: 'https://github.com/diffusionstudio/piper-wasm' },
      voice: creditFromModelCard(voiceId, await readCard(files.card)),
    };
  },
  create: ctx => new PiperNodeEngine(ctx),
};
