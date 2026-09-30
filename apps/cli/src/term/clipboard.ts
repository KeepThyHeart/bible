/**
 * Clipboard.
 *
 * Two mechanisms, because neither covers the whole matrix:
 *
 * - **OSC 52** asks the *terminal emulator* to set the clipboard. It is the
 *   only thing that works over SSH, where a native helper would set the
 *   clipboard on the wrong machine. It is also fire-and-forget: the escape
 *   sequence has no reply, so a terminal that ignores it is indistinguishable
 *   from one that honoured it.
 * - **A native helper** (`clip.exe`, `pbcopy`, `wl-copy`, `xclip`, `xsel`)
 *   reports real success or failure, but only affects the local machine.
 *
 * So the order depends on where we are: over SSH, OSC 52 first; locally, the
 * helper first, because a confirmed copy beats an unverifiable one.
 *
 * Every attempt is recorded. A total failure says which mechanisms were tried
 * and why each did not work, rather than doing nothing quietly — the failure
 * mode the acceptance criteria single out.
 */
import { spawnSync } from 'node:child_process';
import { openSync, writeSync, closeSync } from 'node:fs';

export interface CopyAttempt {
  readonly method: string;
  readonly ok: boolean;
  /** Why it failed. Absent when it succeeded. */
  readonly reason?: string;
}

export interface CopyResult {
  readonly ok: boolean;
  /** The method that worked, when one did. */
  readonly method?: string;
  /** Every mechanism tried, in order. */
  readonly attempts: readonly CopyAttempt[];
  /**
   * True when the copy was made by OSC 52, whose success cannot be confirmed.
   * Callers should phrase the confirmation accordingly ("sent to the terminal"
   * rather than "copied").
   */
  readonly unverified: boolean;
}

/**
 * Seam for tests. The default implementation talks to the real process; the
 * tests supply a fake so that ordering, wrapping and failure reporting can be
 * asserted without a clipboard, a TTY, or an X server.
 */
export interface ClipboardHost {
  readonly platform: NodeJS.Platform;
  readonly env: Readonly<Record<string, string | undefined>>;
  /** Write raw bytes to the controlling terminal. Returns false if there is none. */
  writeTerminal(data: string): boolean;
  /** Run a helper, feeding `input` on stdin. */
  run(command: string, args: readonly string[], input: Buffer): { ok: boolean; reason?: string };
}

/**
 * xterm's default `maxGraphicsSize` caps an OSC 52 payload at just under
 * 100 000 bytes of base64. Rather than emit a sequence that will be truncated
 * into a corrupt clipboard, refuse and let the native helper handle it.
 */
const OSC52_MAX_BASE64 = 74_994;

/** Screen's DCS passthrough has a much smaller per-chunk limit. */
const SCREEN_CHUNK = 768;

export function copyToClipboard(text: string, host: ClipboardHost = defaultHost()): CopyResult {
  const attempts: CopyAttempt[] = [];
  const overSsh = isSsh(host.env);

  const order = overSsh ? ['osc52', 'native'] : ['native', 'osc52'];

  for (const mechanism of order) {
    const attempt =
      mechanism === 'osc52' ? tryOsc52(text, host, attempts) : tryNative(text, host, attempts);
    if (attempt) {
      return {
        ok: true,
        method: attempt,
        attempts,
        unverified: attempt === 'osc52',
      };
    }
  }

  return { ok: false, attempts, unverified: false };
}

/** A one-line explanation for the user when nothing worked. */
export function describeFailure(result: CopyResult): string {
  if (result.ok) return '';
  if (result.attempts.length === 0) return 'no clipboard mechanism is available';
  return result.attempts.map((a) => `${a.method}: ${a.reason ?? 'failed'}`).join('; ');
}

// --- OSC 52 --------------------------------------------------------------

function tryOsc52(text: string, host: ClipboardHost, attempts: CopyAttempt[]): string | undefined {
  const payload = Buffer.from(text, 'utf8').toString('base64');

  if (payload.length > OSC52_MAX_BASE64) {
    attempts.push({
      method: 'osc52',
      ok: false,
      reason: `selection is too large for a terminal escape (${payload.length} bytes base64, limit ${OSC52_MAX_BASE64})`,
    });
    return undefined;
  }

  const sequence = wrapForMultiplexer(`\x1b]52;c;${payload}\x07`, host.env);

  if (!host.writeTerminal(sequence)) {
    attempts.push({ method: 'osc52', ok: false, reason: 'no controlling terminal to write to' });
    return undefined;
  }

  attempts.push({ method: 'osc52', ok: true });
  return 'osc52';
}

/**
 * tmux and screen both swallow escape sequences they do not understand, so the
 * OSC has to be smuggled through their own passthrough syntax.
 *
 * tmux additionally requires `set -g allow-passthrough on` in recent versions;
 * when it is off the sequence is dropped silently, which is the single most
 * common reason a copy appears to do nothing inside tmux.
 */
export function wrapForMultiplexer(
  sequence: string,
  env: Readonly<Record<string, string | undefined>>,
): string {
  if (env.TMUX) {
    // Inside the DCS wrapper every ESC must be doubled.
    return `\x1bPtmux;${sequence.replace(/\x1b/g, '\x1b\x1b')}\x1b\\`;
  }

  const term = env.TERM ?? '';
  if (term.startsWith('screen')) {
    const chunks: string[] = [];
    for (let i = 0; i < sequence.length; i += SCREEN_CHUNK) {
      chunks.push(`\x1bP${sequence.slice(i, i + SCREEN_CHUNK)}\x1b\\`);
    }
    return chunks.join('');
  }

  return sequence;
}

// --- native helpers ------------------------------------------------------

interface Helper {
  readonly command: string;
  readonly args: readonly string[];
  /** Some helpers want UTF-16LE rather than UTF-8. */
  readonly encoding: 'utf8' | 'utf16le';
}

/**
 * `clip.exe` decodes stdin using the console code page, which mangles anything
 * outside it — Greek and Hebrew included. It does understand UTF-16LE, so that
 * is what it gets.
 */
export function helpersFor(platform: NodeJS.Platform): readonly Helper[] {
  if (platform === 'win32') {
    return [{ command: 'clip.exe', args: [], encoding: 'utf16le' }];
  }
  if (platform === 'darwin') {
    return [{ command: 'pbcopy', args: [], encoding: 'utf8' }];
  }
  return [
    { command: 'wl-copy', args: [], encoding: 'utf8' },
    { command: 'xclip', args: ['-selection', 'clipboard'], encoding: 'utf8' },
    { command: 'xsel', args: ['--clipboard', '--input'], encoding: 'utf8' },
    // WSL: a Linux platform with the Windows helper on PATH.
    { command: 'clip.exe', args: [], encoding: 'utf16le' },
  ];
}

function tryNative(text: string, host: ClipboardHost, attempts: CopyAttempt[]): string | undefined {
  for (const helper of helpersFor(host.platform)) {
    const input = Buffer.from(text, helper.encoding);
    const result = host.run(helper.command, helper.args, input);
    if (result.ok) {
      attempts.push({ method: helper.command, ok: true });
      return helper.command;
    }
    attempts.push({ method: helper.command, ok: false, reason: result.reason ?? 'failed' });
  }
  return undefined;
}

// --- environment ---------------------------------------------------------

function isSsh(env: Readonly<Record<string, string | undefined>>): boolean {
  return Boolean(env.SSH_TTY || env.SSH_CONNECTION || env.SSH_CLIENT);
}

function defaultHost(): ClipboardHost {
  return {
    platform: process.platform,
    env: process.env,

    writeTerminal(data: string): boolean {
      // Write to the terminal itself, not stdout: stdout may be redirected to
      // a file or a pipe, and an escape sequence written there reaches no
      // terminal at all while appearing to succeed.
      const device = process.platform === 'win32' ? 'CONOUT$' : '/dev/tty';
      try {
        const fd = openSync(device, 'w');
        try {
          writeSync(fd, data);
        } finally {
          closeSync(fd);
        }
        return true;
      } catch {
        // Fall back to stdout when it is itself a terminal.
        if (process.stdout.isTTY) {
          process.stdout.write(data);
          return true;
        }
        return false;
      }
    },

    run(command, args, input) {
      try {
        const result = spawnSync(command, [...args], { input, windowsHide: true });
        if (result.error) {
          const code = (result.error as NodeJS.ErrnoException).code;
          return { ok: false, reason: code === 'ENOENT' ? 'not installed' : result.error.message };
        }
        if (result.status !== 0) {
          const stderr = result.stderr?.toString().trim();
          return { ok: false, reason: stderr || `exited ${result.status}` };
        }
        return { ok: true };
      } catch (e) {
        return { ok: false, reason: e instanceof Error ? e.message : String(e) };
      }
    },
  };
}
