/**
 * The board itself: which categories are on it, which tile comes next, and what
 * a tile is worth.
 *
 * The host picks tiles from the big screen. When they do not — they pressed
 * Next question instead, or the round was skipped — the board walks itself:
 * the easiest row across every category first, then the next row down. That is
 * the order a group would choose anyway when it is warming up, and it means the
 * room climbs in difficulty together rather than one column racing ahead.
 *
 * Every function here is pure. The board is chosen once, with the room's own
 * generator, when the first round is built, and later rounds read it back from
 * `context.previous` instead of drawing again: the room's generator has moved on
 * by then, so a second draw would produce a different board and the walk would
 * wander between two of them.
 *
 * A board holds copies of its questions rather than their ids. It is chosen
 * once and played for the length of the room, and a board that had to look its
 * tiles up again could find one gone after a re-import — a hole in the middle
 * of a game that nobody on the screen could explain.
 */

import { STANDARD_DISTRACTOR_COUNT, contentKey } from '../../content/index.js';
import type { QuestionRecord, QuestionSetRecord } from '../../content/index.js';
import { formatRef, isValidVerseId } from '../../../../../src/modules/games/shared/verseId.js';

/** Rows on a full board: one question per difficulty, easiest first. */
export const ROWS = 5;

/**
 * A board narrower than two columns is a quiz with a heading, and one wider
 * than six stops being readable from the back of a hall. Between those, the
 * width follows the room's round count so that a short game still climbs.
 */
export const MIN_COLUMNS = 2;
export const MAX_COLUMNS = 6;

/**
 * What a tile is worth per row. Everyone right on a tile earns the same; a
 * harder tile is worth more to everyone, which is the whole promise of a board.
 */
export const TILE_STEP = 100;

/** What a tile asks, copied off the question when the board was chosen. */
export interface BoardQuestion {
  id: string;
  prompt: string;
  answer: string;
  /** Where the answer is found, for the reveal, or null when it has no one home. */
  reference: string | null;
  /** The leading wrong answers, in the author's order. */
  distractors: string[];
}

/** One category on the board, its questions already in climbing order. */
export interface BoardColumn {
  setId: string;
  name: string;
  questions: BoardQuestion[];
}

export interface BoardLayout {
  columns: BoardColumn[];
}

export interface TilePosition {
  column: number;
  row: number;
}

/** How a tile looks on the big screen this round. */
export type TileState = 'open' | 'played' | 'current';

/**
 * How many categories a room of this length gets.
 *
 * The aim is that the rounds reach the bottom of the board: ten rounds over two
 * categories plays every difficulty, where ten rounds over six would never get
 * past the second row. It depends on the round count alone, so it is the same
 * number on every round of the room.
 */
export function columnsFor(rounds: number, available: number): number {
  const wanted = Math.min(MAX_COLUMNS, Math.max(MIN_COLUMNS, Math.ceil(rounds / ROWS)));
  return Math.max(0, Math.min(wanted, available));
}

export function tileValue(row: number): number {
  return (row + 1) * TILE_STEP;
}

export function tileKey(tile: TilePosition): string {
  return `${tile.column}:${tile.row}`;
}

export function shuffled<T>(items: readonly T[], random: () => number): T[] {
  const list = [...items];
  for (let index = list.length - 1; index > 0; index -= 1) {
    const swap = Math.min(Math.floor(random() * (index + 1)), index);
    const held = list[index] as T;
    list[index] = list[swap] as T;
    list[swap] = held;
  }
  return list;
}

/**
 * The wrong answers a tile offers: the leading ones, as the author ranked them,
 * skipping any that would read as the answer or as each other.
 *
 * The importer already refuses a distractor that collides with the answer, so
 * this should never skip one in practice. It checks anyway because the cost of
 * being wrong is two buttons on thirty phones that both say "Saul".
 */
export function leadingDistractors(question: QuestionRecord, wanted: number): string[] {
  const taken = new Set([question.answer, ...question.accept].map(contentKey));
  const chosen: string[] = [];
  for (const distractor of question.distractors) {
    if (chosen.length >= wanted) break;
    const key = contentKey(distractor);
    if (key.length === 0 || taken.has(key)) continue;
    taken.add(key);
    chosen.push(distractor);
  }
  return chosen;
}

/** Null for a question that cannot offer a full set of options. */
function boardQuestion(question: QuestionRecord): BoardQuestion | null {
  const distractors = leadingDistractors(question, STANDARD_DISTRACTOR_COUNT);
  if (distractors.length < STANDARD_DISTRACTOR_COUNT) return null;
  return {
    id: question.id,
    prompt: question.prompt,
    answer: question.answer,
    reference:
      question.promptVerseId !== null && isValidVerseId(question.promptVerseId)
        ? formatRef(question.promptVerseId)
        : null,
    distractors,
  };
}

/**
 * One category's questions, easiest first.
 *
 * Authored order breaks ties, because the author placed them for a reason and a
 * set whose difficulties are all 3 should still play in the order it was
 * written. A question that has since been deleted, or that cannot offer four
 * options, is left off rather than drawn as a broken tile.
 */
export function columnFor(
  set: QuestionSetRecord,
  lookup: (id: string) => QuestionRecord | null
): BoardColumn | null {
  const ranked = set.questionIds
    .map((id, position) => ({ record: lookup(id), position }))
    .flatMap(({ record, position }) => {
      const question = record === null ? null : boardQuestion(record);
      return record !== null && question !== null
        ? [{ question, difficulty: record.difficulty, position }]
        : [];
    })
    .sort((a, b) => a.difficulty - b.difficulty || a.position - b.position)
    .slice(0, ROWS);
  if (ranked.length === 0) return null;
  return { setId: set.id, name: set.name, questions: ranked.map(({ question }) => question) };
}

/**
 * Chooses the categories for a room.
 *
 * Sets are put in id order before they are shuffled, so the board depends on
 * the room's generator and nothing else — not on the order a database happens
 * to return rows in, which changes with a re-import.
 */
export function chooseBoard(
  sets: readonly QuestionSetRecord[],
  lookup: (id: string) => QuestionRecord | null,
  rounds: number,
  random: () => number
): BoardLayout | null {
  const columns = [...sets]
    .sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0))
    .map((set) => columnFor(set, lookup))
    .filter((column): column is BoardColumn => column !== null);
  const width = columnsFor(rounds, columns.length);
  if (width === 0) return null;
  return { columns: shuffled(columns, random).slice(0, width) };
}

/** Every tile, in the order the board plays them: across a row, then down. */
export function walkOrder(board: BoardLayout): TilePosition[] {
  const depth = board.columns.reduce(
    (deepest, column) => Math.max(deepest, column.questions.length),
    0
  );
  const order: TilePosition[] = [];
  for (let row = 0; row < depth; row += 1) {
    board.columns.forEach((column, index) => {
      if (row < column.questions.length) order.push({ column: index, row });
    });
  }
  return order;
}

/**
 * The next tile nobody has played, or null once the board is cleared.
 *
 * It asks which tiles were played rather than counting rounds, so a round the
 * host skipped still uses up its tile: the question was on the screen, and
 * bringing it back later would be a question the room has already seen.
 */
export function nextTile(board: BoardLayout, played: readonly TilePosition[]): TilePosition | null {
  return openTiles(board, played)[0] ?? null;
}

/** Every tile nobody has played yet, in walk order. */
export function openTiles(board: BoardLayout, played: readonly TilePosition[]): TilePosition[] {
  const used = new Set(played.map(tileKey));
  return walkOrder(board).filter((tile) => !used.has(tileKey(tile)));
}

/**
 * The tile a host's choice names, or null when it names nothing playable: a
 * tile already played, one off the edge of the board, or text that is not a
 * tile at all. The choice is matched against the open tiles' own keys rather
 * than parsed, so there is no malformed string that could name a tile by
 * accident.
 */
export function chosenTile(
  board: BoardLayout,
  played: readonly TilePosition[],
  choice: string
): TilePosition | null {
  return openTiles(board, played).find((tile) => tileKey(tile) === choice) ?? null;
}

export function questionAt(board: BoardLayout, tile: TilePosition): BoardQuestion | null {
  return board.columns[tile.column]?.questions[tile.row] ?? null;
}
