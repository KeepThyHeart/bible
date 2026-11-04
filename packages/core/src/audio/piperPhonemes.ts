/**
 * The pure part of the Piper (VITS) engine: voice configuration, the
 * phonemizer's command line and output, the mapping from phonemes to the
 * model's symbol ids, and the inference scales.
 *
 * The browser worker (`apps/web/.../piperHandlers.ts`) and the native build
 * tool (`tools/audio-build`) both use these, so a verse gets exactly the same
 * model input in both places. No DOM, no Node, no I/O: the runtimes are injected
 * by the callers.
 *
 * Algorithm (ported from `@diffusionstudio/vits-web` 1.0.3, MIT):
 * 1. Phonemize with `piper_phonemize` (`-l <espeak voice> --input [{"text": ...}]`,
 *    one entry per sentence). It prints one JSON line per entry with the espeak
 *    `phonemes`. Its own `phoneme_ids` come from a default table and are ignored:
 *    the phonemes are mapped through the voice's own `phoneme_id_map`, as Piper
 *    does (BOS, PAD, then each phoneme followed by PAD, then EOS, per sentence).
 * 2. Infer with `input` (int64 [1, n]), `input_lengths` (int64 [n]) and `scales`
 *    (float32 [noise_scale, length_scale, noise_w]), plus `sid` for a
 *    multi-speaker model. `output` is float32 PCM at the voice's sample rate.
 * 3. Speed is `length_scale / rate`.
 */

import type { AudioError } from './types';

const engineError = (message: string, retryable = true): AudioError => ({ code: 'engine', message, retryable });

const isNumber = (x: unknown): x is number => typeof x === 'number' && Number.isFinite(x);

/** The parts of a voice's `.onnx.json` that inference needs. */
export interface PiperVoiceConfig {
  espeakVoice: string;
  sampleRate: number;
  noiseScale: number;
  lengthScale: number;
  noiseW: number;
  multiSpeaker: boolean;
  /** Phoneme character to the model's symbol ids. */
  phonemeIdMap: Record<string, number[]>;
}

/** Read the fields inference needs from a voice's JSON, or throw a readable error. */
export function parseVoiceConfig(json: unknown): PiperVoiceConfig {
  const j = json as {
    espeak?: { voice?: unknown };
    audio?: { sample_rate?: unknown };
    inference?: { noise_scale?: unknown; length_scale?: unknown; noise_w?: unknown };
    speaker_id_map?: unknown;
    phoneme_id_map?: unknown;
  } | null;
  const voice = j?.espeak?.voice;
  const sampleRate = j?.audio?.sample_rate;
  if (typeof voice !== 'string' || !voice || !isNumber(sampleRate) || sampleRate <= 0) {
    throw engineError('The voice configuration is not a Piper voice file.', false);
  }
  const inf = j?.inference;
  const map = j?.speaker_id_map;
  const phonemeIdMap: Record<string, number[]> = {};
  const raw = j?.phoneme_id_map;
  if (raw && typeof raw === 'object') {
    for (const [ph, ids] of Object.entries(raw)) {
      if (Array.isArray(ids) && ids.every(isNumber)) phonemeIdMap[ph] = ids as number[];
    }
  }
  if (!phonemeIdMap['^'] || !phonemeIdMap['$'] || !phonemeIdMap['_']) {
    throw engineError('The voice configuration has no phoneme table.', false);
  }
  return {
    espeakVoice: voice,
    sampleRate,
    noiseScale: isNumber(inf?.noise_scale) ? inf.noise_scale : 0.667,
    lengthScale: isNumber(inf?.length_scale) ? inf.length_scale : 1,
    noiseW: isNumber(inf?.noise_w) ? inf.noise_w : 0.8,
    multiSpeaker: !!map && typeof map === 'object' && Object.keys(map).length > 0,
    phonemeIdMap,
  };
}

/** The model input for phonemized sentences: per sentence BOS, PAD, (phoneme, PAD)*, EOS. Unknown phonemes are skipped, as Piper does. */
export function phonemesToIds(sentences: string[][], map: Record<string, number[]>): number[] {
  const ids: number[] = [];
  for (const phonemes of sentences) {
    ids.push(...map['^'], ...map['_']);
    for (const ph of phonemes) {
      const mapped = map[ph];
      if (mapped) ids.push(...mapped, ...map['_']);
    }
    ids.push(...map['$']);
  }
  return ids;
}

/** Sentences for the phonemizer, so each gets its own boundaries. Text with no terminator is one sentence. */
export function splitSentences(text: string): string[] {
  return text.split(/(?<=[.!?…])\s+/).map(s => s.trim()).filter(Boolean);
}

/** The `callMain` arguments that phonemize `text` (one entry per sentence) for an espeak voice. */
export function piperPhonemizerArgs(espeakVoice: string, text: string): string[] {
  const sentences = splitSentences(text);
  return ['-l', espeakVoice, '--input', JSON.stringify(sentences.map(t => ({ text: t }))), '--espeak_data', '/espeak-ng-data'];
}

/** The phonemes of each sentence from the phonemizer's printed lines (non-JSON lines are skipped). */
export function parsePhonemizerLines(lines: string[]): string[][] {
  const out: string[][] = [];
  for (const line of lines) {
    let phonemes: unknown;
    try { phonemes = (JSON.parse(line) as { phonemes?: unknown }).phonemes; } catch { continue; }
    if (Array.isArray(phonemes)) out.push(phonemes.filter((p): p is string => typeof p === 'string'));
  }
  return out;
}

/** The speech rate, clamped to what the model handles. */
export function clampPiperRate(rate: unknown): number {
  const r = isNumber(rate) && rate > 0 ? rate : 1;
  return Math.min(4, Math.max(0.25, r));
}

/** The `scales` input: noise, length (stretched by rate), noise width. */
export function piperScales(config: PiperVoiceConfig, rate: unknown): Float32Array {
  return Float32Array.from([config.noiseScale, config.lengthScale / clampPiperRate(rate), config.noiseW]);
}

/** Samples of silence returned for empty text (0.1 s). */
export function piperSilenceSamples(config: PiperVoiceConfig): number {
  return Math.round(config.sampleRate * 0.1);
}
