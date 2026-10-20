/**
 * Search provider for `search.mode: remote` (task 0190): meaning ("Ideas")
 * search answered by the hosted bibsearch service, behind a first-use consent.
 *
 * Wraps the normal data provider. Keyword and Strong's pass straight through.
 * Semantic search:
 *   1. reads the consent status; `unset` asks the user and waits for the answer;
 *   2. `granted` -> remote (through our own server, or straight from the browser
 *      with `via: 'browser'`); anything else, or any failure -> keyword search;
 *   3. reports which one answered, and why, in `result.semantic`.
 * Nothing at all is sent before consent, including the warm-up call.
 */
import { RemoteSemantic } from '@bible/core/browser';
import type { IBibleDataProvider, ISearchProvider } from '../../providers/interfaces';
import type { SearchOptions, SearchResultData, SearchResultSet, StrongsSearchResult } from '../../types';
import { formatVerseRange } from '../../utils/verseId';
import type { RemoteConsentStore } from './consentStore';

export interface RemoteSearchProviderOptions {
  baseUrl: string;
  /** The normal (server) data provider: keyword + Strong's, and the Bible text for `via: browser`. */
  inner: ISearchProvider;
  consent: Pick<RemoteConsentStore, 'status' | 'request' | 'noticeVersion' | 'via'>;
  /** Only used for `via: 'browser'`: hydrates hits into the reader's translation. */
  getBible?: () => Promise<IBibleDataProvider>;
  getActiveModule: () => string;
  /** `via: 'browser'` only. */
  remote?: { url?: string; apiKey?: string };
  fetch?: typeof fetch;
  /** Test seam for the browser client. */
  createClient?: (url: string, apiKey?: string) => Pick<RemoteSemantic.RemoteSemanticClient, 'search'>;
}

/** Longest passage window whose verses we hydrate one by one. */
const MAX_WINDOW_VERSES = 12;

interface KeywordCacheEntry { key: string; promise: Promise<SearchResultSet>; at: number }
const KEYWORD_CACHE_MS = 5000;

export class RemoteSearchProvider implements ISearchProvider {
  private client: Pick<RemoteSemantic.RemoteSemanticClient, 'search'> | null = null;
  private keywordCache: KeywordCacheEntry | null = null;

  constructor(private readonly o: RemoteSearchProviderOptions) {}

  /**
   * Keyword search. The last call is shared for a few seconds: in Ideas mode the
   * search store runs keyword search itself (for the "N keyword matches" banner)
   * and this provider needs the same results as its fallback, so both get one
   * request instead of two.
   */
  keywordSearch(query: string, modules: string[], options?: SearchOptions): Promise<SearchResultSet> {
    const key = JSON.stringify([query, modules, options?.pageSize ?? null, options?.page ?? null, options?.scope ?? null]);
    const c = this.keywordCache;
    if (c && c.key === key && Date.now() - c.at < KEYWORD_CACHE_MS) return c.promise;
    const promise = this.o.inner.keywordSearch(query, modules, options);
    const entry = { key, promise, at: Date.now() };
    this.keywordCache = entry;
    promise.catch(() => { if (this.keywordCache === entry) this.keywordCache = null; });
    return promise;
  }

  strongsSearch(number: string, options?: Parameters<ISearchProvider['strongsSearch']>[1]): Promise<StrongsSearchResult> {
    return this.o.inner.strongsSearch(number, options);
  }

  /** Remote mode has nothing to warm up, and nothing may be sent before consent. */
  async warmupSemanticSearch(): Promise<void> { /* no-op */ }

  async semanticSearch(query: string, options?: SearchOptions): Promise<SearchResultSet> {
    const pageSize = options?.pageSize ?? 20;
    const modules = options?.modules ?? [];

    let consent = this.o.consent.status;
    if (consent === 'unset') consent = await this.o.consent.request();

    const outcome = await RemoteSemantic.runSemanticChain<SearchResultSet>({
      consent,
      remote: () => (this.o.consent.via === 'browser'
        ? this.searchFromBrowser(query, pageSize, modules)
        : this.searchViaServer(query, pageSize, modules)),
      fallbacks: modules.length > 0
        ? [{
            name: 'keyword',
            run: async () => {
              const kw = await this.keywordSearch(query, modules);
              return { ...kw, results: kw.results.slice(0, pageSize) };
            },
          }]
        : [],
    });

    if (outcome.source === 'remote' && outcome.result) {
      const r = outcome.result;
      const notice = r.semantic?.notice;
      // The service itself answered with keyword results: say so.
      return { ...r, semantic: { ...r.semantic, source: 'remote', ...(notice ? { notice } : {}) } };
    }

    let notice: RemoteSemantic.SemanticNotice | undefined;
    if (outcome.skipped === 'declined' || outcome.skipped === 'no-consent') notice = { kind: 'declined' };
    else if (outcome.skipped === 'remote-error') notice = RemoteSemantic.noteForRemoteError(outcome.remoteError);

    const base: SearchResultSet = outcome.result ?? { results: [], total: 0 };
    return { ...base, semantic: { source: 'keyword', ...(notice ? { notice } : {}) } };
  }

  // -- via: server ---------------------------------------------------------

  private async searchViaServer(query: string, pageSize: number, modules: string[]): Promise<SearchResultSet> {
    const check = RemoteSemantic.checkRemoteQuery(query);
    if (!check.ok) {
      throw new RemoteSemantic.RemoteSemanticError('invalid_query', 0, 'invalid_query', `Query not sent: ${check.rule}`, { rule: check.rule });
    }
    const params = new URLSearchParams({ q: check.query, maxResults: String(pageSize) });
    if (modules.length > 0) params.set('modules', modules.join(','));
    const doFetch = this.o.fetch ?? fetch;
    let res: Response;
    try {
      res = await doFetch(`${this.o.baseUrl}/api/search/semantic?${params}`, {
        headers: { 'X-Remote-Search-Consent': String(this.o.consent.noticeVersion) },
        credentials: 'same-origin',
      });
    } catch (e) {
      throw new RemoteSemantic.RemoteSemanticError('network', 0, 'network', e instanceof Error ? e.message : String(e));
    }
    let body: (Partial<SearchResultSet> & { error?: { code?: string } }) | null = null;
    try { body = await res.json(); } catch { /* not JSON */ }
    if (!res.ok || !body) throw errorFromServerBody(res.status, body);
    return { results: body.results ?? [], total: body.total ?? body.results?.length ?? 0, semantic: body.semantic };
  }

  // -- via: browser --------------------------------------------------------

  private getClient(): Pick<RemoteSemantic.RemoteSemanticClient, 'search'> {
    if (!this.client) {
      const { url, apiKey } = this.o.remote ?? {};
      if (!url) throw new RemoteSemantic.RemoteSemanticError('unknown', 0, 'not_configured', 'No remote URL configured');
      this.client = this.o.createClient
        ? this.o.createClient(url, apiKey)
        : new RemoteSemantic.RemoteSemanticClient({ baseUrl: url, apiKey, fetch: this.o.fetch });
    }
    return this.client;
  }

  private async searchFromBrowser(query: string, pageSize: number, modules: string[]): Promise<SearchResultSet> {
    const module = modules[0] || this.o.getActiveModule();
    // Over-fetch: windows and verses overlap, and we drop the overlaps below.
    const resp = await this.getClient().search(query, { k: Math.min(100, pageSize * 2) });
    const hits = consolidate(resp.hits, pageSize);
    const results = await this.hydrate(hits, module);
    const semantic: RemoteSemantic.SemanticMeta = { source: 'remote', rateLimit: resp.rateLimit };
    if (resp.degraded || resp.routed) semantic.notice = { kind: 'degraded' };
    return { results, total: results.length, semantic };
  }

  /** Fill in each hit's text from the reader's translation. A hit with no text is dropped. */
  private async hydrate(hits: RemoteSemantic.RemoteHit[], module: string): Promise<SearchResultData[]> {
    if (hits.length === 0) return [];
    const ids = new Set<number>();
    for (const h of hits) for (const id of windowIds(h)) ids.add(id);
    const bible = this.o.getBible ? await this.o.getBible() : null;
    if (!bible) throw new RemoteSemantic.RemoteSemanticError('unknown', 0, 'no_text_source', 'No Bible text source');
    const batch = await bible.getVerseTexts(module, [...ids]);
    const verses = batch?.verses ?? {};
    const out: SearchResultData[] = [];
    for (const h of hits) {
      const parts = windowIds(h).map((id) => verses[String(id)]).filter((v) => v?.text);
      if (parts.length === 0) continue;
      const single = h.endVerseId === h.startVerseId;
      out.push({
        verseId: h.startVerseId,
        ...(single ? {} : { endVerseId: h.endVerseId }),
        reference: formatVerseRange(h.startVerseId, single ? undefined : h.endVerseId),
        text: parts.map((v) => v.text).join(' '),
        snippet: parts.map((v) => v.text_html || v.text).join(' '),
        score: h.score,
        module,
        type: single ? 'verse' : 'paragraph',
      });
    }
    return out;
  }
}

/** Highest score first; a hit overlapping a better one already kept is dropped. */
function consolidate(hits: RemoteSemantic.RemoteHit[], limit: number): RemoteSemantic.RemoteHit[] {
  const sorted = [...hits].sort((a, b) => b.score - a.score);
  const kept: RemoteSemantic.RemoteHit[] = [];
  for (const h of sorted) {
    if (kept.some((k) => h.startVerseId <= k.endVerseId && k.startVerseId <= h.endVerseId)) continue;
    kept.push(h);
    if (kept.length >= limit) break;
  }
  return kept;
}

/** Verse ids of a window. Verse ids are consecutive within a chapter; a window across chapters falls back to its two ends. */
function windowIds(h: RemoteSemantic.RemoteHit): number[] {
  const { startVerseId: s, endVerseId: e } = h;
  if (e === s) return [s];
  if (Math.floor(s / 1000) !== Math.floor(e / 1000)) return [s, e];
  const ids: number[] = [];
  for (let id = s; id <= e && ids.length < MAX_WINDOW_VERSES; id++) ids.push(id);
  return ids;
}

/** Turn a failed `/api/search/semantic` reply into the error class the chain understands. */
function errorFromServerBody(
  status: number,
  body: { error?: { code?: string }; semantic?: { notice?: RemoteSemantic.SemanticNotice } } | null,
): RemoteSemantic.RemoteSemanticError {
  const E = RemoteSemantic.RemoteSemanticError;
  const code = body?.error?.code ?? 'unknown';
  const notice = body?.semantic?.notice;
  if (notice && notice.kind !== 'degraded' && notice.kind !== 'declined') {
    if (notice.kind === 'quota') return new E('quota_exceeded', status, code, undefined, { resetAtMs: notice.resetAtMs });
    if (notice.kind === 'paused') return new E('rate_limited', status, code, undefined, { resetAtMs: notice.resetAtMs });
    if (notice.kind === 'rephrase') return new E('rejected', status, code);
  }
  return new E(status === 403 ? 'forbidden' : 'embedder_error', status, code);
}
