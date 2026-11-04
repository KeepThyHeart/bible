/**
 * `ISttEngine` over a Whisper Web Worker (transformers.js, fully on-device).
 *
 * Mirrors `WorkerTtsEngine`: one lazily created module worker, request ids, progress replies.
 * - Abort: the call rejects at once, a `cancel` is posted and a late reply is dropped (the loaded
 *   model is kept).
 * - Crash, stall or undeliverable message: every pending call rejects, the worker is terminated and
 *   the next call creates a new one, re-inits and reloads the model from the installed files.
 * - One request at a time (`prepare` and `transcribe` share a queue).
 * Transcripts and audio are never logged.
 */

import type { ISttEngine, LoadProgress, SpeechBias, SttCapabilities, SttModel, Transcript } from '@bible/core/speech';
import { wasmThreads } from '../models/device';
import { WHISPER_MODELS, WHISPER_PINS, WHISPER_VARIANTS, assetIdFor, whisperFilePaths } from '../models/whisperModels';
import type { SpeechDevice, WhisperModelId, WhisperVariant } from '../types';
import { promptFor } from './biasPrompt';
import type { IModelFileSource } from './modelFiles';
import {
  WhisperWorkerError,
  type TranscribeValue,
  type WhisperDevice,
  type WhisperDtype,
  type WhisperProgress,
  type WhisperReply,
  type WhisperRequest,
  type WhisperRequestBody,
} from './whisperProtocol';

/** The slice of `Worker` this class uses. */
export interface WorkerLike {
  postMessage(message: WhisperRequest, transfer?: Transferable[]): void;
  terminate(): void;
  onmessage: ((e: { data: WhisperReply }) => void) | null;
  onerror: ((e: unknown) => void) | null;
  onmessageerror: ((e: unknown) => void) | null;
}

export interface WhisperEngineOptions {
  files: IModelFileSource;
  /** Where the ONNX runtime wasm files are served (a URL ending in `/`). */
  ortBase: string;
  device: () => Promise<SpeechDevice>;
  createWorker?: () => WorkerLike;
  /** A load that reports no progress for this long is treated as wedged. Default 120 s. */
  loadIdleTimeoutMs?: number;
  /** `transcribe` timeout = base + perAudioSecond * seconds. Defaults 30 s + 5 s per second of audio. */
  transcribeTimeoutMs?: { base: number; perAudioSecond: number };
}

/** Primary subtags Whisper supports. Memory still checks its own language kit. */
export const WHISPER_LANGUAGES = (
  'en zh de es ru ko fr ja pt tr pl ca nl ar sv it id hi fi vi he uk el ms cs ro da hu ta no th ur hr bg lt la mi ml ' +
  'cy sk te fa lv bn sr az sl kn et mk br eu is hy ne mn bs kk sq sw gl mr pa si km sn yo so af oc ka be tg sd gu am ' +
  'yi lo uz fo ht ps tk nn mt sa lb my bo tl mg as tt haw ln ha ba jw su'
).split(' ');

const MODEL_QUALITY: Record<WhisperModelId, SttModel['quality']> = { base: 'medium', tiny: 'low' };

interface Pending {
  resolve(value: unknown): void;
  reject(error: Error): void;
  onProgress?: (p: WhisperProgress) => void;
  timer?: ReturnType<typeof setTimeout>;
  idleMs?: number;
  /** (Re)start the idle window; called on progress. */
  arm?: () => void;
}

interface Active {
  model: WhisperModelId;
  device: SpeechDevice;
  variant: WhisperVariant;
}

const engineError = (message: string) => new WhisperWorkerError('engine', message);
const abortedError = () => {
  const e = new WhisperWorkerError('aborted', 'Aborted');
  e.name = 'AbortError';
  return e;
};
const variantFor = (device: SpeechDevice): WhisperVariant => (device === 'webgpu' ? 'f16' : 'q8');
const splitWords = (text: string) => text.split(/\s+/).filter(Boolean).map((w) => ({ text: w }));

export class WhisperEngine implements ISttEngine {
  readonly id = 'whisper';
  readonly label = 'Whisper (on-device)';
  readonly capabilities: SttCapabilities = {
    streaming: false,
    partials: true,
    wordTimestamps: false,
    wordConfidence: false,
    biasing: 'prompt',
    onDevice: true,
    offline: true,
    needsDownload: true,
    languages: WHISPER_LANGUAGES,
  };

  private worker: WorkerLike | null = null;
  private ready: Promise<void> | null = null;
  /** What the current worker has loaded; null after a (re)start. */
  private loaded: Active | null = null;
  /** What the last `prepare` chose; reloaded into a new worker after a crash. */
  private active: Active | null = null;
  private nextId = 1;
  private readonly pending = new Map<number, Pending>();
  private queue: Promise<unknown> = Promise.resolve();
  private readonly loadIdleMs: number;
  private readonly tTimeout: { base: number; perAudioSecond: number };

  constructor(private readonly o: WhisperEngineOptions) {
    this.loadIdleMs = o.loadIdleTimeoutMs ?? 120_000;
    this.tTimeout = o.transcribeTimeoutMs ?? { base: 30_000, perAudioSecond: 5_000 };
  }

  async isSupported(): Promise<boolean> {
    const g = globalThis as Record<string, unknown>;
    const nav = g.navigator as { mediaDevices?: { getUserMedia?: unknown } } | undefined;
    return (
      typeof g.Worker === 'function' &&
      typeof g.WebAssembly === 'object' &&
      typeof g.AudioWorkletNode === 'function' &&
      typeof nav?.mediaDevices?.getUserMedia === 'function'
    );
  }

  async listModels(): Promise<SttModel[]> {
    const variant = variantFor(await this.o.device());
    return (Object.keys(WHISPER_MODELS) as WhisperModelId[]).map((id) => {
      const m = WHISPER_MODELS[id];
      const downloadBytes = whisperFilePaths(variant).reduce((n, p) => n + (WHISPER_PINS[m.repo]?.[p]?.size ?? 0), 0);
      return { id, label: m.label, languages: WHISPER_LANGUAGES, downloadBytes, quality: MODEL_QUALITY[id], license: m.license };
    });
  }

  async isModelReady(modelId: string): Promise<boolean> {
    const model = this.modelId(modelId);
    return this.o.files.isInstalled(assetIdFor(model, variantFor(await this.o.device())));
  }

  async prepare(modelId: string, onProgress: (p: LoadProgress) => void, signal: AbortSignal): Promise<void> {
    const model = this.modelId(modelId);
    return this.enqueue(signal, async () => {
      let device = await this.o.device();
      const files = this.o.files;
      const idOf = (d: SpeechDevice) => assetIdFor(model, variantFor(d));
      if (!(await files.isInstalled(idOf(device)))) await files.install(idOf(device), onProgress, signal);
      if (signal.aborted) throw abortedError();
      try {
        await this.loadModel({ model, device, variant: variantFor(device) }, onProgress, signal);
      } catch (err) {
        // A WebGPU session that cannot be created falls back to the q8 WASM build, if installed.
        if (device !== 'webgpu' || signal.aborted || !(await files.isInstalled(idOf('wasm')))) throw err;
        device = 'wasm';
        await this.loadModel({ model, device, variant: 'q8' }, onProgress, signal);
      }
    });
  }

  transcribe(pcm: Float32Array, req: { language: string; bias?: SpeechBias }, signal: AbortSignal): Promise<Transcript> {
    return this.enqueue(signal, async () => {
      const active = this.active;
      if (!active) throw new WhisperWorkerError('not-ready', 'Speech model not prepared');
      if (!this.loaded) await this.loadModel(active, () => undefined, signal); // worker restarted
      // Transfer a copy: the caller (listener) keeps its buffer.
      const copy = pcm.slice();
      const audioMs = Math.round((pcm.length / 16000) * 1000);
      const v = (await this.call(
        { op: 'transcribe', pcm: copy, language: req.language, prompt: promptFor(req.bias) },
        signal,
        { idleMs: this.tTimeout.base + this.tTimeout.perAudioSecond * (pcm.length / 16000), transfer: [copy.buffer] },
      )) as TranscribeValue;
      return {
        text: v.text,
        words: splitWords(v.text),
        final: true,
        engineId: this.id,
        modelId: active.model,
        audioMs,
        decodeMs: v.decodeMs,
      };
    });
  }

  dispose(): void {
    this.active = null;
    this.killWorker(engineError('The speech engine was disposed.'));
  }

  // ---------------------------------------------------------------------------------------------

  private modelId(id: string): WhisperModelId {
    if (!(id in WHISPER_MODELS)) throw new WhisperWorkerError('engine', `Unknown speech model "${id}"`);
    return id as WhisperModelId;
  }

  /** Run `fn` after earlier calls finish; reject at once if `signal` aborts while waiting. */
  private enqueue<T>(signal: AbortSignal, fn: () => Promise<T>): Promise<T> {
    if (signal.aborted) return Promise.reject(abortedError());
    const run = this.queue.then(() => {
      if (signal.aborted) throw abortedError();
      return fn();
    });
    this.queue = run.catch(() => undefined);
    return new Promise<T>((resolve, reject) => {
      const onAbort = () => reject(abortedError());
      signal.addEventListener('abort', onAbort, { once: true });
      run.then(resolve, reject).finally(() => signal.removeEventListener('abort', onAbort));
    });
  }

  private async loadModel(a: Active, onProgress: (p: LoadProgress) => void, signal: AbortSignal): Promise<void> {
    const assetId = assetIdFor(a.model, a.variant);
    const paths = whisperFilePaths(a.variant);
    const files: Record<string, ArrayBuffer> = {};
    let n = 0;
    onProgress({ phase: 'engine', loaded: 0, total: paths.length + 1 });
    for (const path of paths) {
      const bytes = await this.o.files.read(assetId, path);
      if (signal.aborted) throw abortedError();
      files[path] =
        bytes.byteOffset === 0 && bytes.byteLength === bytes.buffer.byteLength ? (bytes.buffer as ArrayBuffer) : (bytes.slice().buffer as ArrayBuffer);
      onProgress({ phase: 'engine', loaded: ++n, total: paths.length + 1 });
    }
    const device: WhisperDevice = a.device;
    const dtype: WhisperDtype = { ...WHISPER_VARIANTS[a.variant].dtype };
    await this.call(
      { op: 'load', modelId: assetId, device, dtype, files },
      signal,
      { idleMs: this.loadIdleMs, transfer: Object.values(files), onProgress: () => onProgress({ phase: 'engine', loaded: paths.length, total: paths.length + 1 }) },
    );
    onProgress({ phase: 'engine', loaded: paths.length + 1, total: paths.length + 1 });
    this.active = a;
    this.loaded = a;
  }

  private createWorker(): WorkerLike {
    if (this.o.createWorker) return this.o.createWorker();
    return new Worker(new URL('./whisperWorker.ts', import.meta.url), { type: 'module' }) as unknown as WorkerLike;
  }

  private async ensureWorker(): Promise<WorkerLike> {
    if (!this.worker) {
      const worker = this.createWorker();
      this.worker = worker;
      this.loaded = null;
      worker.onmessage = (e) => this.onReply(worker, e.data);
      worker.onerror = () => this.crash(worker, 'The speech engine crashed.');
      worker.onmessageerror = () => this.crash(worker, 'The speech engine sent an unreadable message.');
      const cores = (globalThis.navigator as { hardwareConcurrency?: number } | undefined)?.hardwareConcurrency;
      this.ready = this.rawCall(
        worker,
        { op: 'init', ortBase: this.o.ortBase, numThreads: wasmThreads(!!(globalThis as { crossOriginIsolated?: boolean }).crossOriginIsolated, cores) },
        { idleMs: this.loadIdleMs },
      ).then(() => undefined);
      this.ready.catch(() => { if (this.worker === worker) this.killWorker(engineError('The speech engine failed to start.')); });
    }
    const worker = this.worker;
    await this.ready;
    if (worker !== this.worker) throw engineError('The speech engine restarted.');
    return worker;
  }

  private async call(
    body: WhisperRequestBody,
    signal: AbortSignal,
    opts: { onProgress?: (p: WhisperProgress) => void; idleMs?: number; transfer?: Transferable[] } = {},
  ): Promise<unknown> {
    if (signal.aborted) throw abortedError();
    const worker = await this.ensureWorker();
    if (signal.aborted) throw abortedError();
    return this.rawCall(worker, body, { ...opts, signal });
  }

  private rawCall(
    worker: WorkerLike,
    body: WhisperRequestBody,
    opts: { onProgress?: (p: WhisperProgress) => void; idleMs?: number; transfer?: Transferable[]; signal?: AbortSignal },
  ): Promise<unknown> {
    const id = this.nextId++;
    return new Promise((resolve, reject) => {
      const entry: Pending = { resolve, reject, onProgress: opts.onProgress, idleMs: opts.idleMs };
      const arm = () => {
        if (entry.timer) clearTimeout(entry.timer);
        if (entry.idleMs) entry.timer = setTimeout(() => this.crash(worker, 'The speech engine stopped responding.'), entry.idleMs);
      };
      const finish = () => { if (entry.timer) clearTimeout(entry.timer); opts.signal?.removeEventListener('abort', onAbort); };
      entry.resolve = (v) => { finish(); resolve(v); };
      entry.reject = (e) => { finish(); reject(e); };
      const onAbort = () => {
        if (!this.pending.delete(id)) return;
        finish();
        try { worker.postMessage({ id: this.nextId++, op: 'cancel', target: id }); } catch { /* worker gone */ }
        reject(abortedError());
      };
      opts.signal?.addEventListener('abort', onAbort, { once: true });
      this.pending.set(id, entry);
      arm();
      entry.arm = arm;
      try {
        worker.postMessage({ ...body, id } as WhisperRequest, opts.transfer);
      } catch {
        this.pending.delete(id);
        finish();
        this.crash(worker, 'The speech engine could not be reached.');
        reject(engineError('The speech engine could not be reached.'));
      }
    });
  }

  private onReply(worker: WorkerLike, msg: WhisperReply): void {
    if (worker !== this.worker) return;
    const entry = this.pending.get(msg.id);
    if (!entry) return; // a late reply for an aborted or timed-out call
    if (msg.kind === 'progress') {
      entry.onProgress?.(msg.p);
      entry.arm?.(); // progress proves the worker is alive
      return;
    }
    this.pending.delete(msg.id);
    if (msg.kind === 'ok') entry.resolve(msg.value);
    else entry.reject(msg.error.code === 'aborted' ? abortedError() : new WhisperWorkerError(msg.error.code, msg.error.message));
  }

  private crash(worker: WorkerLike, message: string): void {
    if (worker !== this.worker) return;
    this.killWorker(engineError(message));
  }

  private killWorker(error: Error): void {
    const worker = this.worker;
    this.worker = null;
    this.ready = null;
    this.loaded = null;
    const doomed = [...this.pending.values()];
    this.pending.clear();
    if (worker) {
      worker.onmessage = null;
      worker.onerror = null;
      worker.onmessageerror = null;
      try { worker.terminate(); } catch { /* already gone */ }
    }
    for (const p of doomed) p.reject(error);
  }
}
