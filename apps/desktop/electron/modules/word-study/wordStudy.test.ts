/**
 * Word study IPC handlers: input validation at the boundary and the wiring to
 * the shared service / group store. Core services and module access are mocked.
 */
import { describe, it, expect, beforeAll, beforeEach, vi } from 'vitest';

const handlers = new Map<string, (event: unknown, ...args: unknown[]) => Promise<any>>();

vi.mock('electron', () => ({
  app: { getPath: vi.fn(() => '/fake/userData'), isPackaged: false },
}));
vi.mock('electron-log', () => ({
  default: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

const svc = {
  resolve: vi.fn((_q: string) => [{ strongs: 'G25', language: 'Greek', gloss: 'love' }]),
  getOverview: vi.fn(async () => ({ ok: 'overview' })),
  getOccurrences: vi.fn(async () => ({ total: 0, items: [] })),
};
const store = {
  list: vi.fn(() => []),
  save: vi.fn((g: any) => ({ ...g, id: g.id ?? 'wg-1', label: g.label ?? g.terms[0] })),
  remove: vi.fn(() => true),
};
const serviceCtor = vi.fn((_deps: unknown) => svc);

vi.mock('@bible/core', async () => {
  const actual = await vi.importActual<any>('@bible/core');
  return {
    ...actual,
    WordStudyService: function (deps: unknown) { return serviceCtor(deps); },
    WordGroupStore: function () { return store; },
    UserDataRepository: function () { return {}; },
    WordFamilyService: function () { return {}; },
  };
});
vi.mock('../../ipc/bibleHandlers', () => ({ ensureBibleRepository: vi.fn(async () => ({ repo: 'kjv' })) }));
const dictCache = new Map<string, object>();
vi.mock('../../ipc/dictionaryHandlers', () => ({
  ensureDictionaryRepository: vi.fn(async (a: string) => {
    if (!dictCache.has(a)) dictCache.set(a, { dict: a });
    return dictCache.get(a);
  }),
}));
vi.mock('../../services/installedModules', () => ({
  listInstalledModules: vi.fn((type: string) =>
    type === 'bible'
      ? [{ abbreviation: 'KJV' }]
      : [{ abbreviation: 'strongsgreek' }, { abbreviation: 'strongshebrew' }, { abbreviation: 'webster' }]),
}));
vi.mock('../../services/sharedUserDb', () => ({ getSharedUserDb: vi.fn(async () => ({})) }));
vi.mock('../../schema/userSchema', () => ({ initializeUserSchema: vi.fn() }));

import wordStudyModule, { resetWordStudyForTests } from './index';
import { createModuleIpc } from '../moduleIpc';
import type { MainModuleDeps } from '../FeatureMainModule';

const fakeIpcMain = {
  handle: (channel: string, fn: (event: unknown, ...args: unknown[]) => unknown) => void handlers.set(channel, fn as never),
  removeHandler: (channel: string) => void handlers.delete(channel),
};
const deps: MainModuleDeps = { userDataPath: '/fake/userData', getWindows: () => [], log: { info() {}, warn() {}, error() {} } };

const call = (channel: string, ...args: unknown[]) => handlers.get(channel)!({}, ...args);

beforeAll(() => void wordStudyModule.registerIpc(createModuleIpc('word-study', fakeIpcMain, deps), deps));
beforeEach(() => {
  vi.clearAllMocks();
  resetWordStudyForTests();
});

describe('module:word-study channels', () => {
  it('registers all six module channels', () => {
    for (const c of ['resolve', 'getOverview', 'getOccurrences', 'listGroups', 'saveGroup', 'deleteGroup']) {
      expect(handlers.has(`module:word-study:${c}`)).toBe(true);
    }
  });
});

describe('module:word-study:resolve', () => {
  it('rejects empty and oversized queries', async () => {
    expect((await call('module:word-study:resolve', '')).ok).toBe(false);
    expect((await call('module:word-study:resolve', 'x'.repeat(201))).ok).toBe(false);
    expect((await call('module:word-study:resolve', 42)).ok).toBe(false);
  });
  it('delegates to the service', async () => {
    const r = await call('module:word-study:resolve', 'G25');
    expect(r).toEqual({ ok: true, value: [{ strongs: 'G25', language: 'Greek', gloss: 'love' }] });
  });
});

describe('service wiring', () => {
  it('builds one service with all installed bibles and both dictionaries, reused across calls', async () => {
    await call('module:word-study:resolve', 'G25');
    await call('module:word-study:resolve', 'G26');
    expect(serviceCtor).toHaveBeenCalledTimes(1);
    const deps = (serviceCtor.mock.calls[0] as any[])[0];
    expect([...deps.bibles().keys()]).toEqual(['KJV']);
    expect(deps.greek).toEqual({ dict: 'strongsgreek' });
    expect(deps.hebrew).toEqual({ dict: 'strongshebrew' });
  });
});

describe('module:word-study:getOverview', () => {
  it('normalises the Strong\'s number and passes options', async () => {
    const r = await call('module:word-study:getOverview', { kind: 'strongs', strongs: 'g0025' }, { module: 'KJV', renderingMode: 'phrase' });
    expect(r.ok).toBe(true);
    expect(svc.getOverview).toHaveBeenCalledWith({ kind: 'strongs', strongs: 'G25' }, { module: 'KJV', renderingMode: 'phrase' });
  });
  it('rejects bad subjects', async () => {
    for (const bad of [
      null, 'G25', { kind: 'strongs', strongs: 'nope' }, { kind: 'strongs' }, { kind: 'other' },
      { kind: 'group', group: { id: 'a', terms: [] } },
      { kind: 'group', group: { terms: ['love'] } },
      { kind: 'group', group: { id: 'a', terms: [1] } },
      { kind: 'group', group: { id: 'a', terms: Array(101).fill('x') } },
    ]) {
      const r = await call('module:word-study:getOverview', bad);
      expect(r.ok).toBe(false);
      expect(r.error.code).toBe('invalid_input');
    }
    expect(svc.getOverview).not.toHaveBeenCalled();
  });
  it('rejects bad options', async () => {
    const s = { kind: 'strongs', strongs: 'G25' };
    expect((await call('module:word-study:getOverview', s, { renderingMode: 'bogus' })).ok).toBe(false);
    expect((await call('module:word-study:getOverview', s, { module: '../x' })).ok).toBe(false);
  });
  it('strips unknown keys from a group subject', async () => {
    await call('module:word-study:getOverview', { kind: 'group', group: { id: 'g', terms: ['love', 'lov*'], evil: 1 } });
    expect(svc.getOverview).toHaveBeenCalledWith(
      { kind: 'group', group: { id: 'g', label: 'love', terms: ['love', 'lov*'] } }, {});
  });
});

describe('module:word-study:getOccurrences', () => {
  const subject = { kind: 'strongs', strongs: 'H1' };
  it('accepts a valid query', async () => {
    const q = { module: 'KJV', book: 1, form: 'k', offset: 0, limit: 50, renderingMode: 'head' };
    expect((await call('module:word-study:getOccurrences', subject, q)).ok).toBe(true);
    expect(svc.getOccurrences).toHaveBeenCalledWith({ kind: 'strongs', strongs: 'H1' }, q);
  });
  it('rejects out-of-range values', async () => {
    for (const q of [
      {}, { module: 'KJV', book: 0 }, { module: 'KJV', book: 67 }, { module: 'KJV', limit: 501 },
      { module: 'KJV', limit: 0 }, { module: 'KJV', offset: -1 }, { module: 'KJV', limit: 1.5 },
    ]) {
      expect((await call('module:word-study:getOccurrences', subject, q)).ok).toBe(false);
    }
    expect(svc.getOccurrences).not.toHaveBeenCalled();
  });
});

describe('saved groups', () => {
  it('lists, saves and deletes through the store', async () => {
    expect(await call('module:word-study:listGroups')).toEqual({ ok: true, value: [] });
    const saved = await call('module:word-study:saveGroup', { terms: ['love'], stem: false });
    expect(saved.ok).toBe(true);
    expect(store.save).toHaveBeenCalledWith({ terms: ['love'], stem: false });
    expect(await call('module:word-study:deleteGroup', 'wg-1')).toEqual({ ok: true, value: true });
    expect(store.remove).toHaveBeenCalledWith('wg-1');
  });
  it('validates saveGroup and deleteGroup input', async () => {
    expect((await call('module:word-study:saveGroup', { terms: [] })).ok).toBe(false);
    expect((await call('module:word-study:saveGroup', { terms: ['a'], stem: 'yes' })).ok).toBe(false);
    expect((await call('module:word-study:saveGroup', { terms: ['a'], notes: 'n'.repeat(2001) })).ok).toBe(false);
    expect((await call('module:word-study:saveGroup', 'x')).ok).toBe(false);
    expect((await call('module:word-study:deleteGroup', '')).ok).toBe(false);
    expect(store.save).not.toHaveBeenCalled();
    expect(store.remove).not.toHaveBeenCalled();
  });
});
