/**
 * Screen buffer and diffing renderer.
 *
 * The app renders by handing over a whole frame — an array of lines — and this
 * works out the smallest set of escape sequences that turns the previous frame
 * into the new one. Nothing above this layer thinks about cursor movement.
 *
 * **Why diff at all.** The naive renderer clears the screen and redraws it. On
 * a fast terminal that flickers, and over SSH it is unusable: a full 88×40
 * frame is ~3.5 KB every keystroke. Scrolling one line in the reader changes
 * almost nothing, and diffing turns that into a few dozen bytes.
 *
 * The diff is per *cell*, not per line: for a line that changed, only the part
 * from the first differing column onward is rewritten, followed by an erase to
 * end of line. Typing into the input line therefore emits one short sequence,
 * regardless of how long the line is.
 */
import { stringWidth } from './layout';
import { RESET, SGR_PATTERN } from './style';
import type { TerminalSize } from './raw';

/** Enter / leave the alternate screen buffer, so the user's scrollback survives. */
const ALT_SCREEN_ON = '\x1b[?1049h';
const ALT_SCREEN_OFF = '\x1b[?1049l';
const CURSOR_HIDE = '\x1b[?25l';
const CURSOR_SHOW = '\x1b[?25h';
const CLEAR_ALL = '\x1b[2J';
const ERASE_LINE_RIGHT = '\x1b[K';

/** 1-based, as ANSI counts. */
function cursorTo(row: number, column: number): string {
  return `\x1b[${row};${column}H`;
}

export interface ScreenWriter {
  write(data: string): unknown;
}

export interface ScreenOptions {
  /** Defaults to `process.stdout`. */
  out?: ScreenWriter;
  /** Defaults to reading `process.stdout`. */
  measure?: () => TerminalSize;
}

export interface CursorPosition {
  /** 0-based row within the frame. */
  readonly row: number;
  /** 0-based *column*, in display columns rather than characters. */
  readonly column: number;
}

export class Screen {
  private readonly out: ScreenWriter;
  private readonly measure: () => TerminalSize;

  private previous: string[] = [];
  private started = false;
  private removeExitGuards: (() => void) | undefined;

  constructor(options: ScreenOptions = {}) {
    this.out = options.out ?? process.stdout;
    this.measure = options.measure ?? defaultMeasure;
  }

  start(): void {
    if (this.started) return;
    this.started = true;

    this.out.write(ALT_SCREEN_ON + CURSOR_HIDE + CLEAR_ALL + cursorTo(1, 1));
    this.previous = [];

    // The terminal is left in a broken state if the process dies here — the
    // alternate buffer stays active and the cursor stays hidden — so every exit
    // path restores it, not just the tidy one.
    this.removeExitGuards = installExitGuards(() => this.stop());
  }

  stop(): void {
    if (!this.started) return;
    this.started = false;

    this.out.write(CURSOR_SHOW + ALT_SCREEN_OFF);
    this.previous = [];

    this.removeExitGuards?.();
    this.removeExitGuards = undefined;
  }

  isStarted(): boolean {
    return this.started;
  }

  /**
   * Discard the knowledge of what is on screen, forcing the next `draw` to
   * repaint everything.
   *
   * Call this on resize: the terminal reflows or truncates its own contents on
   * a size change, so the previous frame no longer describes what the user is
   * looking at, and a diff against it would leave debris.
   */
  invalidate(): void {
    this.previous = [];
  }

  draw(lines: readonly string[], cursor?: CursorPosition): void {
    const { rows } = this.measure();
    const frame = lines.slice(0, rows);
    const output: string[] = [CURSOR_HIDE];

    const height = Math.max(frame.length, this.previous.length);
    for (let row = 0; row < height; row += 1) {
      const next = frame[row] ?? '';
      const prev = this.previous[row];

      if (prev === next) continue;

      // Rewrite only from the first column that differs.
      const column = firstDifferingColumn(prev ?? '', next);
      output.push(cursorTo(row + 1, column + 1));
      output.push(sliceFromColumn(next, column));
      // Reset before erasing. `\x1b[K` fills to the right margin with the
      // *current* background, so erasing while a highlight is still active
      // paints the rest of the row in that colour — a stray bar to the margin.
      output.push(RESET);
      // Erase whatever the previous, longer frame left to the right.
      output.push(ERASE_LINE_RIGHT);
    }

    if (cursor) {
      output.push(cursorTo(cursor.row + 1, cursor.column + 1));
      output.push(CURSOR_SHOW);
    }

    // One write per frame. Several writes can be flushed separately, which is
    // what a partially-drawn frame — visible tearing — actually looks like.
    if (output.length > 1) this.out.write(output.join(''));

    this.previous = [...frame];
  }
}

/**
 * The display column at which two lines first differ.
 *
 * Compared token by token and measured by width, so a wide character is never
 * cut in half and the returned column is a real terminal column rather than a
 * string index. An SGR sequence is one zero-width token, which means a style
 * change with identical text still counts as a difference — otherwise the old
 * colour would be left on screen under the new text.
 */
export function firstDifferingColumn(previous: string, next: string): number {
  const a = tokenize(previous);
  const b = tokenize(next);
  let column = 0;

  for (let i = 0; i < a.length && i < b.length; i += 1) {
    const left = a[i]!;
    const right = b[i]!;
    if (left.text !== right.text) return column;
    column += left.width;
  }

  return column;
}

/**
 * The part of `line` at or after a given display column, with the styling that
 * was in force at that point re-established.
 *
 * Without the re-established prefix, cutting a line in the middle of a
 * highlighted verse would emit the rest of the words with no colour — the
 * highlight would appear to stop wherever the previous frame happened to
 * differ, which is a diffing artefact rather than anything the caller asked
 * for.
 */
export function sliceFromColumn(line: string, column: number): string {
  if (column <= 0) return line;

  let used = 0;
  let index = 0;
  let active: string[] = [];

  for (const token of tokenize(line)) {
    if (used >= column) break;
    if (token.width === 0 && SGR_PATTERN.test(token.text)) {
      // A reset clears the stack; anything else adds to it. Styles emitted by
      // `renderStyledLine` are always reset before the next one starts, so in
      // practice the stack holds at most one entry.
      if (token.text === RESET) active = [];
      else active.push(token.text);
    }
    used += token.width;
    index += token.text.length;
  }

  return active.join('') + line.slice(index);
}

interface Token {
  readonly text: string;
  readonly width: number;
}

/**
 * Split a line into escape sequences and characters.
 *
 * An SGR sequence is one token of zero width, so it never shifts the column
 * arithmetic and a style change on its own is still detected as a difference.
 */
function tokenize(line: string): Token[] {
  const tokens: Token[] = [];
  let index = 0;

  while (index < line.length) {
    if (line[index] === '\x1b') {
      SGR_ANCHORED.lastIndex = index;
      const match = SGR_ANCHORED.exec(line);
      if (match !== null) {
        tokens.push({ text: match[0], width: 0 });
        index += match[0].length;
        continue;
      }
    }
    const char = String.fromCodePoint(line.codePointAt(index)!);
    tokens.push({ text: char, width: stringWidth(char) });
    index += char.length;
  }

  return tokens;
}

/** Sticky so it can be anchored at an index; `lastIndex` is set before each use. */
const SGR_ANCHORED = /\x1b\[[0-9;]*m/y;

function defaultMeasure(): TerminalSize {
  return {
    columns: process.stdout.columns || 80,
    rows: process.stdout.rows || 24,
  };
}

/**
 * Shares the shape of `raw.ts`'s guards deliberately: both restore a different
 * piece of terminal state, and both must run on every exit path. Signals
 * re-raise after cleanup so the exit code stays honest.
 */
function installExitGuards(cleanup: () => void): () => void {
  const onExit = () => cleanup();
  const onSignal = (signal: NodeJS.Signals) => () => {
    cleanup();
    process.kill(process.pid, signal);
  };
  const onUncaught = (error: unknown) => {
    cleanup();
    throw error;
  };

  const sigint = onSignal('SIGINT');
  const sigterm = onSignal('SIGTERM');
  const sighup = onSignal('SIGHUP');

  process.on('exit', onExit);
  process.on('SIGINT', sigint);
  process.on('SIGTERM', sigterm);
  process.on('SIGHUP', sighup);
  process.on('uncaughtException', onUncaught);

  return () => {
    process.off('exit', onExit);
    process.off('SIGINT', sigint);
    process.off('SIGTERM', sigterm);
    process.off('SIGHUP', sighup);
    process.off('uncaughtException', onUncaught);
  };
}
