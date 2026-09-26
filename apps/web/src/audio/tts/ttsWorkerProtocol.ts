/**
 * The message protocol between a `WorkerTtsEngine` (page side) and the worker
 * that runs the actual engine (`serveTtsWorker`, worker side).
 *
 * Every request carries an `id`; every reply names it. The worker may send any
 * number of `progress` replies for a request, then exactly one `ok` or `error`.
 * An engine adapter (Piper, Kokoro) chooses what `init` and `prepare` payloads
 * mean; the protocol only carries them.
 */

import type { AudioError, LoadProgress, SynthesisRequest } from '@bible/core/browser';

export type TtsWorkerRequest =
  | { id: number; op: 'init'; payload: unknown }
  | { id: number; op: 'prepare'; voiceId: string; payload?: unknown }
  | { id: number; op: 'synthesize'; req: SynthesisRequest }
  | { id: number; op: 'evict'; voiceId: string }
  /** Best-effort: skip a queued request, or abort a running one that can be aborted. */
  | { id: number; op: 'cancel'; target: number }
  | { id: number; op: 'dispose' };

/** A request without its id (the caller assigns it). Distributes over the union. */
export type TtsWorkerRequestBody = TtsWorkerRequest extends infer T ? (T extends { id: number } ? Omit<T, 'id'> : never) : never;

export interface SynthesizeValue {
  pcm: Float32Array;
  sampleRate: number;
  sentences?: Array<{ start: number; end: number }>;
}

export type TtsWorkerReply =
  | { id: number; kind: 'progress'; p: LoadProgress }
  | { id: number; kind: 'ok'; value?: unknown }
  | { id: number; kind: 'error'; error: AudioError };

/** What an engine's worker entry point supplies to `serveTtsWorker`. */
export interface TtsWorkerHandlers {
  init(payload: unknown): Promise<void>;
  prepare(voiceId: string, payload: unknown, progress: (p: LoadProgress) => void, signal: AbortSignal): Promise<void>;
  synthesize(req: SynthesisRequest, signal: AbortSignal): Promise<SynthesizeValue>;
  evict(voiceId: string): Promise<void>;
}
