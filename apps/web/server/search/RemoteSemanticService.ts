/**
 * Semantic search through the hosted bibsearch service, for `search.mode: 'remote'`
 * with `via: 'server'`.
 *
 * The server calls bibsearch on the browser's behalf. The call is built fresh from
 * the query alone: nothing about the user's request (IP, cookies, headers, identity)
 * is passed on, and the only credential is the operator's optional API key, which the
 * client sends as `X-API-Key`. bibsearch returns verse ids only (`include_text=false`);
 * the text is looked up here, in the reader's translation.
 */

import { RemoteSemantic } from '@bible/core';
import { VerseIdHelper } from '../core.js';
import type { IBibleRepository, OrchestrationSearchResult } from '@bible/core';

/** The request header carrying the user's agreement; its value is the notice version they agreed to. */
export const CONSENT_HEADER = 'x-remote-search-consent';

const SNIPPET_LENGTH = 200;

/** Where hit text comes from: the reader's translation (or the default), resolved per request. */
export interface RemoteHydration {
  repo?: Pick<IBibleRepository, 'getVerse' | 'getVerseRange'>;
  module: string;
  bookNames: Map<number, string>;
}

export interface RemoteSemanticResponse {
  results: OrchestrationSearchResult[];
  total: number;
  timings: Record<string, number>;
  semantic: RemoteSemantic.SemanticMeta;
}

/** True when the header value is the current notice version. */
export function hasRemoteConsent(headerValue: unknown): boolean {
  const v = Array.isArray(headerValue) ? headerValue[0] : headerValue;
  return typeof v === 'string' && v.trim() === String(RemoteSemantic.REMOTE_SEMANTIC_NOTICE_VERSION);
}

export class RemoteSemanticService {
  constructor(private readonly client: Pick<RemoteSemantic.RemoteSemanticClient, 'search'>) {}

  /** Throws `RemoteSemanticError` on any failure; the caller turns it into a 503. */
  async search(query: string, maxResults: number, hydration: RemoteHydration): Promise<RemoteSemanticResponse> {
    const t0 = Date.now();
    const res = await this.client.search(query, { k: maxResults });
    const tRemote = Date.now() - t0;

    const results = res.hits.map((hit): OrchestrationSearchResult => {
      const { startVerseId: start, endVerseId: end } = hit;
      let text = '';
      const repo = hydration.repo;
      if (repo) {
        if (start === end) {
          text = repo.getVerse(start)?.text ?? '';
        } else {
          text = repo.getVerseRange(start, end).map((v: { text: string }) => v.text).join(' ');
        }
      }
      return {
        verseId: start,
        endVerseId: end,
        reference: VerseIdHelper.formatReference(start, end, hydration.bookNames),
        text,
        snippet: text.length > SNIPPET_LENGTH ? text.slice(0, SNIPPET_LENGTH) + '...' : text,
        score: Math.round(hit.score * 1000) / 1000,
        module: hydration.module,
        type: hit.level === 'verse' || hit.level === 'paragraph' || hit.level === 'chapter'
          ? hit.level
          : start === end ? 'verse' : 'paragraph',
      };
    });

    const semantic: RemoteSemantic.SemanticMeta = { source: 'remote', rateLimit: res.rateLimit };
    if (res.degraded || res.routed) semantic.notice = { kind: 'degraded' };

    return {
      results,
      total: results.length,
      timings: { remote: tRemote, total: Date.now() - t0 },
      semantic,
    };
  }
}
