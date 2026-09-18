/**
 * Raw mode, input pump, and resize.
 *
 * Three responsibilities that have to be one object because they share a
 * lifetime: the terminal has to be put into raw mode, read from, and — without
 * exception — put back. "Without exception" is the hard part. A process that
 * exits from raw mode leaves the user's shell with no echo and no line editing,
 * which looks like a hung terminal. So restoration is wired to every exit path
 * there is, not just the tidy one.
 *
 * Note that in raw mode ctrl+c no longer raises `SIGINT` — it arrives as the
 * byte `0x03` like any other key. {@link TerminalInput} therefore delivers it
 * as a key and leaves the policy to the caller, while still guaranteeing the
 * terminal is restored if the process does go down.
 */
import type { Key } from './keys';
import { decodeKeys, flushPending } from './keys';

export interface TerminalSize {
  readonly columns: number;
  readonly rows: number;
}

/**
 * How long to wait before deciding a lone `ESC` really was the escape key
 * rather than the start of a sequence that has not finished arriving.
 *
 * 50 ms is the conventional value: comfortably longer than the gap between
 * bytes of one sequence even over a slow SSH link, and short enough that
 * pressing escape does not feel laggy.
 */
export const ESCAPE_TIMEOUT_MS = 50;

export interface InputStream {
  setRawMode?(mode: boolean): unknown;
  setEncoding(encoding: BufferEncoding): unknown;
  resume(): unknown;
  pause(): unknown;
  on(event: 'data', listener: (chunk: string) => void): unknown;
  off(event: 'data', listener: (chunk: string) => void): unknown;
  readonly isTTY?: boolean;
}

export interface TerminalInputOptions {
  onKey(key: Key): void;
  onResize?(size: TerminalSize): void;
  /** Defaults to `process.stdin`. */
  input?: InputStream;
  /** Defaults to reading `process.stdout`. */
  measure?: () => TerminalSize;
  /** Registers a resize listener; returns a disposer. Defaults to `process.stdout`. */
  onResizeSource?: (listener: () => void) => () => void;
  escapeTimeoutMs?: number;
}

export class TerminalInput {
  private readonly input: InputStream;
  private readonly options: TerminalInputOptions;
  private readonly escapeTimeoutMs: number;

  private pending = '';
  private escapeTimer: ReturnType<typeof setTimeout> | undefined;
  private disposeResize: (() => void) | undefined;
  private removeExitGuards: (() => void) | undefined;
  private running = false;
  private wasRaw = false;

  constructor(options: TerminalInputOptions) {
    this.options = options;
    this.input = options.input ?? (process.stdin as unknown as InputStream);
    this.escapeTimeoutMs = options.escapeTimeoutMs ?? ESCAPE_TIMEOUT_MS;
  }

  start(): void {
    if (this.running) return;
    this.running = true;

    if (this.input.setRawMode) {
      this.input.setRawMode(true);
      this.wasRaw = true;
    }
    this.input.setEncoding('utf8');
    this.input.on('data', this.handleData);
    this.input.resume();

    const source = this.options.onResizeSource ?? defaultResizeSource;
    this.disposeResize = source(() => this.options.onResize?.(this.size()));

    this.removeExitGuards = installExitGuards(() => this.stop());
  }

  stop(): void {
    if (!this.running) return;
    this.running = false;

    this.clearEscapeTimer();
    this.input.off('data', this.handleData);
    if (this.wasRaw && this.input.setRawMode) {
      this.input.setRawMode(false);
      this.wasRaw = false;
    }
    this.input.pause();

    this.disposeResize?.();
    this.disposeResize = undefined;
    this.removeExitGuards?.();
    this.removeExitGuards = undefined;
  }

  size(): TerminalSize {
    return this.options.measure ? this.options.measure() : defaultMeasure();
  }

  /** Arrow function so it keeps its binding when used as a listener. */
  private readonly handleData = (chunk: string): void => {
    this.clearEscapeTimer();

    const { keys, pending } = decodeKeys(this.pending + chunk);
    for (const k of keys) this.options.onKey(k);
    this.pending = pending;

    if (this.pending !== '') this.startEscapeTimer();
  };

  private startEscapeTimer(): void {
    this.escapeTimer = setTimeout(() => {
      this.escapeTimer = undefined;
      const held = this.pending;
      this.pending = '';
      for (const k of flushPending(held)) this.options.onKey(k);
    }, this.escapeTimeoutMs);

    // Never let a pending escape hold the process open.
    (this.escapeTimer as { unref?: () => void }).unref?.();
  }

  private clearEscapeTimer(): void {
    if (this.escapeTimer !== undefined) {
      clearTimeout(this.escapeTimer);
      this.escapeTimer = undefined;
    }
  }
}

function defaultMeasure(): TerminalSize {
  return {
    // A pipe reports no size. 80×24 is the historical default and a sane
    // fallback for output that is being redirected.
    columns: process.stdout.columns || 80,
    rows: process.stdout.rows || 24,
  };
}

/**
 * `process.stdout`'s `resize` event is the portable spelling. On POSIX it is
 * driven by `SIGWINCH`; on Windows, where no such signal exists, Node raises
 * the same event from the console API. Listening for `SIGWINCH` directly would
 * work on only one of the two platforms this ships to.
 */
function defaultResizeSource(listener: () => void): () => void {
  process.stdout.on('resize', listener);
  return () => {
    process.stdout.off('resize', listener);
  };
}

/**
 * Restore the terminal on every way out: a normal exit, a signal, or an
 * uncaught throw.
 *
 * The exception handlers deliberately re-raise after cleaning up. Swallowing a
 * crash would leave the app in an unknown state, and the point here is only to
 * make sure the user's shell is usable enough to read the stack trace.
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
