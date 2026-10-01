// @vitest-environment node
import { describe, it, expect, vi, beforeAll } from 'vitest';
import Database from 'better-sqlite3';
import { makeSql } from '../../services/__tests__/helpers/testSql';

const handlers = new Map<string, (...args: unknown[]) => Promise<unknown>>();
vi.mock('electron', () => ({
  ipcMain: { handle: (channel: string, fn: (e: unknown, ...a: unknown[]) => Promise<unknown>) => handlers.set(channel, (...a) => fn({}, ...a)) },
}));
vi.mock('electron-log', () => ({ default: { info: vi.fn(), warn: vi.fn(), error: vi.fn() } }));
const db = new Database(':memory:');
vi.mock('../../services/sharedUserDb', () => ({ getSharedUserDb: async () => makeSql(db) }));

import { registerNoteDirectionHandlers, moveNoteDirectionKeys } from '../noteDirectionHandlers';

const call = (channel: string, ...args: unknown[]) => handlers.get(channel)!(...args) as Promise<{ ok: boolean; value?: unknown; error?: { code: string } }>;
const rows = () => db.prepare('SELECT owner_uuid, collection, item_key, value FROM user_data_item ORDER BY item_key').all();

beforeAll(() => registerNoteDirectionHandlers());

describe('note-direction IPC handlers', () => {
  it('stores, reads and clears a note direction', async () => {
    expect(await call('note-direction:get', 'a/n.bn')).toEqual({ ok: true, value: null });
    expect((await call('note-direction:set', 'a/n.bn', 'rtl')).ok).toBe(true);
    expect(rows()).toEqual([{ owner_uuid: 'app:note-direction', collection: 'notes', item_key: 'a/n.bn', value: 'rtl' }]);
    expect((await call('note-direction:get', 'a/n.bn')).value).toBe('rtl');
    expect((await call('note-direction:set', 'a/n.bn', 'ltr')).ok).toBe(true);
    expect((await call('note-direction:get', 'a/n.bn')).value).toBe('ltr');
    expect((await call('note-direction:set', 'a/n.bn', null)).ok).toBe(true);
    expect(rows()).toEqual([]);
  });

  it('rejects bad input', async () => {
    expect(await call('note-direction:set', 'x.bn', 'auto')).toMatchObject({ ok: false, error: { code: 'invalid_input' } });
    expect(await call('note-direction:get', '')).toMatchObject({ ok: false, error: { code: 'invalid_input' } });
  });

  it('follows a note rename and a folder rename', async () => {
    await call('note-direction:set', 'old.bn', 'rtl');
    await call('note-direction:set', 'dir/one.bn', 'ltr');
    await moveNoteDirectionKeys('old.bn', 'moved/new.bn');
    await moveNoteDirectionKeys('dir', 'dir2');
    expect(rows().map((r) => (r as { item_key: string }).item_key)).toEqual(['dir2/one.bn', 'moved/new.bn']);
    expect((await call('note-direction:get', 'moved/new.bn')).value).toBe('rtl');
    expect((await call('note-direction:get', 'dir2/one.bn')).value).toBe('ltr');
  });
});
