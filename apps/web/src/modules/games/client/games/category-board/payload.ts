/**
 * Reading what the server sent, rather than trusting it.
 *
 * A view payload arrives as `unknown`, and it genuinely can be: a phone that
 * loaded yesterday's bundle, a room whose game changed under a screen that was
 * asleep, a round the server had nothing to build from. Every one of those ends
 * as a screen in front of a group, so each is read into a shape or into null,
 * and a null draws a line of plain text instead of throwing in a render.
 *
 * The shapes are declared here as well as on the server on purpose. What passes
 * between the two is the wire, not a type: the phone must survive a payload the
 * current server would never send, and it can only do that by checking.
 */

export interface TileOption {
  index: number;
  label: string;
}

export interface TileQuestion {
  category: string;
  value: number;
  prompt: string;
  options: TileOption[];
}

export type TileState = 'open' | 'played' | 'current';

export interface BoardTile {
  value: number;
  state: TileState;
  /** What to send to pick this tile, or null for a board that offers none. */
  choice: string | null;
}

export interface BoardColumn {
  name: string;
  tiles: BoardTile[];
}

/** The big screen's payload: the board, and the tile in play or null once it is cleared. */
export interface HostBoardView {
  columns: BoardColumn[];
  tile: TileQuestion | null;
}

export interface RevealedOption {
  label: string;
  correct: boolean;
}

export interface RevealDetail {
  category: string;
  value: number;
  prompt: string;
  answer: string;
  reference: string | null;
  options: RevealedOption[];
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

function stringAt(source: Record<string, unknown>, key: string): string | null {
  const value = source[key];
  return typeof value === 'string' ? value : null;
}

function numberAt(source: Record<string, unknown>, key: string): number | null {
  const value = source[key];
  return typeof value === 'number' && Number.isFinite(value) ? value : null;
}

function entriesAt(source: Record<string, unknown>, key: string): Record<string, unknown>[] {
  const value = source[key];
  return Array.isArray(value) ? value.filter(isRecord) : [];
}

/**
 * A tile question, or null. A question with no options is null as well: this
 * game is answered only by tapping, so drawing a prompt with nothing to tap
 * would look like a real round that nobody can answer.
 */
export function readQuestion(view: unknown): TileQuestion | null {
  if (!isRecord(view)) return null;
  const category = stringAt(view, 'category');
  const value = numberAt(view, 'value');
  const prompt = stringAt(view, 'prompt');
  if (category === null || value === null || prompt === null) return null;

  const options: TileOption[] = [];
  for (const entry of entriesAt(view, 'options')) {
    const index = numberAt(entry, 'index');
    const label = stringAt(entry, 'label');
    if (index === null || label === null) continue;
    options.push({ index, label });
  }
  if (options.length === 0) return null;

  return { category, value, prompt, options };
}

function stateAt(source: Record<string, unknown>): TileState {
  const value = source['state'];
  // A tile's state is decoration: an unknown one is drawn as open rather than
  // taking the board down with it.
  return value === 'played' || value === 'current' ? value : 'open';
}

export function readHostView(view: unknown): HostBoardView | null {
  if (!isRecord(view) || !Array.isArray(view['columns'])) return null;

  const columns: BoardColumn[] = [];
  for (const entry of entriesAt(view, 'columns')) {
    const name = stringAt(entry, 'name');
    if (name === null) continue;
    const tiles: BoardTile[] = [];
    for (const tile of entriesAt(entry, 'tiles')) {
      const value = numberAt(tile, 'value');
      if (value === null) continue;
      const choice = stringAt(tile, 'choice');
      tiles.push({ value, state: stateAt(tile), choice: choice !== null && choice.length > 0 ? choice : null });
    }
    columns.push({ name, tiles });
  }
  if (columns.length === 0) return null;

  return { columns, tile: readQuestion(view['tile']) };
}

export function readDetail(detail: unknown): RevealDetail | null {
  if (!isRecord(detail)) return null;
  const answer = stringAt(detail, 'answer');
  if (answer === null || answer.length === 0) return null;

  const options: RevealedOption[] = [];
  for (const entry of entriesAt(detail, 'options')) {
    const label = stringAt(entry, 'label');
    if (label === null) continue;
    options.push({ label, correct: entry['correct'] === true });
  }

  const reference = stringAt(detail, 'reference');
  return {
    category: stringAt(detail, 'category') ?? '',
    value: numberAt(detail, 'value') ?? 0,
    prompt: stringAt(detail, 'prompt') ?? '',
    answer,
    reference: reference !== null && reference.length > 0 ? reference : null,
    options,
  };
}

/** How the option buttons are lettered, on both screens, so they can be said aloud. */
export const OPTION_LETTERS = ['A', 'B', 'C', 'D', 'E', 'F'] as const;

export function letterFor(index: number): string {
  return OPTION_LETTERS[index] ?? String(index + 1);
}

/**
 * The reverse of `letterFor`, for a keyboard answer: `a`/`b`/`c`/`d`/`e`/`f`,
 * either case. Anything else — a letter past the options actually offered, a
 * digit, a modifier key's own name — is not one of the lettered options, so
 * it answers nothing rather than guessing what was meant.
 */
export function indexForLetter(key: string): number | null {
  const index = OPTION_LETTERS.indexOf(key.toUpperCase() as (typeof OPTION_LETTERS)[number]);
  return index === -1 ? null : index;
}

/** "Prophets for 300", the way a host would say it. */
export function tileCaption(category: string, value: number): string {
  return `${category} for ${value}`;
}
