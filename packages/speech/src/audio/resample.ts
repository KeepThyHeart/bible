/** Streaming mono resampler to 16 kHz. Pure and dependency-free (also bundled into the AudioWorklet). */

export const TARGET_RATE = 16000;

export interface ResampleState {
  /** Input not yet consumed. */
  buf: Float32Array;
  /** Fractional read position inside buf. */
  pos: number;
}

export function createResampleState(): ResampleState {
  return { buf: new Float32Array(0), pos: 0 };
}

/** Low-pass edge as a fraction of the 16 kHz Nyquist (8 kHz). Speech energy sits below it. */
const CUTOFF_HZ = 7400;
/** Zero crossings of the sinc kept on each side of the centre (at the cutoff). */
const LOBES = 8;

/**
 * Resample one chunk; state carries the remainder between calls.
 * Windowed-sinc (Hann) low-pass at 7.4 kHz, evaluated at each output instant: keeps the band
 * Whisper listens to and keeps fricatives above 8 kHz from aliasing into it (a plain box
 * average was audibly worse on "s" and "th"). Upsampling uses the same kernel.
 */
export function resampleTo16k(input: Float32Array, inRate: number, state: ResampleState): Float32Array {
  if (inRate === TARGET_RATE) return input.slice();
  const buf = new Float32Array(state.buf.length + input.length);
  buf.set(state.buf);
  buf.set(input, state.buf.length);
  const step = inRate / TARGET_RATE;
  const fc = Math.min(CUTOFF_HZ, inRate / 2 - 1) / inRate; // cycles per input sample
  const half = Math.ceil(LOBES / (2 * fc));
  const out: number[] = [];
  let pos = state.pos;
  // pos is relative to buf; the first `half` samples of history may be missing at stream start (zeros).
  while (pos + half < buf.length) {
    const c = Math.floor(pos);
    let sum = 0;
    let norm = 0;
    for (let k = c - half + 1; k <= c + half; k++) {
      const x = k - pos;
      const w = 0.5 + 0.5 * Math.cos((Math.PI * x) / half);
      const arg = 2 * fc * x;
      const h = (arg === 0 ? 1 : Math.sin(Math.PI * arg) / (Math.PI * arg)) * w;
      if (k >= 0) {
        sum += buf[k] * h;
        norm += h;
      }
    }
    out.push(sum / norm);
    pos += step;
  }
  const drop = Math.max(0, Math.floor(pos) - half);
  state.buf = buf.slice(drop);
  state.pos = pos - drop;
  return Float32Array.from(out);
}
