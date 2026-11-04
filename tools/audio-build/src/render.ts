/**
 * Turn a prepared chapter into one continuous PCM signal and exact verse timings.
 *
 * Every verse is synthesized on its own; the signal is the intro, a gap, verse 1,
 * a gap, verse 2 ... Times come from sample counts, never from estimates:
 * `start = samples so far / rate`, `end = start + the verse's own samples / rate`.
 * The gap after a verse is silence between its end and the next start, so a
 * verse's span holds only its speech.
 */

import type { ITtsEngine, ManifestVerse } from './core';
import type { PreparedChapter } from './text';

export interface RenderSettings {
  rate: number;
  /** Silence after each verse, ms. */
  gapMs: number;
  /** Silence after the intro, ms. */
  introGapMs: number;
  /** Trim near-silent samples at the edges of each synthesized piece (keeps `padMs` of it). */
  trim?: boolean;
}

export const DEFAULT_RENDER: Readonly<RenderSettings> = { rate: 1, gapMs: 350, introGapMs: 700, trim: true };

export interface RenderedChapter {
  pcm: Float32Array;
  sampleRate: number;
  /** Seconds, rounded to milliseconds. */
  duration: number;
  intro?: [number, number];
  verses: ManifestVerse[];
}

const TRIM_THRESHOLD = 0.004;
const TRIM_PAD_MS = 40;

/** Drop leading and trailing near-silence, keeping a little so words are not clipped. */
export function trimSilence(pcm: Float32Array, sampleRate: number, padMs = TRIM_PAD_MS): Float32Array {
  let a = 0;
  let b = pcm.length;
  while (a < b && Math.abs(pcm[a]) < TRIM_THRESHOLD) a++;
  while (b > a && Math.abs(pcm[b - 1]) < TRIM_THRESHOLD) b--;
  if (a === b) return pcm.subarray(0, 0);
  const pad = Math.round((padMs / 1000) * sampleRate);
  return pcm.subarray(Math.max(0, a - pad), Math.min(pcm.length, b + pad));
}

const ms = (seconds: number): number => Math.round(seconds * 1000) / 1000;

export class RenderError extends Error {}

export async function renderChapter(
  engine: ITtsEngine,
  voiceId: string,
  chapter: PreparedChapter,
  settings: RenderSettings,
  signal: AbortSignal,
): Promise<RenderedChapter> {
  const parts: Float32Array[] = [];
  let sampleRate = 0;
  let samples = 0;
  const verses: ManifestVerse[] = [];
  let intro: [number, number] | undefined;

  const push = (pcm: Float32Array): void => { parts.push(pcm); samples += pcm.length; };
  const silence = (milliseconds: number): void => {
    const n = Math.round((milliseconds / 1000) * sampleRate);
    if (n > 0) push(new Float32Array(n));
  };
  const speak = async (text: string): Promise<{ start: number; end: number }> => {
    const res = await engine.synthesize({ text, voiceId, rate: settings.rate }, signal);
    if (sampleRate === 0) sampleRate = res.sampleRate;
    else if (res.sampleRate !== sampleRate) throw new RenderError(`The engine changed sample rate mid-chapter (${sampleRate} to ${res.sampleRate}).`);
    const pcm = settings.trim === false ? res.pcm : trimSilence(res.pcm, sampleRate);
    if (pcm.length === 0) throw new RenderError(`The engine produced no audio for: "${text.slice(0, 60)}"`);
    const start = samples;
    push(pcm);
    return { start, end: samples };
  };

  if (chapter.intro) {
    const span = await speak(chapter.intro);
    intro = [ms(span.start / sampleRate), ms(span.end / sampleRate)];
    silence(settings.introGapMs);
  }
  for (let i = 0; i < chapter.verses.length; i++) {
    const v = chapter.verses[i];
    const span = await speak(v.text);
    verses.push([v.verse, ms(span.start / sampleRate), ms(span.end / sampleRate)]);
    if (i < chapter.verses.length - 1) silence(settings.gapMs);
  }
  if (verses.length === 0) throw new RenderError('The chapter has no speakable text.');

  const pcm = new Float32Array(samples);
  let at = 0;
  for (const p of parts) { pcm.set(p, at); at += p.length; }
  // Round the duration up so the last verse never ends past it.
  const duration = Math.ceil((samples / sampleRate) * 1000) / 1000;
  return { pcm, sampleRate, duration, ...(intro ? { intro } : {}), verses };
}
