/**
 * Tab persistence.
 *
 * The round-trip tests use a real file rather than `:memory:`, because
 * "survives quit and relaunch" is a claim about a file on disk and an
 * in-memory database cannot fail the way a real one does. The corruption tests
 * write deliberately broken files, which is the only honest way to check that
 * the app still starts.
 */
import { afterAll, describe, expect, test } from 'bun:test';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { addBookmark, type Bookmark } from './bookmarks';
import {
  DEFAULT_SESSION,
  type SessionState,
  StateStore,
  type TabState,
} from './state';

const scratch = mkdtempSync(join(tmpdir(), 'state-'));
afterAll(() => rmSync(scratch, { recursive: true, force: true }));

let counter = 0;
const freshHome = (): string => join(scratch, `home-${(counter += 1)}`);

const tab = (overrides: Partial<TabState> = {}): TabState => ({
  bookNumber: 43,
  chapter: 3,
  cursorVerse: 43003016,
  selectionAnchor: undefined,
  scrollOffset: 0,
  translation: 'KJV',
  displayMode: 'paragraph',
  ...overrides,
});

describe('a fresh install', () => {
  test('starts with one default tab rather than none', () => {
    const { store, recoveredFrom } = StateStore.open(freshHome());

    expect(recoveredFrom).toBeUndefined();
    expect(store.load()).toEqual(DEFAULT_SESSION);
    expect(store.load().tabs).toHaveLength(1);
    store.close();
  });
});

describe('surviving quit and relaunch', () => {
  test('every field of every tab round-trips', () => {
    const home = freshHome();
    const session: SessionState = {
      tabs: [
        tab(),
        tab({
          bookNumber: 45,
          chapter: 8,
          cursorVerse: 45008028,
          scrollOffset: 12,
          translation: 'ASV',
          displayMode: 'numbered',
        }),
      ],
      activeTab: 1,
    };

    const first = StateStore.open(home).store;
    first.save(session);
    first.close();

    // A new process, a new connection — the actual claim being made.
    const second = StateStore.open(home).store;
    expect(second.load()).toEqual(session);
    second.close();
  });

  test('tab order is preserved', () => {
    const home = freshHome();
    const session: SessionState = {
      tabs: [tab({ bookNumber: 1 }), tab({ bookNumber: 19 }), tab({ bookNumber: 66 })],
      activeTab: 0,
    };

    const first = StateStore.open(home).store;
    first.save(session);
    first.close();

    const second = StateStore.open(home).store;
    expect(second.load().tabs.map((t) => t.bookNumber)).toEqual([1, 19, 66]);
    second.close();
  });

  test('the active tab is restored, so the app opens where it left off', () => {
    const home = freshHome();
    const first = StateStore.open(home).store;
    first.save({ tabs: [tab(), tab(), tab()], activeTab: 2 });
    first.close();

    const second = StateStore.open(home).store;
    expect(second.load().activeTab).toBe(2);
    second.close();
  });

  test('saving replaces the previous tabs rather than appending', () => {
    const home = freshHome();
    const store = StateStore.open(home).store;

    store.save({ tabs: [tab(), tab(), tab()], activeTab: 0 });
    store.save({ tabs: [tab()], activeTab: 0 });

    expect(store.load().tabs).toHaveLength(1);
    store.close();
  });

  test('an out-of-range active index is clamped, not trusted', () => {
    const home = freshHome();
    const store = StateStore.open(home).store;

    store.save({ tabs: [tab(), tab()], activeTab: 99 });

    expect(store.load().activeTab).toBe(1);
    store.close();
  });

  test('saving an empty tab list still leaves a usable session', () => {
    const store = StateStore.ephemeral();
    store.save({ tabs: [], activeTab: 0 });
    expect(store.load().tabs.length).toBeGreaterThan(0);
    store.close();
  });
});

describe('bookmarks', () => {
  test('starts empty', () => {
    const store = StateStore.open(freshHome()).store;
    expect(store.loadBookmarks()).toEqual([]);
    store.close();
  });

  test('every field, and the order, round-trips', () => {
    const home = freshHome();
    let list: readonly Bookmark[] = addBookmark([], 'So loved', 43003016);
    list = addBookmark(list, 'Committed unto us', 47005019);

    const first = StateStore.open(home).store;
    first.saveBookmarks(list);
    first.close();

    // A new process, a new connection — the actual claim being made.
    const second = StateStore.open(home).store;
    expect(second.loadBookmarks()).toEqual([...list]);
    second.close();
  });

  test('ids survive the round-trip, so a rename or a delete still finds the right one', () => {
    const home = freshHome();
    const list = addBookmark(addBookmark([], 'A', 1), 'B', 2);

    const first = StateStore.open(home).store;
    first.saveBookmarks(list);
    first.close();

    const second = StateStore.open(home).store;
    expect(second.loadBookmarks().map((b) => b.id)).toEqual(list.map((b) => b.id));
    second.close();
  });

  test('saving replaces the previous list rather than appending', () => {
    const store = StateStore.ephemeral();
    store.saveBookmarks(addBookmark(addBookmark([], 'A', 1), 'B', 2));
    store.saveBookmarks(addBookmark([], 'C', 3));

    const loaded = store.loadBookmarks();
    expect(loaded).toHaveLength(1);
    expect(loaded[0]?.name).toBe('C');
    store.close();
  });
});

describe('corruption recovery', () => {
  test('a file that is not a database is set aside and the app still starts', () => {
    const home = freshHome();
    // Create the directory by opening once, then damage the file.
    StateStore.open(home).store.close();
    writeFileSync(join(home, 'state.db'), 'this is definitely not SQLite');

    const { store, recoveredFrom } = StateStore.open(home);

    // Failing to start would be a far worse outcome than losing a tab list.
    expect(recoveredFrom).toBe(join(home, 'state.db.corrupt'));
    expect(store.load()).toEqual(DEFAULT_SESSION);
    store.close();
  });

  test('the damaged file is kept, not deleted', () => {
    const home = freshHome();
    StateStore.open(home).store.close();
    writeFileSync(join(home, 'state.db'), 'corrupt');

    const { store, recoveredFrom } = StateStore.open(home);
    store.close();

    expect(readFileSync(recoveredFrom!, 'utf8')).toBe('corrupt');
  });

  test('a truncated database is recovered from', () => {
    const home = freshHome();
    const first = StateStore.open(home).store;
    first.save({ tabs: [tab()], activeTab: 0 });
    first.close();

    // A real SQLite header followed by nothing — opens fine, fails on read.
    writeFileSync(join(home, 'state.db'), 'SQLite format 3\u0000');

    const { store, recoveredFrom } = StateStore.open(home);
    expect(recoveredFrom).toBeDefined();
    expect(store.load()).toEqual(DEFAULT_SESSION);
    store.close();
  });

  test('recovery leaves a working store, not a read-only husk', () => {
    const home = freshHome();
    StateStore.open(home).store.close();
    writeFileSync(join(home, 'state.db'), 'corrupt');

    const { store } = StateStore.open(home);
    store.save({ tabs: [tab({ bookNumber: 40 })], activeTab: 0 });
    expect(store.load().tabs[0]?.bookNumber).toBe(40);
    store.close();
  });
});
