/**
 * Where the search results come from.
 *
 * Verses: the app's own search provider (the one `searchStore` holds) is
 * private to that store, and driving `searchStore.performSearch` would hijack
 * the Study pane's results. So the host registers the provider once
 * (`setVerseSearchProvider(providers.search)` next to `searchStore.init` in
 * main.tsx); until then a plain fetch of the same keyword endpoint is used.
 * Hymns: the same `/api/hymns?q=` the hymn picker uses.
 */

import { API_BASE } from '../../utils/apiUrl';
import type { HymnSearchResponse, HymnSummary } from '../hymns';

export interface VerseHit {
  verseId: number;
  module: string;
  reference: string;
  text: string;
}

/** Structural subset of `ISearchProvider` so tests and hosts can pass anything similar. */
export interface VerseSearchProvider {
  keywordSearch(
    query: string,
    modules: string[],
    options?: { pageSize?: number },
  ): Promise<{ results: Array<{ verseId: number; module: string; reference: string; text: string }> }>;
}

let provider: VerseSearchProvider | null = null;

export function setVerseSearchProvider(p: VerseSearchProvider | null): void {
  provider = p;
}

const VERSE_PAGE = 20;

export async function searchVerses(query: string, module?: string): Promise<VerseHit[]> {
  const modules = module ? [module] : [];
  const set = provider
    ? await provider.keywordSearch(query, modules, { pageSize: VERSE_PAGE })
    : await fetchKeyword(query, modules);
  return set.results.slice(0, VERSE_PAGE).map(r => ({
    verseId: r.verseId, module: r.module, reference: r.reference, text: r.text,
  }));
}

async function fetchKeyword(query: string, modules: string[]) {
  const params = new URLSearchParams({ q: query, pageSize: String(VERSE_PAGE) });
  if (modules.length > 0) params.set('modules', modules.join(','));
  const res = await fetch(`${API_BASE}/api/search/keyword?${params}`);
  if (!res.ok) throw new Error(String(res.status));
  return (await res.json()) as { results: VerseHit[] };
}

export async function searchHymns(query: string): Promise<HymnSummary[]> {
  const res = await fetch(`${API_BASE}/api/hymns?q=${encodeURIComponent(query)}`);
  if (!res.ok) throw new Error(String(res.status));
  return ((await res.json()) as HymnSearchResponse).hymns;
}
