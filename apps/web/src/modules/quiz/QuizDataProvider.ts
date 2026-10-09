import { MemoryQuizProgressStore, QuizEngine } from '@bible/core/browser';
import type {
  IQuizCatalogSource,
  IQuizProgressStore,
  QuizCatalog,
  QuizFilter,
  QuizPassage,
  QuizQuestion,
} from '@bible/core/browser';
import { API_BASE } from '../../utils/apiUrl';

const EMPTY_CATALOG: QuizCatalog = { modules: [], coverage: [] };
const MAX_CACHED_QUESTION_SETS = 50;

/**
 * Quiz questions over HTTP: `GET /api/quiz` (the catalog, fetched once) and
 * `GET /api/quiz/questions?range=...` (questions for a passage, kept in memory
 * by URL, oldest dropped past a small cap).
 *
 * No quiz module installed (404) resolves an empty catalog / no questions and
 * is not remembered. Any other failure rejects and is not remembered either.
 */
export class QuizDataProvider implements IQuizCatalogSource {
  private catalog: Promise<QuizCatalog> | null = null;
  private readonly questionSets = new Map<string, QuizQuestion[]>();

  constructor(private readonly baseUrl: string) {}

  getCatalog(): Promise<QuizCatalog> {
    if (!this.catalog) {
      const request = this.fetchCatalog();
      this.catalog = request;
      request.then(
        (catalog) => { if (catalog.modules.length === 0 && this.catalog === request) this.catalog = null; },
        () => { if (this.catalog === request) this.catalog = null; },
      );
    }
    return this.catalog;
  }

  async getQuestions(passages: QuizPassage[], filter?: QuizFilter): Promise<QuizQuestion[]> {
    if (passages.length === 0) return [];
    const params = new URLSearchParams();
    for (const p of passages) params.append('range', `${p.start}-${p.end}`);
    for (const k of filter?.kinds ?? []) params.append('kind', k);
    for (const m of filter?.modes ?? []) params.append('mode', m);
    const url = `${this.baseUrl}/api/quiz/questions?${params.toString()}`;

    const hit = this.questionSets.get(url);
    if (hit) {
      // Refresh recency.
      this.questionSets.delete(url);
      this.questionSets.set(url, hit);
      return hit;
    }
    const res = await fetch(url);
    if (res.status === 404) return [];
    if (!res.ok) throw new Error(`API error ${res.status}`);
    const body = (await res.json()) as { questions: QuizQuestion[] };
    let questions = body.questions ?? [];
    // `moduleUuids` is the one filter the endpoint does not take; apply it here.
    if (filter?.moduleUuids?.length) {
      const only = new Set(filter.moduleUuids);
      questions = questions.filter((q) => !q.origin || only.has(q.origin));
    }
    this.questionSets.set(url, questions);
    while (this.questionSets.size > MAX_CACHED_QUESTION_SETS) {
      const oldest = this.questionSets.keys().next().value;
      if (oldest === undefined) break;
      this.questionSets.delete(oldest);
    }
    return questions;
  }

  private async fetchCatalog(): Promise<QuizCatalog> {
    const res = await fetch(`${this.baseUrl}/api/quiz`);
    if (res.status === 404) return EMPTY_CATALOG;
    if (!res.ok) throw new Error(`API error ${res.status}`);
    return (await res.json()) as QuizCatalog;
  }
}

let shared: QuizDataProvider | null = null;

/** The app-wide provider. */
export function getQuizProvider(): IQuizCatalogSource {
  if (!shared) shared = new QuizDataProvider(API_BASE);
  return shared;
}

// Web policy: no quiz progress is saved in the browser until web accounts exist.
// This store lives for the page session only and writes nothing anywhere.
let sessionStore: IQuizProgressStore | null = null;

/** The page-session progress store (in memory; nothing persisted). */
export function getQuizSessionStore(): IQuizProgressStore {
  if (!sessionStore) sessionStore = new MemoryQuizProgressStore();
  return sessionStore;
}

let engine: QuizEngine | null = null;

/** The app-wide quiz engine: HTTP questions, in-memory progress. */
export function getQuizEngine(): QuizEngine {
  if (!engine) engine = new QuizEngine(getQuizProvider(), getQuizSessionStore());
  return engine;
}
