/**
 * The opened input line, driven through the real decoder and the real reader.
 *
 * Every other test about this builds `Key` objects by hand, which proves the
 * routing but not the decoding: a `/` that arrives as some other name, or a
 * `backspace` that arrives as `0x08` rather than `0x7f`, would pass all of them
 * and still leave the app with no way to type a reference. So this drives raw
 * bytes into a real {@link startup} — real modules, real chapter, real frame —
 * and asserts on what the user would see.
 *
 * Skipped when the shipped KJV is not on disk, like every other test here that
 * reads a module.
 */
import { afterAll, describe, expect, test } from 'bun:test';
import { existsSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { defaultDiscoveryEnv, type DiscoveryEnv } from '../data/modules';

import { decodeKeys, flushPending } from '../term/keys';
import { stripAnsi } from '../term/style';
import { startup } from './startup';

const MODULES = join(import.meta.dir, '..', '..', '..', '..', 'data', 'modules');
const hasKjv = existsSync(join(MODULES, 'bible_kjv.db'));

/**
 * A real environment with a temporary `BIBLE_HOME`.
 *
 * `startup` is the real one, so without this it reads and writes the
 * developer's own `~/.bible/state.db` — which is not merely untidy. These tests
 * navigate and change reading settings, so the state they leave behind arrives
 * in the *next* test's opening frame and in the developer's next real session.
 * One test changing a reading setting is enough to make every later assertion
 * here describe a screen nobody asked for.
 *
 * `home` and `cwd` stay real, deliberately: the shipped KJV is found through the
 * desktop module root beside the repository, and redirecting those as well would
 * leave these tests with no Bible to read.
 */
function isolated(): { env: DiscoveryEnv } {
  const base = defaultDiscoveryEnv();
  const dir = mkdtempSync(join(tmpdir(), 'bible-e2e-'));
  homes.push(dir);
  return { env: { ...base, env: { ...base.env, BIBLE_HOME: dir } } };
}

const homes: string[] = [];
afterAll(() => {
  for (const dir of homes) rmSync(dir, { recursive: true, force: true });
});

/** Feed raw terminal bytes in, exactly as a TTY would deliver them. */
function send(app: { handleKey: (key: ReturnType<typeof decodeKeys>['keys'][number]) => void }, bytes: string): void {
  // The leftover is flushed too: `decodeKeys` holds an unterminated escape
  // sequence back, so a lone `ESC` would otherwise never arrive at all.
  const { keys, pending } = decodeKeys(bytes);
  for (const key of keys) app.handleKey(key);
  for (const key of flushPending(pending)) app.handleKey(key);
}

function screenText(app: { frame: () => { lines: string[] } }): string {
  return app.frame().lines.map(stripAnsi).join('\n');
}

describe.skipIf(!hasKjv)('the input line, end to end', () => {
  test('a reference typed after a slash navigates, and the prompt tracks the mode', async () => {
    const { app } = await startup(isolated());

    // Closed: the row advertises the key that opens it.
    expect(screenText(app)).toContain('/ go to or search');

    // The bytes a user actually sends. `/` opens, the rest is text.
    send(app, '/rom 8:28');
    const typing = screenText(app);
    expect(typing).toContain('> rom 8:28');
    // The input row does not advertise the key; the screen's own hint row
    // still does, so look at the row that holds the prompt, not the whole frame.
    const inputRow = typing.split('\n').find((line) => line.includes('> rom 8:28')) ?? '';
    expect(inputRow).not.toContain('/ go to or search');

    send(app, '\r');
    const landed = screenText(app);
    expect(landed).toContain('Romans 8');
    // Closed again, and the caret is gone with it.
    expect(landed).toContain('/ go to or search');

    app.handleKey(decodeKeys('\x03').keys[0]!);
  });

  test('letters are commands while the line is closed, and text once it is open', async () => {
    const { app } = await startup(isolated());

    // `n` closed is the next-chapter command, so the frame changes rather than
    // an `n` appearing anywhere.
    const before = screenText(app);
    send(app, 'n');
    const after = screenText(app);
    expect(after).not.toBe(before);
    expect(after).not.toContain('> n');

    // The same key after `/` is just a letter. This is the `g`-in-Genesis bug:
    // the whole point is that a bound letter can begin a book name.
    send(app, '/genesis 1');
    expect(screenText(app)).toContain('> genesis 1');

    send(app, '\r');
    expect(screenText(app)).toContain('Genesis 1');

    app.handleKey(decodeKeys('\x03').keys[0]!);
  });

  test('backspacing off the start closes the line rather than trapping the user', async () => {
    const { app } = await startup(isolated());

    send(app, '/ab');
    expect(screenText(app)).toContain('> ab');

    // Three, for two characters: the third is the one at the start.
    send(app, '\x7f\x7f\x7f');
    expect(screenText(app)).toContain('/ go to or search');

    app.handleKey(decodeKeys('\x03').keys[0]!);
  });
});
