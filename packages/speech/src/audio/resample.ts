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

/**
 * Resample one chunk; state carries the remainder between calls.
 * Downsampling averages the input over each output sample's span (a box low-pass,
 * so energy below the new Nyquist is kept and aliasing is limited); upsampling is linear.
 */
export function resampleTo16k(input: Float32Array, inRate: number, state: ResampleState): Float32Array {
  if (inRate === TARGET_RATE) return input.slice();
  const buf = new Float32Array(state.buf.length + input.length);
  buf.set(state.buf);
  buf.set(input, state.buf.length);
  const r = inRate / TARGET_RATE;
  const out: number[] = [];
  let pos = state.pos;
  if (r >= 1) {
    while (pos + r <= buf.length) {
      const end = pos + r;
      let i = Math.floor(pos);
      let sum = 0;
      while (i < end) {
        const a = Math.max(pos, i);
        const b = Math.min(end, i + 1);
        sum += buf[i] * (b - a);
        i++;
      }
      out.push(sum / r);
      pos = end;
    }
  } else {
    while (Math.floor(pos) + 1 < buf.length) {
      const i = Math.floor(pos);
      const f = pos - i;
      out.push(buf[i] * (1 - f) + buf[i + 1] * f);
      pos += r;
    }
  }
  const drop = Math.floor(pos);
  state.buf = buf.slice(drop);
  state.pos = pos - drop;
  return Float32Array.from(out);
}
