/**
 * The Quiz module's main-process API, shared by `./index.ts` (implements it through
 * `ipc.handle`) and the renderer's `createModuleClient<QuizApi>('quiz')`.
 */
import type {
  QuizAttempt,
  QuizCatalog,
  QuizFilter,
  QuizItemStat,
  QuizPassage,
  QuizQuestion,
  QuizSessionSummary,
} from '@bible/core/browser';

export interface QuizApi {
  getCatalog(): QuizCatalog;
  getQuestions(passages: QuizPassage[], filter?: QuizFilter): QuizQuestion[];
  getStats(keys: string[]): Record<string, QuizItemStat>;
  recordAttempt(attempt: QuizAttempt): void;
  recordSession(summary: QuizSessionSummary): void;
  listSessions(limit?: number): QuizSessionSummary[];
}
