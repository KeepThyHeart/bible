/**
 * Name that reference: the verse is on the screen, the room says where it is
 * from.
 *
 * Two answer shapes, and the round says which one it is using so that the
 * phone never has to know the game's settings. Multiple choice is the default
 * because four large buttons keep a whole group moving and cost nobody a
 * spelling; a typed reference is the same question without the scaffolding,
 * and it is scored with partial credit, because someone who knows a verse is
 * in Romans and guesses the chapter wrong knows a great deal more than someone
 * who said Ezekiel.
 *
 * Everyone right inside the window earns the same. Nothing here reads the
 * clock: the room already records how long a correct answer took and separates
 * two equal scores with it, which is the only place speed belongs.
 *
 * How hard a round is is not a property of the verse — it is `closeness`, how
 * far the wrong options were drawn from the right one, independent of how
 * well-known the verse itself is (that is `familiarity`, a room-wide
 * setting). The rungs it dials between live in `distractors.ts`, which is
 * where the interesting part of this game is.
 *
 * Either shape stands until time runs out and can be changed until then —
 * the room does not reveal early just because everyone has answered once, nor
 * lock a phone the moment it taps or sends. A host can also have teams vote
 * together on the tapped shape; the room then keeps each phone's latest tap
 * as its vote and pays everyone on a team what the team's majority chose. The
 * typed shape cannot be voted on: a reference picked from three dials is not
 * one of a few options a team can count, and its partial credit belongs to
 * the person who recalled it.
 */

import type {
  AnswerValue,
  PersonalResult,
  PlayerId,
  RevealAggregate,
  RoomSettings,
} from '../../../../../src/modules/games/shared/protocol.js';
import type { GameModule, Round, RoundOutcome, ScoredAnswer } from '../../../../../src/modules/games/shared/games.js';
import { formatRef, fromVerseId } from '../../../../../src/modules/games/shared/verseId.js';
import type { VerseId } from '../../../../../src/modules/games/shared/verseId.js';
import { drawVerse, translation } from '../../content/index.js';
import type { Verse, VerseDraw, VerseFilter } from '../../content/index.js';
import { DISTANCES, drawDistractors } from './distractors.js';
import type { Distance, VerseSource } from './distractors.js';

export const GAME_ID = 'name-that-reference';

export type AnswerShape = 'choice' | 'reference';

/**
 * How far every wrong option is drawn from the truth — the whole difficulty
 * knob of this game, and a host setting in its own right, independent of
 * `familiarity` (how well-known the *true* verse is). It rides the same
 * five-rung ladder `distractors.ts` already partitions the canon into; there
 * is no separate "difficulty" concept layered on top of it, because for this
 * game there never was one — every knob difficulty used to turn was really
 * this one, just hidden behind three names instead of the ladder itself. See
 * `readGameOptions` for the settings this replaces.
 */
export type Closeness = Distance;

/** Nearest first, same order the ladder in `distractors.ts` walks. */
export const CLOSENESS_LEVELS: readonly Closeness[] = DISTANCES;

/**
 * Host-facing wording, in words a host recognises rather than the module's
 * own vocabulary of rungs.
 */
export const CLOSENESS_LABELS: Readonly<Record<Closeness, string>> = {
  chapter: 'Same chapter — hard mode',
  book: 'Same book, different chapter',
  section: 'Same section of the canon',
  testament: 'Different testament',
  anywhere: 'Anywhere in the Bible',
};

/**
 * Four options: enough that a guess is worth little, few enough to read from
 * the back of a room and to tap without looking.
 */
export const DISTRACTOR_COUNT = 3;

/**
 * A room nobody has configured plays this rung: every wrong option a
 * different book from the true one, which is a real question (nothing about
 * the choices gives the true book away) without demanding the exact chapter
 * and verse recall that `chapter` or `book` would.
 */
export const DEFAULT_CLOSENESS: Closeness = 'section';

/**
 * Every wrong option comes from the *same* rung. This is deliberate, not a
 * simplification: mixing rungs is what produced the reported default
 * experience of three closely-grouped references and one obvious outlier,
 * because `distractors.ts` partitions the canon so that any rung nearer than
 * `section` never leaves the true verse's own book. Combine such a rung with
 * one that always does — `standard` used to offer `chapter`, `book` *and*
 * `section` together — and three of the four options share a book while the
 * fourth conspicuously does not, which is a tell a room learns after one
 * round and needs no verse knowledge at all to use. A single rung, offered
 * uniformly, never creates that asymmetry: every option is equally near or
 * far, so only knowing the verse decides it.
 */
export function mixFor(closeness: Closeness): readonly Distance[] {
  return Array.from({ length: DISTRACTOR_COUNT }, () => closeness);
}

/** A round is worth the same to everyone who gets it right. */
export const ROUND_POINTS = 100;

/**
 * Partial credit, for the typed shape only. Naming the book is most of the
 * recall; the chapter is the rest of it; the verse number is the part a person
 * can know a passage well and still miss.
 */
export const BOOK_POINTS = 40;
export const BOOK_AND_CHAPTER_POINTS = 70;

/**
 * A three-word verse is a memory test rather than a reference question, so the
 * draw skips them unless the host's own filter says otherwise.
 */
export const DEFAULT_MIN_WORDS = 8;

/** Reading time before the options appear, so the race is never to read. */
export const READING_MS_PER_WORD = 260;
export const MIN_READING_MS = 3_000;
export const MAX_READING_MS = 10_000;

/** Reveal rows for the typed shape. Order is worst to best, as a bar chart reads. */
export const CREDIT_LABELS = {
  exact: 'Exact reference',
  bookAndChapter: 'Right book and chapter',
  book: 'Right book',
  miss: 'Somewhere else',
  unreadable: 'Not a reference',
} as const;

// ---------------------------------------------------------------------------
// What travels to the screens
// ---------------------------------------------------------------------------

export interface ReferenceOption {
  index: number;
  /** Already formatted, so neither screen has to know about single-chapter books. */
  label: string;
}

/**
 * The question, as both screens receive it. Host and phone are given the same
 * object because there is nothing in it either may not see: which option is
 * right is in the round's secret and stays on the server until the reveal.
 */
export interface NameThatReferenceView {
  answerShape: AnswerShape;
  closeness: Closeness;
  translation: string;
  text: string;
  /** Empty for the typed shape, where the phone offers a picker instead. */
  options: ReferenceOption[];
}

export interface RevealedOption {
  label: string;
  /** How far it was drawn from the truth, or null for the true reference. */
  distance: Distance | null;
  correct: boolean;
}

export interface NameThatReferenceDetail {
  answerShape: AnswerShape;
  reference: string;
  text: string;
  translation: string;
  options: RevealedOption[];
  /** What a partly right typed answer was worth, for the host to explain. */
  credit: { exact: number; bookAndChapter: number; book: number };
}

export interface NameThatReferenceSecret {
  verseId: VerseId;
  text: string;
  translation: string;
  answerShape: AnswerShape;
  closeness: Closeness;
  options: { id: VerseId; distance: Distance | null }[];
  /** Position of the true reference in `options`, or -1 for the typed shape. */
  correctIndex: number;
}

// ---------------------------------------------------------------------------
// Building a round
// ---------------------------------------------------------------------------

export interface NameThatReferenceOptions {
  closeness?: Closeness;
  answerShape?: AnswerShape;
  /** Narrows the draw — the gospels for a youth group, the whole canon by default. */
  filter?: VerseFilter;
  scopeLabel?: string;
  /**
   * Where verses come from, given the room's translation. Injected so that the
   * round arithmetic can be exercised against a handful of verses rather than
   * against whatever module happens to be installed.
   *
   * This is the canon the wrong answers are drawn from. The verse being *asked
   * about* comes from `pick`, because those two are no longer the same
   * question: the answer is curated, the distractors around it are not.
   */
  source?: (abbreviation: string) => VerseSource | null;
  /**
   * The verse the round is about. Defaults to the curated pool at the room's
   * familiarity; injected by tests that want a known verse out of a fixture.
   */
  pick?: (draw: VerseDraw, random: () => number, translation: string) => Verse | null;
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

function wordCount(text: string): number {
  return text.split(/\s+/).filter((word) => word.length > 0).length;
}

function readingMs(text: string): number {
  const paced = wordCount(text) * READING_MS_PER_WORD;
  return Math.min(MAX_READING_MS, Math.max(MIN_READING_MS, paced));
}

function isCloseness(value: string | undefined): value is Closeness {
  return value !== undefined && (CLOSENESS_LEVELS as readonly string[]).includes(value);
}

/**
 * Reads the three-tier `difficulty` this game exposed before `closeness`
 * existed, for a room whose settings still name it that way. `hard` and
 * `easy` each meant offering every wrong option from one rung, so they map
 * straight across; `standard` meant a *mix* of `chapter`, `book` and
 * `section` together, which is exactly the reported default experience of
 * three closely-grouped references and one obvious outlier (see
 * `DEFAULT_CLOSENESS`) — `section` alone is its closest honest equivalent
 * under the uniform-rung model, not a literal replay of the old mix.
 */
function closenessFromLegacyDifficulty(value: string | undefined): Closeness | null {
  if (value === 'hard') return 'chapter';
  if (value === 'standard') return 'section';
  if (value === 'easy') return 'testament';
  return null;
}

/**
 * What the host chose, read out of the settings bag the shell carries but never
 * interprets. An unrecognised value is treated as no value rather than as an
 * error: these strings can arrive from a client older or newer than this
 * server, and a room that refuses to start because it does not recognise a
 * closeness would be worse than one that quietly plays the default rung.
 */
export function readGameOptions(gameOptions: Record<string, string>): {
  closeness: Closeness | null;
  answerShape: AnswerShape | null;
} {
  const closeness = gameOptions.closeness?.toLowerCase();
  const shape = gameOptions.answerShape?.toLowerCase();
  return {
    closeness: isCloseness(closeness)
      ? closeness
      : closenessFromLegacyDifficulty(gameOptions.difficulty?.toLowerCase()),
    answerShape: shape === 'reference' || shape === 'choice' ? shape : null,
  };
}

/** A round with nothing in it, for a room whose translation carries no verses. */
function emptyRound(index: number, settings: RoomSettings): Round<NameThatReferenceSecret> {
  return {
    index,
    secret: {
      verseId: 0,
      text: '',
      translation: settings.translation,
      answerShape: 'choice',
      closeness: DEFAULT_CLOSENESS,
      options: [],
      correctIndex: -1,
    },
    // Both screens already have to draw something for a payload they cannot
    // read — a phone on an older bundle, a game they do not know. Sending
    // nothing reuses that path instead of inventing a second empty state.
    hostView: null,
    playerView: null,
  };
}

/**
 * The position of the option a tap chose, or null for anything that is not one
 * of this round's options. Under a team vote the null is what keeps a stale or
 * garbled tap from being counted as a vote at all.
 */
function tappedPosition(secret: NameThatReferenceSecret, value: AnswerValue): number | null {
  if (secret.answerShape !== 'choice' || value.type !== 'choice') return null;
  return secret.options[value.index] === undefined ? null : value.index;
}

export function createNameThatReference(
  options: NameThatReferenceOptions = {}
): GameModule<NameThatReferenceSecret> {
  const resolve = options.source ?? ((abbreviation: string) => translation(abbreviation));
  const pick = options.pick ?? drawVerse;
  const filter: VerseFilter = { minWords: DEFAULT_MIN_WORDS, ...options.filter };
  const shapeFor = (settings: RoomSettings): AnswerShape =>
    readGameOptions(settings.gameOptions).answerShape ?? options.answerShape ?? 'choice';

  return {
    id: GAME_ID,
    name: 'Name that reference',
    scopeLabel: options.scopeLabel ?? 'Whole Bible',
    supportsSolo: true,
    usesBuzz: false,
    // A tap, or a typed reference, stands until time runs out rather than
    // locking in on the first one: this is a vote among fixed options (or a
    // considered guess at one), not a race, and nothing about either shape
    // makes an early answer worth freezing before the room has had its whole
    // window to think.
    answerPolicy: 'latest',
    groupVote: {
      mode: 'optional',
      supports: (settings) => shapeFor(settings) === 'choice',
      key: (value, round) => {
        const position = tappedPosition(round.secret, value);
        return position === null ? null : String(position);
      },
      label: (value, round) => {
        const position = tappedPosition(round.secret, value);
        const option = position === null ? undefined : round.secret.options[position];
        return option === undefined ? '' : formatRef(option.id);
      },
    },

    buildRound(context, index): Round<NameThatReferenceSecret> {
      const { settings, random } = context;
      const chosen = readGameOptions(settings.gameOptions);
      const closeness = chosen.closeness ?? options.closeness ?? DEFAULT_CLOSENESS;
      const answerShape = shapeFor(settings);

      const source = resolve(settings.translation);
      const draw: VerseDraw = {
        familiarity: settings.familiarity,
        exclude: context.previous.map((round) => round.secret.verseId),
      };
      if (filter.books !== undefined) draw.books = filter.books;
      if (filter.sections !== undefined) draw.sections = filter.sections;
      if (filter.minWords !== undefined) draw.minWords = filter.minWords;
      const verse = pick(draw, random, settings.translation);
      if (!source || !verse) return emptyRound(index, settings);

      // A typed round has nothing to be near or far from, so it draws nothing.
      const offered: NameThatReferenceSecret['options'] =
        answerShape === 'choice'
          ? shuffled(
              [
                { id: verse.id, distance: null },
                ...drawDistractors({
                  source,
                  answer: verse.id,
                  wanted: mixFor(closeness),
                  random,
                }),
              ],
              random
            )
          : [];

      const secret: NameThatReferenceSecret = {
        verseId: verse.id,
        text: verse.text,
        translation: settings.translation,
        answerShape,
        closeness,
        options: offered,
        correctIndex: offered.findIndex((option) => option.distance === null),
      };

      const view: NameThatReferenceView = {
        answerShape,
        closeness,
        translation: settings.translation,
        text: verse.text,
        options: secret.options.map((option, position) => ({
          index: position,
          label: formatRef(option.id),
        })),
      };

      return {
        index,
        secret,
        hostView: view,
        playerView: view,
        questionPhaseMs: readingMs(verse.text),
      };
    },

    scoreRound(round, answers): RoundOutcome {
      return scoreNameThatReference(round.secret, answers);
    },
  };
}

/** The module the server runs, with its defaults. */
export const nameThatReference = createNameThatReference();

// ---------------------------------------------------------------------------
// Scoring
// ---------------------------------------------------------------------------

type Credit = keyof typeof CREDIT_LABELS;

/** How much of a typed reference was right. */
export function creditFor(answer: VerseId, value: AnswerValue): Credit {
  if (value.type !== 'reference') return 'unreadable';
  const truth = fromVerseId(answer);
  if (value.book !== truth.book) return 'miss';
  if (value.chapter !== truth.chapter) return 'book';
  if (value.verse !== truth.verse) return 'bookAndChapter';
  return 'exact';
}

const CREDIT_POINTS: Record<Credit, number> = {
  exact: ROUND_POINTS,
  bookAndChapter: BOOK_AND_CHAPTER_POINTS,
  book: BOOK_POINTS,
  miss: 0,
  unreadable: 0,
};

/** Reveal rows read best from the top down: nearly right, then further out. */
const CREDIT_ORDER: readonly Credit[] = ['exact', 'bookAndChapter', 'book', 'miss', 'unreadable'];

function resultFor(correct: boolean, points: number, value: AnswerValue, note: string | null): PersonalResult {
  return { correct, pointsAwarded: points, submitted: value, note };
}

/**
 * One answer per player: the first one they sent. The room already refuses a
 * second, or under a team vote hands over only the vote that stood, and taking
 * the earliest rather than the latest means that if it ever stops refusing,
 * nobody improves an answer by watching the room.
 */
function firstPerPlayer(answers: readonly ScoredAnswer[]): ScoredAnswer[] {
  const seen = new Set<PlayerId>();
  const kept: ScoredAnswer[] = [];
  // Arrival order, so that "first" means first, whatever order the caller used.
  for (const answer of [...answers].sort((a, b) => a.at - b.at)) {
    if (seen.has(answer.playerId)) continue;
    seen.add(answer.playerId);
    kept.push(answer);
  }
  return kept;
}

export function scoreNameThatReference(
  secret: NameThatReferenceSecret,
  answers: readonly ScoredAnswer[]
): RoundOutcome {
  const perPlayer = new Map<PlayerId, PersonalResult>();
  const counts = new Map<string, number>();
  const bump = (label: string): void => {
    counts.set(label, (counts.get(label) ?? 0) + 1);
  };

  const detail: NameThatReferenceDetail = {
    answerShape: secret.answerShape,
    reference: secret.verseId === 0 ? '' : formatRef(secret.verseId),
    text: secret.text,
    translation: secret.translation,
    options: secret.options.map((option) => ({
      label: formatRef(option.id),
      distance: option.distance,
      correct: option.distance === null,
    })),
    credit: {
      exact: ROUND_POINTS,
      bookAndChapter: BOOK_AND_CHAPTER_POINTS,
      book: BOOK_POINTS,
    },
  };

  if (secret.verseId === 0) {
    return { perPlayer, aggregates: [], correctLabel: '', detail };
  }

  for (const answer of firstPerPlayer(answers)) {
    if (secret.answerShape === 'choice') {
      const chosen = secret.options[answer.value.type === 'choice' ? answer.value.index : -1];
      if (!chosen) {
        perPlayer.set(answer.playerId, resultFor(false, 0, answer.value, CREDIT_LABELS.unreadable));
        bump(CREDIT_LABELS.unreadable);
        continue;
      }
      const correct = chosen.distance === null;
      perPlayer.set(
        answer.playerId,
        resultFor(correct, correct ? ROUND_POINTS : 0, answer.value, null)
      );
      // Counts are per option, never per player: the big screen shows how the
      // room split without showing who was in which part of it.
      bump(formatRef(chosen.id));
      continue;
    }

    const credit = creditFor(secret.verseId, answer.value);
    perPlayer.set(
      answer.playerId,
      resultFor(
        credit === 'exact',
        CREDIT_POINTS[credit],
        answer.value,
        credit === 'exact' ? null : CREDIT_LABELS[credit]
      )
    );
    bump(CREDIT_LABELS[credit]);
  }

  /*
   * Every option gets a row even at zero, because an option nobody picked is
   * part of how the room split. A credit tier nobody reached is not, and nor is
   * an answer the game could not read, so those rows appear only when they
   * happened.
   */
  const rows: RevealAggregate[] =
    secret.answerShape === 'choice'
      ? secret.options.map((option) => {
          const label = formatRef(option.id);
          return { label, count: counts.get(label) ?? 0 };
        })
      : CREDIT_ORDER.map((credit) => CREDIT_LABELS[credit]).map((label) => ({
          label,
          count: counts.get(label) ?? 0,
        }));
  const unreadable = counts.get(CREDIT_LABELS.unreadable) ?? 0;
  if (secret.answerShape === 'choice' && unreadable > 0) {
    rows.push({ label: CREDIT_LABELS.unreadable, count: unreadable });
  }

  return {
    perPlayer,
    aggregates: rows.filter((row) => row.count > 0 || secret.answerShape === 'choice'),
    correctLabel: formatRef(secret.verseId),
    detail,
  };
}
