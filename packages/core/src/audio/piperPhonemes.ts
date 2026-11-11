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

import { hasPronunciation, splitPronunciation, stripPronunciation } from './pronunciation';
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

const phonemizerArgs = (espeakVoice: string, entries: string[]): string[] =>
  ['-l', espeakVoice, '--input', JSON.stringify(entries.map(t => ({ text: t }))), '--espeak_data', '/espeak-ng-data'];

/** The `callMain` arguments that phonemize `text` (one entry per sentence) for an espeak voice. Pronunciation markers are read as their words. */
export function piperPhonemizerArgs(espeakVoice: string, text: string): string[] {
  return phonemizerArgs(espeakVoice, splitSentences(stripPronunciation(text)));
}

/** One phonemizer run for a text that may carry pronunciation markers. */
export interface PiperPhonemizerPlan {
  /** `callMain` arguments: one entry per sentence, or per plain run of a sentence with markers. */
  args: string[];
  /** The phonemes of each sentence from the printed lines, or null when the output does not line up with the entries. */
  assemble(lines: string[]): string[][] | null;
}

type Piece = { entry: number } | { symbols: string[] };
type Run = { text: string } | { ipa: string[] };

const CLAUSE_PUNCTUATION = ',.;:!?';
const HAS_WORD = /[\p{L}\p{N}]/u;
const STRESS = new Set(['ˈ', 'ˌ']);
const IPA_VOWELS = new Set([...'aeiouæɐɑɒɔəɚɛɜɪʊʌᵻ']);

/**
 * Stand-in words for corrected words. espeak sees the whole sentence with these in place, so
 * the words around a correction keep their context ("the" before a vowel, "of the" run
 * together, unstressed "to"), then the stand-in's phonemes are swapped for the correction's.
 * One begins with a consonant, one with a vowel, chosen by the correction's first sound.
 */
export const PIPER_PLACEHOLDERS = { consonant: 'mango', vowel: 'olive' } as const;

/** The sentence's plain runs and corrections; a correction the voice cannot say is read as its word. */
function sentenceRuns(sentence: string, known?: (symbol: string) => boolean): Run[] {
  const runs: Run[] = [];
  for (const r of splitPronunciation(sentence)) {
    const symbols = r.kind === 'ipa' ? [...r.ipa] : null;
    if (symbols && (!known || symbols.every(known))) { runs.push({ ipa: symbols }); continue; }
    const t = r.kind === 'ipa' ? r.word : r.text;
    const last = runs[runs.length - 1];
    if (last && 'text' in last) last.text += t; else runs.push({ text: t });
  }
  return runs;
}

const startsWithVowel = (ipa: string[]): boolean => IPA_VOWELS.has(ipa.find(s => !STRESS.has(s)) ?? '');

const isBoundary = (s: string | undefined): boolean => s === undefined || s === ' ' || CLAUSE_PUNCTUATION.includes(s);

/**
 * Replace each stand-in, in order, in a sentence's phonemes with its correction. Matching
 * ignores stress marks (espeak may weaken the stand-in's stress in context) and needs a word
 * boundary on both sides. Null when a stand-in cannot be found.
 */
function swapPlaceholders(phonemes: string[], swaps: Array<{ pattern: string[]; ipa: string[] }>): string[] | null {
  const out: string[] = [];
  let at = 0;
  for (const { pattern, ipa } of swaps) {
    let found = -1;
    let end = -1;
    for (let i = at; i < phonemes.length && found < 0; i++) {
      if (STRESS.has(phonemes[i])) continue;
      if (!isBoundary([...phonemes.slice(0, i)].reverse().find(s => !STRESS.has(s)))) continue;
      let j = i;
      let k = 0;
      while (j < phonemes.length && k < pattern.length) {
        if (STRESS.has(phonemes[j])) { j++; continue; }
        if (phonemes[j] !== pattern[k]) break;
        j++; k++;
      }
      if (k === pattern.length && isBoundary(phonemes[j])) { found = i; end = j; }
    }
    if (found < 0) return null;
    // A stress mark right before the stand-in belongs to it (vowel-initial words).
    const begin = found > at && STRESS.has(phonemes[found - 1]) ? found - 1 : found;
    out.push(...phonemes.slice(at, begin), ...ipa);
    at = end;
  }
  out.push(...phonemes.slice(at));
  return out.filter((s, i) => s !== ' ' || out[i - 1] !== ' ');
}

/**
 * Plan the phonemizer run for `text`. A sentence without markers is one entry, exactly as
 * `piperPhonemizerArgs` (so unmarked text gets the same model input as before).
 *
 * - `placeholder` (preferred): a sentence with markers is one entry with a stand-in word in
 *   place of each correction (`PIPER_PLACEHOLDERS`); the stand-ins are also phonemized alone,
 *   and their phonemes in the sentence are swapped for the corrections'.
 * - `split` (fallback): a sentence with markers is cut at them; each plain run is its own entry
 *   and the correction goes between with a word space. The words next to a correction lose
 *   their context. espeak drops punctuation at the start of an entry, so that is emitted here.
 *
 * A marker whose IPA has a symbol the voice cannot say (`known`) is read as its word instead.
 */
export function planPiperPhonemizer(
  espeakVoice: string,
  text: string,
  known?: (symbol: string) => boolean,
  mode: 'placeholder' | 'split' = 'placeholder',
): PiperPhonemizerPlan {
  const entries: string[] = [];
  type Sentence = { pieces: Piece[]; swaps?: Array<{ placeholder: 'consonant' | 'vowel'; ipa: string[] }> };
  const sentences: Sentence[] = [];
  for (const sentence of splitSentences(text)) {
    if (!hasPronunciation(sentence)) {
      sentences.push({ pieces: [{ entry: entries.push(sentence) - 1 }] });
      continue;
    }
    const runs = sentenceRuns(sentence, known);
    if (mode === 'placeholder') {
      const swaps: NonNullable<Sentence['swaps']> = [];
      let plain = '';
      for (const r of runs) {
        if ('text' in r) { plain += r.text; continue; }
        const placeholder = startsWithVowel(r.ipa) ? 'vowel' : 'consonant';
        swaps.push({ placeholder, ipa: r.ipa });
        plain += PIPER_PLACEHOLDERS[placeholder];
      }
      sentences.push({ pieces: [{ entry: entries.push(plain) - 1 }], swaps });
      continue;
    }
    const pieces: Piece[] = [];
    let space = false;
    const add = (p: Piece): void => {
      if (space && pieces.length > 0) pieces.push({ symbols: [' '] });
      space = false;
      pieces.push(p);
    };
    for (const r of runs) {
      if ('ipa' in r) { add({ symbols: r.ipa }); continue; }
      const lead = /^[^\p{L}\p{N}]*/u.exec(r.text)![0];
      const punct = [...lead].filter(c => CLAUSE_PUNCTUATION.includes(c));
      if (punct.length > 0) { pieces.push({ symbols: punct }); space = true; }
      if (/[\s-]/.test(lead)) space = true;
      const body = r.text.slice(lead.length);
      if (HAS_WORD.test(body)) {
        add({ entry: entries.push(body) - 1 });
        if (/\s$/.test(body)) space = true;
      }
    }
    sentences.push({ pieces });
  }
  const swapped = sentences.some(x => x.swaps && x.swaps.length > 0);
  const standIns = swapped ? { consonant: entries.push(PIPER_PLACEHOLDERS.consonant) - 1, vowel: entries.push(PIPER_PLACEHOLDERS.vowel) - 1 } : null;
  return {
    args: phonemizerArgs(espeakVoice, entries),
    assemble(lines) {
      const printed = parsePhonemizerLines(lines);
      if (printed.length !== entries.length) return null;
      const patterns = standIns
        ? { consonant: printed[standIns.consonant].filter(s => !STRESS.has(s)), vowel: printed[standIns.vowel].filter(s => !STRESS.has(s)) }
        : null;
      const out: string[][] = [];
      for (const { pieces, swaps } of sentences) {
        const joined: string[] = [];
        for (const p of pieces) {
          for (const s of 'entry' in p ? printed[p.entry] : p.symbols) {
            if (s === ' ' && (joined.length === 0 || joined[joined.length - 1] === ' ')) continue;
            joined.push(s);
          }
        }
        if (!swaps || swaps.length === 0) { out.push(joined); continue; }
        const result = swapPlaceholders(joined, swaps.map(w => ({ pattern: patterns![w.placeholder], ipa: w.ipa })));
        if (!result) return null;
        out.push(result);
      }
      return out;
    },
  };
}

/**
 * Phonemize `text` (markers allowed) with `run`, which calls the phonemizer with the given
 * arguments and returns the lines it printed. Shared by the browser worker and the native
 * build tool. Stand-ins first; if they cannot be found in the output, the split plan; if
 * that does not line up either, the text without markers, rather than failing.
 */
export async function phonemizePiper(
  run: (args: string[]) => Promise<string[]>,
  espeakVoice: string,
  text: string,
  known?: (symbol: string) => boolean,
): Promise<string[][]> {
  if (!hasPronunciation(text)) return parsePhonemizerLines(await run(piperPhonemizerArgs(espeakVoice, text)));
  for (const mode of ['placeholder', 'split'] as const) {
    const plan = planPiperPhonemizer(espeakVoice, text, known, mode);
    const out = plan.assemble(await run(plan.args));
    if (out) return out;
  }
  return parsePhonemizerLines(await run(piperPhonemizerArgs(espeakVoice, text)));
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
