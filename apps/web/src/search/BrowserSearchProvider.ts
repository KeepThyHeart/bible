/**
 * Search provider that runs semantic search in the browser (via Web Worker)
 * and falls through to the server API for keyword search.
 *
 * Drop-in replacement for the server-side SearchDataProvider when
 * browser-side Ideas Search is enabled.
 */

import type { ISearchProvider, IBibleDataProvider } from '../providers/interfaces';
import type { SearchResultSet, SearchResultData, SearchOptions, StrongsSearchResult } from '../types';
import { BrowserSearchProxy, type ProgressCallback } from './BrowserSearchProxy';
import { formatVerseRange } from '../utils/verseId';

/**
 * The raw worker result carries a passage range but an empty reference and no
 * consolidation. This post-processes it into UI-ready results: resolves the
 * reference from the verse range and drops overlapping duplicates (the worker
 * searches multiple levels — verse/paragraph/chunks — that cover the same text).
 */
function consolidateResults(raw: SearchResultData[], limit: number): SearchResultData[] {
  const sorted = [...raw].sort((a, b) => (b.score ?? 0) - (a.score ?? 0));
  const kept: SearchResultData[] = [];

  for (const r of sorted) {
    const start = r.verseId;
    const end = r.endVerseId ?? r.verseId;
    // Skip if this range overlaps a higher-scored result already kept (same passage region).
    const overlaps = kept.some((k) => {
      const ks = k.verseId;
      const ke = k.endVerseId ?? k.verseId;
      return start <= ke && ks <= end;
    });
    if (overlaps) continue;

    kept.push({
      ...r,
      reference: formatVerseRange(r.verseId, r.endVerseId),
    });
    if (kept.length >= limit) break;
  }

  return kept;
}

export class BrowserSearchProvider implements ISearchProvider {
  private proxy: BrowserSearchProxy;
  private baseUrl: string;

  private bibleProvider: IBibleDataProvider;
  private getActiveModule: () => string;

  constructor(
    baseUrl: string,
    embeddingsUrl: string,
    metadataUrl: string,
    bibleProvider: IBibleDataProvider,
    getActiveModule: () => string,
    modelHost?: string,
    ortWasmPath?: string,
  ) {
    this.baseUrl = baseUrl;
    this.bibleProvider = bibleProvider;
    this.getActiveModule = getActiveModule;
    this.proxy = new BrowserSearchProxy(embeddingsUrl, metadataUrl, modelHost, ortWasmPath);
  }

  setProgressCallback(cb: ProgressCallback | null): void {
    this.proxy.setProgressCallback(cb);
  }

  getStatus() {
    return this.proxy.getStatus();
  }

  async keywordSearch(query: string, modules: string[], options?: SearchOptions): Promise<SearchResultSet> {
    // Keyword search always goes to the server
    const params = new URLSearchParams({ q: query });
    if (modules.length > 0) params.set('modules', modules.join(','));
    if (options?.pageSize) params.set('pageSize', String(options.pageSize));
    const res = await fetch(`${this.baseUrl}/api/search/keyword?${params}`);
    if (!res.ok) throw new Error(`Keyword search failed: ${res.status}`);
    return res.json();
  }

  async semanticSearch(query: string, options?: SearchOptions): Promise<SearchResultSet> {
    // Semantic search runs in the browser via Web Worker. Over-fetch so that after
    // consolidating overlapping verse/paragraph matches we still have a full page.
    const limit = options?.pageSize ?? 20;
    // Read once, so the label the worker stamps on each result and the text
    // fetched for it below cannot come from two different translations.
    const module = this.getActiveModule();
    const raw = await this.proxy.semanticSearch(query, module, { ...options, pageSize: limit * 4 });
    const results = consolidateResults(raw.results, limit);
    await this.enrichVerseText(results, module);
    return { results, total: results.length };
  }

  /**
   * The semantic index stores "idea" descriptions, not verse text. Replace each
   * result's text with the actual scripture from the user's active version.
   *
   * Uses a single batched request (getVerseTexts) rather than one call per result —
   * a per-verse fan-out trips the server rate limiter and overloads the OPFS wasm
   * worker. On failure the idea-preview text is kept as a fallback.
   */
  private async enrichVerseText(results: SearchResultData[], module: string): Promise<void> {
    if (results.length === 0) return;
    const ids = results.map((r) => r.verseId);
    try {
      const batch = await this.bibleProvider.getVerseTexts(module, ids);
      const verses = batch?.verses ?? {};
      for (const r of results) {
        const v = verses[String(r.verseId)];
        if (v?.text) {
          r.text = v.text;
          r.snippet = v.text_html || v.text;
          r.module = module;
        }
      }
    } catch {
      // Batch lookup failed (e.g. offline) — keep the idea preview as a fallback.
    }
  }

  async strongsSearch(number: string, options?: { includeRelated?: boolean; modules?: string[]; scope?: number; maxResults?: number }): Promise<StrongsSearchResult> {
    // Strong's search always goes to the server
    const params = new URLSearchParams({ number });
    if (options?.includeRelated) params.set('includeRelated', 'true');
    if (options?.modules?.length) params.set('modules', options.modules.join(','));
    if (options?.scope) params.set('scope', String(options.scope));
    if (options?.maxResults) params.set('maxResults', String(options.maxResults));
    const res = await fetch(`${this.baseUrl}/api/search/strongs?${params}`);
    if (!res.ok) throw new Error(`Strong's search failed: ${res.status}`);
    return res.json();
  }

  async warmupSemanticSearch(): Promise<void> {
    // Browser-side search initializes lazily on first query — nothing to warm up
  }

  dispose(): void {
    this.proxy.dispose();
  }
}
