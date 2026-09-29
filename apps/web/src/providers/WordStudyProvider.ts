/**
 * Word Study Provider
 *
 * Client side of `/api/word-study`. The heavy lifting (Strong's tagging,
 * stemming, occurrence scans) happens on the server, so this only works
 * online: when the network is unreachable it throws {@link WordStudyOfflineError}
 * so the UI can say "available when online" instead of a generic failure.
 *
 * Saved word groups live in the browser's own storage; a group subject is sent
 * inline with each request (the server keeps no groups).
 */

import type {
  IWordStudyProvider,
  WordKeyCandidate,
  WordOccurrencePage,
  WordOccurrenceQuery,
  WordStudyOptions,
  WordStudyOverview,
  WordStudySubject,
} from '@bible/core/browser';
import { API_BASE } from '../utils/apiUrl';

/** Thrown when the word study server cannot be reached (offline / network failure). */
export class WordStudyOfflineError extends Error {
  readonly code = 'WORD_STUDY_OFFLINE';
  constructor(message = 'Word study is available when online.') {
    super(message);
    this.name = 'WordStudyOfflineError';
  }
}

/** True for a {@link WordStudyOfflineError}, including one that crossed a module boundary. */
export function isWordStudyOfflineError(error: unknown): error is WordStudyOfflineError {
  return error instanceof WordStudyOfflineError
    || (error instanceof Error && (error as { code?: unknown }).code === 'WORD_STUDY_OFFLINE');
}

export class WordStudyProvider implements IWordStudyProvider {
  constructor(private readonly baseUrl: string = API_BASE) {}

  resolve(query: string): Promise<WordKeyCandidate[]> {
    return this.request(`${this.baseUrl}/api/word-study/resolve?q=${encodeURIComponent(query)}`);
  }

  getOverview(subject: WordStudySubject, options: WordStudyOptions = {}): Promise<WordStudyOverview> {
    return this.request(`${this.baseUrl}/api/word-study/overview`, { subject, options });
  }

  getOccurrences(subject: WordStudySubject, query: WordOccurrenceQuery): Promise<WordOccurrencePage> {
    return this.request(`${this.baseUrl}/api/word-study/occurrences`, { subject, query });
  }

  private async request<T>(url: string, body?: unknown): Promise<T> {
    if (typeof navigator !== 'undefined' && navigator.onLine === false) {
      throw new WordStudyOfflineError();
    }
    let res: Response;
    try {
      res = body === undefined
        ? await fetch(url)
        : await fetch(url, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(body),
          });
    } catch (error) {
      const name = (error as { name?: string } | null)?.name;
      if (name === 'TypeError' || name === 'AbortError') {
        throw new WordStudyOfflineError();
      }
      throw error;
    }
    if (!res.ok) {
      const text = await res.text().catch(() => '');
      throw new Error(`API error ${res.status}: ${text}`);
    }
    return res.json() as Promise<T>;
  }
}

let instance: WordStudyProvider | null = null;

/** Shared provider for the app's own server. */
export function getWordStudyProvider(): WordStudyProvider {
  return (instance ??= new WordStudyProvider());
}
