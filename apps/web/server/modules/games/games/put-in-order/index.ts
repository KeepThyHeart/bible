/**
 * Put in order: a handful of events from one story go up shuffled, and the
 * room puts them back.
 *
 * The decisions that shape the payloads:
 *
 * - **an item is keyed by the letter it is shown under, never by where it
 *   belongs.** The phone payload is the cheapest thing in the room to read,
 *   and a key that carried the true position would be the answer printed in
 *   it. The letters are also what a room says aloud: "B before D".
 * - **the order on the screen is itself a wrong answer.** Tapping the list
 *   from the top down, or from the bottom up, earns at most a third of the
 *   round; see `ordering.ts`.
 * - **nearly right is paid.** Credit is by pairs the right way round, starting
 *   above what a shuffle gets by chance. A player who swapped two neighbours
 *   knew the story; one who reversed it did not. Also in `ordering.ts`.
 * - **the room is told how many got it right and how many nearly did**, as
 *   counts. Who was further off is on their own phone and nowhere else.
 *
 * Everyone with the same order earns the same, however late it arrived. The
 * room's tiebreak is the only place speed counts.
 *
 * Lists never repeat within a game while unplayed ones remain, and a list is
 * not followed by another from the same story when a different story is
 * available; see `pick.ts`.
 */

import type {
  AnswerValue,
  PersonalResult,
  PlayerId,
  RevealAggregate,
} from '../../../../../src/modules/games/shared/protocol.js';
import type {
  GameModule,
  Round,
  RoundBuildContext,
  RoundOutcome,
  ScoredAnswer,
} from '../../../../../src/modules/games/shared/games.js';
import { formatRef } from '../../../../../src/modules/games/shared/verseId.js';
import type { VerseId } from '../../../../../src/modules/games/shared/verseId.js';
import { FAMILIARITY_CEILING, orderedLists } from '../../content/index.js';
import type { OrderedListRecord } from '../../content/index.js';
import { displayOrder, gradeFor, pairCount, ranksOf, creditFor, wrongPairs } from './ordering.js';
import type { Grade } from './ordering.js';
import { chooseList, withinCeiling } from './pick.js';

export const GAME_ID = 'put-in-order';

/** A perfect order earns this; a nearly right one earns a share of it. */
export const POINTS = 100;

/**
 * Time to read the items and tap them into place. Ordering five things takes
 * longer than choosing one, so a round asks for at least this much per item
 * and takes the room's own window when that is longer.
 */
export const MS_PER_ITEM = 7_000;

/** For a list whose author left the instruction out. */
export const DEFAULT_INSTRUCTIONS = 'Put these in order.';

/** The letters items are shown under, on both screens, so they can be said aloud. */
export const ITEM_KEYS = ['A', 'B', 'C', 'D', 'E', 'F', 'G', 'H'] as const;

export function keyFor(position: number): string {
  return ITEM_KEYS[position] ?? String(position + 1);
}

/** Reveal rows, best first. */
export const GRADE_LABELS: Record<Grade, string> = {
  inOrder: 'All in order',
  oneSwap: 'One swap away',
  partly: 'Partly in order',
  furtherOff: 'Further off',
  unreadable: 'Not an ordering',
};

const GRADE_ORDER: readonly Grade[] = ['inOrder', 'oneSwap', 'partly', 'furtherOff', 'unreadable'];

/**
 * Rows the big screen always has, even at nought: they are the praise, and a
 * zero there is still the answer to the question the room is asking. The
 * others appear only when somebody landed in them.
 */
const ALWAYS_REPORTED: ReadonlySet<Grade> = new Set<Grade>(['inOrder', 'oneSwap']);

// ---------------------------------------------------------------------------
// What travels to the screens
// ---------------------------------------------------------------------------

export interface OrderItemView {
  key: string;
  label: string;
}

/**
 * The round as both screens see it while it is live: the items in the order
 * they are shown, and nothing about the order they belong in. Host and phone
 * are given the same object because there is nothing in it either may not see.
 */
export interface PutInOrderView {
  title: string;
  instructions: string;
  /** Shown top to bottom in this order. Empty when there was nothing to build from. */
  items: OrderItemView[];
}

export interface OrderedItemSecret {
  key: string;
  label: string;
  verseId: VerseId | null;
  note: string | null;
}

/** Never leaves the server until the round is scored. */
export interface PutInOrderSecret {
  listId: string;
  title: string;
  instructions: string;
  /** The right order, each item under the key it was shown with. */
  items: OrderedItemSecret[];
}

export interface RevealedItem {
  key: string;
  label: string;
  /** Already formatted, or null for an item with no single home, such as a book name. */
  reference: string | null;
  note: string | null;
}

export interface PutInOrderDetail {
  title: string;
  instructions: string;
  /** In the right order. */
  items: RevealedItem[];
  /** How many pairs the list holds, for a phone that explains its own score. */
  pairs: number;
}

// ---------------------------------------------------------------------------
// Building a round
// ---------------------------------------------------------------------------

export interface PutInOrderOptions {
  /**
   * Every list the game may choose from. Defaults to the content library;
   * injected by tests that want a known handful without a database.
   */
  lists?: () => readonly OrderedListRecord[];
}

/**
 * What both screens get when there is no list to put up: a server whose
 * content was never imported. The views say so in words rather than drawing
 * an empty list as though it were a question.
 */
const NOTHING: PutInOrderView = { title: '', instructions: '', items: [] };

function playedSoFar(context: RoundBuildContext<PutInOrderSecret | null>): string[] {
  const ids: string[] = [];
  for (const round of context.previous) {
    if (round.secret !== null) ids.push(round.secret.listId);
  }
  return ids;
}

function roundFrom(
  list: OrderedListRecord,
  index: number,
  context: RoundBuildContext<PutInOrderSecret | null>
): Round<PutInOrderSecret | null> {
  const shown = displayOrder(list.items.length, context.random);
  // The key follows the slot an item is shown in, so it says where the item
  // sits on the screen and nothing about where it belongs.
  const keys: string[] = [];
  shown.forEach((canonical, position) => {
    keys[canonical] = keyFor(position);
  });

  const instructions = list.instructions ?? DEFAULT_INSTRUCTIONS;
  const secret: PutInOrderSecret = {
    listId: list.id,
    title: list.title,
    instructions,
    items: list.items.map((item, canonical) => ({
      key: keys[canonical] ?? keyFor(canonical),
      label: item.label,
      verseId: item.verseId,
      note: item.note,
    })),
  };
  const view: PutInOrderView = {
    title: list.title,
    instructions,
    items: shown.map((canonical, position) => ({
      key: keyFor(position),
      label: list.items[canonical]?.label ?? '',
    })),
  };

  return {
    index,
    secret,
    hostView: view,
    playerView: view,
    answerWindowMs: Math.max(context.settings.answerWindowMs, list.items.length * MS_PER_ITEM),
  };
}

export function createPutInOrder(
  options: PutInOrderOptions = {}
): GameModule<PutInOrderSecret | null> {
  const lists = options.lists ?? (() => orderedLists());

  return {
    id: GAME_ID,
    name: 'Put in order',
    scopeLabel: 'Whole Bible',
    supportsSolo: true,
    // Draws lists by familiarity alone; no translation or set to pick.
    usesTranslation: false,
    usesSet: false,
    usesBuzz: false,

    buildRound(context, index): Round<PutInOrderSecret | null> {
      const reachable = withinCeiling(lists(), FAMILIARITY_CEILING[context.settings.familiarity]);
      const list = chooseList(reachable, playedSoFar(context), context.random);
      if (list === null) return { index, secret: null, hostView: NOTHING, playerView: NOTHING };
      return roundFrom(list, index, context);
    },

    scoreRound(round, answers): RoundOutcome {
      return scorePutInOrder(round.secret, answers);
    },
  };
}

/** The module the server runs, drawing from the content library. */
export const putInOrder = createPutInOrder();

// ---------------------------------------------------------------------------
// Scoring
// ---------------------------------------------------------------------------

/**
 * One answer per player: the first one they sent. The room already refuses a
 * second, and taking the earliest means that if it ever stops refusing, nobody
 * improves an order by watching the room.
 */
function firstPerPlayer(answers: readonly ScoredAnswer[]): ScoredAnswer[] {
  const seen = new Set<PlayerId>();
  const kept: ScoredAnswer[] = [];
  for (const answer of [...answers].sort((a, b) => a.at - b.at)) {
    if (seen.has(answer.playerId)) continue;
    seen.add(answer.playerId);
    kept.push(answer);
  }
  return kept;
}

function submittedOrder(value: AnswerValue): unknown {
  return value.type === 'order' ? value.order : null;
}

/**
 * The line on the player's own phone. It counts pairs rather than naming
 * items, because "4 of 6 pairs" explains the points and the reveal list above
 * it already shows where everything goes.
 */
function noteFor(grade: Grade, ranks: readonly number[]): string | null {
  const pairs = pairCount(ranks.length);
  const right = pairs - wrongPairs(ranks);
  switch (grade) {
    case 'inOrder':
      return null;
    case 'oneSwap':
      return 'One swap from perfect';
    case 'partly':
      return `${right} of ${pairs} pairs the right way round`;
    case 'furtherOff':
      return `${right} of ${pairs} pairs the right way round. Points start past half.`;
    case 'unreadable':
      return GRADE_LABELS.unreadable;
  }
}

function detailFor(secret: PutInOrderSecret): PutInOrderDetail {
  return {
    title: secret.title,
    instructions: secret.instructions,
    items: secret.items.map((item) => ({
      key: item.key,
      label: item.label,
      reference: item.verseId === null ? null : formatRef(item.verseId),
      note: item.note,
    })),
    pairs: pairCount(secret.items.length),
  };
}

export function scorePutInOrder(
  secret: PutInOrderSecret | null,
  answers: readonly ScoredAnswer[]
): RoundOutcome {
  const perPlayer = new Map<PlayerId, PersonalResult>();
  // A round with nothing on the screen has no right answer, so nobody is
  // marked for having looked at it.
  if (secret === null) return { perPlayer, aggregates: [], correctLabel: '', detail: null };

  const keys = secret.items.map((item) => item.key);
  const counts = new Map<Grade, number>();

  for (const answer of firstPerPlayer(answers)) {
    const ranks = ranksOf(submittedOrder(answer.value), keys);
    const grade: Grade = ranks === null ? 'unreadable' : gradeFor(ranks);
    counts.set(grade, (counts.get(grade) ?? 0) + 1);
    perPlayer.set(answer.playerId, {
      correct: grade === 'inOrder',
      pointsAwarded: ranks === null ? 0 : Math.round(POINTS * creditFor(ranks)),
      submitted: answer.value,
      note: ranks === null ? GRADE_LABELS.unreadable : noteFor(grade, ranks),
    });
  }

  // Counts per grade and nothing else: how the room did, never who did what.
  const aggregates: RevealAggregate[] = GRADE_ORDER.filter(
    (grade) => ALWAYS_REPORTED.has(grade) || (counts.get(grade) ?? 0) > 0
  ).map((grade) => ({ label: GRADE_LABELS[grade], count: counts.get(grade) ?? 0 }));

  return {
    perPlayer,
    aggregates,
    correctLabel: secret.items.map((item) => item.label).join(' → '),
    detail: detailFor(secret),
  };
}
