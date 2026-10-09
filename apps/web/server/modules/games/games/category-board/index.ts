/**
 * The category board: a grid of categories, five questions each, the easy ones
 * worth little and the hard ones worth a lot.
 *
 * Every tile is multiple choice. Four large buttons keep a whole group moving
 * and cost nobody a spelling, and the content already ranks its wrong answers,
 * so the three offered are the three the author thought most plausible.
 *
 * Everyone right on a tile earns that tile's value, whether they answered first
 * or last. Nothing here reads the clock: the room already records how long a
 * correct answer took and separates two equal scores with it, which is the only
 * place speed belongs.
 *
 * The host picks each tile from the big screen. A tile the host did not pick is
 * the next one along the board's own walk — see `board.ts` for the order — so
 * pressing Next question plays on without anyone having to choose.
 *
 * A tap stands until time runs out and can be changed before then, whether or
 * not the room is voting as teams. A host can also have teams vote together;
 * the room then keeps each phone's latest tap as its vote and pays everyone
 * on a team the tile's value when the team's majority is right. This module
 * still scores one answer at a time; all it adds is which option a tap was.
 */

import type {
  AnswerValue,
  PersonalResult,
  PlayerId,
  RevealAggregate,
} from '../../../../../src/modules/games/shared/protocol.js';
import type { GameModule, Round, RoundOutcome, ScoredAnswer } from '../../../../../src/modules/games/shared/games.js';
import { content, questionSets } from '../../content/index.js';
import {
  chooseBoard,
  chosenTile,
  nextTile,
  openTiles,
  questionAt,
  shuffled,
  tileKey,
  tileValue,
} from './board.js';
import type { BoardLayout, TilePosition, TileState } from './board.js';

export const GAME_ID = 'category-board';

/** The tag every board category carries in the content library. */
export const BOARD_TAG = 'category-board';

/** Reading time before the options appear, so the race is never to read. */
export const READING_MS_PER_WORD = 260;
export const MIN_READING_MS = 3_000;
export const MAX_READING_MS = 8_000;

/** The reveal row for an answer that was not one of the four options. */
export const UNREADABLE_LABEL = 'Not one of the options';

// ---------------------------------------------------------------------------
// What travels to the screens
// ---------------------------------------------------------------------------

export interface TileOption {
  index: number;
  label: string;
}

/**
 * The question on a tile, as both screens receive it. Nothing in it says which
 * option is right: that stays in the round's secret until the reveal.
 */
export interface TileQuestion {
  category: string;
  value: number;
  prompt: string;
  options: TileOption[];
}

export interface BoardTileView {
  value: number;
  state: TileState;
  /**
   * What the host's screen sends to pick this tile. Opaque to the screen, so
   * the way a tile is named stays this module's business.
   */
  choice: string;
}

export interface BoardColumnView {
  name: string;
  tiles: BoardTileView[];
}

/**
 * The big screen gets the board as well as the question. The phone does not:
 * at 320 pixels a grid of thirty tiles is noise, and the person holding it is
 * already looking at the board on the wall.
 *
 * `tile` is null once every tile has been played, so the screen can show the
 * finished board and say so rather than pretend there is a question.
 */
export interface CategoryBoardHostView {
  columns: BoardColumnView[];
  tile: TileQuestion | null;
}

export interface RevealedOption {
  label: string;
  correct: boolean;
}

export interface CategoryBoardDetail {
  category: string;
  value: number;
  prompt: string;
  answer: string;
  reference: string | null;
  options: RevealedOption[];
}

/** The question a round asks, as the server keeps it until the reveal. */
export interface SecretQuestion {
  id: string;
  category: string;
  prompt: string;
  answer: string;
  reference: string | null;
}

export interface CategoryBoardSecret {
  /**
   * The board, on the first round only. Later rounds read it from there, and
   * leaving it off them keeps the room from persisting thirty copies of it.
   */
  chosenBoard: BoardLayout | null;
  /** The tile this round played, or null when there was nothing left to play. */
  tile: TilePosition | null;
  question: SecretQuestion | null;
  value: number;
  options: RevealedOption[];
}

// ---------------------------------------------------------------------------
// Building a round
// ---------------------------------------------------------------------------

function wordCount(text: string): number {
  return text.split(/\s+/).filter((word) => word.length > 0).length;
}

function readingMs(text: string): number {
  const paced = wordCount(text) * READING_MS_PER_WORD;
  return Math.min(MAX_READING_MS, Math.max(MIN_READING_MS, paced));
}

/** The board as the big screen draws it this round. */
function boardView(
  board: BoardLayout,
  played: readonly TilePosition[],
  current: TilePosition | null
): BoardColumnView[] {
  const used = new Set(played.map(tileKey));
  const here = current === null ? null : tileKey(current);
  return board.columns.map((column, columnIndex) => ({
    name: column.name,
    tiles: column.questions.map((_question, row) => {
      const key = tileKey({ column: columnIndex, row });
      const state: TileState = key === here ? 'current' : used.has(key) ? 'played' : 'open';
      return { value: tileValue(row), state, choice: key };
    }),
  }));
}

function emptySecret(chosenBoard: BoardLayout | null): CategoryBoardSecret {
  return { chosenBoard, tile: null, question: null, value: 0, options: [] };
}

/** Every tile the rounds so far have used up, played or skipped. */
function playedIn(previous: readonly Round<CategoryBoardSecret>[]): TilePosition[] {
  return previous.flatMap((round) => (round.secret.tile ? [round.secret.tile] : []));
}

/** The board this room is playing, chosen on the first round and read back after. */
function boardFor(
  previous: readonly Round<CategoryBoardSecret>[],
  rounds: number,
  random: () => number
): BoardLayout | null {
  const first = previous[0];
  if (first !== undefined) return first.secret.chosenBoard;
  return chooseBoard(
    questionSets({ tag: BOARD_TAG }),
    (id) => content().question(id),
    rounds,
    random
  );
}

/**
 * The position of the option a tap chose, or null for anything that is not one
 * of this tile's options. Under a team vote the null is what keeps a stale or
 * garbled tap from being counted as a vote at all.
 */
function tappedPosition(secret: CategoryBoardSecret, value: AnswerValue): number | null {
  if (value.type !== 'choice') return null;
  return secret.options[value.index] === undefined ? null : value.index;
}

export function createCategoryBoard(): GameModule<CategoryBoardSecret> {
  return {
    id: GAME_ID,
    name: 'Category board',
    scopeLabel: 'Whole Bible',
    supportsSolo: true,
    // Its own curated board (`content/source/board.json`) — no familiarity,
    // translation or set setting reaches it.
    usesFamiliarity: false,
    usesTranslation: false,
    usesSet: false,
    usesBuzz: false,
    // A tap stands until time runs out rather than locking in on the first
    // one, whether or not the room is voting as teams — see the module doc
    // comment.
    answerPolicy: 'latest',
    groupVote: {
      mode: 'optional',
      key: (value, round) => {
        const position = tappedPosition(round.secret, value);
        return position === null ? null : String(position);
      },
      label: (value, round) => {
        const position = tappedPosition(round.secret, value);
        return position === null ? '' : (round.secret.options[position]?.label ?? '');
      },
    },

    /**
     * The tiles still on the board. Before the first round there is no board
     * yet — it is drawn when that round is built — so there is nothing to pick.
     */
    openChoices(previous): string[] {
      const board = previous[0]?.secret.chosenBoard ?? null;
      if (board === null) return [];
      return openTiles(board, playedIn(previous)).map(tileKey);
    },

    buildRound(context, index): Round<CategoryBoardSecret> {
      const { settings, random, previous, choice } = context;
      const board = boardFor(previous, settings.rounds, random);
      // Carried only by the round that chose it; see the secret's own note.
      const chosenBoard = previous.length === 0 ? board : null;

      // Both screens already have to draw something for a payload they cannot
      // read. A room with no categories imported sends nothing and reuses that
      // path, which says plainly that there is nothing to show.
      if (board === null) {
        return { index, secret: emptySecret(null), hostView: null, playerView: null };
      }

      const played = playedIn(previous);
      // The room has already refused a choice that is not open, but a round is
      // built from whatever it is handed, so an unusable one falls back to the
      // walk here too rather than to a hole in the board.
      const picked = choice === null ? null : chosenTile(board, played, choice);
      const tile = picked ?? nextTile(board, played);
      const question = tile === null ? null : questionAt(board, tile);
      const column = tile === null ? undefined : board.columns[tile.column];

      if (tile === null || question === null || column === undefined) {
        const cleared: CategoryBoardHostView = { columns: boardView(board, played, null), tile: null };
        return { index, secret: emptySecret(chosenBoard), hostView: cleared, playerView: null };
      }

      const value = tileValue(tile.row);
      const options: RevealedOption[] = shuffled(
        [
          { label: question.answer, correct: true },
          ...question.distractors.map((label) => ({ label, correct: false })),
        ],
        random
      );

      const asked: TileQuestion = {
        category: column.name,
        value,
        prompt: question.prompt,
        options: options.map((option, position) => ({ index: position, label: option.label })),
      };
      const hostView: CategoryBoardHostView = {
        columns: boardView(board, played, tile),
        tile: asked,
      };

      return {
        index,
        secret: {
          chosenBoard,
          tile,
          question: {
            id: question.id,
            category: column.name,
            prompt: question.prompt,
            answer: question.answer,
            reference: question.reference,
          },
          value,
          options,
        },
        hostView,
        playerView: asked,
        questionPhaseMs: readingMs(question.prompt),
      };
    },

    scoreRound(round, answers): RoundOutcome {
      return scoreCategoryBoard(round.secret, answers);
    },
  };
}

/** The module the server runs. */
export const categoryBoard = createCategoryBoard();

// ---------------------------------------------------------------------------
// Scoring
// ---------------------------------------------------------------------------

/**
 * One answer per player: the first one they sent. The room already refuses a
 * second, or under a team vote hands over only the vote that stood, and taking
 * the earliest rather than the latest means that if it ever stops refusing,
 * nobody improves an answer by watching the room.
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

export function scoreCategoryBoard(
  secret: CategoryBoardSecret,
  answers: readonly ScoredAnswer[]
): RoundOutcome {
  const perPlayer = new Map<PlayerId, PersonalResult>();
  const question = secret.question;
  // Nobody is marked wrong for tapping at a screen that had nothing on it.
  if (question === null) {
    return { perPlayer, aggregates: [], correctLabel: '', detail: null };
  }

  const counts = new Map<number, number>();
  let unreadable = 0;
  for (const answer of firstPerPlayer(answers)) {
    const index = answer.value.type === 'choice' ? answer.value.index : -1;
    const chosen = secret.options[index];
    if (!chosen) {
      unreadable += 1;
      perPlayer.set(answer.playerId, {
        correct: false,
        pointsAwarded: 0,
        submitted: answer.value,
        note: UNREADABLE_LABEL,
      });
      continue;
    }
    // Counted by position, never by player: the big screen shows how the room
    // split without showing who was in which part of it.
    counts.set(index, (counts.get(index) ?? 0) + 1);
    perPlayer.set(answer.playerId, {
      correct: chosen.correct,
      pointsAwarded: chosen.correct ? secret.value : 0,
      submitted: answer.value,
      note: null,
    });
  }

  // Every option gets a row even at zero, because an option nobody picked is
  // part of how the room split. An unreadable answer is not, so its row appears
  // only when one happened.
  const aggregates: RevealAggregate[] = secret.options.map((option, index) => ({
    label: option.label,
    count: counts.get(index) ?? 0,
  }));
  if (unreadable > 0) aggregates.push({ label: UNREADABLE_LABEL, count: unreadable });

  const detail: CategoryBoardDetail = {
    category: question.category,
    value: secret.value,
    prompt: question.prompt,
    answer: question.answer,
    reference: question.reference,
    options: secret.options,
  };

  return { perPlayer, aggregates, correctLabel: question.answer, detail };
}
