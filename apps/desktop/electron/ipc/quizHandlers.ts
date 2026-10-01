/**
 * IPC for the quiz (task 0074).
 *
 * Questions: every installed quiz module (module_type 'quiz', `quiz_*.db`) is
 * opened read-only and queried; a catalog merges them. Progress: per-question
 * stats and finished-quiz summaries are `user_data_item` rows (owner
 * `app:quiz`) in the shared user database, via core's
 * `UserDataQuizProgressStore`.
 *
 * Replies use the `Result<T>` envelope; the renderer side is
 * `src/ui/services/quizAPI.ts`.
 */
import { IpcMain } from 'electron';
import log from 'electron-log';
import { existsSync, readdirSync } from 'fs';
import { join } from 'path';
import {
  SqliteModuleRepositoryFactory,
  UserDataRepository,
  nodeCodecRegistry,
  wrapSqlConnection,
} from '@bible/core';
import type { ICodecRegistry, IModuleRepositoryFactory, IQuizRepository } from '@bible/core';
import { mergeCatalogs, UserDataQuizProgressStore } from '@bible/core/browser';
import type {
  QuizAttempt,
  QuizCatalog,
  QuizFilter,
  QuizItemStat,
  QuizPassage,
  QuizQuestion,
  QuizSessionSummary,
} from '@bible/core/browser';
import { getDataPath, getUserModulesPath, resolveModulePath } from '../utils/appPaths';
import { ipcHandler, IpcKnownError } from './handler-helper';
import { getModuleDatabaseRegistry } from '../services/ModuleDatabaseRegistry';
import { listInstalledModules } from '../services/installedModules';
import { getSharedUserDb } from '../services/sharedUserDb';
import { initializeUserSchema } from '../schema/userSchema';

const repositoryFactory: IModuleRepositoryFactory = new SqliteModuleRepositoryFactory();
const codecs: ICodecRegistry = nodeCodecRegistry();

const QUIZ_FILE = /^quiz.*\.db$/i;
const MAX_PASSAGES = 50;
const MAX_KEYS = 2000;
const MAX_SESSIONS_LIMIT = 200;

interface OpenQuiz {
  path: string;
  repo: IQuizRepository;
}

/** Opened modules, and the merged catalog. Empty results are not cached so a module installed later is found. */
let openModules: OpenQuiz[] | null = null;
let cachedCatalog: QuizCatalog | null = null;

function quizFilesIn(dir: string): string[] {
  try {
    if (!existsSync(dir)) return [];
    return readdirSync(dir)
      .filter((name) => QUIZ_FILE.test(name))
      .sort()
      .map((name) => join(dir, name));
  } catch {
    return [];
  }
}

/**
 * Candidate database paths: modules registered in `main.db` with type 'quiz',
 * then any `quiz*.db` file in the user modules and bundled data directories.
 */
export function findQuizModulePaths(): string[] {
  const paths: string[] = [];
  try {
    for (const module of listInstalledModules('quiz')) {
      paths.push(resolveModulePath(module.databasePath));
    }
  } catch (error) {
    log.debug('[quiz] module registry lookup failed, probing files:', error);
  }
  paths.push(...quizFilesIn(getUserModulesPath()), ...quizFilesIn(getDataPath()));
  return [...new Set(paths)];
}

/** Every readable quiz module, opened once. Files that are not quiz modules are skipped. */
function loadModules(): OpenQuiz[] {
  if (openModules) return openModules;
  const found: OpenQuiz[] = [];
  const seenUuids = new Set<string>();
  for (const dbPath of findQuizModulePaths()) {
    const db = getModuleDatabaseRegistry().openByPath(dbPath, { readonly: true });
    if (!db) continue;
    const repo = repositoryFactory.create(wrapSqlConnection(db), 'quiz', codecs) as IQuizRepository | null;
    if (!repo) continue;
    try {
      const info = repo.getInfo();
      if (info.uuid && seenUuids.has(info.uuid)) continue;
      seenUuids.add(info.uuid);
      repo.getCoverage(); // throws when the quiz tables are missing
      found.push({ path: dbPath, repo });
      log.info('Quiz module loaded:', dbPath);
    } catch (error) {
      log.warn(`[quiz] ${dbPath} is not a readable quiz module:`, error);
    }
  }
  if (found.length > 0) openModules = found;
  return found;
}

function getCatalog(): QuizCatalog {
  if (cachedCatalog) return cachedCatalog;
  const modules = loadModules();
  if (modules.length === 0) return { modules: [], coverage: [] };
  cachedCatalog = mergeCatalogs(
    modules.map((m) => ({ modules: [m.repo.getInfo()], coverage: m.repo.getCoverage() })),
  );
  return cachedCatalog;
}

function isFiniteNumber(v: unknown): v is number {
  return typeof v === 'number' && Number.isFinite(v);
}

function parsePassages(raw: unknown): QuizPassage[] {
  if (!Array.isArray(raw) || raw.length > MAX_PASSAGES) {
    throw new IpcKnownError('invalid_input', `passages must be an array of at most ${MAX_PASSAGES} ranges.`);
  }
  return raw.map((p) => {
    const r = p as Partial<QuizPassage> | null;
    if (!r || typeof r !== 'object' || !isFiniteNumber(r.start) || !isFiniteNumber(r.end)) {
      throw new IpcKnownError('invalid_input', 'Each passage needs numeric start and end.');
    }
    return { start: r.start, end: r.end };
  });
}

function parseFilter(raw: unknown): QuizFilter | undefined {
  if (raw === undefined || raw === null) return undefined;
  if (typeof raw !== 'object' || Array.isArray(raw)) throw new IpcKnownError('invalid_input', 'filter must be an object.');
  const f = raw as Record<string, unknown>;
  const out: QuizFilter = {};
  for (const field of ['kinds', 'modes', 'moduleUuids'] as const) {
    const v = f[field];
    if (v === undefined) continue;
    if (!Array.isArray(v) || v.length > 100 || v.some((x) => typeof x !== 'string')) {
      throw new IpcKnownError('invalid_input', `filter.${field} must be an array of strings.`);
    }
    out[field] = v as string[];
  }
  return out;
}

function parseKeys(raw: unknown): string[] {
  if (!Array.isArray(raw) || raw.length > MAX_KEYS || raw.some((k) => typeof k !== 'string' || k.length === 0 || k.length > 200)) {
    throw new IpcKnownError('invalid_input', `keys must be an array of at most ${MAX_KEYS} non-empty strings.`);
  }
  return raw as string[];
}

const RESULTS = new Set(['correct', 'partly', 'incorrect', 'ungraded', 'skipped']);

function parseAttempt(raw: unknown): QuizAttempt {
  const a = raw as Partial<QuizAttempt> | null;
  if (!a || typeof a !== 'object' || typeof a.key !== 'string' || a.key.length === 0 || a.key.length > 200
      || typeof a.result !== 'string' || !RESULTS.has(a.result) || typeof a.at !== 'string' || a.at.length === 0
      || (a.quizId !== undefined && typeof a.quizId !== 'string')) {
    throw new IpcKnownError('invalid_input', 'Invalid quiz attempt.');
  }
  return { key: a.key, result: a.result, at: a.at, ...(a.quizId !== undefined ? { quizId: a.quizId } : {}) };
}

function parseSession(raw: unknown): QuizSessionSummary {
  const s = raw as Partial<QuizSessionSummary> | null;
  if (!s || typeof s !== 'object' || typeof s.id !== 'string' || s.id.length === 0 || s.id.length > 200
      || typeof s.date !== 'string' || !isFiniteNumber(s.total) || !isFiniteNumber(s.graded)
      || !isFiniteNumber(s.correct) || !isFiniteNumber(s.partly) || !isFiniteNumber(s.score)
      || !Array.isArray(s.missedKeys) || s.missedKeys.length > MAX_KEYS || s.missedKeys.some((k) => typeof k !== 'string')
      || (s.label !== undefined && typeof s.label !== 'string')) {
    throw new IpcKnownError('invalid_input', 'Invalid quiz session summary.');
  }
  return {
    id: s.id,
    date: s.date,
    ...(s.label !== undefined ? { label: s.label } : {}),
    passages: parsePassages(s.passages),
    total: s.total,
    graded: s.graded,
    correct: s.correct,
    partly: s.partly,
    score: s.score,
    missedKeys: s.missedKeys as string[],
  };
}

let storeInit: Promise<UserDataQuizProgressStore> | null = null;

/** The progress store over the shared user DB, opened once (a failed open is retried). */
async function getProgressStore(): Promise<UserDataQuizProgressStore> {
  if (!storeInit) {
    storeInit = (async () => {
      const db = await getSharedUserDb();
      initializeUserSchema(db);
      return new UserDataQuizProgressStore(new UserDataRepository(db));
    })().catch((err: unknown) => {
      storeInit = null;
      throw err;
    });
  }
  return storeInit;
}

export function registerQuizHandlers(_ipcMain: IpcMain): void {
  ipcHandler<[], QuizCatalog>('quiz:getCatalog', () => getCatalog());

  ipcHandler<[unknown, unknown?], QuizQuestion[]>('quiz:getQuestions', (rawPassages, rawFilter) => {
    const passages = parsePassages(rawPassages);
    const filter = parseFilter(rawFilter);
    const byKey = new Map<string, QuizQuestion>();
    for (const m of loadModules()) {
      for (const q of m.repo.getQuestions(passages, filter)) {
        if (!byKey.has(q.key)) byKey.set(q.key, q);
      }
    }
    return [...byKey.values()];
  });

  ipcHandler<[unknown], Record<string, QuizItemStat>>('quiz:getStats', async (rawKeys) => {
    const keys = parseKeys(rawKeys);
    const stats = await (await getProgressStore()).getStats(keys);
    return Object.fromEntries(stats);
  });

  ipcHandler<[unknown], void>('quiz:recordAttempt', async (raw) => {
    const attempt = parseAttempt(raw);
    await (await getProgressStore()).recordAttempt(attempt);
  });

  ipcHandler<[unknown], void>('quiz:recordSession', async (raw) => {
    const summary = parseSession(raw);
    await (await getProgressStore()).recordSession(summary);
  });

  ipcHandler<[unknown?], QuizSessionSummary[]>('quiz:listSessions', async (rawLimit) => {
    if (rawLimit !== undefined && rawLimit !== null
        && (!Number.isInteger(rawLimit) || (rawLimit as number) < 1 || (rawLimit as number) > MAX_SESSIONS_LIMIT)) {
      throw new IpcKnownError('invalid_input', `limit must be an integer from 1 to ${MAX_SESSIONS_LIMIT}.`);
    }
    return (await getProgressStore()).listSessions((rawLimit as number | undefined) ?? undefined);
  });
}

export function closeQuizDbs(): void {
  // Handles are owned by ModuleDatabaseRegistry (closed on `will-quit`);
  // drop only our cached copies.
  for (const m of openModules ?? []) getModuleDatabaseRegistry().close(m.path);
  openModules = null;
  cachedCatalog = null;
  storeInit = null;
}
