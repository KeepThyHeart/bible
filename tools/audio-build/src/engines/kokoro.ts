/**
 * Native Kokoro-82M (Apache-2.0) through `kokoro-js`, which runs the ONNX model with
 * onnxruntime-node on the CPU and uses its own phonemizer. The model and voice files are
 * downloaded once into the cache dir.
 */

import { join } from 'node:path';
import { ensureDownloaded } from './download';
import type {
  AudioError, AudioVoice, ITtsEngine, LoadProgress, SynthesisRequest, SynthesisResult, TtsEngineCapabilities,
} from '../core';
import type { EngineContext, EngineCredits, EngineDefinition, Quantization } from './types';

export const KOKORO_MODEL_ID = 'onnx-community/Kokoro-82M-v1.0-ONNX';

/** The files transformers.js reads for this model, by precision. */
export function kokoroModelFiles(q: Quantization): string[] {
  return ['config.json', 'tokenizer.json', 'tokenizer_config.json', q === 'q8' ? 'onnx/model_quantized.onnx' : 'onnx/model.onnx'];
}

const v = (id: string, label: string, language: string): AudioVoice => ({ id, label, language, license: 'Apache-2.0' });

export const KOKORO_VOICES: AudioVoice[] = [
  v('af_heart', 'Heart (US female)', 'en-US'), v('af_alloy', 'Alloy (US female)', 'en-US'), v('af_aoede', 'Aoede (US female)', 'en-US'),
  v('af_bella', 'Bella (US female)', 'en-US'), v('af_jessica', 'Jessica (US female)', 'en-US'), v('af_kore', 'Kore (US female)', 'en-US'),
  v('af_nicole', 'Nicole (US female)', 'en-US'), v('af_nova', 'Nova (US female)', 'en-US'), v('af_river', 'River (US female)', 'en-US'),
  v('af_sarah', 'Sarah (US female)', 'en-US'), v('af_sky', 'Sky (US female)', 'en-US'),
  v('am_adam', 'Adam (US male)', 'en-US'), v('am_echo', 'Echo (US male)', 'en-US'), v('am_eric', 'Eric (US male)', 'en-US'),
  v('am_fenrir', 'Fenrir (US male)', 'en-US'), v('am_liam', 'Liam (US male)', 'en-US'), v('am_michael', 'Michael (US male)', 'en-US'),
  v('am_onyx', 'Onyx (US male)', 'en-US'), v('am_puck', 'Puck (US male)', 'en-US'), v('am_santa', 'Santa (US male)', 'en-US'),
  v('bf_alice', 'Alice (UK female)', 'en-GB'), v('bf_emma', 'Emma (UK female)', 'en-GB'), v('bf_isabella', 'Isabella (UK female)', 'en-GB'),
  v('bf_lily', 'Lily (UK female)', 'en-GB'),
  v('bm_daniel', 'Daniel (UK male)', 'en-GB'), v('bm_fable', 'Fable (UK male)', 'en-GB'), v('bm_george', 'George (UK male)', 'en-GB'),
  v('bm_lewis', 'Lewis (UK male)', 'en-GB'),
];

const engineError = (message: string, retryable = true): AudioError => ({ code: 'engine', message, retryable });

/** Pieces of at most `maxChars`, split after sentence punctuation (then commas); the model has a token limit per run. */
export function splitForKokoro(text: string, maxChars = 280): string[] {
  const t = text.trim();
  if (t.length <= maxChars) return t ? [t] : [];
  const out: string[] = [];
  const take = (s: string, re: RegExp): string[] => s.split(re).map(x => x.trim()).filter(Boolean);
  for (const sentence of take(t, /(?<=[.!?;:])\s+/)) {
    if (sentence.length <= maxChars) { out.push(sentence); continue; }
    let cur = '';
    for (const clause of take(sentence, /(?<=,)\s+/)) {
      if (cur && cur.length + clause.length + 1 > maxChars) { out.push(cur); cur = clause; } else cur = cur ? `${cur} ${clause}` : clause;
    }
    if (cur) out.push(cur);
  }
  // A single run-on piece with no punctuation at all: cut at spaces.
  return out.flatMap(p => {
    if (p.length <= maxChars) return [p];
    const words = p.split(/\s+/);
    const parts: string[] = [];
    let cur = '';
    for (const w of words) {
      if (cur && cur.length + w.length + 1 > maxChars) { parts.push(cur); cur = w; } else cur = cur ? `${cur} ${w}` : w;
    }
    if (cur) parts.push(cur);
    return parts;
  });
}

const PIECE_GAP_SECONDS = 0.2;

interface KokoroInstance {
  generate(text: string, opts: { voice: string; speed: number }): Promise<{ audio: Float32Array; sampling_rate: number }>;
}
interface KokoroModule { KokoroTTS: new (model: unknown, tokenizer: unknown) => KokoroInstance }
interface TransformersModule {
  env: { cacheDir: string };
  StyleTextToSpeech2Model: { from_pretrained(id: string, opts: Record<string, unknown>): Promise<unknown> };
  AutoTokenizer: { from_pretrained(id: string, opts?: Record<string, unknown>): Promise<unknown> };
}

export class KokoroNodeEngine implements ITtsEngine {
  readonly id = 'kokoro';
  readonly label = 'Kokoro (native)';
  readonly capabilities: TtsEngineCapabilities = {
    rate: { min: 0.5, max: 2, step: 0.05 },
    nativeRate: true,
    languages: ['en'],
    backends: [],
    approxRuntimeBytes: 600 * 1024 * 1024,
  };
  private tts: KokoroInstance | null = null;

  constructor(private readonly ctx: EngineContext) {}

  async isSupported(): Promise<boolean> { return true; }
  async listVoices(): Promise<AudioVoice[]> { return KOKORO_VOICES; }
  async isVoiceReady(): Promise<boolean> { return this.tts !== null; }

  async prepare(voiceId: string, onProgress: (p: LoadProgress) => void): Promise<void> {
    const bad = checkKokoroVoice(voiceId);
    if (bad) throw engineError(bad, false);
    if (this.tts) return;
    // kokoro-js and transformers.js are ES modules: load them with a real dynamic import.
    const transformers = (await import('@huggingface/transformers')) as unknown as TransformersModule;
    const hfCache = join(this.ctx.cacheDir, 'huggingface');
    transformers.env.cacheDir = hfCache;
    // Fetch the model files ourselves (with a curl fallback: Node's fetch cannot always reach the
    // Hugging Face CDN host), into the layout transformers.js reads its cache from.
    await fetchKokoroFiles(this.ctx);
    const kokoro = (await import('kokoro-js')) as unknown as KokoroModule;
    onProgress({ phase: 'engine', loaded: 0 });
    const progress_callback = (p: { status?: string; loaded?: number; total?: number }): void => {
      if (p.status === 'progress' && typeof p.loaded === 'number') onProgress({ phase: 'voice', loaded: p.loaded, total: p.total });
    };
    // What `KokoroTTS.from_pretrained` does, spelled out so the ONNX thread count can be set
    // (it forwards no session options): the model on the CPU, then the tokenizer.
    const [model, tokenizer] = await Promise.all([
      transformers.StyleTextToSpeech2Model.from_pretrained(KOKORO_MODEL_ID, {
        dtype: this.ctx.quantization,
        device: 'cpu',
        progress_callback,
        session_options: { intraOpNumThreads: this.ctx.threads, interOpNumThreads: 1 },
      }),
      transformers.AutoTokenizer.from_pretrained(KOKORO_MODEL_ID, { progress_callback }),
    ]);
    this.tts = new kokoro.KokoroTTS(model, tokenizer);
    onProgress({ phase: 'engine', loaded: 1, total: 1 });
  }

  async synthesize(req: SynthesisRequest, signal: AbortSignal): Promise<SynthesisResult> {
    if (!this.tts) await this.prepare(req.voiceId, () => {});
    const speed = Math.min(2, Math.max(0.5, Number.isFinite(req.rate) && req.rate > 0 ? req.rate : 1));
    const pieces = splitForKokoro(req.text);
    if (pieces.length === 0) return { pcm: new Float32Array(2400), sampleRate: 24000 };
    const chunks: Float32Array[] = [];
    let sampleRate = 24000;
    for (let i = 0; i < pieces.length; i++) {
      if (signal.aborted) throw { code: 'aborted', message: 'Aborted', retryable: false } satisfies AudioError;
      const r = await this.tts!.generate(pieces[i], { voice: req.voiceId, speed });
      sampleRate = r.sampling_rate;
      chunks.push(r.audio);
      if (i < pieces.length - 1) chunks.push(new Float32Array(Math.round(PIECE_GAP_SECONDS * sampleRate)));
    }
    const pcm = new Float32Array(chunks.reduce((n, c) => n + c.length, 0));
    let at = 0;
    for (const c of chunks) { pcm.set(c, at); at += c.length; }
    return { pcm, sampleRate };
  }

  async evictVoice(): Promise<void> { /* the model serves every voice */ }
  dispose(): void { this.tts = null; }
}

export async function fetchKokoroFiles(ctx: Pick<EngineContext, 'cacheDir' | 'quantization' | 'log'>): Promise<void> {
  const hfCache = join(ctx.cacheDir, 'huggingface');
  for (const f of kokoroModelFiles(ctx.quantization)) {
    await ensureDownloaded(`https://huggingface.co/${KOKORO_MODEL_ID}/resolve/main/${f}`, join(hfCache, KOKORO_MODEL_ID, f), ctx.log);
  }
}

export function checkKokoroVoice(id: string): string | undefined {
  return KOKORO_VOICES.some(x => x.id === id) ? undefined : `"${id}" is not a Kokoro voice. Known: ${KOKORO_VOICES.map(x => x.id).join(', ')}.`;
}

const modelLabel = (q: Pick<{ quantization: Quantization }, 'quantization'>): string => `Kokoro-82M-v1.0-ONNX ${q.quantization}`;

export const kokoroDefinition: EngineDefinition = {
  id: 'kokoro',
  label: 'Kokoro-82M (native, onnxruntime-node)',
  languages: ['en'],
  voices: KOKORO_VOICES,
  defaultVoice: lang => (lang.toLowerCase().split(/[-_]/)[0] === 'en' ? 'am_michael' : undefined),
  checkVoice: checkKokoroVoice,
  modelLabel,
  memoryMbPerJob: ({ quantization }) => (quantization === 'q8' ? 700 : 1400),
  prefetch: (_voice, ctx) => fetchKokoroFiles(ctx),
  nominalRtf: ({ quantization }) => (quantization === 'q8' ? 1.2 : 3),
  async credits(voiceId, ctx): Promise<EngineCredits> {
    return {
      engine: { name: 'kokoro-js with onnxruntime-node', license: 'Apache-2.0', url: 'https://github.com/hexgrad/kokoro' },
      model: { name: modelLabel(ctx), license: 'Apache-2.0', url: `https://huggingface.co/${KOKORO_MODEL_ID}`, attribution: 'Kokoro-82M by hexgrad, ONNX conversion by onnx-community' },
      voice: { name: `Kokoro voice ${voiceId}`, license: 'Apache-2.0', url: 'https://huggingface.co/hexgrad/Kokoro-82M' },
    };
  },
  create: ctx => new KokoroNodeEngine(ctx),
};
