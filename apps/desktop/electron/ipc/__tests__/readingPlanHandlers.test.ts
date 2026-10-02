// @vitest-environment node
import { describe, it, expect, vi, beforeAll } from 'vitest';
import Database from 'better-sqlite3';
import { ReadingPlans } from '@bible/core';
import { makeSql } from '../../services/__tests__/helpers/testSql';

const handlers = new Map<string, (...args: unknown[]) => Promise<unknown>>();
vi.mock('electron', () => ({
  ipcMain: { handle: (channel: string, fn: (e: unknown, ...a: unknown[]) => Promise<unknown>) => handlers.set(channel, (...a) => fn({}, ...a)) },
}));
vi.mock('electron-log', () => ({ default: { info: vi.fn(), warn: vi.fn(), error: vi.fn() } }));
const db = new Database(':memory:');
vi.mock('../../services/sharedUserDb', () => ({ getSharedUserDb: async () => makeSql(db) }));

import { registerReadingPlanHandlers } from '../readingPlanHandlers';

type Reply = { ok: boolean; value?: unknown; error?: { code: string } };
const call = (channel: string, ...args: unknown[]) => handlers.get(channel)!(...args) as Promise<Reply>;

const plan = {
  key: 'user:p1', version: 1, name: 'Jude', source: 'user',
  days: [{ readings: [{ start: 65001001, end: 65001012 }] }, { readings: [{ start: 65001013, end: 65001025 }] }],
};
const enrollment = {
  id: 'e1', planKey: 'user:p1', planVersion: 1, planName: 'Jude', startDate: '2026-10-01', pacing: 'flexible',
  readingDays: [0, 1, 2, 3, 4, 5, 6], status: 'active', createdAt: '2026-10-01T00:00:00Z',
};

beforeAll(() => registerReadingPlanHandlers());

describe('reading plan IPC handlers', () => {
  it('round-trips plans, enrollments and completions through user_data_item', async () => {
    expect((await call('reading-plans:put-plan', plan)).ok).toBe(true);
    expect((await call('reading-plans:list-plans')).value).toEqual([plan]);
    expect((await call('reading-plans:put-enrollment', enrollment)).ok).toBe(true);
    const completion = { enrollmentId: 'e1', day: 1, reading: 0, at: '2026-10-01T10:00:00Z', via: 'manual' };
    expect((await call('reading-plans:set-completions', [{ completion, done: true }])).ok).toBe(true);
    expect((await call('reading-plans:list-completions', 'e1')).value).toEqual([completion]);
    const owners = db.prepare('SELECT DISTINCT owner_uuid FROM user_data_item').all();
    expect(owners).toEqual([{ owner_uuid: 'app:reading-plans' }]);
    expect((await call('reading-plans:remove-enrollment', 'e1')).ok).toBe(true);
    expect((await call('reading-plans:list-completions')).value).toEqual([]);
  });

  it('snapshots stock plans', async () => {
    const stock = ReadingPlans.getStockPlan('stock:gospels-30');
    expect((await call('reading-plans:put-snapshot', stock)).ok).toBe(true);
    expect((await call('reading-plans:get-plan', 'stock:gospels-30@1')).value).toMatchObject({ key: 'stock:gospels-30', version: 1 });
  });

  it('rejects invalid input', async () => {
    expect(await call('reading-plans:put-plan', { ...plan, days: [] })).toMatchObject({ ok: false, error: { code: 'invalid_input' } });
    expect(await call('reading-plans:put-plan', { ...plan, key: 'stock:x', source: 'stock' })).toMatchObject({ ok: false, error: { code: 'invalid_input' } });
    expect(await call('reading-plans:remove-plan', 'stock:mcheyne')).toMatchObject({ ok: false, error: { code: 'invalid_input' } });
    expect(await call('reading-plans:put-enrollment', { ...enrollment, pacing: 'sometimes' })).toMatchObject({ ok: false, error: { code: 'invalid_input' } });
    expect(await call('reading-plans:set-completions', [{ completion: { enrollmentId: 'e1', day: 0, reading: 0, at: 'x', via: 'manual' }, done: true }]))
      .toMatchObject({ ok: false, error: { code: 'invalid_input' } });
  });
});
