/**
 * Messages between `WhisperEngine` (page side) and the Whisper worker.
 *
 * Every request carries an `id`; every reply names it. The worker may send any
 * number of `progress` replies, then exactly one `ok` or `error`. Same shape as
 * the TTS worker protocol. Types only: the worker imports nothing from core.
 */

export type WhisperDevice = 'webgpu' | 'wasm';
/** transformers.js dtype per ONNX session, e.g. `{ encoder_model: 'q8', decoder_model_merged: 'q8' }`. */
export type WhisperDtype = Record<string, string>;

export type WhisperRequest =
  | { id: number; op: 'init'; ortBase: string; numThreads: number }
  /** `files`: repo-relative path -> bytes (transferred). */
  | { id: number; op: 'load'; modelId: string; device: WhisperDevice; dtype: WhisperDtype; files: Record<string, ArrayBuffer> }
  /** `pcm`: 16 kHz mono (transferred). `prompt`: bias text, may be empty. */
  | { id: number; op: 'transcribe'; pcm: Float32Array; language: string; prompt: string }
  /** Best-effort: skip a queued request, or stop a running transcription between chunks. */
  | { id: number; op: 'cancel'; target: number }
  | { id: number; op: 'dispose' };

/** A request without its id (the caller assigns it). Distributes over the union. */
export type WhisperRequestBody = WhisperRequest extends infer T ? (T extends { id: number } ? Omit<T, 'id'> : never) : never;

export interface WhisperProgress {
  phase: 'load';
  loaded: number;
  total?: number;
}

export interface TranscribeValue {
  text: string;
  decodeMs: number;
}

export type WhisperErrorCode = 'engine' | 'not-ready' | 'aborted';

export type WhisperReply =
  | { id: number; kind: 'progress'; p: WhisperProgress }
  | { id: number; kind: 'ok'; value?: unknown }
  | { id: number; kind: 'error'; error: { code: WhisperErrorCode; message: string } };

export class WhisperWorkerError extends Error {
  constructor(readonly code: WhisperErrorCode, message: string) {
    super(message);
    this.name = 'WhisperWorkerError';
  }
}
