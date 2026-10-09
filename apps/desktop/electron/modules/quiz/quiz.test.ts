/**
 * `module:quiz:*` channels: opens every installed quiz module read-only (real temp
 * SQLite files built from the canonical Quiz schema), merges their catalogs
 * and questions, validates input, and keeps progress in the user database
 * (an in-memory better-sqlite3 db behind a mocked `sharedUserDb`).
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { mkdtempSync, rmSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';

const handlers = new Map<string, (event: unknown, ...args: unknown[]) => unknown>();

vi.mock('electron', () => ({
  app: { getPath: vi.fn(() => '/fake/userData'), isPackaged: false },
}));

vi.mock('electron-log', () => ({
  default: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

const paths = { data: '', modules: '' };
vi.mock('../../utils/appPaths', () => ({
  getDataPath: () => paths.data,
  getUserModulesPath: () => paths.modules,
  resolveModulePath: (p: string) => join(paths.data, p),
}));

vi.mock('../../services/installedModules', () => ({ listInstalledModules: vi.fn(() => []) }));
vi.mock('../../services/sharedMainDb', () => ({ getSharedModuleMetadataRepo: vi.fn() }));

// The user database: plain in-memory better-sqlite3 (set in beforeEach).
const userDb: { current: unknown } = { current: null };
vi.mock('../../services/sharedUserDb', () => ({ getSharedUserDb: async () => userDb.current }));

import { loadSchemaSql } from '@bible/core';
import quizModule from './index';
import { createModuleIpc } from '../moduleIpc';
import type { MainModuleDeps } from '../FeatureMainModule';
import { __resetModuleDatabaseRegistryForTests } from '../../services/ModuleDatabaseRegistry';
import { makeSql } from '../../services/__tests__/helpers/testSql';

const nativeSqliteAvailable = ((): boolean => {
  try {
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const Database = require('better-sqlite3-multiple-ciphers');
    new Database(':memory:').close();
    return true;
  } catch {
    return false;
  }
})();

const SCHEMA = join(__dirname, '..', '..', '..', '..', '..', 'packages', 'core', 'sql', 'schemas', 'initial', 'Quiz.sql');

/** One module with one question per (key, verse range). */
function buildModule(file: string, uuid: string, questions: Array<{ id: number; key: string; start: number; end: number }>): void {
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  const Database = require('better-sqlite3-multiple-ciphers');
  const db = new Database(file);
  db.exec(loadSchemaSql(SCHEMA));
  db.prepare(
    `INSERT INTO module_info (info_id, module_uuid, module_type, abbreviation, full_name, format, license_spdx)
     VALUES (1, ?, 'quiz', 'Q', 'Test Quiz', 'quiz-module', 'CC-BY-4.0')`,
  ).run(uuid);
  for (const q of questions) {
    db.prepare(
      `INSERT INTO quiz_question (question_id, question_key, kind, answer_mode, difficulty, prompt, answer)
       VALUES (?, ?, 'recall', 'free_response', 1, ?, 'A')`,
    ).run(q.id, q.key, `Prompt ${q.key}`);
    db.prepare(
      `INSERT INTO verse_link (source_type, source_id, verse_id_start, verse_id_end, link_type)
       VALUES ('quiz_question', ?, ?, ?, 'primary_passage')`,
    ).run(q.id, q.start, q.end);
  }
  db.close();
}

type Reply = { ok: boolean; value?: any; error?: { code: string } };
const fakeIpcMain = {
  handle: (channel: string, fn: (event: unknown, ...args: unknown[]) => unknown) => void handlers.set(channel, fn),
  removeHandler: (channel: string) => void handlers.delete(channel),
};
const deps: MainModuleDeps = {
  userDataPath: '/fake/userData',
  getWindows: () => [],
  log: { info() {}, warn() {}, error() {} },
};
const closeQuizDbs = (): void => void quizModule.close?.();
const registerQuizHandlers = (): void => void quizModule.registerIpc(createModuleIpc('quiz', fakeIpcMain, deps), deps);

/** `channel` is `quiz:<method>`; the module's real channel is `module:quiz:<method>`. */
async function call(channel: string, ...args: unknown[]): Promise<Reply> {
  const handler = handlers.get(`module:${channel}`);
  if (!handler) throw new Error(`${channel} not registered`);
  return (await handler({}, ...args)) as Reply;
}

const attempt = { key: 'kth:MRK:4:01', result: 'correct', at: '2026-10-01T10:00:00.000Z' };
const session = {
  id: 'quiz-1', date: '2026-10-01T10:05:00.000Z', label: 'Mark 4', passages: [{ start: 41004001, end: 41004999 }],
  total: 5, graded: 4, correct: 3, partly: 0, score: 0.75, missedKeys: ['kth:MRK:4:02'],
};

describe.skipIf(!nativeSqliteAvailable)('module:quiz:* channels', () => {
  let tmpDir: string;
  let memDb: { close(): void };

  beforeEach(() => {
    handlers.clear();
    __resetModuleDatabaseRegistryForTests();
    closeQuizDbs();
    tmpDir = mkdtempSync(join(tmpdir(), 'quiz-handlers-'));
    paths.data = tmpDir;
    paths.modules = join(tmpDir, 'modules-not-there');
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const Database = require('better-sqlite3');
    const db = new Database(':memory:');
    memDb = db;
    userDb.current = makeSql(db);
    registerQuizHandlers();
  });

  afterEach(() => {
    closeQuizDbs();
    __resetModuleDatabaseRegistryForTests();
    memDb.close();
    rmSync(tmpDir, { recursive: true, force: true });
  });

  it('registers every channel', () => {
    for (const c of ['getCatalog', 'getQuestions', 'getStats', 'recordAttempt', 'recordSession', 'listSessions']) {
      expect(handlers.has(`module:quiz:${c}`)).toBe(true);
    }
  });

  it('answers an empty catalog when no module is installed, and picks a module installed later', async () => {
    expect(await call('quiz:getCatalog')).toEqual({ ok: true, value: { modules: [], coverage: [] } });
    buildModule(join(tmpDir, 'quiz_a.db'), '00000000-0000-4000-8000-0000000000a1', [{ id: 1, key: 'a:1', start: 41004001, end: 41004002 }]);
    const reply = await call('quiz:getCatalog');
    expect(reply.value.modules).toHaveLength(1);
    expect(reply.value.coverage).toEqual([{ book: 41, chapter: 4, count: 1 }]);
  });

  it('picks up a module installed (or removed) after the first catalog call', async () => {
    buildModule(join(tmpDir, 'quiz_a.db'), '00000000-0000-4000-8000-0000000000a1', [{ id: 1, key: 'a:1', start: 41004001, end: 41004002 }]);
    expect((await call('quiz:getCatalog')).value.modules).toHaveLength(1);
    buildModule(join(tmpDir, 'quiz_b.db'), '00000000-0000-4000-8000-0000000000b2', [{ id: 1, key: 'b:1', start: 41004003, end: 41004004 }]);
    const after = await call('quiz:getCatalog');
    expect(after.value.modules).toHaveLength(2);
    expect(after.value.coverage).toEqual([{ book: 41, chapter: 4, count: 2 }]);
    const qs = await call('quiz:getQuestions', [{ start: 41004001, end: 41004999 }]);
    expect(qs.value).toHaveLength(2);
    rmSync(join(tmpDir, 'quiz_b.db'));
    expect((await call('quiz:getCatalog')).value.modules).toHaveLength(1);
  });

  it('returns questions overlapping the passages', async () => {
    buildModule(join(tmpDir, 'quiz_a.db'), '00000000-0000-4000-8000-0000000000a1', [
      { id: 1, key: 'a:1', start: 41004001, end: 41004002 },
      { id: 2, key: 'a:2', start: 41005001, end: 41005002 },
    ]);
    const reply = await call('quiz:getQuestions', [{ start: 41004001, end: 41004999 }]);
    expect(reply.ok).toBe(true);
    expect(reply.value.map((q: { key: string }) => q.key)).toEqual(['a:1']);
  });

  it('merges two modules (catalog and questions)', async () => {
    buildModule(join(tmpDir, 'quiz_a.db'), '00000000-0000-4000-8000-0000000000a1', [{ id: 1, key: 'a:1', start: 41004001, end: 41004002 }]);
    buildModule(join(tmpDir, 'quiz_b.db'), '00000000-0000-4000-8000-0000000000b2', [{ id: 1, key: 'b:1', start: 41004003, end: 41004004 }]);
    const catalog = await call('quiz:getCatalog');
    expect(catalog.value.modules).toHaveLength(2);
    expect(catalog.value.coverage).toEqual([{ book: 41, chapter: 4, count: 2 }]);
    const questions = await call('quiz:getQuestions', [{ start: 41004001, end: 41004999 }]);
    expect(questions.value.map((q: { key: string }) => q.key).sort()).toEqual(['a:1', 'b:1']);
  });

  it('skips a quiz*.db file that is not a quiz module', async () => {
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const Database = require('better-sqlite3-multiple-ciphers');
    const junk = new Database(join(tmpDir, 'quiz_broken.db'));
    junk.exec('CREATE TABLE unrelated (x INTEGER)');
    junk.close();
    expect(await call('quiz:getCatalog')).toEqual({ ok: true, value: { modules: [], coverage: [] } });
  });

  it('validates question input', async () => {
    expect(await call('quiz:getQuestions', 'nope')).toMatchObject({ ok: false, error: { code: 'invalid_input' } });
    expect(await call('quiz:getQuestions', [{ start: 'x', end: 2 }])).toMatchObject({ ok: false, error: { code: 'invalid_input' } });
    const many = Array.from({ length: 51 }, () => ({ start: 1, end: 2 }));
    expect(await call('quiz:getQuestions', many)).toMatchObject({ ok: false, error: { code: 'invalid_input' } });
    expect(await call('quiz:getQuestions', [], { kinds: 'recall' })).toMatchObject({ ok: false, error: { code: 'invalid_input' } });
  });

  it('records attempts and sessions in the user database and reads them back', async () => {
    expect((await call('quiz:recordAttempt', attempt)).ok).toBe(true);
    expect((await call('quiz:recordAttempt', { ...attempt, result: 'incorrect' })).ok).toBe(true);
    const stats = await call('quiz:getStats', ['kth:MRK:4:01', 'never:seen']);
    expect(stats.value).toEqual({
      'kth:MRK:4:01': expect.objectContaining({ key: 'kth:MRK:4:01', seen: 2, correct: 1, missed: 1, lastResult: 'incorrect' }),
    });

    expect((await call('quiz:recordSession', session)).ok).toBe(true);
    const listed = await call('quiz:listSessions', 5);
    expect(listed.value).toEqual([session]);
  });

  it('validates progress input', async () => {
    expect(await call('quiz:getStats', 'x')).toMatchObject({ ok: false, error: { code: 'invalid_input' } });
    expect(await call('quiz:getStats', Array.from({ length: 2001 }, (_, i) => `k${i}`))).toMatchObject({ ok: false, error: { code: 'invalid_input' } });
    expect(await call('quiz:recordAttempt', { key: 'k', result: 'bogus', at: 'x' })).toMatchObject({ ok: false, error: { code: 'invalid_input' } });
    expect(await call('quiz:recordSession', { id: 's' })).toMatchObject({ ok: false, error: { code: 'invalid_input' } });
    expect(await call('quiz:recordAttempt', { key: 'k', result: 'correct', at: 'not a date' })).toMatchObject({ ok: false, error: { code: 'invalid_input' } });
    expect(await call('quiz:recordAttempt', { key: 'k'.repeat(201), result: 'correct', at: attempt.at })).toMatchObject({ ok: false, error: { code: 'invalid_input' } });
    expect(await call('quiz:recordSession', { ...session, missedKeys: Array.from({ length: 2001 }, (_, i) => `k${i}`) })).toMatchObject({ ok: false, error: { code: 'invalid_input' } });
    expect(await call('quiz:recordSession', { ...session, label: 'x'.repeat(201) })).toMatchObject({ ok: false, error: { code: 'invalid_input' } });
    expect(await call('quiz:recordSession', { ...session, passages: Array.from({ length: 51 }, () => ({ start: 1, end: 2 })) })).toMatchObject({ ok: false, error: { code: 'invalid_input' } });
    expect(await call('quiz:listSessions', 0)).toMatchObject({ ok: false, error: { code: 'invalid_input' } });
  });
});
