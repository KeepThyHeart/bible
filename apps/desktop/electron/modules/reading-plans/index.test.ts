// @vitest-environment node
import { describe, it, expect, vi, beforeAll } from 'vitest';
import Database from 'better-sqlite3';
import { ReadingPlans } from '@bible/core';
import { makeSql } from '../../services/__tests__/helpers/testSql';

const handlers = new Map<string, (...args: unknown[]) => Promise<unknown>>();
vi.mock('electron', () => ({ app: { getPath: vi.fn(() => '/fake/userData'), isPackaged: false } }));
vi.mock('electron-log', () => ({ default: { info: vi.fn(), warn: vi.fn(), error: vi.fn() } }));
const db = new Database(':memory:');
vi.mock('../../services/sharedUserDb', () => ({ getSharedUserDb: async () => makeSql(db) }));

import readingPlansModule from './index';
import { readingPlansMainManifest } from './manifest';
import { createModuleIpc } from '../moduleIpc';
import { registerMainModules, closeMainModules, type MainModuleEntry } from '../mainModules';
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

type Reply = { ok: boolean; value?: unknown; error?: { code: string } };
const call = (method: string, ...args: unknown[]) => handlers.get(`module:reading-plans:${method}`)!(...args) as Promise<Reply>;

const plan = {
  key: 'user:p1', version: 1, name: 'Jude', source: 'user',
  days: [{ readings: [{ start: 65001001, end: 65001012 }] }, { readings: [{ start: 65001013, end: 65001025 }] }],
};
const enrollment = {
  id: 'e1', planKey: 'user:p1', planVersion: 1, planName: 'Jude', startDate: '2026-10-01', pacing: 'flexible',
  readingDays: [0, 1, 2, 3, 4, 5, 6], status: 'active', createdAt: '2026-10-01T00:00:00Z',
};

beforeAll(() => { readingPlansModule.registerIpc(createModuleIpc('reading-plans', ipcMain, deps), deps); });

describe('reading-plans main module', () => {
  it('round-trips plans, enrollments and completions through user_data_item', async () => {
    expect((await call('putPlan', plan)).ok).toBe(true);
    expect((await call('listPlans')).value).toEqual([plan]);
    expect((await call('putEnrollment', enrollment)).ok).toBe(true);
    const completion = { enrollmentId: 'e1', day: 1, reading: 0, at: '2026-10-01T10:00:00Z', via: 'manual' };
    expect((await call('setCompletions', [{ completion, done: true }])).ok).toBe(true);
    expect((await call('listCompletions', 'e1')).value).toEqual([completion]);
    const owners = db.prepare('SELECT DISTINCT owner_uuid FROM user_data_item').all();
    expect(owners).toEqual([{ owner_uuid: 'app:reading-plans' }]);
    expect((await call('removeEnrollment', 'e1')).ok).toBe(true);
    expect((await call('listCompletions')).value).toEqual([]);
  });

  it('snapshots stock plans', async () => {
    const stock = ReadingPlans.getStockPlan('stock:gospels-30');
    expect((await call('putSnapshot', stock)).ok).toBe(true);
    expect((await call('getPlan', 'stock:gospels-30@1')).value).toMatchObject({ key: 'stock:gospels-30', version: 1 });
  });

  it('rejects invalid input', async () => {
    expect(await call('putPlan', { ...plan, days: [] })).toMatchObject({ ok: false, error: { code: 'invalid_input' } });
    expect(await call('putPlan', { ...plan, key: 'stock:x', source: 'stock' })).toMatchObject({ ok: false, error: { code: 'invalid_input' } });
    expect(await call('removePlan', 'stock:mcheyne')).toMatchObject({ ok: false, error: { code: 'invalid_input' } });
    expect(await call('putEnrollment', { ...enrollment, pacing: 'sometimes' })).toMatchObject({ ok: false, error: { code: 'invalid_input' } });
    expect(await call('setCompletions', [{ completion: { enrollmentId: 'e1', day: 0, reading: 0, at: 'x', via: 'manual' }, done: true }]))
      .toMatchObject({ ok: false, error: { code: 'invalid_input' } });
  });
});

describe('reading-plans main module registration', () => {
  it('registers the ten operations under module:reading-plans:*', () => {
    expect([...handlers.keys()].filter((c) => c.startsWith('module:reading-plans:')).sort()).toEqual(
      ['getPlan', 'listCompletions', 'listEnrollments', 'listPlans', 'putEnrollment', 'putPlan', 'putSnapshot', 'removeEnrollment', 'removePlan', 'setCompletions']
        .map((m) => `module:reading-plans:${m}`),
    );
  });

  it('close() forgets the cached store', async () => {
    await call('listPlans');
    await readingPlansModule.close!();
    expect((await call('listPlans')).ok).toBe(true);
  });

  it('loads at startup through the main registry, and never when switched off', async () => {
    const run = async (overrideText: string) => {
      handlers.clear();
      const load = vi.fn(async () => ({ default: readingPlansModule }));
      const modules: MainModuleEntry[] = [{ manifest: readingPlansMainManifest, load }];
      await registerMainModules(ipcMain, deps, { modules, packaged: false, overrideText, flagOverrideText: '' });
      const channels = [...handlers.keys()];
      await closeMainModules();
      return { load, channels };
    };
    const on = await run('');
    expect(on.load).toHaveBeenCalledTimes(1);
    expect(on.channels).toContain('module:reading-plans:listPlans');
    const off = await run('-reading-plans');
    expect(off.load).not.toHaveBeenCalled();
    expect(off.channels).toEqual([]);
  });
});
