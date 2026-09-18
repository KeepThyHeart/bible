/**
 * `~/.bible/state.db` — the only file this app writes.
 *
 * It holds the open tabs (what you had open is what you get back), the
 * bookmarks and a few app-level values.
 *
 * **Two kinds of state, stored differently.** Tabs and bookmarks get real
 * tables, because they are lists the app reasons about — ordering, the active
 * one, one row each. Everything else (display settings, the last commentary) is
 * a key/value row in `app_state`, so adding one needs no schema change.
 *
 * **Corruption is expected, not exceptional.** A power cut mid-write, a synced
 * folder, a half-copied home directory. The store recovers by moving the bad
 * file aside and starting fresh, because failing to start is a far worse
 * outcome than losing a tab list.
 */
import { existsSync, mkdirSync, renameSync, rmSync } from 'node:fs';
import { join } from 'node:path';

import { VerseIdHelper } from '@bible/core';

import { BunSql } from '../data/BunSql';
import type { Bookmark } from './bookmarks';

/** Bumped when the *table* shape changes; the JSON blob versions itself. */
export const STATE_SCHEMA_VERSION = 1;

/** How a chapter is drawn. Both flow to whatever width the window happens to be. */
export type DisplayMode = 'paragraph' | 'numbered';

const DISPLAY_MODES: readonly DisplayMode[] = ['paragraph', 'numbered'];

/** Anything else stored in the column reads back as the default, never as a crash. */
function toDisplayMode(raw: string): DisplayMode {
  return DISPLAY_MODES.includes(raw as DisplayMode) ? (raw as DisplayMode) : 'paragraph';
}

export interface TabState {
  readonly bookNumber: number;
  readonly chapter: number;
  /** The verse the cursor sits on — the subject of every key. */
  readonly cursorVerse: number;
  /**
   * The other end of a selection, when there is one.
   *
   * A selection is an anchor plus the cursor rather than a start and an end, so
   * that `shift+↑` from the anchor shrinks the range instead of inverting it,
   * and so there is exactly one place the cursor lives. `undefined` means the
   * selection is the cursor verse alone, which is what `y` copies by default.
   */
  readonly selectionAnchor: number | undefined;
  /**
   * Whether the arrow keys *extend* the selection rather than replace it.
   *
   * Set only by `v`, whose whole job is to make the ordinary arrows extend on a
   * terminal that swallows `shift+arrow` . `shift+↑`/`shift+↓` leave it
   * unset: they carry their own intent in the modifier, so the plain arrow that
   * follows collapses the range the way it does in every editor. Without the
   * distinction there is no way back to a bare cursor except `esc`, which is
   * what "stuck in shift mode" was.
   *
   * Deliberately *not* persisted. It is the state of a keystroke in progress,
   * and restoring it on launch would resurrect the stuck feeling across a
   * restart — so `state.db` has no column for it and it reads back `undefined`.
   */
  readonly selectionArmed?: boolean | undefined;
  readonly scrollOffset: number;
  /** Module abbreviation, e.g. `KJV`. */
  readonly translation: string;
  readonly displayMode: DisplayMode;
}

export interface SessionState {
  readonly tabs: readonly TabState[];
  /** Index into `tabs`. Restored on launch, so the app opens where it left off. */
  readonly activeTab: number;
}

export const DEFAULT_TAB: TabState = {
  bookNumber: 1,
  chapter: 1,
  cursorVerse: 1001001,
  selectionAnchor: undefined,
  scrollOffset: 0,
  translation: 'KJV',
  displayMode: 'paragraph',
};

export const DEFAULT_SESSION: SessionState = { tabs: [DEFAULT_TAB], activeTab: 0 };

/**
 * The cursor's verse *number*, as opposed to its verse id.
 *
 * `cursorVerse` is stored as a full verse id so it stays meaningful on its own —
 * a bare verse number would be wrong the moment the tab's book or chapter
 * changed without it. Screens want the number, and deriving it in one place
 * keeps the id-versus-number distinction from leaking into every one of them.
 */
export function cursorVerseNumber(tab: TabState): number {
  return VerseIdHelper.parse(tab.cursorVerse).verse;
}

const SCHEMA = `
CREATE TABLE IF NOT EXISTS state_schema (
  version INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS tab (
  tab_id        INTEGER PRIMARY KEY AUTOINCREMENT,
  sort_order    INTEGER NOT NULL,
  book_number   INTEGER NOT NULL,
  chapter       INTEGER NOT NULL,
  cursor_verse  INTEGER NOT NULL,
  selection_anchor INTEGER,
  scroll_offset INTEGER NOT NULL DEFAULT 0,
  translation   TEXT    NOT NULL,
  display_mode  TEXT    NOT NULL DEFAULT 'paragraph'
);

CREATE TABLE IF NOT EXISTS app_state (
  key   TEXT PRIMARY KEY,
  value TEXT NOT NULL
);

-- \`id\` is assigned by app/bookmarks.ts, not by SQLite: it is what every
-- rename, re-point, reorder and delete refers to, and it has to survive a
-- save/load round-trip meaning the same thing, which an AUTOINCREMENT
-- reassigned on every save would not.
CREATE TABLE IF NOT EXISTS bookmark (
  id          INTEGER PRIMARY KEY,
  sort_order  INTEGER NOT NULL,
  name        TEXT    NOT NULL,
  verse_id    INTEGER NOT NULL
);
`;

interface TabRow {
  book_number: number;
  chapter: number;
  cursor_verse: number;
  selection_anchor: number | null;
  scroll_offset: number;
  translation: string;
  display_mode: string;
}

export interface OpenStateResult {
  readonly store: StateStore;
  /** Set when the previous file was unreadable and had to be set aside. */
  readonly recoveredFrom: string | undefined;
}

export class StateStore {
  private constructor(private readonly sql: BunSql) {}

  /**
   * Open (or create) the state database under a `~/.bible`-style directory.
   *
   * Never throws for a damaged file: the bad one is renamed to
   * `state.db.corrupt` and a fresh database takes its place, so the app always
   * starts. The caller is told, so it can mention it once.
   */
  static open(bibleHomePath: string): OpenStateResult {
    mkdirSync(bibleHomePath, { recursive: true });
    const path = join(bibleHomePath, 'state.db');

    try {
      return { store: StateStore.initialise(path), recoveredFrom: undefined };
    } catch {
      const aside = `${path}.corrupt`;
      try {
        rmSync(aside, { force: true });
        if (existsSync(path)) renameSync(path, aside);

        // The `-wal` and `-shm` sidecars have to go too. A stale write-ahead
        // log left beside a *new* database makes SQLite reject that database
        // as "file is not a database" — so moving only `state.db` aside turns
        // one unreadable file into two.
        for (const suffix of ['-wal', '-shm']) {
          rmSync(`${path}${suffix}`, { force: true });
        }
      } catch {
        // If even that fails there is nothing useful left to try; the fresh
        // open below will surface any real problem.
      }
      return { store: StateStore.initialise(path), recoveredFrom: aside };
    }
  }

  /** In-memory store, for tests and for a `--no-state` run. */
  static ephemeral(): StateStore {
    return StateStore.initialise(':memory:');
  }

  private static initialise(path: string): StateStore {
    const sql = new BunSql(path, { create: true });
    try {
      for (const statement of SCHEMA.split(';')) {
        const trimmed = statement.trim();
        if (trimmed) sql.execute(trimmed);
      }

      const version = sql.queryOne<{ version: number }>('SELECT version FROM state_schema LIMIT 1');
      if (!version) {
        sql.execute('INSERT INTO state_schema (version) VALUES (?)', [STATE_SCHEMA_VERSION]);
      } else if (version.version !== STATE_SCHEMA_VERSION) {
        sql.execute('UPDATE state_schema SET version = ?', [STATE_SCHEMA_VERSION]);
      }

      // A read is the only way to know the file is really usable; `open`
      // succeeds on a truncated or non-SQLite file until something is queried.
      sql.queryOne('SELECT count(*) AS n FROM tab');

      return new StateStore(sql);
    } catch (error) {
      sql.close();
      throw error;
    }
  }

  /**
   * The tabs from the last session.
   *
   * Returns the default session rather than an empty one when there is nothing
   * stored — the app is never in a state with no tabs.
   */
  load(): SessionState {
    let rows: TabRow[];
    try {
      rows = this.sql.queryAll<TabRow>('SELECT * FROM tab ORDER BY sort_order, tab_id');
    } catch {
      return DEFAULT_SESSION;
    }

    if (rows.length === 0) return DEFAULT_SESSION;

    const tabs = rows.map(
      (row): TabState => ({
        bookNumber: row.book_number,
        chapter: row.chapter,
        cursorVerse: row.cursor_verse,
        selectionAnchor: row.selection_anchor ?? undefined,
        scrollOffset: row.scroll_offset,
        translation: row.translation,
        displayMode: toDisplayMode(row.display_mode),
      }),
    );

    const stored = Number.parseInt(this.getValue('activeTab') ?? '0', 10);
    const activeTab = Number.isNaN(stored) ? 0 : Math.min(Math.max(stored, 0), tabs.length - 1);

    return { tabs, activeTab };
  }

  /** Replace the stored tabs with this session. */
  save(state: SessionState): void {
    const tabs = state.tabs.length > 0 ? state.tabs : DEFAULT_SESSION.tabs;

    this.sql.transaction(() => {
      this.sql.execute('DELETE FROM tab');
      tabs.forEach((tab, index) => {
        this.sql.execute(
          `INSERT INTO tab (
             sort_order, book_number, chapter, cursor_verse, selection_anchor,
             scroll_offset, translation, display_mode
           ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
          [
            index,
            tab.bookNumber,
            tab.chapter,
            tab.cursorVerse,
            tab.selectionAnchor ?? null,
            tab.scrollOffset,
            tab.translation,
            tab.displayMode,
          ],
        );
      });

      const active = Math.min(Math.max(state.activeTab, 0), tabs.length - 1);
      this.setValue('activeTab', String(active));
    });
  }

  /** Every bookmark, in the user's own order. */
  loadBookmarks(): Bookmark[] {
    try {
      return this.sql
        .queryAll<{ id: number; name: string; verse_id: number }>(
          'SELECT id, name, verse_id FROM bookmark ORDER BY sort_order, id',
        )
        .map((row) => ({ id: row.id, name: row.name, verseId: row.verse_id }));
    } catch {
      return [];
    }
  }

  /** Replace the stored bookmarks with this list, in the order given. */
  saveBookmarks(bookmarks: readonly Bookmark[]): void {
    this.sql.transaction(() => {
      this.sql.execute('DELETE FROM bookmark');
      bookmarks.forEach((bookmark, index) => {
        this.sql.execute(
          'INSERT INTO bookmark (id, sort_order, name, verse_id) VALUES (?, ?, ?, ?)',
          [bookmark.id, index, bookmark.name, bookmark.verseId],
        );
      });
    });
  }

  getValue(key: string): string | undefined {
    const row = this.sql.queryOne<{ value: string }>('SELECT value FROM app_state WHERE key = ?', [
      key,
    ]);
    return row?.value;
  }

  setValue(key: string, value: string): void {
    this.sql.execute(
      'INSERT INTO app_state (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value',
      [key, value],
    );
  }

  /** False once {@link close} has run, or once the connection was closed under it. */
  isOpen(): boolean {
    return this.sql.isOpen();
  }

  close(): void {
    this.sql.close();
  }
}
