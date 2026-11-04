/**
 * Worker-side logic for Whisper, free of `self` so Node tests can drive it with a
 * fake transformers module. `whisperWorker.ts` is the thin adapter.
 *
 * ## Serving model files without a network (verified on @huggingface/transformers 3.8.1)
 *
 * `getModelFile` (src/utils/hub.js) behaves like this:
 * 1. With `allowLocalModels=false` AND `allowRemoteModels=false` it throws straight away
 *    ("both local and remote models are disabled"), before looking at any cache. The design's
 *    first idea therefore does not work.
 * 2. With `env.useCustomCache=true` the custom cache is consulted FIRST (keys: the local path
 *    `/models/<id>/<file>`, then the remote URL `<remoteHost><remotePathTemplate><file>`), and a hit
 *    returns without touching the network, whatever the allow flags are.
 * 3. A miss with `allowRemoteModels=true` calls `fetch(remoteURL)`; optional files (`fatal=false`,
 *    e.g. `.onnx_data`, `added_tokens.json`) turn a 404 into `null`, but a network error would reject.
 *
 * Working variant: `allowLocalModels=false`, `allowRemoteModels=true`, `remoteHost` on a name that
 * can never resolve (`https://speech.invalid/`), `remotePathTemplate='{model}/'`, our in-memory cache
 * answering for those URLs, and a `fetch` guard that answers 404 for that host (so optional files
 * resolve to `null` and nothing ever leaves the device). Other fetches (ORT wasm) pass through.
 */

import {
  WhisperWorkerError,
  type TranscribeValue,
  type WhisperDevice,
  type WhisperDtype,
  type WhisperErrorCode,
  type WhisperProgress,
  type WhisperReply,
  type WhisperRequest,
} from './whisperProtocol';
import { cleanTranscript, splitChunks } from './postprocess';

export const OFFLINE_HOST = 'https://speech.invalid/';
const SAMPLE_RATE = 16000;
const MAX_PROMPT_TOKENS = 120;
const PREV_TAIL_TOKENS = 30;
const MAX_TARGET_POSITIONS = 224;

export interface TokenizerLike {
  encode(text: string, o?: { add_special_tokens?: boolean }): number[];
  decode(ids: number[], o?: { skip_special_tokens?: boolean }): string;
}
export interface ModelLike {
  generate(o: Record<string, unknown>): Promise<{ tolist(): Array<Array<number | bigint>> }>;
  dispose?(): Promise<unknown> | void;
}
export type ProcessorLike = (audio: Float32Array) => Promise<{ input_features: unknown }>;

/** The slice of `@huggingface/transformers` used here. */
export interface TransformersLike {
  env: { backends: { onnx: { wasm: Record<string, unknown> } } } & Record<string, unknown>;
  AutoTokenizer: { from_pretrained(id: string, o?: object): Promise<TokenizerLike> };
  AutoProcessor: { from_pretrained(id: string, o?: object): Promise<ProcessorLike> };
  WhisperForConditionalGeneration: { from_pretrained(id: string, o?: object): Promise<ModelLike> };
}

/** In-memory `Cache` stand-in (match/put) keyed by the URL transformers.js builds. */
export class MemCache {
  private readonly files = new Map<string, ArrayBuffer>();
  fill(prefix: string, files: Record<string, ArrayBuffer>): void {
    for (const [path, bytes] of Object.entries(files)) this.files.set(prefix + path, bytes);
  }
  clear(): void {
    this.files.clear();
  }
  async match(key: string | { url: string }): Promise<Response | undefined> {
    const bytes = this.files.get(typeof key === 'string' ? key : key.url);
    return bytes ? new Response(bytes, { headers: { 'Content-Length': String(bytes.byteLength) } }) : undefined;
  }
  async put(): Promise<void> {
    /* read-only */
  }
}

/** Wrap `fetch` so the offline host answers 404 instead of going to the network. Returns an undo. */
export function installOfflineFetch(host = OFFLINE_HOST): () => void {
  const g = globalThis as { fetch?: typeof fetch };
  const real = g.fetch;
  if (!real) return () => undefined;
  const guard = ((input: RequestInfo | URL, init?: RequestInit) => {
    const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
    if (url.startsWith(host)) return Promise.resolve(new Response(null, { status: 404 }));
    return real(input, init);
  }) as typeof fetch;
  g.fetch = guard;
  return () => {
    if (g.fetch === guard) g.fetch = real;
  };
}

/** `en-US` -> `en`. */
export const primaryLanguage = (tag: string): string => tag.split(/[-_]/)[0].toLowerCase();

const capTail = <T>(a: T[], n: number): T[] => (a.length > n ? a.slice(a.length - n) : a);

/** `[<|startofprev|>, ...prompt, <|startoftranscript|>, <|lang|>, <|transcribe|>, <|notimestamps|>]`; no startofprev without a prompt. */
export function buildDecoderPrefix(tok: TokenizerLike, language: string, promptIds: number[] = []): number[] {
  const special = (t: string): number => {
    const ids = tok.encode(t, { add_special_tokens: false });
    if (ids.length !== 1) throw new WhisperWorkerError('engine', `Unsupported token ${t}`);
    return ids[0];
  };
  const prompt = capTail(promptIds, MAX_PROMPT_TOKENS);
  return [
    ...(prompt.length ? [special('<|startofprev|>'), ...prompt] : []),
    special('<|startoftranscript|>'),
    special(`<|${primaryLanguage(language)}|>`),
    special('<|transcribe|>'),
    special('<|notimestamps|>'),
  ];
}

export interface WhisperHandlers {
  init(o: { ortBase: string; numThreads: number }): Promise<void>;
  load(
    o: { modelId: string; device: WhisperDevice; dtype: WhisperDtype; files: Record<string, ArrayBuffer> },
    progress: (p: WhisperProgress) => void,
  ): Promise<void>;
  transcribe(o: { pcm: Float32Array; language: string; prompt: string }, signal: AbortSignal): Promise<TranscribeValue>;
  dispose(): Promise<void>;
}

export function createWhisperHandlers(
  tfSource: TransformersLike | Promise<TransformersLike> = import('@huggingface/transformers') as unknown as Promise<TransformersLike>,
): WhisperHandlers {
  const cache = new MemCache();
  let tf: TransformersLike | null = null;
  let undoFetch: (() => void) | null = null;
  let tokenizer: TokenizerLike | null = null;
  let processor: ProcessorLike | null = null;
  let model: ModelLike | null = null;

  const free = async () => {
    const m = model;
    model = tokenizer = processor = null;
    try { await m?.dispose?.(); } catch { /* already gone */ }
  };

  async function run(pcm: Float32Array, language: string, prompt: string, signal: AbortSignal): Promise<TranscribeValue> {
    if (!tokenizer || !processor || !model) throw new WhisperWorkerError('not-ready', 'No model loaded');
    const started = performance.now();
    const biasIds = prompt ? tokenizer.encode(' ' + prompt, { add_special_tokens: false }) : [];
    const texts: string[] = [];
    let prev: number[] = [];
    for (const [s, e] of splitChunks(pcm, { sampleRate: SAMPLE_RATE })) {
      if (signal.aborted) throw new WhisperWorkerError('aborted', 'Aborted');
      const inputs = await processor(pcm.subarray(s, e));
      const prefix = buildDecoderPrefix(tokenizer, language, capTail([...biasIds, ...prev], MAX_PROMPT_TOKENS));
      const sec = (e - s) / SAMPLE_RATE;
      const maxNew = Math.max(1, Math.min(MAX_TARGET_POSITIONS - prefix.length, Math.ceil(sec * 6) + 8));
      const out = await model.generate({ inputs: inputs.input_features, decoder_input_ids: prefix, max_new_tokens: maxNew });
      const ids = out.tolist()[0].map(Number).slice(prefix.length);
      texts.push(ids.length ? tokenizer.decode(ids, { skip_special_tokens: true }).trim() : '');
      const t = tokenizer;
      prev = ids.slice(-PREV_TAIL_TOKENS * 2).filter((id) => t.decode([id], { skip_special_tokens: true }) !== '').slice(-PREV_TAIL_TOKENS);
    }
    const text = cleanTranscript(texts.filter(Boolean).join(' '), prompt, (pcm.length / SAMPLE_RATE) * 1000);
    return { text, decodeMs: Math.round(performance.now() - started) };
  }

  return {
    async init({ ortBase, numThreads }) {
      tf = await tfSource;
      const env = tf.env;
      env.allowLocalModels = false;
      env.allowRemoteModels = true; // see header: false would throw before the cache is consulted
      env.remoteHost = OFFLINE_HOST;
      env.remotePathTemplate = '{model}/';
      env.useBrowserCache = false;
      env.useFSCache = false;
      env.useCustomCache = true;
      env.customCache = cache;
      env.backends.onnx.wasm.wasmPaths = ortBase;
      env.backends.onnx.wasm.numThreads = numThreads;
      undoFetch ??= installOfflineFetch();
    },

    async load({ modelId, device, dtype, files }, progress) {
      if (!tf) throw new WhisperWorkerError('not-ready', 'Worker not initialised');
      await free();
      const id = `whisper/${modelId}`;
      cache.fill(`${OFFLINE_HOST}${id}/`, files);
      try {
        progress({ phase: 'load', loaded: 0, total: 4 });
        tokenizer = await tf.AutoTokenizer.from_pretrained(id);
        processor = await tf.AutoProcessor.from_pretrained(id);
        progress({ phase: 'load', loaded: 1, total: 4 });
        model = await tf.WhisperForConditionalGeneration.from_pretrained(id, { device, dtype });
        progress({ phase: 'load', loaded: 2, total: 4 });
        // 1 s silent warm-up compiles kernels/shaders so the first real utterance is not slow.
        await run(new Float32Array(SAMPLE_RATE), 'en', '', new AbortController().signal);
        progress({ phase: 'load', loaded: 4, total: 4 });
      } catch (err) {
        await free();
        throw err;
      } finally {
        cache.clear(); // the bytes now live inside ORT
      }
    },

    transcribe: ({ pcm, language, prompt }, signal) => run(pcm, language, prompt, signal),

    async dispose() {
      await free();
      cache.clear();
      undoFetch?.();
      undoFetch = null;
    },
  };
}

const toError = (err: unknown): { code: WhisperErrorCode; message: string } => {
  if (err instanceof WhisperWorkerError) return { code: err.code, message: err.message };
  return { code: 'engine', message: err instanceof Error ? err.message : 'Speech engine failed' };
};

/**
 * Request dispatcher: runs requests one at a time in arrival order; `cancel` aborts a queued or
 * running one (a running transcription stops between chunks). Returns the `onmessage` function.
 */
export function serveWhisper(post: (r: WhisperReply) => void, handlers: WhisperHandlers): (req: WhisperRequest) => void {
  const aborts = new Map<number, AbortController>();
  let tail: Promise<void> = Promise.resolve();

  const execute = async (req: Exclude<WhisperRequest, { op: 'cancel' }>, signal: AbortSignal): Promise<unknown> => {
    switch (req.op) {
      case 'init': return handlers.init(req);
      case 'load': return handlers.load(req, (p) => post({ id: req.id, kind: 'progress', p }));
      case 'transcribe': return handlers.transcribe(req, signal);
      case 'dispose': return handlers.dispose();
    }
  };

  return (req) => {
    if (req.op === 'cancel') {
      aborts.get(req.target)?.abort();
      return;
    }
    const ac = new AbortController();
    aborts.set(req.id, ac);
    tail = tail.then(async () => {
      try {
        if (ac.signal.aborted) throw new WhisperWorkerError('aborted', 'Aborted');
        post({ id: req.id, kind: 'ok', value: await execute(req, ac.signal) });
      } catch (err) {
        post({ id: req.id, kind: 'error', error: toError(err) });
      } finally {
        aborts.delete(req.id);
      }
    });
  };
}
