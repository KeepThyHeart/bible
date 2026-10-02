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

import { registerKeywordHandlers } from '../keywordHandlers';

const set = {
  schema: 1, id: 'set-1', name: 'Mine', scope: { kind: 'everywhere' }, updatedAt: '2026-01-01T00:00:00.000Z',
  marks: [{ id: 'm1', label: 'God', rule: { kind: 'word', forms: ['god'] }, style: { color: 'mark.1', line: 'solid' }, enabled: true }],
};
const call = (channel: string, ...args: unknown[]) => handlers.get(channel)!(...args) as Promise<{ ok: boolean; value?: unknown; error?: { code: string } }>;

beforeAll(() => registerKeywordHandlers());

describe('keyword IPC handlers', () => {
  it('round-trips a set through user_data_item', async () => {
    expect(await call('keywords:list')).toEqual({ ok: true, value: [] });
    expect((await call('keywords:put', set)).ok).toBe(true);
    const listed = await call('keywords:list');
    expect((listed.value as { id: string }[]).map((s) => s.id)).toEqual(['set-1']);
    const row = db.prepare('SELECT owner_uuid, collection, item_key FROM user_data_item').get();
    expect(row).toEqual({ owner_uuid: 'app:keyword-marks', collection: 'sets', item_key: 'set-1' });
    expect((await call('keywords:remove', 'set-1')).ok).toBe(true);
    expect((await call('keywords:list')).value).toEqual([]);
  });

  it('rejects invalid and built-in sets', async () => {
    expect(await call('keywords:put', { nope: true })).toMatchObject({ ok: false, error: { code: 'invalid_input' } });
    expect(await call('keywords:put', { ...set, builtIn: 'connectives-en' })).toMatchObject({ ok: false, error: { code: 'invalid_input' } });
    expect(await call('keywords:remove', 'builtin:connectives-en')).toMatchObject({ ok: false, error: { code: 'invalid_input' } });
  });
});
