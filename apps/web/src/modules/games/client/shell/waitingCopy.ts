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
 *
 * Every waiting state says what is being waited on: the answer, the other
 * players, the organizer. The functions below word the ones that need a
 * translation or a count; the two constants are kept as they were.
 */

import { gt } from './t.js';

export const AWAITING_ROUND = 'Getting the question ready…';
export const AWAITING_REVEAL = 'Waiting for the answer.';

export function awaitingRound(): string {
  return gt('games.phone.awaitingRound', AWAITING_ROUND);
}

export function awaitingReveal(): string {
  return gt('games.phone.awaitingReveal', AWAITING_REVEAL);
}

/** After a player has sent an answer: the label above what they sent. */
export function sentLabel(): string {
  return gt('games.phone.sent', 'Sent');
}

/** After sending, until the round is revealed. */
export function waitingForAnswer(): string {
  return gt('games.phone.awaitingReveal', AWAITING_REVEAL);
}

/** After sending, while some players have not answered yet. */
export function waitingForPlayers(remaining: number): string {
  return remaining === 1
    ? gt('games.phone.waitingOnOne', 'Waiting for 1 more player.')
    : gt('games.phone.waitingOnMany', 'Waiting for {count} more players.', { count: remaining });
}

/** A phone that is not running the game, between games or before one starts. */
export function waitingForOrganizer(): string {
  return gt('games.phone.waitingOrganizer', 'Waiting for the organizer.');
}

/** A turn that belongs to someone else. */
export function waitingForTurn(name: string): string {
  return gt('games.phone.waitingTurn', 'Waiting for {name}.', { name });
}
