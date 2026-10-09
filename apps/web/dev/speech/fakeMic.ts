/**
 * A microphone that plays a WAV file, for repeatable demos, tests and benchmarks.
 *
 * The clip is consumed once, in real time, like a person speaking; the stream carries silence after
 * it ends (and while no stream is open the clip does not advance), so end-pointing behaves as it does
 * with a live mic. `rewind()` starts the clip over. Frames are 20 ms of 16 kHz mono, as the real mic.
 */

import type { IMicrophone, MicStream } from '@bible/core/speech';

export const SAMPLE_RATE = 16000;
export const FRAME = 320;

export interface DecodedWav {
  /** Mono, 16 kHz. */
  samples: Float32Array;
  seconds: number;
}

/** Decode a PCM16 / PCM24 / PCM32 / float32 WAV (any rate, mono or stereo) to 16 kHz mono. */
export function decodeWav(wav: ArrayBuffer): DecodedWav {
  const v = new DataView(wav);
  const tag = (o: number): string => String.fromCharCode(v.getUint8(o), v.getUint8(o + 1), v.getUint8(o + 2), v.getUint8(o + 3));
  if (wav.byteLength < 44 || tag(0) !== 'RIFF' || tag(8) !== 'WAVE') throw new Error('Not a WAV file');
  let fmt: { format: number; channels: number; rate: number; bits: number } | null = null;
  let dataAt = -1;
  let dataLen = 0;
  for (let o = 12; o + 8 <= wav.byteLength; ) {
    const size = v.getUint32(o + 4, true);
    if (tag(o) === 'fmt ') {
      let format = v.getUint16(o + 8, true);
      if (format === 0xfffe && size >= 26) format = v.getUint16(o + 8 + 24, true); // WAVE_FORMAT_EXTENSIBLE
      fmt = { format, channels: v.getUint16(o + 10, true), rate: v.getUint32(o + 12, true), bits: v.getUint16(o + 22, true) };
    } else if (tag(o) === 'data') {
      dataAt = o + 8;
      dataLen = Math.min(size, wav.byteLength - dataAt);
      break;
    }
    o += 8 + size + (size & 1);
  }
  if (!fmt || dataAt < 0) throw new Error('WAV has no fmt or data chunk');
  const { format, channels, rate, bits } = fmt;
  const bytes = bits / 8;
  if (!((format === 1 && (bits === 16 || bits === 24 || bits === 32)) || (format === 3 && bits === 32))) {
    throw new Error(`Unsupported WAV encoding (format ${format}, ${bits} bit)`);
  }
  const n = Math.floor(dataLen / (bytes * channels));
  const mono = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    let sum = 0;
    for (let c = 0; c < channels; c++) {
      const at = dataAt + (i * channels + c) * bytes;
      sum += format === 3 ? v.getFloat32(at, true)
        : bits === 16 ? v.getInt16(at, true) / 32768
        : bits === 24 ? ((v.getUint8(at) | (v.getUint8(at + 1) << 8) | (v.getInt8(at + 2) << 16)) / 8388608)
        : v.getInt32(at, true) / 2147483648;
    }
    mono[i] = sum / channels;
  }
  const samples = rate === SAMPLE_RATE ? mono : resampleLinear(mono, rate);
  return { samples, seconds: samples.length / SAMPLE_RATE };
}

/** Linear resample to 16 kHz (box-averaged first when downsampling by a lot). Good enough for a harness. */
function resampleLinear(input: Float32Array, rate: number): Float32Array {
  const ratio = rate / SAMPLE_RATE;
  const out = new Float32Array(Math.floor(input.length / ratio));
  for (let i = 0; i < out.length; i++) {
    const from = i * ratio;
    const to = Math.min(input.length, (i + 1) * ratio);
    if (ratio > 1.5) {
      let sum = 0;
      let count = 0;
      for (let j = Math.floor(from); j < Math.ceil(to); j++, count++) sum += input[j];
      out[i] = count ? sum / count : 0;
    } else {
      const j = Math.floor(from);
      const f = from - j;
      out[i] = input[j] * (1 - f) + (input[Math.min(j + 1, input.length - 1)] ?? 0) * f;
    }
  }
  return out;
}

export interface FakeMic extends IMicrophone {
  /** Start the clip over. */
  rewind(): void;
  readonly seconds: number;
}

export interface WavMicOptions {
  /** Frames per real second; 1 = real time. Values above 1 run faster than speech. Default 1. */
  speed?: number;
}

/** @param wav a WAV file; throws on an unsupported encoding. */
export function wavToMic(wav: ArrayBuffer, o: WavMicOptions = {}): FakeMic {
  const { samples, seconds } = decodeWav(wav);
  return pcmToMic(samples, seconds, o);
}

export function pcmToMic(samples: Float32Array, seconds: number, o: WavMicOptions = {}): FakeMic {
  const speed = Math.max(0.1, o.speed ?? 1);
  let pos = 0;
  return {
    seconds,
    rewind() {
      pos = 0;
    },
    async open(_opts, signal): Promise<MicStream> {
      if (signal.aborted) throw Object.assign(new Error('aborted'), { name: 'AbortError' });
      const listeners = new Set<(f: Float32Array) => void>();
      const started = performance.now();
      let sent = 0;
      let closed = false;
      const tick = (): void => {
        if (closed) return;
        const due = Math.floor(((performance.now() - started) * speed) / 20);
        for (; sent < due; sent++) {
          const frame = new Float32Array(FRAME);
          if (pos < samples.length) frame.set(samples.subarray(pos, pos + FRAME));
          pos += FRAME;
          for (const cb of listeners) cb(frame);
        }
      };
      const timer = setInterval(tick, 10);
      return {
        onFrame(cb) {
          listeners.add(cb);
          return () => listeners.delete(cb);
        },
        close() {
          closed = true;
          clearInterval(timer);
          listeners.clear();
        },
      };
    },
  };
}

export async function loadWavFromUrl(url: string): Promise<ArrayBuffer> {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`Could not load ${url} (${res.status})`);
  return res.arrayBuffer();
}

export const loadWavFromFile = (file: File): Promise<ArrayBuffer> => file.arrayBuffer();
