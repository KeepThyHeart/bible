/**
 * Web Worker for client-side Bible SQLite queries via wa-sqlite + OPFS.
 *
 * Opens lite Bible .db files directly from OPFS (no full-DB load into memory)
 * and runs chapter/verse queries locally. This eliminates server round-trips
 * for downloaded translations.
 *
 * NOTE: Verse formatting lives in `./verseFormatting.ts` — a duplicate of
 * @bible/core VerseFormatter, kept because the core package is CJS and Vite's
 * worker build (Rollup) cannot resolve named CJS re-exports in ES workers.
 *
 * Message protocol:
 *   -> { type: 'openDb', module }
 *   <- { type: 'dbReady', module }
 *   -> { type: 'closeDb', module }
 *   -> { type: 'getChapter', requestId, module, book, chapter }
 *   -> { type: 'getVerse', requestId, module, verseId }
 *   <- { type: 'result', requestId, data }
 *   <- { type: 'error', requestId, message }
 */

import SQLiteESMFactory from 'wa-sqlite/dist/wa-sqlite-async.mjs';
import { OriginPrivateFileSystemVFS } from 'wa-sqlite/src/examples/OriginPrivateFileSystemVFS.js';
import * as SQLite from 'wa-sqlite';
import {
  formatVerseText,
  hasWordsOfChrist,
  getFootnotes,
  type FormattingData,
} from './verseFormatting';

// ── State ──────────────────────────────────────────────────────────────────

type SQLiteAPI = ReturnType<typeof SQLite.Factory>;

let sqlite3: SQLiteAPI | null = null;

/** LRU cache of opened databases (max 3). Values are wa-sqlite numeric DB handles. */
const dbCache = new Map<string, number>();
const dbAccessOrder: string[] = [];
const MAX_CACHED_DBS = 3;

/** Cached per-module: does interlinear_word table exist? (always false for lite DBs) */
const interlinearCache = new Map<string, boolean>();

// ── SQL Helpers ────────────────────────────────────────────────────────────

async function ensureSqlite(): Promise<void> {
  if (sqlite3) return;
  const module = await SQLiteESMFactory({
    locateFile(file: string) {
      // In Vite dev mode, the default relative URL resolves to the SPA fallback (HTML).
      // Serve the .wasm from the public directory instead.
      return `/${file}`;
    },
  });
  sqlite3 = SQLite.Factory(module);
  const vfs = new OriginPrivateFileSystemVFS();
  sqlite3.vfs_register(vfs, true);
}

function touchLru(module: string): void {
  const idx = dbAccessOrder.indexOf(module);
  if (idx !== -1) dbAccessOrder.splice(idx, 1);
  dbAccessOrder.push(module);
}

async function evictIfNeeded(): Promise<void> {
  while (dbCache.size > MAX_CACHED_DBS && dbAccessOrder.length > 0) {
    const oldest = dbAccessOrder.shift()!;
    const handle = dbCache.get(oldest);
    if (handle !== undefined) {
      await sqlite3!.close(handle);
      dbCache.delete(oldest);
      interlinearCache.delete(oldest);
    }
  }
}

function getDb(module: string): number | undefined {
  const handle = dbCache.get(module);
  if (handle !== undefined) touchLru(module);
  return handle;
}

async function checkInterlinearData(db: number): Promise<boolean> {
  let found = false;
  await sqlite3!.exec(db,
    "SELECT COUNT(*) as c FROM sqlite_master WHERE type='table' AND name='interlinear_word'",
    (row) => { found = (row[0] as number) > 0; }
  );
  return found;
}

async function getCoveredBooks(db: number): Promise<number[]> {
  const books: number[] = [];
  await sqlite3!.exec(db,
    'SELECT DISTINCT verse_id / 1000000 as book_number FROM bible_verse ORDER BY book_number',
    (row) => { books.push(row[0] as number); }
  );
  return books;
}

interface RawVerseRow {
  verse_id: number;
  text: string;
  formatting: string | null;
  word_count: number | null;
}

function rowToRawVerse(r: (number | string | Uint8Array | number[] | bigint | null)[]): RawVerseRow {
  return {
    verse_id: r[0] as number,
    text: r[1] as string,
    formatting: r[2] as string | null,
    word_count: r[3] as number | null,
  };
}

/**
 * Columns as the v2 module schema actually defines them:
 * `bible_verse(verse_id, text, formatting, word_count, metadata)`.
 *
 * This asked for `text_plain` and `formatting_data` — v1 names that no module
 * in the registry has had for some time. Every local read therefore failed with
 * `no such column: text_plain`, and `OfflineBibleProvider.getChapter` caught it
 * and fell back to the server. The fallback is what hid the bug: the app worked
 * perfectly, it just downloaded 6.5 MB per translation and then never read a
 * single byte of it. Nothing offline could work either — the "offline" path was
 * the server path with an extra failed query in front of it.
 */
const VERSE_SQL = 'SELECT verse_id, text, formatting, word_count FROM bible_verse';

async function queryChapter(db: number, book: number, chapter: number): Promise<RawVerseRow[]> {
  const startId = book * 1000000 + chapter * 1000;
  const endId = startId + 999;
  const rows: RawVerseRow[] = [];
  for await (const stmt of sqlite3!.statements(db, `${VERSE_SQL} WHERE verse_id BETWEEN ? AND ? ORDER BY verse_id`)) {
    sqlite3!.bind_collection(stmt, [startId, endId]);
    while (await sqlite3!.step(stmt) === SQLite.SQLITE_ROW) {
      rows.push(rowToRawVerse(sqlite3!.row(stmt)));
    }
  }
  return rows;
}

async function querySingleVerse(db: number, verseId: number): Promise<RawVerseRow | null> {
  let result: RawVerseRow | null = null;
  for await (const stmt of sqlite3!.statements(db, `${VERSE_SQL} WHERE verse_id = ?`)) {
    sqlite3!.bind_collection(stmt, [verseId]);
    if (await sqlite3!.step(stmt) === SQLite.SQLITE_ROW) {
      result = rowToRawVerse(sqlite3!.row(stmt));
    }
  }
  return result;
}

function formatRow(row: RawVerseRow) {
  const fd: FormattingData | undefined = row.formatting ? JSON.parse(row.formatting) : undefined;
  const { textHtml, isParagraphStart, sectionHeading } = formatVerseText(row.text, fd);
  const footnotes = getFootnotes(fd);

  const bookNumber = Math.floor(row.verse_id / 1000000);
  const remainder = row.verse_id % 1000000;
  const chapter = Math.floor(remainder / 1000);
  const verseNum = remainder % 1000;

  return {
    verse_id: row.verse_id,
    book_number: bookNumber,
    chapter,
    verse: verseNum,
    text: row.text,
    text_html: textHtml,
    is_paragraph_start: isParagraphStart,
    words_of_christ: hasWordsOfChrist(fd),
    footnotes: footnotes.length > 0 ? footnotes : undefined,
    section_heading: sectionHeading,
  };
}

// ── Message Handler ────────────────────────────────────────────────────────

self.onmessage = async (e: MessageEvent) => {
  const msg = e.data;

  try {
    switch (msg.type) {
      case 'openDb': {
        await ensureSqlite();
        const moduleName = msg.module as string;
        // Close existing if re-opening same module
        if (dbCache.has(moduleName)) {
          await sqlite3!.close(dbCache.get(moduleName)!);
          dbCache.delete(moduleName);
        }
        // Open OPFS file directly — path matches OfflineStorageManager's storage layout
        const db = await sqlite3!.open_v2(`modules/${moduleName}.db`);
        dbCache.set(moduleName, db);
        touchLru(moduleName);
        await evictIfNeeded();
        interlinearCache.set(moduleName, await checkInterlinearData(db));
        self.postMessage({ type: 'dbReady', module: moduleName });
        break;
      }

      case 'closeDb': {
        const handle = dbCache.get(msg.module);
        if (handle !== undefined) {
          await sqlite3!.close(handle);
          dbCache.delete(msg.module);
          interlinearCache.delete(msg.module);
          const idx = dbAccessOrder.indexOf(msg.module);
          if (idx !== -1) dbAccessOrder.splice(idx, 1);
        }
        break;
      }

      case 'getChapter': {
        const db = getDb(msg.module);
        if (db === undefined) {
          self.postMessage({ type: 'error', requestId: msg.requestId, message: `Module ${msg.module} not open` });
          return;
        }

        const rows = await queryChapter(db, msg.book, msg.chapter);
        const verses = rows.map(formatRow);
        const hasInterlinear = interlinearCache.get(msg.module) ?? false;

        const data: Record<string, unknown> = {
          verses,
          hasInterlinearData: hasInterlinear,
        };

        if (verses.length === 0) {
          data.coveredBooks = await getCoveredBooks(db);
        }

        self.postMessage({ type: 'result', requestId: msg.requestId, data });
        break;
      }

      case 'getVerse': {
        const db = getDb(msg.module);
        if (db === undefined) {
          self.postMessage({ type: 'error', requestId: msg.requestId, message: `Module ${msg.module} not open` });
          return;
        }

        const row = await querySingleVerse(db, msg.verseId);
        if (!row) {
          self.postMessage({ type: 'error', requestId: msg.requestId, message: 'Verse not found' });
          return;
        }

        self.postMessage({ type: 'result', requestId: msg.requestId, data: formatRow(row) });
        break;
      }
    }
  } catch (err) {
    const requestId = msg.requestId;
    const message = err instanceof Error ? err.message : String(err);
    if (requestId != null) {
      self.postMessage({ type: 'error', requestId, message });
    } else {
      self.postMessage({ type: 'error', requestId: -1, message });
    }
  }
};
