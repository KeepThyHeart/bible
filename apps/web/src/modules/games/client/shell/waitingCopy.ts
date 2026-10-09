/**
 * Shared wording for the two moments every game's phone view can have
 * nothing to draw for reasons that have nothing to do with the player:
 *
 * - `AWAITING_ROUND`: this round's payload has not arrived yet — a brief
 *   race around a reconnect, or the instant between rounds before the next
 *   one's view lands. Every game used to word this differently ("Nothing to
 *   answer this round.", "Nothing to find this round.", "Nothing to
 *   describe this turn.", "Nothing to show for this round." ...), none of
 *   which said why, so it read as broken rather than momentary.
 * - `AWAITING_REVEAL`: the round has been answered and scored, but the
 *   reveal payload itself has not arrived yet. Most games already agreed on
 *   this wording; the couple that did not are brought in line with it here.
 *
 * Neither of these is the message for a player genuinely left out of a
 * round — not dealt a seat, or watching a turn that is not theirs. That
 * wait is real, can last the whole round, and is worth explaining on its
 * own terms (see detective's and describe-it's own "waiting" states), so it
 * keeps its own wording rather than being folded in here.
 */
export const AWAITING_ROUND = 'Getting the question ready…';
export const AWAITING_REVEAL = 'Waiting for the answer.';
