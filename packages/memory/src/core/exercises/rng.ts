/**
 * Determinism for the graded exercises.
 *
 * Two of the exercises make random choices - which words to blank, which
 * distractors to show and in what order - and both of them have to be
 * *reproducible*. The reason is not testing convenience, it is correctness of
 * the user's experience:
 *
 *   - A blanks step is served, the user submits, sees what they missed, and
 *     immediately practises the same card again. If the blanks moved, they
 *     never get to close the gap they just discovered.
 *   - A picker step that is re-served after a wrong pick (the ordering rung is
 *     blocking - see `ordering.ts`) must show the SAME candidates in the SAME
 *     order. Reshuffling on retry would mean the user's "not that one" mark
 *     pointed at a different verse each time, which reads as the app cheating.
 *
 * So nothing in `src/exercises/` calls `Math.random` directly. Every function
 * that needs randomness takes an `Rng` and defaults it to a seeded generator
 * derived from stable inputs (the verse id, the difficulty), which means two
 * calls with the same arguments produce the same answer with no caller state
 * to thread through.
 *
 * `crypto` does not exist in the QuickJS realm the extension runs in, and we
 * do not need it: this is presentation randomness, not security randomness.
 * mulberry32 is nine lines, has no dependencies, and passes well enough for
 * shuffling twelve verses.
 */

/** A uniform random source in [0, 1). `Math.random` satisfies this. */
export type Rng = () => number;

/**
 * mulberry32 - a 32-bit seeded PRNG.
 *
 * Chosen over an LCG because a plain LCG's low bits are famously non-random,
 * and `Math.floor(rng() * n)` for small `n` leans on exactly those bits: an
 * LCG here would visibly bias which candidate lands in which slot.
 */
export function mulberry32(seed: number): Rng {
  // `>>> 0` forces the seed into an unsigned 32-bit integer. A caller passing
  // a float or a negative number gets a usable generator rather than NaN.
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/**
 * Fold several integers into one 32-bit seed (FNV-1a over their bytes).
 *
 * Used to build the *default* seed for a call, e.g. `seedFrom(verseId,
 * difficultyTenths)`. Distinct inputs must give distinct-looking streams or
 * every verse in a passage would be blanked in the same shape.
 */
export function seedFrom(...values: number[]): number {
  let h = 0x811c9dc5;
  for (const value of values) {
    // Only the low 32 bits matter; `| 0` also flattens NaN/Infinity to 0
    // rather than poisoning the whole hash.
    let x = (Number.isFinite(value) ? Math.trunc(value) : 0) | 0;
    for (let i = 0; i < 4; i += 1) {
      h ^= x & 0xff;
      h = Math.imul(h, 0x01000193);
      x >>>= 8;
    }
  }
  return h >>> 0;
}

/**
 * Fisher-Yates, returning a new array. The input is never mutated because the
 * caller's array is usually a slice of live session state.
 */
export function shuffled<T>(items: readonly T[], rng: Rng): T[] {
  const out = items.slice();
  for (let i = out.length - 1; i > 0; i -= 1) {
    // A hostile or sloppy `Rng` that returns exactly 1 (or more) would index
    // past the end and silently drop an element, so clamp rather than trust.
    const raw = Math.floor(rng() * (i + 1));
    const j = raw < 0 ? 0 : raw > i ? i : raw;
    const swap = out[i];
    out[i] = out[j];
    out[j] = swap;
  }
  return out;
}

/**
 * Pick one index from `weights` with probability proportional to its weight.
 * Returns -1 when nothing is selectable (empty array, or all weights <= 0).
 *
 * Weights are the mechanism by which `blanks.ts` biases toward content words
 * without ever *excluding* function words: a low weight is rare, not
 * impossible, which is the behaviour the design asks for.
 */
export function weightedPick(weights: readonly number[], rng: Rng): number {
  let total = 0;
  for (const w of weights) {
    if (w > 0) total += w;
  }
  if (total <= 0) return -1;

  let target = rng() * total;
  for (let i = 0; i < weights.length; i += 1) {
    const w = weights[i];
    if (w <= 0) continue;
    target -= w;
    // `<= 0` rather than `< 0`: with rng() === 0 the first positive-weight
    // entry must win instead of falling through to the end.
    if (target <= 0) return i;
  }

  // Floating-point drift only. Fall back to the last positive weight.
  for (let i = weights.length - 1; i >= 0; i -= 1) {
    if (weights[i] > 0) return i;
  }
  return -1;
}
