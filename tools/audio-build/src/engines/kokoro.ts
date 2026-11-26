/**
 * Native Kokoro-82M (Apache-2.0) through `kokoro-js`, which runs the ONNX model with
 * onnxruntime-node on the CPU and uses its own phonemizer. The model and voice files are
 * downloaded once into the cache dir.
 */

import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { ensureDownloaded } from './download';
import { clearSpeechIpa, hasPronunciation, splitPronunciation, stripPronunciation } from '../core';
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

type KokoroAudio = { audio: Float32Array; sampling_rate: number };
/** The token ids tensor the tokenizer returns; `dims` is [1, n]. */
export interface KokoroIds { dims: number[] }
export interface KokoroTokenizer {
  (text: string, opts?: { truncation?: boolean }): { input_ids: KokoroIds };
  model?: { tokens_to_ids?: Map<string, number> };
}
export interface KokoroInstance {
  generate(text: string, opts: { voice: string; speed: number }): Promise<KokoroAudio>;
  generate_from_ids?(ids: KokoroIds, opts: { voice: string; speed: number }): Promise<KokoroAudio>;
  tokenizer?: KokoroTokenizer;
  /** The StyleTTS2 model: `{ input_ids, style [1,256], speed [1] }` to `{ waveform }`. */
  model?: (inputs: Record<string, unknown>) => Promise<{ waveform: { data: Float32Array } }>;
}

// -- Voice blends -------------------------------------------------------------------

/** One voice of a blend and its share (the shares of a blend sum to 1). */
export interface KokoroVoicePart { id: string; weight: number }

/** Each voice's style data: 510 rows (one per input length) of 256 floats. */
export const KOKORO_STYLE_ROWS = 510;
export const KOKORO_STYLE_DIM = 256;

/**
 * A Kokoro voice id or a blend, `am_michael:0.5+bm_george:0.5` (weights are shares, normalised
 * to sum to 1; `am_michael+bm_george` is an even blend). The first voice sets the accent: the
 * text is phonemized, and gets pronunciation corrections, in its language.
 */
export function parseKokoroVoice(spec: string): { parts: KokoroVoicePart[] } | { error: string } {
  const raw = spec.split('+').map(p => p.trim());
  const parts: KokoroVoicePart[] = [];
  for (const p of raw) {
    const m = /^([a-z]{2}_[a-z]+)(?::(\d+(?:\.\d+)?|\.\d+))?$/.exec(p);
    if (!m) return { error: `"${spec}" is not a Kokoro voice or blend (for example am_michael:0.5+bm_george:0.5).` };
    if (!KOKORO_VOICES.some(x => x.id === m[1])) return { error: `"${m[1]}" is not a Kokoro voice. Known: ${KOKORO_VOICES.map(x => x.id).join(', ')}.` };
    if (parts.some(x => x.id === m[1])) return { error: `"${m[1]}" appears twice in the blend "${spec}".` };
    const weight = m[2] === undefined ? 1 : Number(m[2]);
    if (!(weight > 0)) return { error: `Each voice in a blend needs a weight above 0 ("${p}").` };
    parts.push({ id: m[1], weight });
  }
  const total = parts.reduce((n, x) => n + x.weight, 0);
  return { parts: parts.map(x => ({ id: x.id, weight: x.weight / total })) };
}

/** True when the id is a blend (or a single voice written with a weight), which takes our own model call. */
export const isKokoroBlend = (spec: string): boolean => /[:+]/.test(spec);

const blendParts = (spec: string): KokoroVoicePart[] => {
  const r = parseKokoroVoice(spec);
  if ('error' in r) throw engineError(r.error, false);
  return r.parts;
};

/** The weighted average of the voices' style data. */
export function blendKokoroStyles(parts: KokoroVoicePart[], load: (voiceId: string) => Float32Array): Float32Array {
  const out = new Float32Array(KOKORO_STYLE_ROWS * KOKORO_STYLE_DIM);
  for (const { id, weight } of parts) {
    const data = load(id);
    if (data.length !== out.length) throw engineError(`Kokoro voice ${id} has ${data.length} style values, expected ${out.length}.`, false);
    for (let i = 0; i < out.length; i++) out[i] += weight * data[i];
  }
  return out;
}

/** The style row kokoro-js picks for `tokens` input ids (BOS and EOS included). */
export function kokoroStyleRow(style: Float32Array, tokens: number): Float32Array {
  const at = KOKORO_STYLE_DIM * Math.min(Math.max(tokens - 2, 0), KOKORO_STYLE_ROWS - 1);
  return style.slice(at, at + KOKORO_STYLE_DIM);
}

/** A voice's style data as shipped in the kokoro-js package (`voices/<id>.bin`, little-endian float32), which kokoro-js itself reads in Node. */
export function readKokoroVoiceData(voiceId: string): Float32Array {
  const file = join(dirname(require.resolve('kokoro-js')), '..', 'voices', `${voiceId}.bin`);
  const buf = readFileSync(file);
  return new Float32Array(buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength));
}

const firstVoice = (spec: string): string => (isKokoroBlend(spec) ? blendParts(spec)[0].id : spec);

const voiceName = (id: string): string => KOKORO_VOICES.find(x => x.id === id)?.label.split(' (')[0] ?? id;

export function kokoroVoiceLanguage(spec: string): string | undefined {
  const r = parseKokoroVoice(spec);
  return 'error' in r ? undefined : KOKORO_VOICES.find(x => x.id === r.parts[0].id)?.language;
}

/** `michael50-george50` for a blend; the id itself for one voice. */
export function kokoroVoiceSlug(spec: string): string {
  if (!isKokoroBlend(spec)) return spec;
  return blendParts(spec).map(p => `${p.id.split('_')[1]}${Math.round(p.weight * 100)}`).join('-');
}

/** `Michael 50% + George 50%` for a blend; the id itself for one voice. */
export function kokoroVoiceLabel(spec: string): string {
  if (!isKokoroBlend(spec)) return spec;
  return blendParts(spec).map(p => `${voiceName(p.id)} ${Math.round(p.weight * 100)}%`).join(' + ');
}

const PROBE_STOP = Symbol('kokoro-phonemes');

/**
 * Kokoro's own phonemes for plain `text`, exactly as `generate` would make them. kokoro-js
 * 1.2.1 does not export its phonemizer, but `generate(text)` phonemizes and then calls
 * `this.tokenizer(phonemes)`: a copy of the instance whose tokenizer records its argument and
 * stops gives the string without running the model. A test pins this against the real package.
 */
export async function kokoroPhonemes(tts: KokoroInstance, text: string, voice: string): Promise<string> {
  let captured: string | undefined;
  const probe = Object.assign(Object.create(Object.getPrototypeOf(tts) as object) as KokoroInstance, tts, {
    tokenizer: (phonemes: string) => { captured = phonemes; throw PROBE_STOP; },
  });
  try {
    await probe.generate(text, { voice, speed: 1 });
  } catch (e) {
    if (e !== PROBE_STOP) throw e;
  }
  if (typeof captured !== 'string') throw engineError('Could not read Kokoro\'s phonemes (kokoro-js changed?).', false);
  return captured;
}

/**
 * Phonemes for a piece with pronunciation markers: each plain run phonemized as Kokoro would
 * (`phonemize`), each marker's IPA in between, with a space wherever the text had one.
 */
export async function kokoroMarkedPhonemes(phonemize: (text: string) => Promise<string>, text: string): Promise<string> {
  let out = '';
  for (const r of splitPronunciation(text)) {
    if (r.kind === 'ipa') { out += r.ipa; continue; }
    if (/^\s/.test(r.text)) out += ' ';
    if (/[\p{L}\p{N}]/u.test(r.text)) out += await phonemize(r.text);
    else out += r.text.trim();
    if (/\s$/.test(r.text)) out += ' ';
  }
  return out.replace(/ {2,}/g, ' ').trim();
}

/** The corrections are American English: British voices get the words. */
const speaksOverlay = (voiceId: string): boolean => KOKORO_VOICES.find(x => x.id === voiceId)?.language === 'en-US';
interface KokoroModule { KokoroTTS: new (model: unknown, tokenizer: unknown) => KokoroInstance }
type TensorClass = new (type: string, data: Float32Array | number[], dims: number[]) => unknown;
interface TransformersModule {
  env: { cacheDir: string };
  Tensor: TensorClass;
  StyleTextToSpeech2Model: { from_pretrained(id: string, opts: Record<string, unknown>): Promise<unknown> };
  AutoTokenizer: { from_pretrained(id: string, opts?: Record<string, unknown>): Promise<unknown> };
}

export class KokoroNodeEngine implements ITtsEngine {
  readonly id = 'kokoro';
  readonly label = 'Kokoro (native)';
  readonly capabilities: TtsEngineCapabilities = {
    rate: { min: 0.5, max: 2, step: 0.05 },
    nativeRate: true,
    pronunciation: true,
    languages: ['en'],
    backends: [],
    approxRuntimeBytes: 600 * 1024 * 1024,
  };
  private tts: KokoroInstance | null = null;
  private Tensor: TensorClass | null = null;
  /** Blended style data by voice spec. */
  private readonly styles = new Map<string, Float32Array>();

  constructor(private readonly ctx: EngineContext, private readonly loadVoiceData: (voiceId: string) => Float32Array = readKokoroVoiceData) {}

  /** For tests: an engine around a stand-in instance and tensor class (no model files). */
  static withInstance(ctx: EngineContext, tts: KokoroInstance, Tensor: TensorClass, loadVoiceData?: (voiceId: string) => Float32Array): KokoroNodeEngine {
    const e = new KokoroNodeEngine(ctx, loadVoiceData);
    e.tts = tts;
    e.Tensor = Tensor;
    return e;
  }

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
    this.Tensor = transformers.Tensor;
    if (isKokoroBlend(voiceId)) this.style(voiceId);
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
      const r = await this.generate(pieces[i], req.voiceId, speed);
      sampleRate = r.sampling_rate;
      chunks.push(r.audio);
      if (i < pieces.length - 1) chunks.push(new Float32Array(Math.round(PIECE_GAP_SECONDS * sampleRate)));
    }
    const pcm = new Float32Array(chunks.reduce((n, c) => n + c.length, 0));
    let at = 0;
    for (const c of chunks) { pcm.set(c, at); at += c.length; }
    return { pcm, sampleRate };
  }

  /**
   * One piece. Plain voice, no clear speech: through Kokoro's own pipeline, or, with markers,
   * our phonemes and `generate_from_ids` (unchanged from before blends and clear speech).
   * Otherwise always our phonemes (in the first voice's accent, with the corrections, then the
   * clear-speech rules), then the tokenizer and, for a blend, the model with the blended style.
   */
  private async generate(piece: string, voice: string, speed: number): Promise<KokoroAudio> {
    const tts = this.tts!;
    const blend = isKokoroBlend(voice);
    if (!blend && !this.ctx.clearSpeech) {
      if (!hasPronunciation(piece)) return tts.generate(piece, { voice, speed });
      if (!speaksOverlay(voice) || !tts.tokenizer || !tts.generate_from_ids) return tts.generate(stripPronunciation(piece), { voice, speed });
      const phonemes = await kokoroMarkedPhonemes(t => kokoroPhonemes(tts, t, voice), piece);
      const { input_ids } = tts.tokenizer(phonemes, { truncation: true });
      return tts.generate_from_ids(input_ids, { voice, speed });
    }
    if (!tts.tokenizer || !tts.generate_from_ids || (blend && (!tts.model || !this.Tensor))) {
      throw engineError('This kokoro-js build does not expose its tokenizer and model; blends and clear speech need them.', false);
    }
    const accent = firstVoice(voice);
    const phonemize = (t: string): Promise<string> => kokoroPhonemes(tts, t, accent);
    let phonemes = hasPronunciation(piece) && speaksOverlay(accent)
      ? await kokoroMarkedPhonemes(phonemize, piece)
      : await phonemize(stripPronunciation(piece));
    if (this.ctx.clearSpeech) {
      const vocab = tts.tokenizer.model?.tokens_to_ids;
      phonemes = clearSpeechIpa(phonemes, vocab ? s => vocab.has(s) : undefined);
    }
    const { input_ids } = tts.tokenizer(phonemes, { truncation: true });
    if (!blend) return tts.generate_from_ids(input_ids, { voice, speed });
    // What kokoro-js `generate_from_ids` does, with the blended style in place of one voice's.
    const style = kokoroStyleRow(this.style(voice), input_ids.dims.at(-1) ?? 0);
    const T = this.Tensor!;
    const { waveform } = await tts.model!({
      input_ids,
      style: new T('float32', style, [1, KOKORO_STYLE_DIM]),
      speed: new T('float32', [speed], [1]),
    });
    return { audio: waveform.data, sampling_rate: 24000 };
  }

  private style(spec: string): Float32Array {
    let s = this.styles.get(spec);
    if (!s) { s = blendKokoroStyles(blendParts(spec), this.loadVoiceData); this.styles.set(spec, s); }
    return s;
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
  const r = parseKokoroVoice(id);
  return 'error' in r ? r.error : undefined;
}

const modelLabel = (q: Pick<{ quantization: Quantization }, 'quantization'>): string => `Kokoro-82M-v1.0-ONNX ${q.quantization}`;

export const kokoroDefinition: EngineDefinition = {
  id: 'kokoro',
  pronunciation: true,
  clearSpeech: true,
  voiceLanguage: kokoroVoiceLanguage,
  voiceSlug: kokoroVoiceSlug,
  voiceLabel: kokoroVoiceLabel,
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
      voice: {
        name: isKokoroBlend(voiceId) ? `Kokoro voice blend ${blendParts(voiceId).map(p => `${p.id} ${Math.round(p.weight * 100)}%`).join(' + ')}` : `Kokoro voice ${voiceId}`,
        license: 'Apache-2.0',
        url: 'https://huggingface.co/hexgrad/Kokoro-82M',
      },
    };
  },
  create: ctx => new KokoroNodeEngine(ctx),
};
