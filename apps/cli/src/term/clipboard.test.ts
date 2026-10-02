/**
 * The clipboard.
 *
 * The real clipboard is not available in CI and differs on every desktop, so
 * these drive a fake `ClipboardHost`. What is actually being tested is the
 * decision-making: which mechanism is tried first and why, how the escape is
 * wrapped for tmux and screen, and whether a total failure explains itself.
 */
import { describe, expect, test } from 'bun:test';

import {
  type ClipboardHost,
  type CopyResult,
  copyToClipboard,
  describeFailure,
  helpersFor,
  wrapForMultiplexer,
} from './clipboard';

interface FakeOptions {
  platform?: NodeJS.Platform;
  env?: Record<string, string | undefined>;
  /** Helper commands that "work". Everything else reports not installed. */
  working?: readonly string[];
  hasTerminal?: boolean;
}

function fake(options: FakeOptions = {}) {
  const written: string[] = [];
  const ran: string[] = [];
  const working = new Set(options.working ?? []);

  const host: ClipboardHost = {
    platform: options.platform ?? 'linux',
    env: options.env ?? {},
    writeTerminal(data) {
      if (options.hasTerminal === false) return false;
      written.push(data);
      return true;
    },
    run(command, _args, input) {
      ran.push(`${command}:${input.length}`);
      return working.has(command) ? { ok: true } : { ok: false, reason: 'not installed' };
    },
  };

  return { host, written, ran };
}

describe('mechanism order', () => {
  test('locally, a native helper is preferred over the unverifiable OSC 52', () => {
    const { host, written, ran } = fake({ working: ['xclip'] });

    const result = copyToClipboard('hello', host);

    expect(result.ok).toBe(true);
    expect(result.method).toBe('xclip');
    expect(result.unverified).toBe(false);
    expect(ran[0]).toStartWith('wl-copy'); // tried first, absent
    expect(written).toHaveLength(0); // never fell through to OSC 52
  });

  test('over SSH, OSC 52 goes first — a local helper would set the wrong machine\'s clipboard', () => {
    const { host, written, ran } = fake({
      env: { SSH_TTY: '/dev/pts/0' },
      working: ['xclip'],
    });

    const result = copyToClipboard('hello', host);

    expect(result.method).toBe('osc52');
    expect(result.unverified).toBe(true);
    expect(written).toHaveLength(1);
    expect(ran).toHaveLength(0);
  });

  test('falls through to OSC 52 when every helper is missing', () => {
    const { host, written } = fake({ working: [] });

    const result = copyToClipboard('hello', host);

    expect(result.ok).toBe(true);
    expect(result.method).toBe('osc52');
    expect(written).toHaveLength(1);
    expect(result.attempts.filter((a) => !a.ok).length).toBeGreaterThan(0);
  });
});

describe('failure reporting', () => {
  test('a total failure names every mechanism and why it did not work', () => {
    const { host } = fake({ working: [], hasTerminal: false });

    const result: CopyResult = copyToClipboard('hello', host);

    expect(result.ok).toBe(false);
    const explanation = describeFailure(result);
    expect(explanation).toContain('wl-copy: not installed');
    expect(explanation).toContain('xclip: not installed');
    expect(explanation).toContain('osc52: no controlling terminal');
  });

  test('an oversized selection is refused by OSC 52 with a reason, not truncated', () => {
    const { host } = fake({ env: { SSH_TTY: '/dev/pts/0' }, working: [] });

    const result = copyToClipboard('x'.repeat(200_000), host);

    const osc = result.attempts.find((a) => a.method === 'osc52');
    expect(osc?.ok).toBe(false);
    expect(osc?.reason).toContain('too large');
  });
});

describe('multiplexer wrapping', () => {
  const OSC = '\x1b]52;c;aGk=\x07';

  test('passes through untouched outside a multiplexer', () => {
    expect(wrapForMultiplexer(OSC, {})).toBe(OSC);
  });

  test('tmux gets a DCS wrapper with every ESC doubled', () => {
    const wrapped = wrapForMultiplexer(OSC, { TMUX: '/tmp/tmux-1000/default,123,0' });

    expect(wrapped).toStartWith('\x1bPtmux;');
    expect(wrapped).toEndWith('\x1b\\');
    // The inner ESC must be doubled or tmux eats the sequence.
    expect(wrapped).toContain('\x1b\x1b]52;c;');
  });

  test('screen gets DCS chunks', () => {
    const wrapped = wrapForMultiplexer(OSC, { TERM: 'screen.xterm-256color' });
    expect(wrapped).toStartWith('\x1bP');
    expect(wrapped).toEndWith('\x1b\\');
  });

  test('a long payload is split into several screen chunks', () => {
    const long = `\x1b]52;c;${'A'.repeat(3000)}\x07`;
    const wrapped = wrapForMultiplexer(long, { TERM: 'screen' });
    expect(wrapped.split('\x1bP').length - 1).toBeGreaterThan(1);
  });
});

describe('helper selection', () => {
  test('Windows uses clip.exe', () => {
    expect(helpersFor('win32').map((h) => h.command)).toEqual(['clip.exe']);
  });

  test('macOS uses pbcopy', () => {
    expect(helpersFor('darwin').map((h) => h.command)).toEqual(['pbcopy']);
  });

  test('Linux tries Wayland, then X, then WSL', () => {
    expect(helpersFor('linux').map((h) => h.command)).toEqual([
      'wl-copy',
      'xclip',
      'xsel',
      'clip.exe',
    ]);
  });

  test('clip.exe is fed UTF-16LE, because it mangles UTF-8 outside the code page', () => {
    // Bible text is full of Greek and Hebrew; this is not a hypothetical.
    const { host, ran } = fake({ platform: 'win32', working: ['clip.exe'] });
    copyToClipboard('θεὸς', host);

    // 4 characters as UTF-16LE is 8 bytes; as UTF-8 it would be 9.
    expect(ran).toEqual(['clip.exe:8']);
  });

  test('other helpers are fed UTF-8', () => {
    const { host, ran } = fake({ platform: 'darwin', working: ['pbcopy'] });
    copyToClipboard('θεὸς', host);
    expect(ran).toEqual(['pbcopy:9']);
  });
});
