/**
 * Fixture export: turn a recording (or a Piper/TTS rendering) into a 16 kHz mono 16-bit WAV plus the
 * `fixtures.json` entry the integration tests expect (`{ file, ref, voice, text, kind }`).
 *
 * The audio never leaves the page except as the file the user downloads.
 */

import type { ITtsEngine } from '@bible/core/browser';
import { SAMPLE_RATE } from './fakeMic';

export type FixtureKind = 'correct' | 'skip' | 'swap';

export interface FixtureEntry {
  file: string;
  ref: string;
  voice: string;
  text: string;
  kind: FixtureKind;
}

export function encodeWav(samples: Float32Array, rate: number = SAMPLE_RATE): ArrayBuffer {
  const buf = new ArrayBuffer(44 + samples.length * 2);
  const v = new DataView(buf);
  const str = (o: number, s: string): void => [...s].forEach((c, i) => v.setUint8(o + i, c.charCodeAt(0)));
  str(0, 'RIFF');
  v.setUint32(4, 36 + samples.length * 2, true);
  str(8, 'WAVE');
  str(12, 'fmt ');
  v.setUint32(16, 16, true);
  v.setUint16(20, 1, true);
  v.setUint16(22, 1, true);
  v.setUint32(24, rate, true);
  v.setUint32(28, rate * 2, true);
  v.setUint16(32, 2, true);
  v.setUint16(34, 16, true);
  str(36, 'data');
  v.setUint32(40, samples.length * 2, true);
  for (let i = 0; i < samples.length; i++) {
    const s = Math.max(-1, Math.min(1, samples[i]));
    v.setInt16(44 + i * 2, s < 0 ? s * 0x8000 : s * 0x7fff, true);
  }
  return buf;
}

export const fixtureFileName = (ref: string, voice: string, kind: FixtureKind): string =>
  `${ref.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '')}.${voice.toLowerCase().replace(/[^a-z0-9]+/g, '-')}.${kind}.wav`;

export function fixtureEntry(o: { ref: string; voice: string; text: string; kind: FixtureKind }): FixtureEntry {
  return { file: fixtureFileName(o.ref, o.voice, o.kind), ...o };
}

/** Render text with a TTS engine (Piper) to 16 kHz mono samples. The engine's voice must be prepared. */
export async function renderWithTts(engine: ITtsEngine, voiceId: string, text: string, signal: AbortSignal): Promise<Float32Array> {
  const r = await engine.synthesize({ text, voiceId, rate: 1 }, signal);
  return resampleTo16k(r.pcm, r.sampleRate);
}

export function resampleTo16k(pcm: Float32Array, rate: number): Float32Array {
  if (rate === SAMPLE_RATE) return pcm;
  const ratio = rate / SAMPLE_RATE;
  const out = new Float32Array(Math.floor(pcm.length / ratio));
  for (let i = 0; i < out.length; i++) {
    const from = i * ratio;
    const j = Math.floor(from);
    const f = from - j;
    out[i] = pcm[j] * (1 - f) + (pcm[Math.min(j + 1, pcm.length - 1)] ?? 0) * f;
  }
  return out;
}

export function download(name: string, data: BlobPart, type: string): void {
  const url = URL.createObjectURL(new Blob([data], { type }));
  const a = document.createElement('a');
  a.href = url;
  a.download = name;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 10_000);
}

/** Download the WAV and its fixtures.json entry (one JSON object per line, ready to paste into the array). */
export function exportFixture(samples: Float32Array, meta: { ref: string; voice: string; text: string; kind: FixtureKind }): FixtureEntry {
  const entry = fixtureEntry(meta);
  download(entry.file, encodeWav(samples), 'audio/wav');
  download(`${entry.file}.json`, JSON.stringify(entry, null, 2), 'application/json');
  return entry;
}
