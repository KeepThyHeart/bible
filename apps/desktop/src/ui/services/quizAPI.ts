/**
 * Renderer side of the quiz (task 0074): adapters that let core's `QuizEngine`
 * use the `quiz:*` IPC channels (`electron/ipc/quizHandlers.ts`) as its
 * question source and progress store.
 */
import type {
  IQuizCatalogSource,
  IQuizProgressStore,
  QuizAttempt,
  QuizCatalog,
  QuizFilter,
  QuizItemStat,
  QuizPassage,
  QuizQuestion,
  QuizSessionSummary,
} from '@bible/core/browser';
import { unwrap } from './ipcResult';

type QuizBridge = typeof window.electron.quiz;

const defaultBridge = (): QuizBridge => window.electron.quiz;

/** Questions and catalog from every installed quiz module. */
export class IpcQuizSource implements IQuizCatalogSource {
  constructor(private readonly bridge: () => QuizBridge = defaultBridge) {}

  getCatalog(): Promise<QuizCatalog> {
    return unwrap(this.bridge().getCatalog());
  }

  getQuestions(passages: QuizPassage[], filter?: QuizFilter): Promise<QuizQuestion[]> {
    return unwrap(this.bridge().getQuestions(passages, filter));
  }
}

/** Progress kept in the user database. */
export class IpcQuizProgressStore implements IQuizProgressStore {
  constructor(private readonly bridge: () => QuizBridge = defaultBridge) {}

  async getStats(keys: string[]): Promise<Map<string, QuizItemStat>> {
    if (keys.length === 0) return new Map();
    const stats = await unwrap(this.bridge().getStats(keys));
    return new Map(Object.entries(stats));
  }

  async recordAttempt(attempt: QuizAttempt): Promise<void> {
    await unwrap(this.bridge().recordAttempt(attempt));
  }

  async recordSession(summary: QuizSessionSummary): Promise<void> {
    await unwrap(this.bridge().recordSession(summary));
  }

  listSessions(limit?: number): Promise<QuizSessionSummary[]> {
    return unwrap(this.bridge().listSessions(limit));
  }
}
