/**
 * How the phone says which option it chose and how many clues it had seen, in
 * the one number a choice answer is allowed to carry.
 *
 * The wire's tapped answer is `{ type: 'choice', index }` and the transport
 * rebuilds it field by field, so nothing can ride beside the index. Solo play
 * needs something to — the player turns the clues over themselves, and only
 * the phone knows how far they got — so the clue count is folded into the
 * index: `option + OPTION_SLOTS × (cluesSeen − 1)`.
 *
 * The server keeps a twin of this file and the two must agree to the digit;
 * both test suites pin the same numbers. In group play the server's clock
 * overrules any claim to have seen fewer clues than it allows, so the claim can
 * only ever cost the player who makes it.
 */

/** Room for more options than any round offers. */
export const OPTION_SLOTS = 8;

export interface ChoiceCode {
  option: number;
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
