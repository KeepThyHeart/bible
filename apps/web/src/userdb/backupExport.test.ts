// @vitest-environment node
import { createHash } from 'node:crypto';
import { describe, it, expect, beforeAll } from 'vitest';
import sqlite3InitModule from '@sqlite.org/sqlite-wasm';
import { Backup } from '@bible/core/browser';
import { exportBackup, handleBackup } from './backupExport';
import { createUserDbHandler } from './handler';
import { finishOpen } from './openUserDb';

let sqlite3: Awaited<ReturnType<typeof sqlite3InitModule>>;
beforeAll(async () => {
  sqlite3 = await sqlite3InitModule();
}, 60_000);

const fastKdf = async (pw: string) => new Uint8Array(createHash('sha256').update(pw.normalize('NFC')).digest());

function seeded() {
  const { sql } = finishOpen(new sqlite3.oo1.DB(':memory:'), ':memory:');
  sql.execute("INSERT INTO user_note (note_id, content, title) VALUES (1, 'hello note', 'T')");
  sql.execute("INSERT INTO user_text_markup (module_id, verse_id_start, verse_id_end, color) VALUES (1, 43003016, 43003016, '#ffee00')");
  sql.execute("INSERT INTO collection (collection_id, name) VALUES (1, 'Bookmarks')");
  sql.execute("INSERT INTO pinned_item (collection_id, item_type, verse_id_start, verse_id_end, reference_text) VALUES (1, 'verse', 43003016, 43003016, 'John 3:16')");
  sql.execute("INSERT INTO memory_collection (id, name, created_at) VALUES (1, 'Mine', 1)");
  sql.execute("INSERT INTO memory_passage (id, collection_id, module_id, start_verse_id, end_verse_id, reference, verse_count, added_at) VALUES (1, 1, 'KJV', 43003016, 43003016, 'John 3:16', 1, 1)");
  sql.execute("INSERT INTO memory_card (id, passage_id, rung, state) VALUES (1, 1, 'r1', 'new')");
  return sql;
}

const TABLES = ['user_note', 'user_text_markup', 'collection', 'pinned_item', 'memory_collection', 'memory_passage', 'memory_card'];

async function entries(bytes: Uint8Array) {
  const archive = await Backup.readBackupFile([bytes], undefined);
  return archive.entries;
}

describe('backup export from the worker database', () => {
  it('plain export holds highlights, notes, bookmarks and Memory, not just user_data_item', async () => {
    const out = await exportBackup(seeded());
    expect(out.extension).toBe('zip');
    const e = await entries(out.bytes);
    for (const t of TABLES) expect(e.has(`user/${t}.ndjson`), t).toBe(true);
    const text = (path: string) => new TextDecoder().decode(e.get(path));
    expect(text('user/user_note.ndjson')).toContain('hello note');
    expect(text('user/user_text_markup.ndjson')).toContain('#ffee00');
    expect(text('user/pinned_item.ndjson')).toContain('John 3:16');
    expect(text('user/memory_passage.ndjson')).toContain('John 3:16');
  });

  it('encrypted export is a .bbk that opens with the password only', async () => {
    const out = await exportBackup(seeded(), { password: 'correct horse', seal: { kdf: fastKdf } });
    expect(out.extension).toBe('bbk');
    await expect(Backup.readBackupFile([out.bytes], { password: 'wrong' }, { kdf: fastKdf })).rejects.toThrow();
    const archive = await Backup.readBackupFile([out.bytes], { password: 'correct horse' }, { kdf: fastKdf });
    expect(archive.encrypted).toBe(true);
    expect(archive.entries.has('user/memory_card.ndjson')).toBe(true);
  });

  it('is served through the handler backup extension; encrypted needs a password', async () => {
    const handler = createUserDbHandler({
      open: async () => finishOpen(new sqlite3.oo1.DB(':memory:'), ':memory:'),
      emit: () => undefined,
      extensions: { backup: handleBackup },
    });
    const out = (await handler.handle({ op: 'backup', action: 'exportPlain' })) as { bytes: Uint8Array; extension: string };
    expect(out.extension).toBe('zip');
    expect((await entries(out.bytes)).has('user/user_note.ndjson')).toBe(true);
    await expect(handler.handle({ op: 'backup', action: 'exportEncrypted' })).rejects.toThrow(/password/i);
  });
});
