/** Pure maths for a two-pointer (pinch) gesture along the x axis. */
export interface PinchStep {
  /** New distance / old distance; > 1 zooms in. */
  ratio: number;
  /** Midpoint of the two pointers after the move (client x). */
  mid: number;
  /** Midpoint movement since the previous positions. */
  midDelta: number;
}

/** null when a pointer is too close to the other to give a stable ratio. */
export function pinchStep(prev: readonly [number, number], next: readonly [number, number], minDistance = 8): PinchStep | null {
  const d0 = Math.abs(prev[1] - prev[0]);
  const d1 = Math.abs(next[1] - next[0]);
  if (d0 < minDistance || d1 < minDistance) return null;
  return { ratio: d1 / d0, mid: (next[0] + next[1]) / 2, midDelta: (next[0] + next[1]) / 2 - (prev[0] + prev[1]) / 2 };
}
