/**
 * Sword drill.
 *
 * A reference goes up on the big screen and everybody races to find it in
 * their own Bible, printed or on a phone. It needs no authored content: the
 * reference is the question and the verse is the answer, drawn from the curated
 * pool so that a room set to well-known verses is sent to Romans 8:28 rather
 * than to the back half of Judges.
 *
 * The settled design is what makes this more than a race to a button:
 *
 * - **tap order sets the queue, not the score.** Tapping "Found it" proves
 *   nothing; reading the verse aloud does. So the phone's one button is a buzz,
 *   and the room's clock-corrected buzz queue decides who reads first.
 * - **the host confirms down the queue.** A confirmation is worth the same to
 *   everyone who earns one, so the first finger on the button gains an earlier
 *   turn and nothing else. A wrong reading passes to the next in line.
 * - **anyone never reached is simply not scored.** They found it; nobody heard
 *   them read it. Their phone says they found it, and nothing about them
 *   reaches the big screen, so there is no reason to mash the button.
 *
 * The verse text never reaches a *player's* phone until the reveal — it would
 * let someone read it aloud without opening a Bible at all, which is the whole
 * game. **The host is the deliberate exception**: `hostView` carries the verse
 * text from the start of the round (`SwordDrillHostView`), so a host who does
 * not have the passage memorised can still confirm a reader's citation the
 * moment they hear it, rather than having to find and read the verse
 * themselves while the room waits. This is enforced by giving the host a
 * genuinely different view object, in keeping with privacy-by-projection
 * (ADR 0004) — never by trusting a client to hide a field it was actually
 * sent — and `playerView` is unchanged: still `{ reference, translation }` and
 * nothing else.
 *
 * **Getting onto the buzzer is not only a tap.** By default
 * (`gameOptions.buzzMode`, read by the client — nothing here builds a round
 * any differently either way) a phone has no button at all: the host reads
 * the reference aloud, listens for whoever actually found it, and taps that
 * player's own name to put them on the buzzer (`{cmd: 'callOn'}` in the room
 * protocol), landing them in the queue exactly where their own tap would
 * have. `buttons` mode keeps the original race-to-tap mechanic for a room
 * that wants it. Either way this module — the round, the scoring, the queue
 * itself — sees no difference at all; the choice lives entirely in the room
 * reducer (`admitsBuzzFrom`/`admitBuzz`/`handleCallOn`) and the client.
 */

import type {
  GameModule,
  Round,
  RoundBuildContext,
  RoundOutcome,
  ScoredAnswer,
} from '../../../../../src/modules/games/shared/games.js';
import type {
  PersonalResult,
  PlayerId,
  RevealAggregate,
  RoomSettings,
} from '../../../../../src/modules/games/shared/protocol.js';
import { formatRef } from '../../../../../src/modules/games/shared/verseId.js';
import type { VerseId } from '../../../../../src/modules/games/shared/verseId.js';
import { drawVerse } from '../../content/index.js';
import type { VerseDraw } from '../../content/index.js';

export const GAME_ID = 'sword-drill';

/** Every confirmed find earns this, whoever tapped first. */
export const POINTS = 100;

/**
 * The shortest search the round allows. The room's answer window is sized for
 * typing a word, and turning to a page in a printed Bible — in a hall, with a
 * child on one knee — takes longer than that. A host who has asked for a longer
 * window gets it; nobody gets less than this.
 */
export const MIN_SEARCH_MS = 45_000;

/** The one row the big screen is given: how many were heard and confirmed. */
export const CONFIRMED_LABEL = 'Confirmed';

/**
 * What a player whose reading the host passed on is told, on their own phone
 * and nowhere else.
 */
export const PASSED_NOTE = 'Not that one this time.';

/** The host's ruling on one reading aloud. */
export type Verdict = 'correct' | 'incorrect';

/**
 * What a player's phone is given while the round is live. The reference is
 * the question, so there is nothing here a player may not see; the verse
 * text is not in it, on purpose (see the module doc comment).
 */
export interface SwordDrillView {
  reference: string;
  translation: string;
}

/**
 * What the host alone is given while the round is live: the same reference,
 * plus the verse text, so the host can confirm a reader's citation the
 * instant they hear it rather than having to find and read the verse
 * themselves. See the module doc comment for why this is host-only.
 */
export interface SwordDrillHostView extends SwordDrillView {
  text: string;
}

/** Never leaves the server until the round is scored. */
export interface SwordDrillSecret {
  verseId: VerseId;
  reference: string;
  text: string;
  translation: string;
}

/** What the reveal screens draw, on both sides. */
export interface SwordDrillReveal {
  reference: string;
  text: string;
  translation: string;
  /**
   * Who was heard and confirmed, in the order they were. Praise is public, so
   * these are the only players the reveal identifies; nobody the host passed on
   * and nobody the host never reached is in it.
   */
  confirmed: PlayerId[];
}

/** How long the room searches before the round runs out on its own. */
export function searchWindowMs(settings: RoomSettings): number {
  return Math.max(MIN_SEARCH_MS, settings.answerWindowMs);
}

/** Verses this game has already sent the room to, so a round does not repeat one. */
function alreadyAsked(context: RoundBuildContext<SwordDrillSecret | null>): VerseId[] {
  const ids: VerseId[] = [];
  for (const round of context.previous) {
    if (round.secret !== null) ids.push(round.secret.verseId);
  }
  return ids;
}

/**
 * The host's ruling on an answer, or null when nobody ruled on it.
 *
 * Null is never guessed into a ruling. Crediting by arrival order instead would
 * pay whoever was reading when the host pressed "Reveal now", or the last reader
 * the host turned down — and paying someone for a wrong reading is worse than
 * paying nobody for a right one. Anything but the two rulings a host can give
 * reads as null too, so a ruling this game does not understand pays nobody.
 */
export function verdictOf(answer: ScoredAnswer): Verdict | null {
  const verdict: unknown = answer.verdict;
  return verdict === 'correct' || verdict === 'incorrect' ? verdict : null;
}

interface Ruling {
  verdict: Verdict;
  answer: ScoredAnswer;
}

/**
 * One ruling per player. A confirmation stands over anything else on file for
 * them, because the room never lets a confirmed reader buzz again and a
 * confirmation that could be overwritten would be a score that could vanish.
 */
function rulingsFrom(answers: readonly ScoredAnswer[]): Map<PlayerId, Ruling> {
  const rulings = new Map<PlayerId, Ruling>();
  for (const answer of [...answers].sort((a, b) => a.at - b.at)) {
    const verdict = verdictOf(answer);
    if (verdict === null) continue;
    if (rulings.get(answer.playerId)?.verdict === 'correct') continue;
    rulings.set(answer.playerId, { verdict, answer });
  }
  return rulings;
}

export function scoreSwordDrill(
  secret: SwordDrillSecret | null,
  answers: readonly ScoredAnswer[]
): RoundOutcome {
  const perPlayer = new Map<PlayerId, PersonalResult>();
  // A round with no verse behind it has nothing to find, so nobody is paid or
  // passed over for having looked.
  if (secret === null) {
    return { perPlayer, aggregates: [], correctLabel: '', detail: null };
  }

  const confirmed: Ruling[] = [];
  for (const [playerId, ruling] of rulingsFrom(answers)) {
    const found = ruling.verdict === 'correct';
    if (found) confirmed.push(ruling);
    perPlayer.set(playerId, {
      correct: found,
      pointsAwarded: found ? POINTS : 0,
      submitted: ruling.answer.value,
      note: found ? null : PASSED_NOTE,
    });
  }
  // An answer nobody ruled on — the host revealed while they were reading, or
  // the round ended before the queue reached them — gets no result at all:
  // no points, and no mark, which is the settled promise to anyone not reached.

  confirmed.sort((a, b) => a.answer.at - b.answer.at);
  const aggregates: RevealAggregate[] = [{ label: CONFIRMED_LABEL, count: confirmed.length }];

  return {
    perPlayer,
    aggregates,
    correctLabel: secret.reference,
    detail: {
      reference: secret.reference,
      text: secret.text,
      translation: secret.translation,
      confirmed: confirmed.map((ruling) => ruling.answer.playerId),
    } satisfies SwordDrillReveal,
  };
}

export const swordDrill: GameModule<SwordDrillSecret | null> = {
  id: GAME_ID,
  name: 'Sword drill',
  scopeLabel: 'Whole Bible',
  // The proof is a verse read aloud to somebody else. A room of one has
  // nobody to hear it, so a solo player would be confirming themselves.
  supportsSolo: false,
  usesBuzz: true,
  // Everyone the host hears read it has found it, not only the first. Each
  // confirmation passes the turn on, and an empty queue sends the room back to
  // searching until the time runs out or the host reveals.
  confirmsEveryBuzz: true,

  buildRound(
    context: RoundBuildContext<SwordDrillSecret | null>,
    index: number
  ): Round<SwordDrillSecret | null> {
    const { settings } = context;
    const draw: VerseDraw = { familiarity: settings.familiarity, exclude: alreadyAsked(context) };
    const verse = drawVerse(draw, context.random, settings.translation);

    // A server with no Bible module installed can still open a room. Starting
    // one anyway gives screens that say there is nothing to find, rather than a
    // reference nobody can check against a verse.
    if (verse === null) {
      return { index, secret: null, hostView: null, playerView: null };
    }

    const reference = formatRef(verse.id);
    const playerView: SwordDrillView = { reference, translation: settings.translation };
    const hostView: SwordDrillHostView = { ...playerView, text: verse.text };
    return {
      index,
      secret: { verseId: verse.id, reference, text: verse.text, translation: settings.translation },
      // The host alone gets the verse text, so they can confirm a citation
      // the moment they hear it — see the module doc comment. A player's
      // phone gets the reference and nothing else.
      hostView,
      playerView,
      // The search is the reading phase: the room is live for taps from the
      // moment the reference goes up, and the first tap freezes the clock
      // while the host listens.
      questionPhaseMs: searchWindowMs(settings),
    };
  },

  scoreRound(round: Round<SwordDrillSecret | null>, answers: ScoredAnswer[]): RoundOutcome {
    return scoreSwordDrill(round.secret, answers);
  },
};
