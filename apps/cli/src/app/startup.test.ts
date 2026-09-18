/**
 * The whole startup path, from an empty `~/.bible` to a drawn frame.
 *
 * This is the only test that runs the pieces in the order the real program does:
 * extract the bundled KJV, discover it, restore the session, draw. Each step is
 * covered on its own elsewhere; what is verified here is that they fit together,
 * which is exactly the seam a unit test cannot see.
 *
 * `BIBLE_HOME` points at a temporary directory, so this never touches the
 * developer's own `~/.bible`.
 */
import { afterEach, describe, expect, test } from 'bun:test';
import { existsSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { defaultDiscoveryEnv, type DiscoveryEnv } from '../data/modules';
import { startup, startupMessage, type Startup } from './startup';
import { createTheme, stripAnsi } from '../term/style';

const theme = createTheme('none');
const dirs: string[] = [];
const started: Startup[] = [];

afterEach(() => {
  for (const s of started.splice(0)) {
    s.store.close();
    s.library.close();
  }
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

function home(): string {
  const dir = mkdtempSync(join(tmpdir(), 'bible-home-'));
  dirs.push(dir);
  return dir;
}

/**
 * A genuinely isolated environment: real filesystem, but a home, a working
 * directory and an environment that between them yield exactly one module root.
 *
 * Redirecting `BIBLE_HOME` alone is not enough, and finding that out is half the
 * value of this test. In a developer checkout the repo root
 * (`data/modules`) is itself a module root, and it holds a KJV
 * with the same `content_sha256` as the bundled one — so `ensureBundledKjv`
 * correctly reports `already-discoverable` and never extracts anything. The
 * first-run path would then be untested on the only machines that run these
 * tests.
 */
function envAt(path: string): DiscoveryEnv {
  const base = defaultDiscoveryEnv();
  return { ...base, home: path, cwd: path, env: { BIBLE_HOME: path } };
}

async function boot(path: string): Promise<Startup> {
  const result = await startup({ env: envAt(path), theme });
  started.push(result);
  return result;
}

/** Whether this build has a real bundled KJV, as opposed to the CI placeholder. */
const bundled = join(import.meta.dir, '..', 'assets', 'bible_kjv.db');
const hasBundled = existsSync(bundled) && Bun.file(bundled).size > 1_000_000;

describe.skipIf(!hasBundled)('a first run', () => {
  test('extracts the bundled KJV, finds it, and draws a readable frame', async () => {
    const path = home();
    const first = await boot(path);

    expect(first.firstRun.action).toBe('extracted');
    expect(existsSync(join(path, 'modules', 'bible_kjv.db'))).toBe(true);

    const frame = first.app.frame().lines.map(stripAnsi);
    // The default tab is Genesis 1:1, so this is the whole chain: extraction,
    // discovery, the canon, the reader, and the frame.
    expect(frame.join('\n')).toContain('In the beginning God created');
    expect(frame[0]).toContain('Genesis 1');
  });

  test('says so once, on the footer', async () => {
    const first = await boot(home());
    const footer = stripAnsi(first.app.frame().lines.at(-1) ?? '');
    expect(footer).toContain('extracted');
  });

  test('a second run extracts nothing and says nothing', async () => {
    const path = home();
    await boot(path);
    const second = await boot(path);

    // `already-discoverable`, not `already-extracted`: the copy written by the
    // first run is now found by discovery, which is the earlier of the two
    // checks and the more informative answer.
    expect(second.firstRun.action).toBe('already-discoverable');
    expect(startupMessage(second.firstRun, undefined)).toBeUndefined();
  });
});

describe.skipIf(!hasBundled)('a returning run', () => {
  test('opens where it left off', async () => {
    const path = home();
    const first = await boot(path);

    // Move to John 3, and save the way quitting does.
    const tab = { ...first.store.load().tabs[0]!, bookNumber: 43, chapter: 3, cursorVerse: 43003016 };
    first.store.save({ tabs: [tab], activeTab: 0 });
    first.store.close();
    first.library.close();
    started.pop();

    const second = await boot(path);
    const frame = second.app.frame().lines.map(stripAnsi);
    expect(frame[0]).toContain('John 3');
    expect(frame.join('\n')).toContain('For God so loved the world');
  });

  test('a corrupt state.db starts fresh and says so', async () => {
    const path = home();
    await boot(path);
    started.pop()!.store.close();

    writeFileSync(join(path, 'state.db'), 'this is not a database');
    const second = await boot(path);

    expect(second.recoveredFrom).toBeDefined();
    expect(stripAnsi(second.app.frame().lines.at(-1) ?? '')).toContain('unreadable');
    // And it still reads: recovery means a default tab, not a broken app.
    expect(second.app.frame().lines.map(stripAnsi)[0]).toContain('Genesis 1');
  });
});

describe('startupMessage', () => {
  test('a recovered state.db is reported ahead of a first-run extraction', () => {
    // Losing the tabs you had is the more surprising of the two, and the footer
    // has room for one line.
    const message = startupMessage(
      { action: 'extracted', path: '/x', contentSha256: undefined, detail: '' },
      'state.db.corrupt',
    );
    expect(message).toContain('unreadable');
  });

  test('nothing is said when nothing happened', () => {
    expect(
      startupMessage(
        { action: 'already-extracted', path: '/x', contentSha256: undefined, detail: '' },
        undefined,
      ),
    ).toBeUndefined();
  });
});
