// @vitest-environment node
import { describe, it, expect, vi, beforeAll } from 'vitest';
import Database from 'better-sqlite3';
import { makeSql } from '../../services/__tests__/helpers/testSql';

const handlers = new Map<string, (...args: unknown[]) => Promise<unknown>>();
vi.mock('electron', () => ({ app: { getPath: vi.fn(() => '/fake/userData'), isPackaged: false } }));
vi.mock('electron-log', () => ({ default: { info: vi.fn(), warn: vi.fn(), error: vi.fn() } }));
const db = new Database(':memory:');
vi.mock('../../services/sharedUserDb', () => ({ getSharedUserDb: async () => makeSql(db) }));

import keywordMarksModule from './index';
import { createModuleIpc } from '../moduleIpc';
import type { MainModuleDeps } from '../FeatureMainModule';

const deps: MainModuleDeps = {
  userDataPath: '/fake/userData',
  getWindows: () => [],
  log: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
};
const ipcMain = {
  handle: (channel: string, fn: (e: unknown, ...a: unknown[]) => Promise<unknown>) => handlers.set(channel, (...a) => fn({}, ...a)),
  removeHandler: (channel: string) => handlers.delete(channel),
};

const set = {
  schema: 1, id: 'set-1', name: 'Mine', scope: { kind: 'everywhere' }, updatedAt: '2026-01-01T00:00:00.000Z',
  marks: [{ id: 'm1', label: 'God', rule: { kind: 'word', forms: ['god'] }, style: { color: 'mark.1', line: 'solid' }, enabled: true }],
};
const call = (method: string, ...args: unknown[]) => handlers.get(`module:keyword-marks:${method}`)!(...args) as Promise<{ ok: boolean; value?: unknown; error?: { code: string } }>;

beforeAll(() => { keywordMarksModule.registerIpc(createModuleIpc('keyword-marks', ipcMain, deps), deps); });

describe('keyword-marks main module', () => {
  it('round-trips a set through user_data_item', async () => {
    expect(await call('list')).toEqual({ ok: true, value: [] });
    expect((await call('put', set)).ok).toBe(true);
    const listed = await call('list');
    expect((listed.value as { id: string }[]).map((s) => s.id)).toEqual(['set-1']);
    const row = db.prepare('SELECT owner_uuid, collection, item_key FROM user_data_item').get();
    expect(row).toEqual({ owner_uuid: 'app:keyword-marks', collection: 'sets', item_key: 'set-1' });
    expect((await call('remove', 'set-1')).ok).toBe(true);
    expect((await call('list')).value).toEqual([]);
  });

  it('rejects invalid and built-in sets', async () => {
    expect(await call('put', { nope: true })).toMatchObject({ ok: false, error: { code: 'invalid_input' } });
    expect(await call('put', { ...set, builtIn: 'connectives-en' })).toMatchObject({ ok: false, error: { code: 'invalid_input' } });
    expect(await call('remove', 'builtin:connectives-en')).toMatchObject({ ok: false, error: { code: 'invalid_input' } });
  });
});

describe('keyword-marks main module registration', () => {
  it('registers the three operations under module:keyword-marks:*', () => {
    expect([...handlers.keys()].filter((c) => c.startsWith('module:keyword-marks:')).sort()).toEqual(
      ['list', 'put', 'remove'].map((m) => `module:keyword-marks:${m}`),
    );
  });
});
