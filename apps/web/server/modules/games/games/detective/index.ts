/**
 * The detective game: a mystery person, a clue on every phone, and a vote.
 *
 * The big screen shows the vaguest clue and four names. Every other clue is
 * dealt out, one to a phone and never to the big screen, so nobody holds the
 * whole case: the room has to read its clues aloud and talk it over. Then each
 * group votes — a team, or the whole room with teams off — and the group's
 * majority is its answer.
 *
 * The room carries out the vote. This module scores plainly, one answer at a
 * time, and the group-vote wrapper applies the majority, the tie and the
 * everyone-scores-the-same rule around it, so the arithmetic that decides
 * whether a dissenter is paid lives in one place for every game played this
 * way. The vote can change until time runs out, because a group that is still
 * talking has not decided.
 *
 * Solo is not offered. One person holding one clue is not a case, it is a
 * guess.
 *
 * The cases are curated, tagged `detective`, and drawn at or under the room's
 * familiarity. A person is never the answer twice in one game.
 */

import type { GameModule, Round, RoundBuildContext, RoundOutcome, ScoredAnswer, Table } from '../../../../../src/modules/games/shared/games.js';
import type { AnswerValue, PersonalResult, PlayerId, RevealAggregate, RoomSettings } from '../../../../../src/modules/games/shared/protocol.js';
import { formatRef } from '../../../../../src/modules/games/shared/verseId.js';
import type { VerseId } from '../../../../../src/modules/games/shared/verseId.js';
import { FAMILIARITY_CEILING, contentKey, questions } from '../../content/index.js';
import type { QuestionFilter, QuestionRecord } from '../../content/index.js';
import { dealtAnywhere, dealtIndexFor, holdersOf } from './deal.js';

export const GAME_ID = 'detective';

/** The tag the content generator puts on every detective case. */
export const QUESTION_TAG = 'detective';

/** What every case asks, and what the generator puts in front of its vaguest clue. */
export const QUESTION = 'Who is the mystery person?';

/**
 * Four names: the person and the three most plausible wrong answers, which the
 * generator ranks first. Enough that a guess is worth little, few enough to
 * read aloud while a group argues.
 */
export const WRONG_OPTIONS = 3;

/** A case solved is worth the same to everyone in the group that solved it. */
export const POINTS = 100;

/**
 * The shortest time a case is open for. Reading four clues aloud and arguing
 * about them takes longer than answering a question does, so a room left at
 * the usual answer window would be cut off mid-sentence. A host who set a
 * longer window keeps it.
 */
export const MIN_DISCUSSION_MS = 90_000;

// ---------------------------------------------------------------------------
// What travels to the screens
// ---------------------------------------------------------------------------

export interface DetectiveOption {
  index: number;
  label: string;
}

/** The big screen: the public clue and the names. No dealt clue, ever. */
export interface DetectiveHostView {
  question: string;
  opening: string;
  options: DetectiveOption[];
}

/**
 * One phone, holding one clue. The clue's reference stays on the server until
 * the reveal, because "Exodus 2:5" is half of "Moses"; and nothing here says
 * which name is right.
 */
export interface DetectivePhoneView {
  clue: string;
  /** True when another phone in this player's group holds the same clue. */
  shared: boolean;
  options: DetectiveOption[];
}

/** A phone that joined after the deal. It is in from the next case. */
export interface DetectiveWaitingView {
  waiting: true;
}

export type ClueWhere = 'screen' | 'phones' | 'undealt';

export interface DetectiveRevealClue {
  text: string;
  /** Where the clue comes from, as a reader would write it; null if unsourced. */
  reference: string | null;
  /** On the big screen, dealt to phones, or left in the deck for a small group. */
  where: ClueWhere;
}

export interface DetectiveReveal {
  person: string;
  /** In the order they were offered, so a phone can name the option it voted for. */
  options: string[];
  correctIndex: number;
  /** The public clue first, then the dealt ones. */
  clues: DetectiveRevealClue[];
}

interface CaseClue {
  text: string;
  verseId: VerseId | null;
}

/** Never leaves the server; the views and the reveal are built from it. */
export interface DetectiveSecret {
  questionId: string;
  person: string;
  opening: CaseClue;
  /** The clues dealt to phones. */
  dealt: CaseClue[];
  options: string[];
  correctIndex: number;
  /** Turns the deck, so the first seat is not always handed the same clue. */
  dealOffset: number;
}

// ---------------------------------------------------------------------------
// Building a round
// ---------------------------------------------------------------------------

export interface DetectiveOptions {
  /**
   * Where cases come from. Defaults to the content library; injected by a test
   * that wants a known handful of people rather than the imported set.
   */
  questions?: (filter: QuestionFilter) => QuestionRecord[];
}

function shuffled<T>(items: readonly T[], random: () => number): T[] {
  const list = [...items];
  for (let index = list.length - 1; index > 0; index -= 1) {
    const swap = Math.min(Math.floor(random() * (index + 1)), index);
    const held = list[index] as T;
    list[index] = list[swap] as T;
    list[swap] = held;
  }
  return list;
}

function pickOne<T>(items: readonly T[], random: () => number): T | null {
  if (items.length === 0) return null;
  return items[Math.min(Math.floor(random() * items.length), items.length - 1)] ?? null;
}

/** A case with nothing to deal, or nothing to be wrong about, is not a case. */
function playable(question: QuestionRecord): boolean {
  return question.clues.length > 0 && question.distractors.length > 0;
}

/**
 * Who this game has already asked about, by name rather than by case, so two
 * cases about one person — which the content allows — still count as one.
 */
function alreadyAsked(context: RoundBuildContext<DetectiveSecret | null>): Set<string> {
  const asked = new Set<string>();
  for (const round of context.previous) {
    if (round.secret !== null) asked.add(contentKey(round.secret.person));
  }
  return asked;
}

/**
 * The case for this round: someone at or under the room's familiarity whom
 * this game has not asked about yet.
 *
 * When the room has run through everyone under its ceiling, the draw reaches
 * the nearest tier above rather than repeating somebody, as who-am-I does. A
 * repeated case is one the room has already solved; a person slightly less
 * well known than the setting promised is a mild surprise. A room set to `any`
 * has no ceiling to reach past.
 *
 * Questions arrive in id order, so a draw from the room's own generator is
 * reproducible from its seed.
 */
function chooseQuestion(
  source: (filter: QuestionFilter) => QuestionRecord[],
  context: RoundBuildContext<DetectiveSecret | null>
): QuestionRecord | null {
  const asked = alreadyAsked(context);
  const fresh = (question: QuestionRecord): boolean =>
    playable(question) && !asked.has(contentKey(question.answer));

  const ceiling = FAMILIARITY_CEILING[context.settings.familiarity];
  const filter: QuestionFilter = { tag: QUESTION_TAG };
  if (ceiling !== null) filter.maxDifficulty = ceiling;
  const underCeiling = source(filter).filter(fresh);
  if (underCeiling.length > 0) return pickOne(underCeiling, context.random);
  if (ceiling === null) return null;

  const beyond = source({ tag: QUESTION_TAG, minDifficulty: ceiling + 1 }).filter(fresh);
  if (beyond.length === 0) return null;
  const nearest = Math.min(...beyond.map((question) => question.difficulty));
  return pickOne(
    beyond.filter((question) => question.difficulty === nearest),
    context.random
  );
}

/**
 * The public clue, as the generator wrote it into the prompt. A hand-written
 * case that did not follow the pattern is shown whole rather than cut.
 */
export function openingOf(prompt: string): string {
  const trimmed = prompt.trim();
  return trimmed.startsWith(QUESTION) ? trimmed.slice(QUESTION.length).trim() : trimmed;
}

function secretFor(question: QuestionRecord, random: () => number): DetectiveSecret {
  const offered = shuffled([question.answer, ...question.distractors.slice(0, WRONG_OPTIONS)], random);
  const dealt = question.clues.map((clue) => ({ text: clue.text, verseId: clue.verseId }));
  return {
    questionId: question.id,
    person: question.answer,
    opening: { text: openingOf(question.prompt), verseId: question.promptVerseId },
    dealt,
    options: offered,
    correctIndex: offered.indexOf(question.answer),
    dealOffset: Math.min(Math.floor(random() * dealt.length), dealt.length - 1),
  };
}

function optionsOf(secret: DetectiveSecret): DetectiveOption[] {
  return secret.options.map((label, index) => ({ index, label }));
}

function windowFor(settings: RoomSettings): number {
  return Math.max(settings.answerWindowMs, MIN_DISCUSSION_MS);
}

/** The option a vote names, or null for anything that is not a vote on this case. */
function chosenIndex(secret: DetectiveSecret | null, value: AnswerValue): number | null {
  if (secret === null || value.type !== 'choice') return null;
  const index = value.index;
  return Number.isInteger(index) && index >= 0 && index < secret.options.length ? index : null;
}

/**
 * What one viewer is shown. Pure and cheap: it runs on every snapshot, and the
 * deal it reads was drawn when the round was built.
 */
export function detectiveViewFor(
  secret: DetectiveSecret | null,
  table: Table,
  viewer: PlayerId | null
): DetectiveHostView | DetectivePhoneView | DetectiveWaitingView | null {
  // Nothing to show is said by sending nothing: both screens already draw a
  // line of text for a payload they cannot read.
  if (secret === null) return null;
  const options = optionsOf(secret);
  if (viewer === null) return { question: QUESTION, opening: secret.opening.text, options };

  const clueCount = secret.dealt.length;
  const index = dealtIndexFor(table.seats, viewer, clueCount, secret.dealOffset);
  if (index === null) return { waiting: true };
  return {
    clue: secret.dealt[index]?.text ?? '',
    shared: holdersOf(table.seats, viewer, clueCount, secret.dealOffset) > 1,
    options,
  };
}

export function createDetective(options: DetectiveOptions = {}): GameModule<DetectiveSecret | null> {
  const source = options.questions ?? ((filter: QuestionFilter) => questions(filter));

  return {
    id: GAME_ID,
    name: 'Detective',
    scopeLabel: 'People of the Bible',
    supportsSolo: false,
    // Draws people by familiarity alone; no translation or set to pick.
    usesTranslation: false,
    usesSet: false,
    usesBuzz: false,
    groupVote: {
      mode: 'always',
      key: (value, round) => {
        const index = chosenIndex(round.secret, value);
        return index === null ? null : String(index);
      },
      label: (value, round) => {
        const index = chosenIndex(round.secret, value);
        return index === null ? '' : (round.secret?.options[index] ?? '');
      },
    },

    buildRound(context, index): Round<DetectiveSecret | null> {
      const question = chooseQuestion(source, context);
      // A server with nothing imported still runs its lobby; a round with no
      // case behind it draws "nothing to show" rather than an exception in
      // front of a group.
      if (question === null) return { index, secret: null, hostView: null, playerView: null };
      return {
        index,
        secret: secretFor(question, context.random),
        // Every view is computed per viewer, so these are never sent.
        hostView: null,
        playerView: null,
        answerWindowMs: windowFor(context.settings),
      };
    },

    viewFor(round, table, viewer) {
      return detectiveViewFor(round.secret, table, viewer);
    },

    accepts(round, table, playerId, value) {
      // Someone who joined after the deal holds no clue and belongs to no
      // group yet, so a vote from them could only be counted by accident.
      if (!table.seats.some((seat) => seat.playerId === playerId)) return false;
      return chosenIndex(round.secret, value) !== null;
    },

    scoreRound(round, answers, table): RoundOutcome {
      return scoreDetective(round.secret, answers, table);
    },
  };
}

/** The module the server runs, drawing from the content library. */
export const detective = createDetective();

// ---------------------------------------------------------------------------
// Scoring
// ---------------------------------------------------------------------------

/** One short line for a phone whose vote the game could not read. */
export const UNREADABLE_NOTE = 'Not one of the options';

/**
 * Plain scoring, one answer at a time. Under the vote the room calls this
 * twice: once with everyone's real votes, for the big screen's split, and once
 * per group with the group's choice given to every member, for the points.
 */
export function scoreDetective(
  secret: DetectiveSecret | null,
  answers: readonly ScoredAnswer[],
  table: Table
): RoundOutcome {
  const perPlayer = new Map<PlayerId, PersonalResult>();
  // A round with no case behind it has no right answer, so nobody is scored
  // for having tapped at an empty screen, and nobody is marked wrong either.
  if (secret === null) return { perPlayer, aggregates: [], correctLabel: '', detail: null };

  const counts = secret.options.map(() => 0);
  for (const answer of answers) {
    const index = chosenIndex(secret, answer.value);
    if (index === null) {
      perPlayer.set(answer.playerId, {
        correct: false,
        pointsAwarded: 0,
        submitted: answer.value,
        note: UNREADABLE_NOTE,
      });
      continue;
    }
    counts[index] = (counts[index] ?? 0) + 1;
    const correct = index === secret.correctIndex;
    perPlayer.set(answer.playerId, {
      correct,
      pointsAwarded: correct ? POINTS : 0,
      submitted: answer.value,
      note: null,
    });
  }

  // Every name gets a row even at zero: a suspect nobody voted for is part of
  // how the room split. Counts only; nobody is named.
  const aggregates: RevealAggregate[] = secret.options.map((label, index) => ({
    label,
    count: counts[index] ?? 0,
  }));

  const dealt = dealtAnywhere(table.seats, secret.dealt.length, secret.dealOffset);
  const referenceOf = (clue: CaseClue): string | null =>
    clue.verseId === null ? null : formatRef(clue.verseId);
  const detail: DetectiveReveal = {
    person: secret.person,
    options: [...secret.options],
    correctIndex: secret.correctIndex,
    clues: [
      { text: secret.opening.text, reference: referenceOf(secret.opening), where: 'screen' },
      ...secret.dealt.map((clue, index) => ({
        text: clue.text,
        reference: referenceOf(clue),
        where: dealt.has(index) ? ('phones' as const) : ('undealt' as const),
      })),
    ],
  };

  return { perPlayer, aggregates, correctLabel: secret.person, detail };
}
