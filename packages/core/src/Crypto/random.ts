/** Randomness source. Production code always uses `defaultRandom`; tests inject a fixed one. */
export interface RandomSource {
  bytes(n: number): Uint8Array;
}

export const defaultRandom: RandomSource = {
  bytes(n: number): Uint8Array {
    const out = new Uint8Array(n);
    // getRandomValues is limited to 65536 bytes per call.
    for (let o = 0; o < n; o += 65536) {
      globalThis.crypto.getRandomValues(out.subarray(o, Math.min(n, o + 65536)));
    }
    return out;
  },
};

/**
 * Deterministic byte source for golden files and known-answer tests ONLY.
 * Output byte i of the whole stream is `(seed + i * 7 + 13) & 0xff` -- trivially
 * reproducible in any language, and never used for real keys.
 */
export function deterministicRandom(seed = 0): RandomSource {
  let counter = 0;
  return {
    bytes(n: number): Uint8Array {
      const out = new Uint8Array(n);
      for (let i = 0; i < n; i++) out[i] = (seed + counter++ * 7 + 13) & 0xff;
      return out;
    },
  };
}
