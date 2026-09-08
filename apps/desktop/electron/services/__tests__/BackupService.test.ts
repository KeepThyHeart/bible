/**
 * Tests for backup and restore.
 *
 * This is a user-data path - the one place where a bug does not merely display
 * something wrong but loses notes, highlights and collections outright - and it
 * had no tests. `BibleNotesFileService` got two after the `.bn` incident;
 * `BackupService`, which is what a reader falls back on when that goes wrong,
 * got none.
 *
 * What the tests below pin, in rough order of how expensive the failure is:
 *   - a full round trip preserves rows and `.bn` note files;
 *   - `merge` never overwrites a note the reader still has locally;
 *   - a tampered archive cannot write outside the notes directory;
 *   - the wrong password fails cleanly rather than restoring garbage;
 *   - `verse_link` is in the backup set (its comment in the source calls its
 *     omission "a data-loss path, not a gap" - that is exactly the kind of list
 *     entry a refactor drops).
 *
 * The SQL layer is a small in-memory fake rather than a real SQLite handle:
 * the service only uses four methods, and `better-sqlite3` in a vitest process
 * would need the Electron ABI rebuild.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { mkdtempSync, rmSync, mkdirSync, writeFileSync, readFileSync, existsSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';
import { createBackup, validateBackup, restoreBackup, restoreNoteFiles } from '../BackupService';

vi.mock('electron-log', () => ({
  default: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}));

const PASSWORD = 'correct horse battery staple';

/** Minimal in-memory stand-in for the `ISql` surface BackupService uses. */
class FakeDb {
  tables: Record<string, Record<string, unknown>[]>;
  /** SQL statements that were executed, for asserting on clears and rebuilds. */
  executed: string[] = [];

  constructor(tables: Record<string, Record<string, unknown>[]>) {
    this.tables = tables;
  }

  queryOne(sql: string, params?: unknown[]): unknown {
    if (sql.includes('sqlite_master')) {
      const name = String(params?.[0]);
      return name in this.tables ? { name } : undefined;
    }
    return undefined;
  }

  queryAll(sql: string): unknown[] {
    const match = sql.match(/SELECT \* FROM (\w+)/);
    return match ? (this.tables[match[1]] ?? []) : [];
  }

  execute(sql: string, params?: unknown[]): void {
    this.executed.push(sql);

    const del = sql.match(/^DELETE FROM (\w+)/);
    if (del) { this.tables[del[1]] = []; return; }

    const insert = sql.match(/INTO (\w+) \(([^)]+)\)/);
    if (insert && params) {
      const [, table, columnList] = insert;
      const columns = columnList.split(', ');
      const row: Record<string, unknown> = {};
      columns.forEach((col, i) => { row[col] = params[i]; });
      (this.tables[table] ??= []).push(row);
    }
  }

  transaction<T>(fn: () => T): T {
    return fn();
  }
}

let workDir: string;
const dest = () => join(workDir, 'backups');
const notes = () => join(workDir, 'notes');

/** A database with a couple of rows in the tables that matter most. */
function seededDb(): FakeDb {
  return new FakeDb({
    user_note: [
      { note_id: 1, title: 'On John 3', content: 'For God so loved…' },
      { note_id: 2, title: 'On Psalm 23', content: 'The Lord is my shepherd' },
    ],
    verse_link: [{ link_id: 1, note_id: 1, verse_id: 43003016 }],
    user_text_markup: [{ markup_id: 1, verse_id: 43003016, color: 'yellow' }],
    session: [{ session_id: 1, layout: '{}' }],
    user_search_history: [{ id: 1, query: 'grace' }],
    user_note_fts: [],
  });
}

/** An empty database with the same tables, as a restore target. */
function emptyDb(): FakeDb {
  const db = seededDb();
  for (const key of Object.keys(db.tables)) db.tables[key] = [];
  return db;
}

async function backup(db: FakeDb, options: Partial<Parameters<typeof createBackup>[1]> = {}) {
  const result = await createBackup(db as never, {
    password: PASSWORD,
    destinationPath: dest(),
    username: 'tester',
    ...options,
  } as Parameters<typeof createBackup>[1]);
  expect(result.success).toBe(true);
  return result;
}

beforeEach(() => {
  workDir = mkdtempSync(join(tmpdir(), 'backup-service-'));
  mkdirSync(dest(), { recursive: true });
  mkdirSync(notes(), { recursive: true });
});

afterEach(() => {
  rmSync(workDir, { recursive: true, force: true });
});

describe('createBackup', () => {
  it('writes an encrypted .bbk whose contents are not readable as plain text', async () => {
    const result = await backup(seededDb());

    expect(result.path!.endsWith('.bbk')).toBe(true);
    const onDisk = readFileSync(result.path!, 'utf-8');
    expect(onDisk).not.toContain('For God so loved');
    expect(JSON.parse(onDisk).magic).toBe('bible-app-backup');
  });

  it('records a row count for every table it exported', async () => {
    const result = await backup(seededDb());

    expect(result.metadata!.tables.user_note).toBe(2);
    expect(result.metadata!.tables.verse_link).toBe(1);
  });

  it('includes verse_link, whose omission would silently drop every user link', async () => {
    // The source comment calls this out as a data-loss path rather than a gap.
    const result = await backup(seededDb());

    expect(Object.keys(result.metadata!.tables)).toContain('verse_link');
  });

  it('leaves history out unless it was asked for', async () => {
    const without = await backup(seededDb());
    expect(without.metadata!.tables.user_search_history).toBeUndefined();

    const with_ = await backup(seededDb(), { includeHistory: true });
    expect(with_.metadata!.tables.user_search_history).toBe(1);
  });

  it('skips tables the database does not have rather than failing', async () => {
    // Older user databases predate some of these tables; a backup must still
    // be takeable.
    const sparse = new FakeDb({ user_note: [{ note_id: 1 }] });

    const result = await backup(sparse);

    expect(Object.keys(result.metadata!.tables)).toEqual(['user_note']);
  });

  it('bundles the .bn note files, which live outside the database', async () => {
    writeFileSync(join(notes(), 'sermon.bn'), 'sermon text');
    mkdirSync(join(notes(), 'sub'), { recursive: true });
    writeFileSync(join(notes(), 'sub', 'nested.bn'), 'nested text');

    const result = await backup(seededDb(), { notesDir: notes() });

    expect(result.metadata!.noteFiles).toBe(2);
  });

  it('bundles .bak history only when history was asked for', async () => {
    writeFileSync(join(notes(), 'sermon.bn'), 'sermon');
    writeFileSync(join(notes(), 'sermon.bn.bak'), 'older sermon');

    expect((await backup(seededDb(), { notesDir: notes() })).metadata!.noteFiles).toBe(1);
    expect(
      (await backup(seededDb(), { notesDir: notes(), includeHistory: true })).metadata!.noteFiles,
    ).toBe(2);
  });

  it('reports failure rather than throwing when the destination is unwritable', async () => {
    const result = await createBackup(seededDb() as never, {
      password: PASSWORD,
      destinationPath: join(workDir, 'does', 'not', 'exist'),
      username: 'tester',
    } as Parameters<typeof createBackup>[1]);

    expect(result.success).toBe(false);
    expect(result.error).toBeDefined();
  });
});

describe('validateBackup', () => {
  it('accepts the archive it just wrote', async () => {
    const created = await backup(seededDb());

    const result = await validateBackup(created.path!, PASSWORD);

    expect(result.valid).toBe(true);
    expect(result.metadata!.username).toBe('tester');
  });

  it('rejects the wrong password without leaking anything', async () => {
    const created = await backup(seededDb());

    const result = await validateBackup(created.path!, 'wrong password');

    expect(result.valid).toBe(false);
    expect(result.metadata).toBeUndefined();
  });

  it('reports a missing file rather than throwing', async () => {
    const result = await validateBackup(join(workDir, 'nope.bbk'), PASSWORD);

    expect(result.valid).toBe(false);
    expect(result.error).toContain('not found');
  });

  it('rejects a file that is not an archive', async () => {
    const path = join(workDir, 'junk.bbk');
    writeFileSync(path, 'this is not JSON');

    expect((await validateBackup(path, PASSWORD)).valid).toBe(false);
  });

  it('rejects an archive whose ciphertext has been tampered with', async () => {
    // AES-GCM authenticates; a flipped byte must fail rather than decrypt to
    // rubbish that then gets written into the user's database.
    const created = await backup(seededDb());
    const envelope = JSON.parse(readFileSync(created.path!, 'utf-8'));
    const bytes = Buffer.from(envelope.ciphertext, 'base64');
    bytes[0] ^= 0xff;
    envelope.ciphertext = bytes.toString('base64');
    writeFileSync(created.path!, JSON.stringify(envelope));

    expect((await validateBackup(created.path!, PASSWORD)).valid).toBe(false);
  });
});

describe('restoreBackup', () => {
  it('round-trips the rows back into an empty database', async () => {
    const created = await backup(seededDb());
    const target = emptyDb();

    const result = await restoreBackup(target as never, {
      backupPath: created.path!,
      password: PASSWORD,
      mode: 'replace',
    } as Parameters<typeof restoreBackup>[1]);

    expect(result.success).toBe(true);
    expect(target.tables.user_note).toHaveLength(2);
    expect(target.tables.user_note[0]).toMatchObject({ title: 'On John 3' });
    expect(target.tables.verse_link).toHaveLength(1);
  });

  it('clears the target tables in replace mode', async () => {
    const created = await backup(seededDb());
    const target = new FakeDb({ ...emptyDb().tables, user_note: [{ note_id: 9, title: 'stale' }] });

    await restoreBackup(target as never, {
      backupPath: created.path!,
      password: PASSWORD,
      mode: 'replace',
    } as Parameters<typeof restoreBackup>[1]);

    expect(target.tables.user_note.map(r => r.title)).toEqual(['On John 3', 'On Psalm 23']);
  });

  it('does not clear the FTS shadow table, which cannot be deleted from', async () => {
    const created = await backup(seededDb());
    const target = emptyDb();

    await restoreBackup(target as never, {
      backupPath: created.path!,
      password: PASSWORD,
      mode: 'replace',
    } as Parameters<typeof restoreBackup>[1]);

    expect(target.executed.some(sql => sql.startsWith('DELETE FROM user_note_fts'))).toBe(false);
  });

  it('rebuilds the note search index after restoring notes', async () => {
    // Without this the reader's notes are back but unsearchable.
    const created = await backup(seededDb());
    const target = emptyDb();

    await restoreBackup(target as never, {
      backupPath: created.path!,
      password: PASSWORD,
      mode: 'replace',
    } as Parameters<typeof restoreBackup>[1]);

    expect(target.executed.some(sql => sql.includes("user_note_fts) VALUES('rebuild')"))).toBe(true);
  });

  it('keeps existing rows in merge mode', async () => {
    const created = await backup(seededDb());
    const target = new FakeDb({ ...emptyDb().tables, user_note: [{ note_id: 9, title: 'local only' }] });

    await restoreBackup(target as never, {
      backupPath: created.path!,
      password: PASSWORD,
      mode: 'merge',
    } as Parameters<typeof restoreBackup>[1]);

    expect(target.tables.user_note.map(r => r.title)).toContain('local only');
    expect(target.tables.user_note.map(r => r.title)).toContain('On John 3');
  });

  it('skips tables the target database does not have', async () => {
    const created = await backup(seededDb());
    const target = new FakeDb({ user_note: [] });

    const result = await restoreBackup(target as never, {
      backupPath: created.path!,
      password: PASSWORD,
      mode: 'replace',
    } as Parameters<typeof restoreBackup>[1]);

    expect(result.success).toBe(true);
    expect(result.tablesRestored).toEqual(['user_note']);
  });

  it('refuses the wrong password and changes nothing', async () => {
    const created = await backup(seededDb());
    const target = emptyDb();

    const result = await restoreBackup(target as never, {
      backupPath: created.path!,
      password: 'wrong password',
      mode: 'replace',
    } as Parameters<typeof restoreBackup>[1]);

    expect(result.success).toBe(false);
    expect(target.tables.user_note).toHaveLength(0);
  });

  it('reports a missing archive rather than throwing', async () => {
    const result = await restoreBackup(emptyDb() as never, {
      backupPath: join(workDir, 'nope.bbk'),
      password: PASSWORD,
      mode: 'replace',
    } as Parameters<typeof restoreBackup>[1]);

    expect(result.success).toBe(false);
    expect(result.error).toContain('not found');
  });
});

describe('restoring note files', () => {
  async function roundTrip(mode: 'merge' | 'replace', restoreDir: string) {
    writeFileSync(join(notes(), 'sermon.bn'), 'original sermon');
    const created = await backup(seededDb(), { notesDir: notes() });

    return restoreBackup(emptyDb() as never, {
      backupPath: created.path!,
      password: PASSWORD,
      mode,
      notesDir: restoreDir,
    } as Parameters<typeof restoreBackup>[1]);
  }

  it('writes the bundled notes back out', async () => {
    const target = join(workDir, 'restored');
    mkdirSync(target, { recursive: true });

    const result = await roundTrip('replace', target);

    expect(result.noteFilesRestored).toBe(1);
    expect(readFileSync(join(target, 'sermon.bn'), 'utf-8')).toBe('original sermon');
  });

  it('recreates nested directories', async () => {
    mkdirSync(join(notes(), 'sermons'), { recursive: true });
    writeFileSync(join(notes(), 'sermons', 'advent.bn'), 'advent');
    const created = await backup(seededDb(), { notesDir: notes() });
    const target = join(workDir, 'restored');

    await restoreBackup(emptyDb() as never, {
      backupPath: created.path!,
      password: PASSWORD,
      mode: 'replace',
      notesDir: target,
    } as Parameters<typeof restoreBackup>[1]);

    expect(readFileSync(join(target, 'sermons', 'advent.bn'), 'utf-8')).toBe('advent');
  });

  it('overwrites an existing note in replace mode', async () => {
    const target = join(workDir, 'restored');
    mkdirSync(target, { recursive: true });
    writeFileSync(join(target, 'sermon.bn'), 'local edit');

    await roundTrip('replace', target);

    expect(readFileSync(join(target, 'sermon.bn'), 'utf-8')).toBe('original sermon');
  });

  it('preserves a locally-newer note in merge mode', async () => {
    // Merge fills in what is missing. Clobbering here would destroy work the
    // reader did after the backup was taken - the worst outcome this service
    // can produce.
    const target = join(workDir, 'restored');
    mkdirSync(target, { recursive: true });
    writeFileSync(join(target, 'sermon.bn'), 'local edit');

    const result = await roundTrip('merge', target);

    expect(readFileSync(join(target, 'sermon.bn'), 'utf-8')).toBe('local edit');
    expect(result.noteFilesRestored).toBe(0);
  });

  it('restores no files when the archive has none', async () => {
    const created = await backup(seededDb());

    const result = await restoreBackup(emptyDb() as never, {
      backupPath: created.path!,
      password: PASSWORD,
      mode: 'replace',
      notesDir: join(workDir, 'restored'),
    } as Parameters<typeof restoreBackup>[1]);

    expect(result.noteFilesRestored).toBe(0);
  });
});

describe('restoreNoteFiles path guard', () => {
  /**
   * Tested directly rather than through `restoreBackup`: an archive carrying a
   * `../` path cannot be produced by `createBackup` (it derives every key with
   * `relative(notesDir, abs)`), so reaching this guard through the public API
   * would mean hand-encrypting a payload.
   */
  it('writes ordinary paths, including nested ones', () => {
    const target = join(workDir, 'guard');

    const written = restoreNoteFiles(target, { 'a.bn': 'a', 'sub/b.bn': 'b' }, 'replace');

    expect(written).toBe(2);
    expect(readFileSync(join(target, 'sub', 'b.bn'), 'utf-8')).toBe('b');
  });

  it('refuses a path that escapes the notes directory', () => {
    // A tampered archive must not be able to write anywhere on disk it likes.
    const target = join(workDir, 'guard');
    mkdirSync(target, { recursive: true });

    const written = restoreNoteFiles(target, { '../escaped.bn': 'pwned' }, 'replace');

    expect(written).toBe(0);
    expect(existsSync(join(workDir, 'escaped.bn'))).toBe(false);
  });

  it('refuses an absolute path', () => {
    const target = join(workDir, 'guard');
    mkdirSync(target, { recursive: true });
    const outside = join(workDir, 'absolute.bn');

    const written = restoreNoteFiles(target, { [outside]: 'pwned' }, 'replace');

    expect(written).toBe(0);
    expect(existsSync(outside)).toBe(false);
  });

  it('refuses a deep traversal even when it starts inside', () => {
    const target = join(workDir, 'guard');
    mkdirSync(target, { recursive: true });

    const written = restoreNoteFiles(target, { 'sub/../../escaped.bn': 'pwned' }, 'replace');

    expect(written).toBe(0);
    expect(existsSync(join(workDir, 'escaped.bn'))).toBe(false);
  });
});
