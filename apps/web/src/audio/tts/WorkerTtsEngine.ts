/**
 * `ITtsEngine` over a Web Worker: everything about running an engine off the
 * main thread that does not depend on which engine it is.
 *
 * A concrete engine (Piper now, Kokoro later) extends this and supplies four
 * things: `createWorker()`, `initPayload()`, and how to tell whether a voice is
 * already stored (`isVoiceCached`) and how to delete it (`deleteCachedVoice`).
 * Its worker entry point calls `serveTtsWorker` with a handler table. Nothing
 * else in this class changes between engines.
 *
 * ## Abort: ignore the late result, keep the worker
 *
 * Inference cannot be interrupted, and killing the worker would throw away a
 * loaded 20-110 MB model. So an aborted call rejects immediately, a `cancel` is
 * posted (the worker skips it if still queued, or aborts a download), and a
 * reply that arrives later for an unknown id is dropped.
 *
 * ## Crashes and timeouts
 *
 * A worker error, a message that cannot be delivered, or a request that stops
 * making progress rejects every pending call (retryable) and terminates the
 * worker. The next call creates a new one, runs `init` again and re-prepares
 * the voice before synthesizing.
 */

import type {
  AudioError,
  AudioVoice,
  ITtsEngine,
  LoadProgress,
  SynthesisRequest,
  SynthesisResult,
  TtsEngineCapabilities,
  TtsEngineConfig,
} from '@bible/core/browser';
import { abortedError, toTtsError } from './ttsErrors';
import type { SynthesizeValue, TtsWorkerReply, TtsWorkerRequest, TtsWorkerRequestBody } from './ttsWorkerProtocol';

/** The slice of `Worker` this class uses. */
export interface WorkerLike {
  postMessage(message: TtsWorkerRequest): void;
  terminate(): void;
  onmessage: ((e: { data: TtsWorkerReply }) => void) | null;
  onerror: ((e: unknown) => void) | null;
  onmessageerror: ((e: unknown) => void) | null;
}

export interface WorkerTtsEngineOptions {
  /** A synthesize call this long without a reply is treated as a wedged worker. Default 60 s. */
  synthesizeTimeoutMs?: number;
  /** A prepare (download) that reports no progress for this long is treated as stalled. Default 60 s. */
  prepareIdleTimeoutMs?: number;
}

interface Pending {
  resolve(value: unknown): void;
  reject(error: AudioError): void;
  onProgress?: (p: LoadProgress) => void;
  timer?: ReturnType<typeof setTimeout>;
  timeoutMs?: number;
}

const engineError = (message: string): AudioError => ({ code: 'engine', message, retryable: true });

export abstract class WorkerTtsEngine implements ITtsEngine {
  abstract readonly id: string;
  abstract readonly label: string;
  abstract readonly capabilities: TtsEngineCapabilities;

  private worker: WorkerLike | null = null;
  private ready: Promise<void> | null = null;
  private nextId = 1;
  private readonly pending = new Map<number, Pending>();
  private readonly readyVoices = new Set<string>();
  private readonly synthesizeTimeoutMs: number;
  private readonly prepareIdleTimeoutMs: number;

  constructor(protected readonly config: TtsEngineConfig, opts: WorkerTtsEngineOptions = {}) {
    this.synthesizeTimeoutMs = opts.synthesizeTimeoutMs ?? 60_000;
    this.prepareIdleTimeoutMs = opts.prepareIdleTimeoutMs ?? 60_000;
  }

  // -- for the concrete engine ---------------------------------------------------
  protected abstract createWorker(): WorkerLike;
  protected abstract initPayload(): unknown;
  protected abstract isVoiceCached(voiceId: string): Promise<boolean>;
  protected abstract deleteCachedVoice(voiceId: string): Promise<void>;
  /** Extra capability checks (WebGPU, memory). Default: none. */
  protected async extraSupportCheck(): Promise<boolean> { return true; }
  /** The `prepare` payload for a voice (its file list); default: the configured files. */
  protected preparePayload(voiceId: string): unknown {
    return { files: this.config.voices.find(v => v.id === voiceId)?.files ?? [], assetBase: this.config.assetBase };
  }

  // -- ITtsEngine ----------------------------------------------------------------

  async isSupported(): Promise<boolean> {
    if (typeof Worker === 'undefined' || typeof WebAssembly !== 'object') return false;
    try { return await this.extraSupportCheck(); } catch { return false; }
  }

  async listVoices(): Promise<AudioVoice[]> {
    return this.config.voices.map(({ files: _files, ...voice }) => voice);
  }

  async isVoiceReady(voiceId: string): Promise<boolean> {
    return this.readyVoices.has(voiceId) || this.isVoiceCached(voiceId);
  }

  async prepare(voiceId: string, onProgress: (p: LoadProgress) => void, signal: AbortSignal): Promise<void> {
    await this.call({ op: 'prepare', voiceId, payload: this.preparePayload(voiceId) }, signal, {
      onProgress, idleTimeoutMs: this.prepareIdleTimeoutMs,
    });
    this.readyVoices.add(voiceId);
  }

  async synthesize(req: SynthesisRequest, signal: AbortSignal): Promise<SynthesisResult> {
    if (signal.aborted) throw abortedError();
    // A worker recreated after a crash has forgotten its voice. Loading a voice that
    // is already stored is quick and silent; downloading one is not something a
    // background synthesis may start, so a voice that is not stored is an error.
    if (!this.readyVoices.has(req.voiceId)) {
      if (!(await this.isVoiceCached(req.voiceId))) {
        throw { code: 'unsupported', message: 'The voice is not downloaded.', retryable: false } satisfies AudioError;
      }
      await this.prepare(req.voiceId, () => {}, signal);
    }
    const value = await this.call({ op: 'synthesize', req }, signal, { timeoutMs: this.synthesizeTimeoutMs }) as SynthesizeValue;
    return { pcm: value.pcm, sampleRate: value.sampleRate, sentences: value.sentences };
  }

  async evictVoice(voiceId: string): Promise<void> {
    this.readyVoices.delete(voiceId);
    if (this.worker) {
      await this.call({ op: 'evict', voiceId }, new AbortController().signal).catch(() => {});
    }
    await this.deleteCachedVoice(voiceId);
  }

  dispose(): void {
    const worker = this.worker;
    if (worker) {
      try { worker.postMessage({ id: this.nextId++, op: 'dispose' }); } catch { /* already gone */ }
    }
    this.killWorker(abortedError());
  }

  // -- plumbing ------------------------------------------------------------------

  private async ensureWorker(): Promise<WorkerLike> {
    if (!this.worker) {
      const worker = this.createWorker();
      worker.onmessage = e => this.onReply(worker, e.data);
      worker.onerror = () => this.crash(worker, 'The speech engine crashed.');
      worker.onmessageerror = () => this.crash(worker, 'The speech engine sent an unreadable message.');
      this.worker = worker;
      this.readyVoices.clear();
      // The one call timed from the moment it is posted (there is nothing ahead of
      // it to wait behind): a worker whose script never comes up must not hang the
      // caller for ever. A worker that does start reports progress, which restarts
      // the window (see `onReply`).
      this.ready = this.rawCall(worker, { op: 'init', payload: this.initPayload() }, {
        idleTimeoutMs: this.prepareIdleTimeoutMs, timeFromPost: true,
      }).then(() => undefined);
      this.ready.catch(() => { if (this.worker === worker) this.killWorker(engineError('The speech engine failed to start.')); });
    }
    const worker = this.worker;
    await this.ready;
    // A crash while we waited leaves no worker (or a new one still starting):
    // report it rather than hand back something else.
    if (!worker || worker !== this.worker) throw engineError('The speech engine restarted.');
    return worker;
  }

  private async call(
    body: TtsWorkerRequestBody,
    signal: AbortSignal,
    opts: { onProgress?: (p: LoadProgress) => void; timeoutMs?: number; idleTimeoutMs?: number } = {},
  ): Promise<unknown> {
    if (signal.aborted) throw abortedError();
    const worker = await this.ensureWorker();
    if (signal.aborted) throw abortedError();
    return this.rawCall(worker, body, { ...opts, signal });
  }

  private rawCall(
    worker: WorkerLike,
    body: TtsWorkerRequestBody,
    opts: { onProgress?: (p: LoadProgress) => void; timeoutMs?: number; idleTimeoutMs?: number; signal?: AbortSignal; timeFromPost?: boolean },
  ): Promise<unknown> {
    const id = this.nextId++;
    return new Promise((resolve, reject) => {
      const entry: Pending = { resolve, reject, onProgress: opts.onProgress };
      const window = opts.idleTimeoutMs ?? opts.timeoutMs;
      if (window) {
        entry.timeoutMs = window;
        // The worker runs one request at a time, so a request may legitimately sit
        // in its queue behind a long one. Time it from when the worker says it has
        // started it (a first `progress` reply), not from when it was posted.
        if (opts.timeFromPost) {
          entry.timer = setTimeout(() => this.crash(worker, 'The speech engine stopped responding.'), window);
        }
      }
      const finish = () => { if (entry.timer) clearTimeout(entry.timer); opts.signal?.removeEventListener('abort', onAbort); };
      const settle = entry;
      settle.resolve = v => { finish(); resolve(v); };
      settle.reject = e => { finish(); reject(e); };
      const onAbort = () => {
        if (!this.pending.delete(id)) return;
        finish();
        // Tell the worker (it skips a queued request, aborts a download) but keep it alive.
        try { worker.postMessage({ id: this.nextId++, op: 'cancel', target: id }); } catch { /* worker gone */ }
        reject(abortedError());
      };
      opts.signal?.addEventListener('abort', onAbort, { once: true });
      this.pending.set(id, entry);
      try {
        worker.postMessage({ ...body, id } as TtsWorkerRequest);
      } catch {
        this.pending.delete(id);
        finish();
        this.crash(worker, 'The speech engine could not be reached.');
        reject(engineError('The speech engine could not be reached.'));
      }
    });
  }

  private onReply(worker: WorkerLike, msg: TtsWorkerReply): void {
    if (worker !== this.worker) return;
    const entry = this.pending.get(msg.id);
    if (!entry) return; // a late reply for an aborted or timed-out call
    if (msg.kind === 'progress') {
      entry.onProgress?.(msg.p);
      // Progress (including the "started" ping the worker sends when it begins a
      // request) proves the worker is alive: start, or restart, the window.
      if (entry.timeoutMs) {
        if (entry.timer) clearTimeout(entry.timer);
        entry.timer = setTimeout(() => this.crash(worker, 'The speech engine stopped responding.'), entry.timeoutMs);
      }
      return;
    }
    this.pending.delete(msg.id);
    if (msg.kind === 'ok') entry.resolve(msg.value);
    else entry.reject(toTtsError(msg.error));
  }

  private crash(worker: WorkerLike, message: string): void {
    if (worker !== this.worker) return;
    this.killWorker(engineError(message));
  }

  private killWorker(error: AudioError): void {
    const worker = this.worker;
    this.worker = null;
    this.ready = null;
    this.readyVoices.clear();
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
