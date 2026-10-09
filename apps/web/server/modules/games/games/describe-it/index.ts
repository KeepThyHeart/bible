/**
 * Describe It.
 *
 * One player describes the word or name on a card to their own team without
 * saying any of its four forbidden words, or any word on the card itself, and
 * the team shouts guesses. A round is one team's timed turn: a short "get
 * ready" that shows who is describing, then the turn timer, during which the
 * describer taps Got it or Pass as fast as the team can go.
 *
 * What each screen is given is the whole of the design:
 *
 * - **the describer's phone** holds the card, with Got it and Pass.
 * - **the describer's teammates** hold nothing to tap. They are guessing out
 *   loud, and a card on their phones would end the game.
 * - **the other team's phones** hold the card too, with "They said one". They
 *   are the ones listening for a forbidden word, so policing it belongs to
 *   them; a slip passes the card.
 * - **the big screen** shows the describing team, who is describing and the
 *   cards got so far. Never the card in play, never a passed card and never
 *   who called a slip, because a wall the guessers can see is a wall that
 *   answers for them, and a name beside a slip is a finger pointed.
 *
 * Points go to the describing team, the same to everyone on it, per card got.
 * With teams off the room is one team: the turn goes round everybody, and
 * nobody is on the other side to call a slip.
 *
 * A turn is a run of card taps rather than one answer, so it is collected as
 * a log. Every tap names the card it is about, and a tap is taken only when it
 * names the card in play: a network retry, or two phones calling the same slip
 * at once, lands on a card that has already moved on and changes nothing.
 */

import type {
  GameModule,
  Round,
  RoundBuildContext,
  RoundOutcome,
  ScoredAnswer,
  Seat,
  Table,
} from '../../../../../src/modules/games/shared/games.js';
import type {
  AnswerValue,
  HostChrome,
  PersonalResult,
  PhaseName,
  PlayerId,
  RoomSettings,
  TeamId,
} from '../../../../../src/modules/games/shared/protocol.js';
import { dealDeck, dealtBefore } from './deck.js';
import type { DescribeItCard } from './deck.js';
import { describerFor } from './rotation.js';

export const GAME_ID = 'describe-it';

/** What each card got is worth to every member of the describing team. */
export const POINTS_PER_CARD = 50;

/** The game option a host sets the turn length with, in whole seconds. */
export const TURN_SECONDS_OPTION = 'turnSeconds';

export const DEFAULT_TURN_MS = 60_000;

/**
 * Bounds on a host's turn length. Under twenty seconds a describer barely
 * reads the card; past three minutes the other team has stopped watching.
 */
export const MIN_TURN_SECONDS = 20;
export const MAX_TURN_SECONDS = 180;

/**
 * The "get ready" before the timer starts: long enough for the describer to
 * pick up their phone and the team to turn towards them, short enough that
 * nobody reads it as the game having stalled.
 */
export const GET_READY_MS = 5_000;

export type { DescribeItCard } from './deck.js';
export { DECK_SIZE } from './deck.js';
export { describerFor, groupsAtTable } from './rotation.js';

/** Never leaves the server; each view is cut from it per viewer. */
export interface DescribeItSecret {
  /** Dealt when the turn is built, in the order it will be played. */
  deck: DescribeItCard[];
  /** How many turns the game has, so the last one names nobody as next. */
  turns: number;
}

/** The face of a card, as the two phones that may see it draw it. */
export interface CardFace {
  concept: string;
  category: string;
  forbidden: string[];
}

/**
 * The big screen. `got` is the only card text in it: a card got is one the
 * whole room has just heard shouted, so it gives nothing away.
 */
export interface HostTurnView {
  role: 'host';
  teamId: TeamId | null;
  describer: PlayerId | null;
  got: string[];
  /** True once every card in the deck has been played, or when there were none. */
  deckOut: boolean;
  deckSize: number;
}

export interface DescriberView {
  role: 'describer';
  teamId: TeamId | null;
  /** Null once the deck is out. */
  card: CardFace | null;
  /** The index a tap on this card must carry. */
  cardIndex: number;
  deckOut: boolean;
  /** The card before this one was passed by the other team calling a slip. */
  called: boolean;
}

/** The describer's teammates: someone to listen to, and nothing to read. */
export interface GuesserView {
  role: 'guesser';
  teamId: TeamId | null;
  describer: PlayerId;
  gotCount: number;
}

/** The other team: the card, so they can hear a forbidden word when it comes. */
export interface WatcherView {
  role: 'watcher';
  teamId: TeamId | null;
  describer: PlayerId;
  card: CardFace | null;
  cardIndex: number;
  deckOut: boolean;
}

/** Someone who joined mid-turn, or a room with nobody seated. */
export interface WaitingView {
  role: 'waiting';
}

export type DescribeItView = HostTurnView | DescriberView | GuesserView | WatcherView | WaitingView;

/** What the end of a turn shows, on both screens. Passed cards are not in it. */
export interface DescribeItReveal {
  teamId: TeamId | null;
  describer: PlayerId | null;
  got: string[];
  deckOut: boolean;
  /** Who describes the next turn, or null after the last one. */
  next: { teamId: TeamId | null; describer: PlayerId } | null;
}

type CardTap = Extract<AnswerValue, { type: 'card' }>;

/** The card taps in a log, in order. Nothing else a room could hold counts. */
function cardTaps(log: readonly ScoredAnswer[]): CardTap[] {
  return log.flatMap((entry) => (entry.value.type === 'card' ? [entry.value] : []));
}

/** The concepts got, in the order they were got. */
function gotConcepts(deck: readonly DescribeItCard[], taps: readonly CardTap[]): string[] {
  const got: string[] = [];
  for (const tap of taps) {
    const card = deck[tap.card];
    if (tap.action === 'got' && card !== undefined) got.push(card.concept);
  }
  return got;
}

function faceOf(card: DescribeItCard | undefined): CardFace | null {
  if (card === undefined) return null;
  return { concept: card.concept, category: card.category, forbidden: [...card.forbidden] };
}

function seatOf(table: Table, playerId: PlayerId): Seat | undefined {
  return table.seats.find((seat) => seat.playerId === playerId);
}

/**
 * The turn length a host asked for, in milliseconds. A value that is not a
 * whole number of seconds is ignored rather than refused: these strings can
 * come from a client older or newer than this server, and a room that will not
 * start over a turn length is worse than one that plays a minute.
 */
export function turnMsFor(gameOptions: Record<string, string>): number {
  const raw = gameOptions[TURN_SECONDS_OPTION]?.trim();
  if (raw === undefined || !/^\d+$/u.test(raw)) return DEFAULT_TURN_MS;
  const seconds = Math.min(MAX_TURN_SECONDS, Math.max(MIN_TURN_SECONDS, Number(raw)));
  return seconds * 1_000;
}

/** "Blue" for `blue`: how the room says a team's name. */
function teamName(teamId: TeamId): string {
  return `${teamId.charAt(0).toUpperCase()}${teamId.slice(1)}`;
}

/** "Blue team got 5", or the whole room's count when there are no teams. */
export function turnLabel(teamId: TeamId | null, got: number): string {
  if (teamId === null) return `The room got ${got}`;
  return `${teamName(teamId)} team got ${got}`;
}

/**
 * True once every card in the deck has been played. The room ends the turn
 * there rather than leaving a team staring at an empty card until the timer
 * runs down. A deck that was empty from the start takes no tap, so the room
 * never asks, and that turn waits for the timer or the host.
 */
export function deckSpent(round: Round<DescribeItSecret>, table: Table): boolean {
  return cardTaps(table.log).length >= round.secret.deck.length;
}

/**
 * The host's chrome in the game's own words. A round is a turn rather than a
 * question, and an "Answered" count would be one tapping describer against a
 * room shouting, so it goes. The button out of a turn's end names the team up
 * next, from the same rotation the reveal reads.
 */
export function turnChrome(round: Round<DescribeItSecret>, table: Table): HostChrome {
  return {
    roundWord: 'Turn',
    revealLabel: 'End turn',
    nextLabel: nextTurnLabel(round, table),
    hideAnswered: true,
  };
}

function nextTurnLabel(round: Round<DescribeItSecret>, table: Table): string {
  if (round.index + 1 >= round.secret.turns) return 'Show the totals';
  const following = describerFor(round.index + 1, table.seats);
  if (following === null || following.teamId === null) return 'Start the next turn';
  return `Start ${teamName(following.teamId)}’s turn`;
}

export function viewForTurn(
  round: Round<DescribeItSecret>,
  table: Table,
  viewer: PlayerId | null,
  phase: PhaseName
): DescribeItView {
  const { deck } = round.secret;
  const describer = describerFor(round.index, table.seats);
  const taps = cardTaps(table.log);
  const cardIndex = taps.length;
  const deckOut = cardIndex >= deck.length;
  // The card waits for the clock. A describer who has it during the get-ready
  // starts describing in their head before the turn has begun, and a phone
  // that hides it still carries it. The other team's copy waits as well: there
  // is nothing to listen for until somebody is talking.
  const inPlay = phase === 'question' ? null : faceOf(deck[cardIndex]);

  if (viewer === null) {
    return {
      role: 'host',
      teamId: describer?.teamId ?? null,
      describer: describer?.playerId ?? null,
      got: gotConcepts(deck, taps),
      deckOut,
      deckSize: deck.length,
    };
  }

  const seat = seatOf(table, viewer);
  if (seat === undefined || describer === null) return { role: 'waiting' };
  const teamId = describer.teamId;

  if (viewer === describer.playerId) {
    return {
      role: 'describer',
      teamId,
      card: inPlay,
      cardIndex,
      deckOut,
      called: taps.at(-1)?.action === 'slip',
    };
  }
  if (seat.teamId === teamId) {
    return {
      role: 'guesser',
      teamId,
      describer: describer.playerId,
      gotCount: gotConcepts(deck, taps).length,
    };
  }
  return {
    role: 'watcher',
    teamId,
    describer: describer.playerId,
    card: inPlay,
    cardIndex,
    deckOut,
  };
}

/**
 * Whether the room should take this tap. Got it and Pass come only from the
 * describer; a slip only from a seat on another team, which with teams off is
 * nobody. The tap must name the card in play, and there must be one.
 */
export function acceptsTap(
  round: Round<DescribeItSecret>,
  table: Table,
  playerId: PlayerId,
  value: AnswerValue
): boolean {
  if (value.type !== 'card') return false;
  const describer = describerFor(round.index, table.seats);
  const seat = seatOf(table, playerId);
  if (describer === null || seat === undefined) return false;
  const cardIndex = cardTaps(table.log).length;
  if (value.card !== cardIndex || cardIndex >= round.secret.deck.length) return false;
  if (value.action === 'slip') return seat.teamId !== describer.teamId;
  return playerId === describer.playerId;
}

export function scoreTurn(
  round: Round<DescribeItSecret>,
  answers: readonly ScoredAnswer[],
  table: Table
): RoundOutcome {
  const { deck, turns } = round.secret;
  const describer = describerFor(round.index, table.seats);
  const taps = cardTaps(answers);
  const got = gotConcepts(deck, taps);

  // Only the describing team is scored. Everyone else gets no result at all,
  // so the other team's phones show no "+0" for a turn that was not theirs.
  const perPlayer = new Map<PlayerId, PersonalResult>();
  if (describer !== null) {
    for (const seat of table.seats) {
      if (seat.teamId !== describer.teamId) continue;
      perPlayer.set(seat.playerId, {
        correct: got.length > 0,
        pointsAwarded: got.length * POINTS_PER_CARD,
        submitted: null,
        note: null,
      });
    }
  }

  const following = round.index + 1 < turns ? describerFor(round.index + 1, table.seats) : null;
  const teamId = describer?.teamId ?? null;
  return {
    perPlayer,
    aggregates: [{ label: 'Got', count: got.length }],
    correctLabel: turnLabel(teamId, got.length),
    detail: {
      teamId,
      describer: describer?.playerId ?? null,
      got,
      deckOut: taps.length >= deck.length,
      next: following === null ? null : { teamId: following.teamId, describer: following.playerId },
    } satisfies DescribeItReveal,
  };
}

export const describeIt: GameModule<DescribeItSecret> = {
  id: GAME_ID,
  // Sentence case, matching every other game's catalog name (this was the
  // one in title case) — and see who-am-i/index.ts for the question-mark
  // side of the same normalisation.
  name: 'Describe it',
  // Describing to nobody is not a game.
  supportsSolo: false,
  answerPolicy: 'log',
  // A running score between turns turns the next describer's minute into a
  // chase; the totals wait for the end.
  standingsAtSummaryOnly: true,

  buildRound(context: RoundBuildContext<DescribeItSecret>, index: number): Round<DescribeItSecret> {
    const settings: RoomSettings = context.settings;
    return {
      index,
      secret: {
        deck: dealDeck(settings.familiarity, context.random, dealtBefore(context.previous)),
        turns: settings.rounds,
      },
      // Every view is computed per viewer; these are never sent.
      hostView: null,
      playerView: null,
      questionPhaseMs: GET_READY_MS,
      answerWindowMs: turnMsFor(settings.gameOptions),
    };
  },

  viewFor: viewForTurn,
  accepts: acceptsTap,
  roundComplete: deckSpent,
  hostChrome: turnChrome,

  scoreRound(round: Round<DescribeItSecret>, answers: ScoredAnswer[], table: Table): RoundOutcome {
    return scoreTurn(round, answers, table);
  },
};
