/**
 * How a phone says which option it chose and how many clues it had seen, in
 * the one number a choice answer is allowed to carry.
 *
 * The wire has a single shape for a tapped answer, `{ type: 'choice', index }`,
 * and the transport rebuilds it field by field, so nothing can ride alongside
 * the index. Solo play needs something to: the player turns the clues over
 * themselves, and only the phone knows how far they got. So the clue count is
 * folded into the index — `option + OPTION_SLOTS × (cluesSeen − 1)` — and
 * unfolded here.
 *
 * This is a workaround for a missing field, kept to this file and its twin on
 * the client so that replacing it is a two-file change. A phone that sends a
 * plain index, from before this existed, unfolds as having seen one clue; in
 * group play the server's clock then overrules it upward, so an old phone is
 * never paid for a clue it did not answer at.
 */

/**
 * Room for more options than any round offers, so that unfolding never depends
 * on how many options this particular round had.
 */
export const OPTION_SLOTS = 8;

export interface ChoiceCode {
  /** Position in the round's options, counted from zero. */
  option: number;
  /** How many clues the phone was showing, counted from one. */
  cluesSeen: number;
}

export function encodeChoice(option: number, cluesSeen: number): number {
  const slot = Math.min(OPTION_SLOTS - 1, Math.max(0, Math.trunc(option)));
  const seen = Math.max(1, Math.trunc(cluesSeen));
  return slot + OPTION_SLOTS * (seen - 1);
}

export function decodeChoice(index: number): ChoiceCode {
  const whole = Math.max(0, Math.trunc(index));
  return {
    option: whole % OPTION_SLOTS,
    cluesSeen: Math.floor(whole / OPTION_SLOTS) + 1,
  };
}
