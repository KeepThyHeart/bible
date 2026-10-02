/**
 * Quiz progress stores.
 *
 * Desktop keeps progress in the user database as `user_data_item` rows:
 *
 * | owner | collection | itemKey | value (JSON) |
 * |---|---|---|---|
 * | `app:quiz` | `item-stats` | question key, e.g. `kth:MRK:4:03` | {@link QuizItemStat} without `key` |
 * | `app:quiz` | `sessions` | quiz id | {@link QuizSessionSummary} |
 *
 * Sessions are capped at {@link MAX_QUIZ_SESSIONS} (oldest removed). Both
 * collections are picked up by backup and, later, sync like any other item.
 *
 * The web app saves no personal content in the browser until web accounts
 * exist, so it uses {@link MemoryQuizProgressStore}: history lives for the
 * page session only.
 */
import { UserDataItem, appOwner } from '../Data/Models/User/UserDataItem';
import type { IUserDataRepository } from '../Data/Repositories/IUserDataRepository';
import type { IQuizProgressStore } from './ports';
import type { QuizAttempt, QuizItemStat, QuizSessionSummary } from './types';

export const QUIZ_OWNER = appOwner('quiz');
export const QUIZ_STATS_COLLECTION = 'item-stats';
export const QUIZ_SESSIONS_COLLECTION = 'sessions';
export const MAX_QUIZ_SESSIONS = 200;

/** Applies one attempt to a stat (pure). */
export function applyAttempt(stat: QuizItemStat | undefined, attempt: QuizAttempt): QuizItemStat {
  const s: QuizItemStat = stat
    ? { ...stat }
    : { key: attempt.key, seen: 0, correct: 0, partly: 0, missed: 0 };
  s.seen++;
  if (attempt.result === 'correct') {
    s.correct++;
    s.lastCorrect = attempt.at;
  } else if (attempt.result === 'partly') s.partly++;
  else if (attempt.result === 'incorrect') s.missed++;
  s.lastSeen = attempt.at;
  s.lastResult = attempt.result;
  return s;
}

function parseStat(key: string, raw: string | null | undefined): QuizItemStat | undefined {
  try {
    const v = JSON.parse(raw ?? 'null') as Partial<QuizItemStat> | null;
    if (!v || typeof v !== 'object') return undefined;
    const n = (x: unknown) => (typeof x === 'number' && Number.isFinite(x) && x >= 0 ? Math.floor(x) : 0);
    const stat: QuizItemStat = { key, seen: n(v.seen), correct: n(v.correct), partly: n(v.partly), missed: n(v.missed) };
    if (typeof v.lastSeen === 'string') stat.lastSeen = v.lastSeen;
    if (typeof v.lastResult === 'string') stat.lastResult = v.lastResult;
    if (typeof v.lastCorrect === 'string') stat.lastCorrect = v.lastCorrect;
    return stat;
  } catch {
    return undefined;
  }
}

function isSession(v: unknown): v is QuizSessionSummary {
  const s = v as QuizSessionSummary | null;
  return !!s && typeof s === 'object' && typeof s.id === 'string' && typeof s.date === 'string'
    && typeof s.total === 'number' && Array.isArray(s.missedKeys) && Array.isArray(s.passages);
}

/** Progress in `user_data_item` (desktop main process; any `IUserDataRepository`). */
export class UserDataQuizProgressStore implements IQuizProgressStore {
  constructor(private readonly repo: IUserDataRepository) {}

  async getStats(keys: string[]): Promise<Map<string, QuizItemStat>> {
    const out = new Map<string, QuizItemStat>();
    const wanted = new Set(keys);
    if (wanted.size === 0) return out;
    // One collection read beats N point lookups once a quiz has more than a few candidates.
    if (wanted.size > 20) {
      for (const item of this.repo.list(QUIZ_OWNER, QUIZ_STATS_COLLECTION)) {
        if (!wanted.has(item.itemKey)) continue;
        const stat = parseStat(item.itemKey, item.value);
        if (stat) out.set(item.itemKey, stat);
      }
      return out;
    }
    for (const key of wanted) {
      const item = this.repo.get(QUIZ_OWNER, QUIZ_STATS_COLLECTION, key);
      const stat = item ? parseStat(key, item.value) : undefined;
      if (stat) out.set(key, stat);
    }
    return out;
  }

  async recordAttempt(attempt: QuizAttempt): Promise<void> {
    const prev = this.repo.get(QUIZ_OWNER, QUIZ_STATS_COLLECTION, attempt.key);
    const next = applyAttempt(prev ? parseStat(attempt.key, prev.value) : undefined, attempt);
    const { key: _key, ...value } = next;
    this.repo.put(new UserDataItem({
      ownerUuid: QUIZ_OWNER, collection: QUIZ_STATS_COLLECTION, itemKey: attempt.key,
      value: JSON.stringify(value), valueType: 'json',
    }));
  }

  async recordSession(summary: QuizSessionSummary): Promise<void> {
    this.repo.put(new UserDataItem({
      ownerUuid: QUIZ_OWNER, collection: QUIZ_SESSIONS_COLLECTION, itemKey: summary.id,
      value: JSON.stringify(summary), valueType: 'json',
    }));
    const all = this.readSessions();
    for (const old of all.slice(MAX_QUIZ_SESSIONS)) {
      this.repo.remove(QUIZ_OWNER, QUIZ_SESSIONS_COLLECTION, old.id);
    }
  }

  async listSessions(limit = 20): Promise<QuizSessionSummary[]> {
    return this.readSessions().slice(0, Math.max(0, limit));
  }

  /** Newest first. */
  private readSessions(): QuizSessionSummary[] {
    const out: QuizSessionSummary[] = [];
    for (const item of this.repo.list(QUIZ_OWNER, QUIZ_SESSIONS_COLLECTION)) {
      try {
        const v: unknown = JSON.parse(item.value ?? 'null');
        if (isSession(v)) out.push(v);
      } catch { /* skip a corrupt row */ }
    }
    return out.sort((a, b) => (a.date < b.date ? 1 : a.date > b.date ? -1 : 0));
  }
}

/** Progress for the life of the object only. Saves nothing anywhere. */
export class MemoryQuizProgressStore implements IQuizProgressStore {
  private readonly stats = new Map<string, QuizItemStat>();
  private readonly sessions: QuizSessionSummary[] = [];

  async getStats(keys: string[]): Promise<Map<string, QuizItemStat>> {
    const out = new Map<string, QuizItemStat>();
    for (const k of keys) {
      const s = this.stats.get(k);
      if (s) out.set(k, { ...s });
    }
    return out;
  }

  async recordAttempt(attempt: QuizAttempt): Promise<void> {
    this.stats.set(attempt.key, applyAttempt(this.stats.get(attempt.key), attempt));
  }

  async recordSession(summary: QuizSessionSummary): Promise<void> {
    this.sessions.unshift(summary);
    this.sessions.length = Math.min(this.sessions.length, MAX_QUIZ_SESSIONS);
  }

  async listSessions(limit = 20): Promise<QuizSessionSummary[]> {
    return this.sessions.slice(0, Math.max(0, limit));
  }
}
