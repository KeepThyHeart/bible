/**
 * Who am I: a person from the Bible, described in five clues, vaguest first.
 *
 * Four options are on the screen from the first clue, and one tap is all anyone
 * gets. A person who is sure at clue one earns full points; a person who waits
 * for clue five, where the famous deed usually is, earns a fifth. A wrong tap
 * sits that player out for the rest of the question — the owner chose that over
 * locking out only one clue, so the softening lives in the screens instead: the
 * phone says so before the tap, the lockout shows only on that phone, and the
 * big screen counts who got it at each clue and never names who did not.
 *
 * In group play the clues are paced by the server, so every phone shows clue two
 * at the same moment and "got it at clue two" means the same thing for
 * everybody. In solo the player turns them over, since a room of one has
 * nobody to be comparable with and waiting on a clock alone is tedious.
 *
 * The questions are curated, tagged `who-am-i`, and drawn at or under the
 * room's familiarity. A person is never asked twice in one game.
 *
 * A host can have teams vote together instead, and then there is no lockout:
 * see `TEAM_VOTE` for the rules and for which clue a team is paid at.
 */

import type {
  GameModule,
  GroupVoteSpec,
  Round,
  RoundBuildContext,
  RoundOutcome,
  ScoredAnswer,
} from '../../../../../src/modules/games/shared/games.js';
import { groupVoteApplies } from '../../../../../src/modules/games/shared/games.js';
import type {
  AnswerValue,
  PersonalResult,
  PlayerId,
  RevealAggregate,
  RoomSettings,
  ServerTime,
} from '../../../../../src/modules/games/shared/protocol.js';
import { formatRef } from '../../../../../src/modules/games/shared/verseId.js';
import type { VerseId } from '../../../../../src/modules/games/shared/verseId.js';
import { FAMILIARITY_CEILING, contentKey, questions } from '../../content/index.js';
import type { QuestionFilter, QuestionRecord } from '../../content/index.js';
import { decodeChoice } from './answerCode.js';
import {
  CLUE_INTERVAL_MS,
  MAX_CLUES,
  answerWindowMsFor,
  creditedClue,
  pointsForClue,
} from './pacing.js';

export const GAME_ID = 'who-am-i';

/** The tag the content generator puts on every who-am-I question. */
export const QUESTION_TAG = 'who-am-i';

/**
 * Four options: the person and the three most plausible wrong answers, which
 * the generator ranks first. Enough that a guess is worth little, few enough to
 * read from the back of a room while the clues are still arriving.
 */
export const WRONG_OPTIONS = 3;

/** One short line for the phone of a player whose tap the game could not read. */
export const UNREADABLE_NOTE = 'Not one of the options';

export type Pacing = 'server' | 'player';

// ---------------------------------------------------------------------------
// What travels to the screens
// ---------------------------------------------------------------------------

export interface WhoAmIOption {
  index: number;
  label: string;
}

/**
 * The question, as both screens receive it.
 *
 * All the clues travel at once, which is a known cost: a player reading the raw
 * payload could see clue five early. The alternative is a snapshot per clue,
 * which a game module cannot ask for — it has no clock and no way to schedule
 * one — and solo play, where the phone turns the clues itself, needs them all
 * on the phone anyway. What is withheld is what would settle the question: the
 * answer is not marked, and the clue references stay on the server, because
 * "Genesis 2:20" is half of "Adam".
 */
export interface WhoAmIView {
  pacing: Pacing;
  clues: string[];
  options: WhoAmIOption[];
  clueIntervalMs: number;
  /**
   * The length of the answering phase. A screen subtracts it from the room's
   * deadline to find when clue one appeared, so every clue after it is timed
   * from the server's clock rather than from when a message arrived.
   */
  answerWindowMs: number;
  /**
   * Present, and true, only when teams are voting together, so both screens
   * can explain the team's rules instead of the one-guess rule. Left off
   * otherwise, so a normal round's payload is exactly what it always was.
   */
  groupVote?: true;
}

export interface WhoAmIRevealClue {
  text: string;
  /** Where the clue comes from, as a reader would write it; null if unsourced. */
  reference: string | null;
  /** How many got it at this clue. A count; nobody is named. */
  gotIt: number;
  /** What a right answer at this clue earned. */
  points: number;
}

export interface WhoAmIReveal {
  person: string;
  clues: WhoAmIRevealClue[];
  /** The options in the order they were offered, so a phone can say what it chose. */
  options: string[];
  correctIndex: number;
  /** How many got it at all, which is the sum of the per-clue counts. */
  gotIt: number;
}

/** Never leaves the server until the round is scored. */
export interface WhoAmISecret {
  questionId: string;
  person: string;
  clues: { text: string; verseId: VerseId | null }[];
  options: string[];
  correctIndex: number;
  pacing: Pacing;
  clueIntervalMs: number;
}

// ---------------------------------------------------------------------------
// Building a round
// ---------------------------------------------------------------------------

export interface WhoAmIOptions {
  /**
   * Where questions come from. Defaults to the content library; injected by a
   * test that wants a known handful of people rather than the imported set.
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

/** A question with no clue or no wrong answer cannot be played as this game. */
function playable(question: QuestionRecord): boolean {
  return question.clues.length > 0 && question.distractors.length > 0;
}

/**
 * Who this game has already asked about, by name rather than by question, so
 * that two questions about one person — which the content allows — still count
 * as one person.
 */
function alreadyAsked(context: RoundBuildContext<WhoAmISecret | null>): Set<string> {
  const asked = new Set<string>();
  for (const round of context.previous) {
    if (round.secret !== null) asked.add(contentKey(round.secret.person));
  }
  return asked;
}

/**
 * The person for this round: someone at or under the room's familiarity whom
 * this game has not asked about yet.
 *
 * When the room has run through everyone under its ceiling, the draw reaches
 * one tier further rather than repeating somebody. A repeat inside one game is
 * the thing a room notices — everybody already knows the answer — while a
 * person slightly less well known than the setting promised is a mild surprise.
 * The nearest tier is used, so a room set to verses everyone knows that plays a
 * long game meets the well known next, not the obscure.
 *
 * Questions arrive in id order, so a draw from the room's own generator is
 * reproducible from its seed.
 */
function chooseQuestion(
  source: (filter: QuestionFilter) => QuestionRecord[],
  context: RoundBuildContext<WhoAmISecret | null>
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

function secretFor(question: QuestionRecord, settings: RoomSettings, random: () => number): WhoAmISecret {
  const offered = shuffled([question.answer, ...question.distractors.slice(0, WRONG_OPTIONS)], random);
  return {
    questionId: question.id,
    person: question.answer,
    clues: question.clues.slice(0, MAX_CLUES).map((clue) => ({ text: clue.text, verseId: clue.verseId })),
    options: offered,
    correctIndex: offered.indexOf(question.answer),
    pacing: settings.solo ? 'player' : 'server',
    clueIntervalMs: CLUE_INTERVAL_MS,
  };
}

function viewFor(secret: WhoAmISecret, voting: boolean): WhoAmIView {
  return {
    pacing: secret.pacing,
    clues: secret.clues.map((clue) => clue.text),
    options: secret.options.map((label, index) => ({ index, label })),
    clueIntervalMs: secret.clueIntervalMs,
    answerWindowMs: answerWindowMsFor(secret.clues.length),
    ...(voting ? { groupVote: true as const } : {}),
  };
}

// ---------------------------------------------------------------------------
// Voting as a team
// ---------------------------------------------------------------------------

/**
 * The option a guess names, or null for anything that is not one of this
 * round's options. The clue count folded into the index is left out on
 * purpose: one player naming Adam at clue one and another at clue three have
 * cast the same vote.
 */
function optionNamed(secret: WhoAmISecret | null, value: AnswerValue): number | null {
  if (secret === null || value.type !== 'choice') return null;
  const { option } = decodeChoice(value.index);
  return option < secret.options.length ? option : null;
}

/**
 * Who am I, decided by each team's majority.
 *
 * The one-guess lockout is off. A team talking it over has to be able to change
 * its mind, so the room keeps each player's latest vote until time runs out.
 * Alone there is nobody to vote with and the lockout is the game, so a solo
 * room never votes, whatever the switch says.
 *
 * A team is paid at the clue its majority first formed: the vote that took its
 * answer past half the team, counting everyone seated, voters or not. A
 * straggler who comes round to the right name later costs the team nothing.
 * Hedging still earns nothing early: a team that spreads its votes across
 * every name has no majority behind any of them, so it is paid at the clue
 * where enough of it closed in, never at clue one. An answer that wins
 * without ever holding more than half the team — a plurality with people
 * sitting out — is paid at its latest vote, which is the room's own reading.
 * A tap on the name a player already backs is not a vote at all; see
 * `accepts` below.
 */
export const TEAM_VOTE: GroupVoteSpec<WhoAmISecret | null> = {
  mode: 'optional',
  supports: (settings) => !settings.solo,
  key: (value, round) => {
    const option = optionNamed(round.secret, value);
    return option === null ? null : String(option);
  },
  label: (value, round) => {
    const option = optionNamed(round.secret, value);
    return option === null ? '' : (round.secret?.options[option] ?? '');
  },
  // The vote that made more than half the team. There is none when the answer
  // never held that many, and the room then falls back to its latest vote.
  represent: (backing, seated) => backing[Math.floor(seated / 2)],
};

export function createWhoAmI(options: WhoAmIOptions = {}): GameModule<WhoAmISecret | null> {
  const source = options.questions ?? ((filter: QuestionFilter) => questions(filter));

  return {
    id: GAME_ID,
    // No question mark, matching every other game's catalog name (this was
    // the one with one) — the in-game prompt ("Who am I?" on the actual
    // question screens) keeps its own, since that is a live line of speech
    // rather than a catalog label.
    name: 'Who am I',
    scopeLabel: 'People of the Bible',
    supportsSolo: true,
    // Draws people by familiarity alone; there is no translation or set to
    // pick between (`content/source/people.json`, read whole).
    usesTranslation: false,
    usesSet: false,
    usesBuzz: false,
    groupVote: TEAM_VOTE,

    /**
     * A second tap on the name this player already backs is refused, so that
     * re-tapping a vote can never move the team's clue later. In normal play
     * the room refuses every second guess anyway, so this changes nothing there.
     */
    accepts(round, table, playerId, value): boolean {
      const standing = table.log.filter((answer) => answer.playerId === playerId).at(-1);
      if (standing === undefined) return true;
      const before = optionNamed(round.secret, standing.value);
      return before === null || before !== optionNamed(round.secret, value);
    },

    buildRound(context, index): Round<WhoAmISecret | null> {
      const question = chooseQuestion(source, context);
      // A server with nothing imported still runs its lobby; a round with no
      // person behind it draws "nothing to show" on both screens rather than
      // an exception in front of a group.
      if (question === null) return { index, secret: null, hostView: null, playerView: null };

      const secret = secretFor(question, context.settings, context.random);
      const view = viewFor(secret, groupVoteApplies(TEAM_VOTE, context.settings));
      // The projector and the phone are the same question, so they are the
      // same object; nothing in it says which option is right.
      return {
        index,
        secret,
        hostView: view,
        playerView: view,
        answerWindowMs: view.answerWindowMs,
      };
    },

    scoreRound(round, answers): RoundOutcome {
      return scoreWhoAmI(round.secret, answers);
    },
  };
}

/** The module the server runs, drawing from the content library. */
export const whoAmI = createWhoAmI();

// ---------------------------------------------------------------------------
// Scoring
// ---------------------------------------------------------------------------

/**
 * When the answering phase opened, as the room saw it when this answer arrived:
 * already moved by any pause before the answer, and not by any after it.
 *
 * Null for an opening that is not a usable number. Then a round is scored at
 * the clue the phone reports, which is trusting, but a crash in front of a
 * group over a bad timestamp would be worse.
 */
export function openedAtOf(answer: ScoredAnswer): ServerTime | null {
  const opened: unknown = answer.openedAt;
  return typeof opened === 'number' && Number.isFinite(opened) ? opened : null;
}

/**
 * The opening to hold an answer to, or null when the clock has no say.
 *
 * In solo the player turns the clues over, so the room's clock says nothing
 * about which clue was showing: a player who lingered over clue one is still
 * on clue one, whatever the clock reads. There the phone is the only witness,
 * and its figure is exact.
 */
function clockOpeningFor(secret: WhoAmISecret, answer: ScoredAnswer): ServerTime | null {
  return secret.pacing === 'server' ? openedAtOf(answer) : null;
}

/**
 * One answer per player: the first one they sent. The room already refuses a
 * second, or under a team vote hands over only the vote that stood, and taking
 * the earliest means that if it ever stops refusing, nobody gets a second
 * guess by watching the clues.
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

export function clueLabel(clue: number): string {
  return `Clue ${clue}`;
}

export function scoreWhoAmI(
  secret: WhoAmISecret | null,
  answers: readonly ScoredAnswer[]
): RoundOutcome {
  const perPlayer = new Map<PlayerId, PersonalResult>();
  // A round with no person behind it has no right answer, so nobody is scored
  // for having tapped at an empty screen, and nobody is marked wrong either.
  if (secret === null) return { perPlayer, aggregates: [], correctLabel: '', detail: null };

  const gotIt = secret.clues.map(() => 0);

  for (const answer of firstPerPlayer(answers)) {
    const decoded = answer.value.type === 'choice' ? decodeChoice(answer.value.index) : null;
    if (decoded === null || decoded.option >= secret.options.length) {
      perPlayer.set(answer.playerId, {
        correct: false,
        pointsAwarded: 0,
        submitted: answer.value,
        note: UNREADABLE_NOTE,
      });
      continue;
    }

    const correct = decoded.option === secret.correctIndex;
    const clue = creditedClue({
      claimed: decoded.cluesSeen,
      at: answer.at,
      openedAt: clockOpeningFor(secret, answer),
      clueCount: secret.clues.length,
      intervalMs: secret.clueIntervalMs,
    });
    if (correct) gotIt[clue - 1] = (gotIt[clue - 1] ?? 0) + 1;
    perPlayer.set(answer.playerId, {
      correct,
      pointsAwarded: correct ? pointsForClue(clue) : 0,
      submitted: answer.value,
      // Only the phone that answered ever sees this line.
      note: correct ? `Got it at clue ${clue}` : null,
    });
  }

  /*
   * One row per clue, including the clues nobody answered at, because the
   * shape of the ladder is the story: a room that got it at clue one is a
   * different room from one that waited for five. Wrong answers are not
   * counted on the big screen at all. Praise is public; how many guessed wrong
   * is a number that only ever makes someone less willing to guess.
   */
  const aggregates: RevealAggregate[] = gotIt.map((count, position) => ({
    label: clueLabel(position + 1),
    count,
  }));

  const detail: WhoAmIReveal = {
    person: secret.person,
    clues: secret.clues.map((clue, position) => ({
      text: clue.text,
      reference: clue.verseId === null ? null : formatRef(clue.verseId),
      gotIt: gotIt[position] ?? 0,
      points: pointsForClue(position + 1),
    })),
    options: [...secret.options],
    correctIndex: secret.correctIndex,
    gotIt: gotIt.reduce((total, count) => total + count, 0),
  };

  return { perPlayer, aggregates, correctLabel: secret.person, detail };
}

export { decodeChoice, encodeChoice, OPTION_SLOTS } from './answerCode.js';
export {
  ARRIVAL_ALLOWANCE_MS,
  CLUE_INTERVAL_MS,
  FINAL_CLUE_MS,
  MAX_CLUES,
  ROUND_POINTS,
  answerWindowMsFor,
  clueShownAt,
  creditedClue,
  pointsForClue,
} from './pacing.js';
