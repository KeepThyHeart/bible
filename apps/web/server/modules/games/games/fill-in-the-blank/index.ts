/**
 * Fill in the blank.
 *
 * A verse goes up with one word missing and everybody types the word. It needs
 * no authored content at all — the verse text is the question — which is why it
 * is one of the two games a group can play the day a Bible module is installed.
 *
 * One decision shapes the payloads:
 *
 * - **the host and the phone are shown the same words.** The projector is not a
 *   second question; it is the same question, larger. Anything the phone would
 *   need that the projector must not carry lives in `secret`.
 *
 * The reference used to be withheld until the reveal, on the theory that
 * printing "John 3:16" over the blank turns the round into a race to open a
 * Bible app. **That call is deliberately overridden here:** the reference now
 * shows alongside the blanked text from the start of the round, for both host
 * and player (`BlankPrompt.reference`). It was a considered design choice
 * once, not an oversight, so if withholding it is ever wanted back, make that
 * call again rather than "fixing" this quietly.
 *
 * Speed is not a scoring input. Everyone right inside the window scores the
 * same, and the room's own tiebreak sorts the rest out.
 *
 * `answerPolicy: 'latest'`: a typed word can be replaced until time runs out
 * rather than locking in on the first send, and the round does not reveal
 * early just because everyone has sent something — someone still reading the
 * verse should not feel rushed by a bar racing toward an answer nobody asked
 * to see yet. Retyping is ordinary here, unlike a vote among fixed options,
 * so there was never a reason to lock a phone's box the moment it sent once.
 */

import { matchAnswer } from '../../../../../src/modules/games/shared/answers/match.js';
import { isBlank, normalise } from '../../../../../src/modules/games/shared/answers/normalise.js';
import { formatRef } from '../../../../../src/modules/games/shared/verseId.js';
import type { VerseId } from '../../../../../src/modules/games/shared/verseId.js';
import type {
  GameModule,
  Round,
  RoundBuildContext,
  RoundOutcome,
  ScoredAnswer,
} from '../../../../../src/modules/games/shared/games.js';
import type { PersonalResult, PlayerId, RevealAggregate } from '../../../../../src/modules/games/shared/protocol.js';
import { drawVerse } from '../../content/index.js';
import type { Verse, VerseDraw } from '../../content/index.js';
import { BLANK, chooseBlank, maskedText } from './blank.js';
import type { Blank } from './blank.js';

export const GAME_ID = 'fill-in-the-blank';

/** Everyone right inside the window earns this, whoever typed it first. */
export const POINTS = 100;

/**
 * A verse with fewer words than this has no context to recover a word from.
 * "Jesus wept." is a fine verse and a hopeless question.
 */
export const MIN_VERSE_WORDS = 8;

/**
 * How many verses to draw before giving up on a round. A verse can fail to
 * yield a blank — every word a function word, or the one content word repeated
 * — and drawing again is cheaper than asking a bad question. The cap exists so
 * that a module holding only such verses cannot spin.
 */
export const DRAW_ATTEMPTS = 8;

/** Wrong answers shown on the big screen, as counts and never as names. */
export const OTHER_ANSWERS_SHOWN = 3;

/**
 * What both screens are given while the round is live. Carries the reference
 * (see the module doc comment for why), but no clue to the missing word's
 * length: `blank` is a fixed-width marker.
 */
export interface BlankPrompt {
  /** Book, chapter and verse, e.g. "John 3:16". */
  reference: string;
  /** The verse with the missing word replaced by `blank`. */
  text: string;
  /** The marker used inside `text`, so a view can split on it and style it. */
  blank: string;
}

/** Never leaves the server until the round is scored. */
export interface BlankSecret {
  verseId: VerseId;
  reference: string;
  /** The missing word exactly as the verse prints it. */
  word: string;
  accept: string[];
  before: string;
  after: string;
}

/** What the reveal screens draw, on both sides. */
export interface BlankReveal {
  reference: string;
  word: string;
  /** The verse either side of the word, so the reveal can highlight it in place. */
  before: string;
  after: string;
}

/**
 * A round with no verse behind it. A server with no Bible module installed can
 * still open a room and run its lobby, and this is what happens if someone
 * starts anyway: empty screens that say so, rather than a crash in front of a
 * group.
 */
const NO_VERSE: BlankPrompt = { reference: '', text: '', blank: BLANK };

function prompt(verse: Verse, blank: Blank): BlankPrompt {
  return { reference: formatRef(verse.id), text: maskedText(blank), blank: BLANK };
}

function secretFor(verse: Verse, blank: Blank): BlankSecret {
  return {
    verseId: verse.id,
    reference: formatRef(verse.id),
    word: blank.word,
    accept: blank.accept,
    before: blank.before,
    after: blank.after,
  };
}

/** Verses this game has already asked about, so a round does not repeat one. */
function alreadyAsked(context: RoundBuildContext<BlankSecret | null>): VerseId[] {
  const ids: VerseId[] = [];
  for (const round of context.previous) {
    if (round.secret !== null) ids.push(round.secret.verseId);
  }
  return ids;
}

function drawBlank(
  context: RoundBuildContext<BlankSecret | null>
): { verse: Verse; blank: Blank } | null {
  const draw: VerseDraw = {
    familiarity: context.settings.familiarity,
    minWords: MIN_VERSE_WORDS,
    exclude: alreadyAsked(context),
  };
  for (let attempt = 0; attempt < DRAW_ATTEMPTS; attempt += 1) {
    const verse = drawVerse(draw, context.random, context.settings.translation);
    if (verse === null) return null;
    const blank = chooseBlank(verse.text, context.random);
    if (blank !== null) return { verse, blank };
  }
  return null;
}

function answerText(answer: ScoredAnswer): string | null {
  return answer.value.type === 'text' ? answer.value.text : null;
}

/**
 * Wrong answers, grouped by the spelling the matcher compares rather than by
 * what was typed, so that `worlde` and `World` are one row. The row is labelled
 * with the first submission that landed in it, because a screen full of
 * normalised lowercase reads as a bug.
 *
 * Nobody is named. A count is the whole of what the projector is told.
 */
function otherAnswers(answers: readonly ScoredAnswer[], correct: ReadonlySet<PlayerId>): RevealAggregate[] {
  const rows = new Map<string, RevealAggregate>();
  for (const answer of answers) {
    if (correct.has(answer.playerId)) continue;
    const text = answerText(answer);
    if (text === null || isBlank(text)) continue;
    const row = rows.get(normalise(text));
    if (row) row.count += 1;
    else rows.set(normalise(text), { label: text.trim(), count: 1 });
  }
  return [...rows.values()]
    .sort((a, b) => b.count - a.count || a.label.localeCompare(b.label))
    .slice(0, OTHER_ANSWERS_SHOWN);
}

export const fillInTheBlank: GameModule<BlankSecret | null> = {
  id: GAME_ID,
  name: 'Fill in the blank',
  scopeLabel: 'Whole Bible',
  supportsSolo: true,
  answerPolicy: 'latest',

  buildRound(
    context: RoundBuildContext<BlankSecret | null>,
    index: number
  ): Round<BlankSecret | null> {
    const drawn = drawBlank(context);
    if (drawn === null) {
      return { index, secret: null, hostView: NO_VERSE, playerView: NO_VERSE };
    }
    const view = prompt(drawn.verse, drawn.blank);
    // The projector and the phone are the same question, so they are the same
    // object; nothing answer-revealing is in it.
    return {
      index,
      secret: secretFor(drawn.verse, drawn.blank),
      hostView: view,
      playerView: view,
    };
  },

  scoreRound(round: Round<BlankSecret | null>, answers: ScoredAnswer[]): RoundOutcome {
    const secret = round.secret;
    const perPlayer = new Map<PlayerId, PersonalResult>();
    const correct = new Set<PlayerId>();

    for (const answer of answers) {
      const text = answerText(answer);
      // A round with no verse behind it has no right answer, so nobody is
      // marked wrong for having guessed at an empty screen.
      const result =
        secret === null || text === null
          ? { matched: false, near: false }
          : matchAnswer(text, secret.word, secret.accept);
      if (result.matched) correct.add(answer.playerId);
      perPlayer.set(answer.playerId, {
        correct: result.matched,
        pointsAwarded: result.matched ? POINTS : 0,
        submitted: answer.value,
        note: result.near ? 'Close enough!' : null,
      });
    }

    const label = secret?.word ?? '';
    const aggregates: RevealAggregate[] = [{ label, count: correct.size }];

    return {
      perPlayer,
      aggregates: [...aggregates, ...otherAnswers(answers, correct)],
      correctLabel: label,
      detail: secret === null
        ? null
        : ({
            reference: secret.reference,
            word: secret.word,
            before: secret.before,
            after: secret.after,
          } satisfies BlankReveal),
    };
  },
};

export { BLANK } from './blank.js';
