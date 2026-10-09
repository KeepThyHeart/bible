/**
 * Bench: model load time, real-time factor per clip, heap and model size, as JSON.
 *
 * Transcript text is not part of the result (only word counts and, when a reference is given, the
 * word error rate), so a result is safe to paste into a report.
 */

import type { ISttEngine } from '@bible/core/speech';

export interface BenchClip {
  name: string;
  /** 16 kHz mono. */
  samples: Float32Array;
  /** Expected text, for the WER. */
  ref?: string;
}

export interface ClipResult {
  name: string;
  audioSeconds: number;
  decodeMs: number;
  /** decode time / audio time; below 1 is faster than real time. */
  rtf: number;
  words: number;
  wer?: number;
}

export interface BenchResult {
  startedAt: string;
  device: string;
  model: string;
  modelBytes: number | null;
  loadMs: number;
  crossOriginIsolated: boolean;
  hardwareConcurrency: number | null;
  clips: ClipResult[];
  meanRtf: number | null;
  heap: { usedMB: number; totalMB: number; limitMB: number } | null;
}

declare global {
  interface Window {
    __speechBench?: BenchResult;
  }
}

const norm = (s: string): string[] =>
  s.toLowerCase().replace(/[^a-z0-9'\s]/g, ' ').split(/\s+/).filter(Boolean);

/** Word error rate: edit distance over words / reference length. */
export function wer(ref: string, hyp: string): number {
  const r = norm(ref);
  const h = norm(hyp);
  if (!r.length) return h.length ? 1 : 0;
  let prev = Array.from({ length: h.length + 1 }, (_, i) => i);
  for (let i = 1; i <= r.length; i++) {
    const cur = [i];
    for (let j = 1; j <= h.length; j++) {
      cur[j] = Math.min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + (r[i - 1] === h[j - 1] ? 0 : 1));
    }
    prev = cur;
  }
  return prev[h.length] / r.length;
}

export function heapSnapshot(): BenchResult['heap'] {
  const m = (performance as unknown as { memory?: { usedJSHeapSize: number; totalJSHeapSize: number; jsHeapSizeLimit: number } }).memory;
  const mb = (n: number): number => Math.round((n / 1048576) * 10) / 10;
  return m ? { usedMB: mb(m.usedJSHeapSize), totalMB: mb(m.totalJSHeapSize), limitMB: mb(m.jsHeapSizeLimit) } : null;
}

export interface BenchDeps {
  engine: ISttEngine;
  modelId: string;
  device: string;
  clips: BenchClip[];
  /** Loads (and, if needed, installs) the model; the time it takes is `loadMs`. */
  load(): Promise<void>;
  onStep?(label: string): void;
  signal?: AbortSignal;
}

export async function runBench(d: BenchDeps): Promise<BenchResult> {
  const signal = d.signal ?? new AbortController().signal;
  const startedAt = new Date().toISOString();
  d.onStep?.('Loading model');
  const t0 = performance.now();
  await d.load();
  const loadMs = Math.round(performance.now() - t0);

  const models = await d.engine.listModels();
  const modelBytes = models.find((m) => m.id === d.modelId)?.downloadBytes ?? null;

  const clips: ClipResult[] = [];
  for (const [i, clip] of d.clips.entries()) {
    d.onStep?.(`Clip ${i + 1} of ${d.clips.length}`);
    const w0 = performance.now();
    const t = await d.engine.transcribe(clip.samples, { language: 'en' }, signal);
    const wall = performance.now() - w0;
    const audioSeconds = clip.samples.length / 16000;
    const decodeMs = wall;
    clips.push({
      name: clip.name,
      audioSeconds: Math.round(audioSeconds * 100) / 100,
      decodeMs: Math.round(decodeMs),
      rtf: Math.round((decodeMs / 1000 / audioSeconds) * 1000) / 1000,
      words: t.words.length,
      ...(clip.ref !== undefined ? { wer: Math.round(wer(clip.ref, t.text) * 1000) / 1000 } : {}),
    });
  }
  const result: BenchResult = {
    startedAt,
    device: d.device,
    model: d.modelId,
    modelBytes,
    loadMs,
    crossOriginIsolated: typeof crossOriginIsolated === 'boolean' ? crossOriginIsolated : false,
    hardwareConcurrency: typeof navigator !== 'undefined' ? navigator.hardwareConcurrency ?? null : null,
    clips,
    meanRtf: clips.length ? Math.round((clips.reduce((n, c) => n + c.rtf, 0) / clips.length) * 1000) / 1000 : null,
    heap: heapSnapshot(),
  };
  window.__speechBench = result;
  return result;
}
