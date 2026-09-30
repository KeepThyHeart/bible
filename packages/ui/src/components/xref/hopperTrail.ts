/** Pure trail logic for the hopper view: the visited verses before the current one, oldest first. */
import type { VerseId } from '@bible/core/browser';

export interface HopperState {
  current: VerseId;
  /** Verses visited before `current`, oldest first. */
  trail: VerseId[];
}

/** Hop to `next`: the current verse joins the trail. Hopping to the current verse changes nothing. */
export function hopTo(state: HopperState, next: VerseId): HopperState {
  if (next === state.current) return state;
  return { current: next, trail: [...state.trail, state.current] };
}

/** Go back one step; at the start of the trail nothing changes. */
export function goBack(state: HopperState): HopperState {
  if (state.trail.length === 0) return state;
  return { current: state.trail[state.trail.length - 1], trail: state.trail.slice(0, -1) };
}

/** Jump to trail entry `index`; the entry becomes current and the trail is cut off before it. */
export function jumpTo(state: HopperState, index: number): HopperState {
  if (index < 0 || index >= state.trail.length) return state;
  return { current: state.trail[index], trail: state.trail.slice(0, index) };
}

/** Back to the first verse of the trail (or stay put when the trail is empty). */
export function resetTrail(state: HopperState): HopperState {
  if (state.trail.length === 0) return state;
  return { current: state.trail[0], trail: [] };
}

/** Start state, with an optional earlier trail (the current verse is never repeated at its end). */
export function initialState(anchor: VerseId, initialTrail: readonly VerseId[] = []): HopperState {
  const trail = initialTrail.filter((v, i, a) => !(i === a.length - 1 && v === anchor));
  return { current: anchor, trail };
}

/** Fill `{name}` placeholders in a label template. */
export function fillTemplate(template: string, values: Record<string, string | number>): string {
  return template.replace(/\{(\w+)\}/g, (m, k: string) => (k in values ? String(values[k]) : m));
}
