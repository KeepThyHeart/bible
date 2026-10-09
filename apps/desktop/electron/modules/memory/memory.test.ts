// @vitest-environment node
/**
 * Scripture memory's desktop main module (task 0114): the IPC surface, lazy
 * start, error mapping, and the real start sequence (user schema, one-time
 * import of the old extension database, core) against SQLite.
 */
import { mkdirSync, mkdtempSync, rmSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';

import Database from 'better-sqlite3';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { validateBuiltinManifest } from '@bible/core/browser';
import type { ISql } from '@bible/core';
import { createMockApi } from '@bible/extension-testing/createMockApi';
import { MEMORY_API_METHODS, type MemoryPush } from '@bible/memory/api';
import { memoryManifest } from '@bible/memory/manifest';

import { makeSql } from '../../services/__tests__/helpers/testSql';
import { initializeUserSchema } from '../../schema/userSchema';
import type { MainModuleDeps } from '../FeatureMainModule';
import { MAIN_MODULES, closeMainModules, registerMainModules } from '../mainModules';
import { createMemoryMainModule, toModuleError, type MemoryMainEnv } from './index';
import { takePendingNotices } from './notices';
import { legacyMemoryDbPath, MemoryImportPendingError, RETIRED_NOTICE, SKIPPED_NOTICE, startMemoryRuntime, type MemoryRuntime } from './runtime';
import { IpcKnownError } from '../../ipc/result';

function fakeIpcMain() {
  const handlers = new Map<string, (e: unknown, ...a: unknown[]) => unknown>();
  return {
    handlers,
    handle: vi.fn((c: string, fn: (e: unknown, ...a: unknown[]) => unknown) => void handlers.set(c, fn)),
    removeHandler: vi.fn((c: string) => void handlers.delete(c)),
  };
}

const sent: Array<[string, unknown[]]> = [];
const log = { info: vi.fn(), warn: vi.fn(), error: vi.fn() };
const deps: MainModuleDeps = {
  userDataPath: '/tmp/none',
  getWindows: () => [{ isDestroyed: () => false, webContents: { send: (c: string, ...a: unknown[]) => void sent.push([c, a]) } }],
  log,
};

function sqlFor(db: Database.Database): ISql {
  return Object.assign(makeSql(db), { close: () => db.close() }) as ISql;
}


/** A main-module environment over an in-memory user database and a local restore bus. */
function makeEnv() {
  const raw = new Database(':memory:');
  raw.pragma('foreign_keys = ON');
  const userDb = makeSql(raw);
  initializeUserSchema(userDb);
  const restoreListeners = new Set<(e: { mode: 'replace' | 'merge'; tables: readonly string[] }) => void>();
  const restoringListeners = new Set<(e: { mode: 'replace' | 'merge'; tables: readonly string[] }) => void | Promise<void>>();
  return {
    raw,
    userDb,
    restore: (e: { mode: 'replace' | 'merge'; tables: readonly string[]; failed?: boolean }) => restoreListeners.forEach((l) => l(e)),
    restoring: async (e: { mode: 'replace' | 'merge'; tables: readonly string[] }) => {
      for (const l of restoringListeners) await l(e);
    },
    envFor: (start: unknown, extra: Partial<MemoryMainEnv> = {}): Partial<MemoryMainEnv> => ({
      start: start as MemoryMainEnv['start'],
      getUserDb: async () => userDb,
      onUserDataRestored: (l) => {
        restoreListeners.add(l);
        return () => void restoreListeners.delete(l);
      },
      onUserDataRestoring: (l) => {
        restoringListeners.add(l);
        return () => void restoringListeners.delete(l);
      },
      autoStartDelayMs: 60_000,
      ...extra,
    }),
  };
}
let envFor: ReturnType<typeof makeEnv>['envFor'];
let dir: string;
beforeEach(async () => {
  await closeMainModules();
  sent.length = 0;
  vi.clearAllMocks();
  dir = mkdtempSync(join(tmpdir(), 'memory-main-'));
  envFor = makeEnv().envFor;
});
afterEach(async () => {
  await closeMainModules();
  rmSync(dir, { recursive: true, force: true });
});

describe('memory main module: registration', () => {
  it('has a valid desktop-only manifest and is in the production table', () => {
    expect(validateBuiltinManifest(memoryManifest)).toEqual([]);
    expect(memoryManifest.platforms).toEqual(['desktop']);
    expect(MAIN_MODULES.map((m) => m.manifest.id)).toContain('memory');
  });

  it('registers one handler per API method and starts nothing until the first call', async () => {
    const start = vi.fn();
    const ipc = fakeIpcMain();
    await registerMainModules(ipc, deps, {
      modules: [{ manifest: memoryManifest, load: async () => ({ default: createMemoryMainModule(envFor(start)) }) }],
      packaged: false,
      overrideText: '',
    });
    expect([...ipc.handlers.keys()].sort()).toEqual([...MEMORY_API_METHODS, 'takeNotices'].map((m) => `module:memory:${m}`).sort());
    expect(start).not.toHaveBeenCalled();
  });

  it('starts the core once, forwards calls and pushes, and maps errors', async () => {
    let emit: (p: MemoryPush) => void = () => undefined;
    const service = {
      getPlan: vi.fn(async () => ({ plan: true })),
      removePassage: vi.fn(async () => {
        throw new Error('That passage is no longer in your plan.');
      }),
      getStatus: vi.fn(async () => {
        throw new TypeError('bug');
      }),
    };
    const start = vi.fn(async (_d: MainModuleDeps, e: (p: MemoryPush) => void) => {
      emit = e;
      return { service, importResult: null, dispose: vi.fn() } as unknown as MemoryRuntime;
    });
    const ipc = fakeIpcMain();
    await registerMainModules(ipc, deps, {
      modules: [{ manifest: memoryManifest, load: async () => ({ default: createMemoryMainModule(envFor(start)) }) }],
      packaged: false,
      overrideText: '',
    });
    const call = (m: string, ...a: unknown[]) => ipc.handlers.get(`module:memory:${m}`)!({}, ...a);

    const [a, b] = await Promise.all([call('getPlan'), call('getPlan')]);
    expect(a).toEqual({ ok: true, value: { plan: true } });
    expect(b).toEqual(a);
    expect(start).toHaveBeenCalledTimes(1);

    expect(await call('removePassage', { passageId: 1 })).toEqual({
      ok: false,
      error: { code: 'invalid_input', message: 'That passage is no longer in your plan.' },
    });
    expect(service.removePassage).toHaveBeenCalledWith({ passageId: 1 });
    expect(await call('getStatus')).toMatchObject({ ok: false, error: { code: 'internal' } });

    emit({ type: 'planChanged' });
    expect(sent).toEqual([['module:memory:event:push', [{ type: 'planChanged' }]]]);
  });

  it('reports a failed start as unavailable and retries on the next call', async () => {
    const start = vi
      .fn()
      .mockRejectedValueOnce(new Error('database locked'))
      .mockResolvedValueOnce({ service: { getPlan: async () => 1 }, importResult: null, dispose: () => undefined });
    const ipc = fakeIpcMain();
    await registerMainModules(ipc, deps, {
      modules: [{ manifest: memoryManifest, load: async () => ({ default: createMemoryMainModule(envFor(start)) }) }],
      packaged: false,
      overrideText: '',
    });
    const h = ipc.handlers.get('module:memory:getPlan')!;
    expect(await h({})).toMatchObject({ ok: false, error: { code: 'unavailable' } });
    expect(await h({})).toEqual({ ok: true, value: 1 });
  });

  it('maps only plain errors to user-facing failures', () => {
    expect(toModuleError(new Error('x'))).toBeInstanceOf(IpcKnownError);
    class ReferenceError extends Error {}
    expect(toModuleError(new ReferenceError('bad ref'))).toBeInstanceOf(IpcKnownError);
    const sqlite = Object.assign(new Error('constraint'), { name: 'SqliteError' });
    expect(toModuleError(sqlite)).toBe(sqlite);
  });
});

describe('memory main module: start sequence on a real user database', () => {
  function legacyV7(path: string): void {
    const db = new Database(path);
    db.pragma('journal_mode = WAL');
    db.exec(`
      CREATE TABLE meta (key TEXT PRIMARY KEY, value TEXT NOT NULL);
      INSERT INTO meta VALUES ('schema_version', '7');
      CREATE TABLE collection (id INTEGER PRIMARY KEY, name TEXT NOT NULL, created_at INTEGER NOT NULL);
      CREATE TABLE passage (id INTEGER PRIMARY KEY, collection_id INTEGER NOT NULL REFERENCES collection(id) ON DELETE CASCADE,
        module_id TEXT NOT NULL, start_verse_id INTEGER NOT NULL, end_verse_id INTEGER NOT NULL, reference TEXT NOT NULL,
        verse_count INTEGER NOT NULL, added_at INTEGER NOT NULL, answer_mode TEXT, deleted_at INTEGER, recite_on INTEGER NOT NULL DEFAULT 0);
      CREATE TABLE card (id INTEGER PRIMARY KEY, passage_id INTEGER NOT NULL REFERENCES passage(id) ON DELETE CASCADE, rung TEXT NOT NULL,
        state TEXT NOT NULL, interval_step INTEGER NOT NULL DEFAULT -1, due_at INTEGER, streak INTEGER NOT NULL DEFAULT 0,
        last_score REAL, progress_reset_at INTEGER);
      CREATE TABLE attempt (id INTEGER PRIMARY KEY, card_id INTEGER NOT NULL REFERENCES card(id) ON DELETE CASCADE, at INTEGER NOT NULL,
        score REAL NOT NULL, correct_first INTEGER NOT NULL, total_steps INTEGER NOT NULL, replay INTEGER NOT NULL DEFAULT 0,
        duration_ms INTEGER, tier INTEGER NOT NULL DEFAULT 0);
      CREATE TABLE setting (key TEXT PRIMARY KEY, value TEXT NOT NULL);
      INSERT INTO collection VALUES (1, 'Default', 1);
      INSERT INTO passage (id, collection_id, module_id, start_verse_id, end_verse_id, reference, verse_count, added_at)
        VALUES (7, 1, 'KJV', 43003016, 43003016, 'John 3:16', 1, 2);
      INSERT INTO card (id, passage_id, rung, state) VALUES (70, 7, 'blanks', 'new');
      INSERT INTO attempt (id, card_id, at, score, correct_first, total_steps) VALUES (700, 70, 3, 1, 1, 1);
    `);
    db.close();
  }

  async function startOn(userDb: ISql, extensionsRoot: string): Promise<MemoryRuntime> {
    return startMemoryRuntime({
      getUserDb: async () => userDb,
      legacyDbPath: legacyMemoryDbPath(extensionsRoot),
      openReadOnly: (p) => sqlFor(new Database(p, { readonly: true, fileMustExist: true })),
      bible: createMockApi().bible,
      emit: () => undefined,
      log,
    });
  }

  it('imports the old database before the core starts, once, and serves it', async () => {
    const root = join(dir, 'extensions');
    const legacy = legacyMemoryDbPath(root);
    expect(legacy).toBe(join(root, 'ext.bible-app.scripture-memory', 'db', 'memory.db'));
    const { mkdirSync } = await import('fs');
    mkdirSync(join(root, 'ext.bible-app.scripture-memory', 'db'), { recursive: true });
    legacyV7(legacy);

    const raw = new Database(':memory:');
    raw.pragma('foreign_keys = ON');
    const userDb = makeSql(raw);
    initializeUserSchema(userDb);

    const first = await startOn(userDb, root);
    expect(first.importResult).toMatchObject({ status: 'imported', sourceVersion: 7 });
    const plan = await first.service.getPlan();
    expect(plan.passages.map((p) => p.passage.reference)).toEqual(['John 3:16']);
    expect(await first.service.getImportStatus()).toMatchObject({ status: 'imported' });
    first.dispose();

    const second = await startOn(userDb, root);
    expect(second.importResult).toEqual({ status: 'already-recorded', recorded: 'imported' });
    expect((await second.service.getPlan()).passages).toHaveLength(1);
    second.dispose();
  });

  it('starts with an empty plan when there is no old database', async () => {
    const raw = new Database(':memory:');
    raw.pragma('foreign_keys = ON');
    const userDb = makeSql(raw);
    initializeUserSchema(userDb);
    const rt = await startOn(userDb, join(dir, 'none'));
    expect(rt.importResult).toEqual({ status: 'no-source' });
    expect((await rt.service.getPlan()).passages).toEqual([]);
    rt.dispose();
  });

  it('does not start the core while an existing old database cannot be imported, and imports once it can', async () => {
    const root = join(dir, 'extensions');
    const { mkdirSync } = await import('fs');
    mkdirSync(join(root, 'ext.bible-app.scripture-memory', 'db'), { recursive: true });
    const legacy = legacyMemoryDbPath(root);
    legacyV7(legacy);
    const bump = (v: string) => {
      const d = new Database(legacy);
      d.prepare("UPDATE meta SET value = ? WHERE key = 'schema_version'").run(v);
      d.close();
    };
    bump('8');
    const raw = new Database(':memory:');
    raw.pragma('foreign_keys = ON');
    const userDb = makeSql(raw);
    initializeUserSchema(userDb);

    await expect(startOn(userDb, root)).rejects.toBeInstanceOf(MemoryImportPendingError);
    // Nothing was written: no Default list that would later block the import.
    expect(raw.prepare('SELECT COUNT(*) AS n FROM memory_collection').get()).toEqual({ n: 0 });

    bump('7');
    const rt = await startOn(userDb, root);
    expect(rt.importResult.status).toBe('imported');
    rt.dispose();
  });
});

describe('memory main module: badge, restore, push cards (M2)', () => {
  async function registered(start: unknown, extra: Partial<MemoryMainEnv> = {}, moreDeps: Partial<MainModuleDeps> = {}) {
    const env = makeEnv();
    const ipc = fakeIpcMain();
    await registerMainModules(ipc, { ...deps, ...moreDeps }, {
      modules: [{ manifest: memoryManifest, load: async () => ({ default: createMemoryMainModule(env.envFor(start, extra)) }) }],
      packaged: false,
      overrideText: '',
    });
    const call = (m: string, ...a: unknown[]) => ipc.handlers.get(`module:memory:${m}`)!({}, ...a);
    return { env, call };
  }

  it('answers getStatus from the tables without starting the core', async () => {
    const start = vi.fn();
    const { env, call } = await registered(start, { now: () => 10_000 });
    env.raw.exec(`
      INSERT INTO memory_collection (id, name, created_at) VALUES (1, 'Default', 1);
      INSERT INTO memory_passage (id, collection_id, module_id, start_verse_id, end_verse_id, reference, verse_count, added_at)
        VALUES (1, 1, 'KJV', 43003016, 43003016, 'John 3:16', 1, 1);
      INSERT INTO memory_card (id, passage_id, rung, state, due_at) VALUES (1, 1, 'blanks', 'new', 5000), (2, 1, 'ordering', 'new', 20000);
    `);
    expect(await call('getStatus')).toEqual({ ok: true, value: { due: 1, waiting: 0 } });
    expect(start).not.toHaveBeenCalled();
  });

  it('drops the running core after a restore that touched memory, revives merged passages, and redraws', async () => {
    const dispose = vi.fn();
    const start = vi.fn(async () => ({ service: { getPlan: async () => 'plan' }, importResult: null, dispose }) as unknown as MemoryRuntime);
    const { env, call } = await registered(start);
    await call('getPlan');
    env.raw.exec(`
      INSERT INTO memory_collection (id, name, created_at) VALUES (1, 'Default', 1);
      INSERT INTO memory_passage (id, collection_id, module_id, start_verse_id, end_verse_id, reference, verse_count, added_at, deleted_at)
        VALUES (1, 1, 'KJV', 1, 1, 'Genesis 1:1', 1, 1, 100), (2, 1, 'KJV', 2, 2, 'Genesis 1:2', 1, 1, 100), (3, 1, 'KJV', 3, 3, 'Genesis 1:3', 1, 1, 100);
      INSERT INTO memory_card (id, passage_id, rung, state) VALUES (1, 1, 'blanks', 'new'), (2, 2, 'blanks', 'new'), (3, 3, 'blanks', 'new');
      -- Already here before the merge: a session that finished just after passage 3 was removed.
      INSERT INTO memory_attempt (card_id, at, score, correct_first, total_steps) VALUES (3, 150, 1, 1, 1);
    `);
    sent.length = 0;
    const event = { mode: 'merge' as const, tables: ['memory_passage', 'memory_attempt'] };
    await env.restoring(event);
    expect(dispose).toHaveBeenCalledTimes(1);
    // Calls wait while the restore runs.
    let answered = false;
    const pending = (call('getPlan') as Promise<unknown>).then((r: unknown) => ((answered = true), r));
    await new Promise((r) => setTimeout(r, 20));
    expect(answered).toBe(false);
    // The merge brings history: newer than the removal for 1, older for 2.
    env.raw.exec(`INSERT INTO memory_attempt (card_id, at, score, correct_first, total_steps) VALUES (1, 200, 1, 1, 1), (2, 50, 1, 1, 1);`);
    env.restore(event);
    await vi.waitFor(() => expect(sent.length).toBe(2));
    expect(await pending).toEqual({ ok: true, value: 'plan' });
    // Merged history after its removal: back. Only older history, or history already here: stays removed.
    expect(env.raw.prepare('SELECT id, deleted_at FROM memory_passage ORDER BY id').all()).toEqual([
      { id: 1, deleted_at: null },
      { id: 2, deleted_at: 100 },
      { id: 3, deleted_at: 100 },
    ]);
    expect(sent.map(([, a]) => (a[0] as MemoryPush).type)).toEqual(['planChanged', 'status']);
    expect(start).toHaveBeenCalledTimes(2);
  });

  it('a replace restore drops the core but revives nothing', async () => {
    const dispose = vi.fn();
    const start = vi.fn(async () => ({ service: { getPlan: async () => 'plan' }, importResult: null, dispose }) as unknown as MemoryRuntime);
    const { env, call } = await registered(start);
    await call('getPlan');
    env.raw.exec(`
      INSERT INTO memory_collection (id, name, created_at) VALUES (1, 'Default', 1);
      INSERT INTO memory_passage (id, collection_id, module_id, start_verse_id, end_verse_id, reference, verse_count, added_at, deleted_at)
        VALUES (1, 1, 'KJV', 1, 1, 'Genesis 1:1', 1, 1, 100);
      INSERT INTO memory_card (id, passage_id, rung, state) VALUES (1, 1, 'blanks', 'new');
      INSERT INTO memory_attempt (card_id, at, score, correct_first, total_steps) VALUES (1, 200, 1, 1, 1);
    `);
    await env.restoring({ mode: 'replace', tables: ['memory_passage'] });
    env.restore({ mode: 'replace', tables: ['memory_passage'] });
    await vi.waitFor(() => expect(dispose).toHaveBeenCalled());
    expect(env.raw.prepare('SELECT deleted_at FROM memory_passage').get()).toEqual({ deleted_at: 100 });
  });

  it('a restore that touches no memory table leaves the core running', async () => {
    const dispose = vi.fn();
    const start = vi.fn(async () => ({ service: { getPlan: async () => 'plan' }, importResult: null, dispose }) as unknown as MemoryRuntime);
    const { env, call } = await registered(start);
    await call('getPlan');
    await env.restoring({ mode: 'replace', tables: ['user_note'] });
    env.restore({ mode: 'replace', tables: ['user_note'] });
    await new Promise((r) => setTimeout(r, 20));
    expect(dispose).not.toHaveBeenCalled();
  });

  it('restarts the core after a restore for push-card users', async () => {
    const start = vi.fn(async () => ({ service: { getPlan: async () => 'plan' }, importResult: null, dispose: () => undefined }) as unknown as MemoryRuntime);
    const { env, call } = await registered(start);
    await call('getPlan');
    env.raw.exec(`INSERT INTO memory_setting (key, value) VALUES ('pushCards', '{"enabled":true}')`);
    await env.restoring({ mode: 'replace', tables: ['memory_setting'] });
    env.restore({ mode: 'replace', tables: ['memory_setting'] });
    await vi.waitFor(() => expect(start).toHaveBeenCalledTimes(2));
  });

  it('a failed restore lets calls through again without repairs (the UI still redraws)', async () => {
    const start = vi.fn(async () => ({ service: { getPlan: async () => 'plan' }, importResult: null, dispose: () => undefined }) as unknown as MemoryRuntime);
    const { env, call } = await registered(start);
    await env.restoring({ mode: 'merge', tables: ['memory_passage'] });
    sent.length = 0;
    env.restore({ mode: 'merge', tables: ['memory_passage'], failed: true });
    expect(await call('getPlan')).toEqual({ ok: true, value: 'plan' });
    await vi.waitFor(() => expect(sent.map(([, a]) => (a[0] as MemoryPush).type)).toEqual(['planChanged', 'status']));
  });

  it('registers the app:memory reminder source at startup and queues clicks until the core listens', async () => {
    const sources: Array<{ id: string; onActivated?: (a: unknown) => void; target?: unknown }> = [];
    const host = {
      registerSource: vi.fn((s: (typeof sources)[number]) => {
        sources.push(s);
        return () => undefined;
      }),
      scheduler: { replaceItems: vi.fn(async () => ({ accepted: 1 })), listItems: vi.fn(() => []) },
      capabilities: () => ({ permission: 'granted', whenClosed: 'never', actions: false }),
      requestPermission: async () => 'granted',
    };
    let reminders: import('@bible/memory/core').IRemindersApi | undefined;
    const start = vi.fn(async (_d: unknown, _e: unknown, extras: { reminders?: typeof reminders }) => {
      reminders = extras.reminders;
      return { service: { getPlan: async () => 1 }, importResult: null, dispose: () => undefined } as unknown as MemoryRuntime;
    });
    const { call } = await registered(start, {}, { getReminderHost: () => host as never });
    expect(sources.map((s) => [s.id, s.target])).toEqual([['app:memory', { kind: 'route', route: 'app:memory/cards' }]]);
    sources[0]!.onActivated!({ keys: ['k1'], dueAt: 5, activatedAt: 6, sourceId: 'app:memory' });
    await call('getPlan');
    const seen: unknown[] = [];
    await reminders!.onActivated((e) => seen.push(e));
    expect(seen).toEqual([{ key: 'k1', keys: ['k1'], firedAt: 5 }]);
    await reminders!.replaceAll([]);
    expect(host.scheduler.replaceItems).toHaveBeenCalledWith('app:memory', [], 'Scripture memory');
  });

  it('starts the core after launch only when push cards are switched on', async () => {
    const start = vi.fn(async () => ({ service: {}, importResult: null, dispose: () => undefined }) as unknown as MemoryRuntime);
    const off = await registered(start, { autoStartDelayMs: 1 });
    await new Promise((r) => setTimeout(r, 30));
    expect(start).not.toHaveBeenCalled();
    await closeMainModules();

    const on = makeEnv();
    on.raw.exec(`INSERT INTO memory_setting (key, value) VALUES ('pushCards', '{"enabled":true}')`);
    const ipc = fakeIpcMain();
    await registerMainModules(ipc, deps, {
      modules: [{ manifest: memoryManifest, load: async () => ({ default: createMemoryMainModule(on.envFor(start, { autoStartDelayMs: 1 })) }) }],
      packaged: false,
      overrideText: '',
    });
    await vi.waitFor(() => expect(start).toHaveBeenCalledTimes(1));
    void off;
  });
});

describe('memory runtime: retiring the old extension (M2)', () => {
  function legacyFileWithPlan(root: string): string {
    const legacy = legacyMemoryDbPath(root);
    mkdirSync(join(root, 'ext.bible-app.scripture-memory', 'db'), { recursive: true });
    const db = new Database(legacy);
    db.exec(`
      CREATE TABLE meta (key TEXT PRIMARY KEY, value TEXT NOT NULL); INSERT INTO meta VALUES ('schema_version', '7');
      CREATE TABLE collection (id INTEGER PRIMARY KEY, name TEXT NOT NULL, created_at INTEGER NOT NULL);
      CREATE TABLE passage (id INTEGER PRIMARY KEY, collection_id INTEGER NOT NULL, module_id TEXT NOT NULL, start_verse_id INTEGER NOT NULL,
        end_verse_id INTEGER NOT NULL, reference TEXT NOT NULL, verse_count INTEGER NOT NULL, added_at INTEGER NOT NULL,
        answer_mode TEXT, deleted_at INTEGER, recite_on INTEGER NOT NULL DEFAULT 0);
      CREATE TABLE card (id INTEGER PRIMARY KEY, passage_id INTEGER NOT NULL, rung TEXT NOT NULL, state TEXT NOT NULL,
        interval_step INTEGER NOT NULL DEFAULT -1, due_at INTEGER, streak INTEGER NOT NULL DEFAULT 0, last_score REAL, progress_reset_at INTEGER);
      CREATE TABLE attempt (id INTEGER PRIMARY KEY, card_id INTEGER NOT NULL, at INTEGER NOT NULL, score REAL NOT NULL,
        correct_first INTEGER NOT NULL, total_steps INTEGER NOT NULL, replay INTEGER NOT NULL DEFAULT 0, duration_ms INTEGER, tier INTEGER NOT NULL DEFAULT 0);
      INSERT INTO collection VALUES (1, 'Default', 1);
      INSERT INTO passage (id, collection_id, module_id, start_verse_id, end_verse_id, reference, verse_count, added_at)
        VALUES (7, 1, 'KJV', 43003016, 43003016, 'John 3:16', 1, 2);
      INSERT INTO card (id, passage_id, rung, state) VALUES (70, 7, 'blanks', 'new');
      INSERT INTO attempt (id, card_id, at, score, correct_first, total_steps) VALUES (700, 70, 3, 1, 1, 1);
    `);
    db.close();
    return legacy;
  }

  function freshUserDb() {
    const raw = new Database(':memory:');
    raw.pragma('foreign_keys = ON');
    const userDb = makeSql(raw);
    initializeUserSchema(userDb);
    return { raw, userDb };
  }

  async function startWith(userDb: ISql, root: string, extensions: { ready?: () => boolean; isEnabled: (id: string) => boolean; disable: (id: string) => Promise<void> } | null) {
    const pushes: MemoryPush[] = [];
    const rt = await startMemoryRuntime({
      getUserDb: async () => userDb,
      legacyDbPath: legacyMemoryDbPath(root),
      openReadOnly: (p) => sqlFor(new Database(p, { readonly: true, fileMustExist: true })),
      bible: createMockApi().bible,
      getExtensions: () => (extensions ? { ready: () => true, ...extensions } : null),
      emit: (p) => pushes.push(p),
      log,
      retireRetryMs: 5,
    });
    return { rt, pushes };
  }

  it('disables a still-enabled old extension once after the import, with a one-time notice', async () => {
    const root = join(dir, 'extensions');
    legacyFileWithPlan(root);
    const { userDb } = freshUserDb();
    let enabled = true;
    const ext = { isEnabled: vi.fn(() => enabled), disable: vi.fn(async () => void (enabled = false)) };
    const first = await startWith(userDb, root, ext);
    expect(ext.disable).toHaveBeenCalledWith('ext.bible-app.scripture-memory');
    // Not pushed (a hidden window would lose it): queued until a visible window collects it, once.
    expect(first.pushes.some((p) => p.type === 'notice')).toBe(false);
    expect(takePendingNotices(userDb, 1)).toEqual([{ id: 'retired', message: RETIRED_NOTICE }]);
    expect(takePendingNotices(userDb, 2)).toEqual([]);
    first.rt.dispose();

    enabled = true; // the user turned it back on: respected
    const second = await startWith(userDb, root, ext);
    expect(ext.disable).toHaveBeenCalledTimes(1);
    expect(takePendingNotices(userDb, 3)).toEqual([]);
    second.rt.dispose();
  });

  it('leaves the extension alone when the import was skipped, tells the user once, and the manual import merges', async () => {
    const root = join(dir, 'extensions');
    legacyFileWithPlan(root);
    const { raw, userDb } = freshUserDb();
    raw.exec(`
      INSERT INTO memory_collection (id, name, created_at) VALUES (1, 'Default', 1);
      INSERT INTO memory_passage (id, collection_id, module_id, start_verse_id, end_verse_id, reference, verse_count, added_at)
        VALUES (1, 1, 'KJV', 1001001, 1001001, 'Genesis 1:1', 1, 1);
    `);
    const ext = { isEnabled: vi.fn(() => true), disable: vi.fn(async () => undefined) };
    const { rt, pushes } = await startWith(userDb, root, ext);
    expect(rt.importResult.status).toBe('skipped-not-empty');
    expect(ext.disable).not.toHaveBeenCalled();
    expect(pushes.some((p) => p.type === 'notice')).toBe(false);
    expect(takePendingNotices(userDb, 1)).toEqual([{ id: 'skipped', message: SKIPPED_NOTICE }]);
    expect(takePendingNotices(userDb, 2)).toEqual([]);
    expect(await rt.service.getImportStatus()).toMatchObject({ status: 'skipped-not-empty', sourceAvailable: true });

    const result = await rt.service.importLegacyData();
    expect(result).toMatchObject({ status: 'merged', added: { memory_passage: 1, memory_card: 1, memory_attempt: 1 } });
    const refs = raw.prepare('SELECT reference FROM memory_passage ORDER BY id').all();
    expect(refs).toEqual([{ reference: 'Genesis 1:1' }, { reference: 'John 3:16' }]);
    // Merging again adds nothing.
    expect(await rt.service.importLegacyData()).toMatchObject({ status: 'merged', added: {} });
    await vi.waitFor(() => expect(ext.disable).toHaveBeenCalledTimes(1));
    rt.dispose();
  });
});
