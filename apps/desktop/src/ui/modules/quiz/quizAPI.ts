/**
 * Renderer side of the quiz (task 0074): adapters that let core's `QuizEngine`
 * use the main-process Quiz module (`electron/modules/quiz`, channels
 * `module:quiz:*`) as its question source and progress store.
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
import { createModuleClient } from '../../services/moduleClient';
import type { ModuleClient } from '../../services/moduleClient';
import type { QuizApi } from '../../../../electron/modules/quiz/types';

type QuizBridge = ModuleClient<QuizApi>;

const client = createModuleClient<QuizApi>('quiz');
const defaultBridge = (): QuizBridge => client;

/** Questions and catalog from every installed quiz module. */
export class IpcQuizSource implements IQuizCatalogSource {
  constructor(private readonly bridge: () => QuizBridge = defaultBridge) {}

  getCatalog(): Promise<QuizCatalog> {
    return this.bridge().getCatalog();
  }

  getQuestions(passages: QuizPassage[], filter?: QuizFilter): Promise<QuizQuestion[]> {
    return this.bridge().getQuestions(passages, filter);
  }
}

/** Progress kept in the user database. */
export class IpcQuizProgressStore implements IQuizProgressStore {
  constructor(private readonly bridge: () => QuizBridge = defaultBridge) {}

  async getStats(keys: string[]): Promise<Map<string, QuizItemStat>> {
    if (keys.length === 0) return new Map();
    const stats = await this.bridge().getStats(keys);
    return new Map(Object.entries(stats));
  }

  async recordAttempt(attempt: QuizAttempt): Promise<void> {
    await this.bridge().recordAttempt(attempt);
  }

  async recordSession(summary: QuizSessionSummary): Promise<void> {
    await this.bridge().recordSession(summary);
  }

  listSessions(limit?: number): Promise<QuizSessionSummary[]> {
    return this.bridge().listSessions(limit);
  }
}
