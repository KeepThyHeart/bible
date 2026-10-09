/**
 * Who said it: a line of Scripture goes up, the room names who said it.
 *
 * Four names, tapped, because a speaker's name is a spelling test on a phone
 * keyboard — `Nebuchadnezzar` — and this game is about remembering the story,
 * not the orthography. The wrong names come from the question itself, ranked by
 * how much each resembles the speaker, so that the round is hard for the reason
 * it should be: Rebekah and Rachel both said things to Jacob.
 *
 * The reference is withheld until the reveal. "Genesis 27" beside the
 * quotation narrows four names to two, and a room that can see the reference
 * is playing a lookup race. Once the answers are in, the verse is the most
 * useful thing on the screen: the line in its setting, in the room's own
 * translation, and who it was said to. (Fill in the blank once withheld its
 * own reference for the same reason; that design call was later reversed
 * there — see that module's doc comment — but the reasoning still holds here,
 * where the reference itself is most of the answer.)
 *
 * Everyone right inside the window earns the same. Nothing here reads the
 * clock; the room separates equal scores by time, which is the only place
 * speed belongs.
 *
 * A tap stands until time runs out and can be changed before then, whether or
 * not the room is voting as teams. A host can also have teams vote together;
 * the room then keeps each phone's latest tap as its vote and pays everyone
 * on a team what the team's majority chose. This module still scores one
 * answer at a time; all it adds is which name a tap was.
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
import { FAMILIARITY_CEILING, questions, translation } from '../../content/index.js';
import type { QuestionRecord } from '../../content/index.js';
import { WHO_SAID_IT_TAG, chooseQuestion } from './draw.js';
import { chooseDistractors, shuffled } from './options.js';

export const GAME_ID = 'who-said-it';

/** A round is worth the same to everyone who gets it right. */
export const ROUND_POINTS = 100;

/**
 * Reading time before the names appear, so the race is never to read. A
 * quotation is short, so the floor does most of the work; the ceiling is for
 * the rare long speech.
 */
export const READING_MS_PER_WORD = 260;
export const MIN_READING_MS = 3_000;
export const MAX_READING_MS = 10_000;

/** The reveal row for an answer the game could not read as one of the four. */
export const UNREADABLE_LABEL = 'Not one of the names';

// ---------------------------------------------------------------------------
// What travels to the screens
// ---------------------------------------------------------------------------

export interface SpeakerOption {
  index: number;
  label: string;
}

/**
 * The question, as both screens receive it. Host and phone get the same object
 * because nothing in it is private: which name is right, and where the line is
 * from, stay in the secret until the reveal.
 */
export interface WhoSaidItView {
  quote: string;
  options: SpeakerOption[];
}

export interface RevealedSpeaker {
  label: string;
  correct: boolean;
}

export interface WhoSaidItDetail {
  speaker: string;
  quote: string;
  /** `Genesis 27:19`, or empty when the question cites no verse. */
  reference: string;
  /** Who the words were said to, when the question records it. */
  listener: string | null;
  /** The whole verse in the room's translation, or empty when no module has it. */
  text: string;
  /** The translation `text` came from, which is not always the one the room named. */
  translation: string;
  options: RevealedSpeaker[];
}

export interface WhoSaidItSecret {
  questionId: string;
  speaker: string;
  quote: string;
  verseId: VerseId | null;
  reference: string;
  listener: string | null;
  text: string;
  translation: string;
  /** In the order the screens show them. */
  options: RevealedSpeaker[];
}

// ---------------------------------------------------------------------------
// Reading a question
// ---------------------------------------------------------------------------

const QUOTED = /[“"]([\s\S]+?)[”"]/u;

/**
 * The words alone, out of a prompt written `Who said, “…”`. The screens ask the
 * question in their own words and set the quotation large, so the prompt's
 * framing is dropped; a prompt with no quotation marks is shown whole rather
 * than refused, because it is still a question somebody wrote.
 */
export function quotationOf(prompt: string): string {
  const quoted = QUOTED.exec(prompt)?.[1];
  return (quoted ?? prompt).trim();
}

const SPOKEN_TO = /,\s*spoken to\s+(.+)$/iu;

/**
 * Who was being spoken to, out of a context note written `Genesis 22:7, spoken
 * to his father`. The note is prose for a judge rather than a field, so this is
 * a reading of the generator's wording, kept in one place: a note that does not
 * follow it simply has no listener.
 */
export function listenerOf(note: string | null): string | null {
  if (note === null) return null;
  const listener = SPOKEN_TO.exec(note)?.[1]?.trim();
  return listener !== undefined && listener.length > 0 ? listener : null;
}

/** The verse id is authoritative; the note is the fallback for a question without one. */
function referenceOf(question: QuestionRecord): string {
  if (question.promptVerseId !== null) return formatRef(question.promptVerseId);
  return (question.contextNote ?? '').replace(SPOKEN_TO, '').trim();
}

function wordCount(text: string): number {
  return text.split(/\s+/u).filter((word) => word.length > 0).length;
}

function readingMs(text: string): number {
  const paced = wordCount(text) * READING_MS_PER_WORD;
  return Math.min(MAX_READING_MS, Math.max(MIN_READING_MS, paced));
}

/**
 * The verse in the room's translation, falling back to whatever is installed.
 * A room that names a module nobody dropped in still deserves the verse on its
 * reveal, and the label says honestly which translation it got.
 */
function verseFor(
  verseId: VerseId | null,
  abbreviation: string
): { text: string; translation: string } {
  const module = translation(abbreviation) ?? translation();
  const verse = verseId === null ? null : (module?.verse(verseId) ?? null);
  if (module === null || verse === null) return { text: '', translation: '' };
  return { text: verse.text, translation: module.info.abbreviation };
}

// ---------------------------------------------------------------------------
// Building a round
// ---------------------------------------------------------------------------

type Context = RoundBuildContext<WhoSaidItSecret | null>;

function alreadyAsked(context: Context): Set<string> {
  const asked = new Set<string>();
  for (const round of context.previous) {
    if (round.secret !== null) asked.add(round.secret.questionId);
  }
  return asked;
}

function secretFor(question: QuestionRecord, context: Context): WhoSaidItSecret {
  const distractors = chooseDistractors(question.distractors, context.random);
  const options = shuffled(
    [
      { label: question.answer, correct: true },
      ...distractors.map((label) => ({ label, correct: false })),
    ],
    context.random
  );
  const verse = verseFor(question.promptVerseId, context.settings.translation);
  return {
    questionId: question.id,
    speaker: question.answer,
    quote: quotationOf(question.prompt),
    verseId: question.promptVerseId,
    reference: referenceOf(question),
    listener: listenerOf(question.contextNote),
    text: verse.text,
    translation: verse.translation,
    options,
  };
}

/**
 * The position of the name a tap chose, or null for anything that is not one
 * of this round's names. Under a team vote the null is what keeps a stale or
 * garbled tap from being counted as a vote at all.
 */
function tappedPosition(secret: WhoSaidItSecret | null, value: AnswerValue): number | null {
  if (secret === null || value.type !== 'choice') return null;
  return secret.options[value.index] === undefined ? null : value.index;
}

export const whoSaidIt: GameModule<WhoSaidItSecret | null> = {
  id: GAME_ID,
  name: 'Who said it',
  scopeLabel: 'Whole Bible',
  supportsSolo: true,
  // Draws from `content/source/sayings.json` by familiarity and translation;
  // there is no per-set content to choose between.
  usesSet: false,
  usesBuzz: false,
  // A tap stands until time runs out rather than locking in on the first
  // one, whether or not the room is voting as teams: a name picked from four
  // is a vote in the ordinary case too, not a race, and the round does not
  // reveal early just because everyone has tapped once.
  answerPolicy: 'latest',
  groupVote: {
    mode: 'optional',
    key: (value, round) => {
      const position = tappedPosition(round.secret, value);
      return position === null ? null : String(position);
    },
    label: (value, round) => {
      const position = tappedPosition(round.secret, value);
      return position === null ? '' : (round.secret?.options[position]?.label ?? '');
    },
  },

  buildRound(context: Context, index: number): Round<WhoSaidItSecret | null> {
    const question = chooseQuestion(
      questions({ tag: WHO_SAID_IT_TAG }),
      alreadyAsked(context),
      FAMILIARITY_CEILING[context.settings.familiarity],
      context.random
    );
    // No saying to ask: nothing imported, or every one asked already. Both
    // screens draw a line saying so for a null payload, which is the path a
    // phone on an older bundle already takes.
    if (question === null) return { index, secret: null, hostView: null, playerView: null };

    const secret = secretFor(question, context);
    const view: WhoSaidItView = {
      quote: secret.quote,
      options: secret.options.map((option, position) => ({ index: position, label: option.label })),
    };
    return {
      index,
      secret,
      hostView: view,
      playerView: view,
      questionPhaseMs: readingMs(secret.quote),
    };
  },

  scoreRound(round: Round<WhoSaidItSecret | null>, answers: ScoredAnswer[]): RoundOutcome {
    return scoreWhoSaidIt(round.secret, answers);
  },
};

// ---------------------------------------------------------------------------
// Scoring
// ---------------------------------------------------------------------------

/**
 * One answer per player: the first one they sent. The room already refuses a
 * second, or under a team vote hands over only the vote that stood, and taking
 * the earliest means that if it ever stops refusing, nobody improves an answer
 * by watching the room.
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

function resultFor(correct: boolean, value: AnswerValue, note: string | null): PersonalResult {
  return { correct, pointsAwarded: correct ? ROUND_POINTS : 0, submitted: value, note };
}

export function scoreWhoSaidIt(
  secret: WhoSaidItSecret | null,
  answers: readonly ScoredAnswer[]
): RoundOutcome {
  const perPlayer = new Map<PlayerId, PersonalResult>();
  // A round with nothing asked has no right answer, so nobody is marked wrong
  // for having tapped at an empty screen.
  if (secret === null) return { perPlayer, aggregates: [], correctLabel: '', detail: null };

  // Counted by position rather than by name, so two options that happened to
  // share a spelling could never pool their counts.
  const counts = secret.options.map(() => 0);
  let unreadable = 0;

  for (const answer of firstPerPlayer(answers)) {
    const position = answer.value.type === 'choice' ? answer.value.index : -1;
    const chosen = secret.options[position];
    if (chosen === undefined) {
      perPlayer.set(answer.playerId, resultFor(false, answer.value, UNREADABLE_LABEL));
      unreadable += 1;
      continue;
    }
    perPlayer.set(answer.playerId, resultFor(chosen.correct, answer.value, null));
    counts[position] = (counts[position] ?? 0) + 1;
  }

  /*
   * Every name gets a row even at zero, because a name nobody picked is part of
   * how the room split. An answer the game could not read is not, so that row
   * appears only when it happened. Rows are a label and a count and nothing
   * else: the big screen learns how the room divided, never who was where.
   */
  const aggregates: RevealAggregate[] = secret.options.map((option, position) => ({
    label: option.label,
    count: counts[position] ?? 0,
  }));
  if (unreadable > 0) aggregates.push({ label: UNREADABLE_LABEL, count: unreadable });

  const detail: WhoSaidItDetail = {
    speaker: secret.speaker,
    quote: secret.quote,
    reference: secret.reference,
    listener: secret.listener,
    text: secret.text,
    translation: secret.translation,
    options: secret.options.map((option) => ({ ...option })),
  };

  return { perPlayer, aggregates, correctLabel: secret.speaker, detail };
}
