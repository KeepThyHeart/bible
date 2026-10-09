/**
 * Fetch-backed cross-reference graph provider (task 0068). Implements the core
 * `IXrefGraphProvider` over `/api/xref-graph/*`. The two whole-canon indexes are fetched once
 * and kept for the session (the server fingerprints them; a reload picks up new modules).
 */
import { decodeChapterArcs, filterPairs } from '@bible/core/browser';
import type { BookMatrix, ChapterArcs, EgoOptions, IXrefGraphProvider, VerseId, XrefEdge, XrefGraph } from '@bible/core/browser';
import { API_BASE } from '../../utils/apiUrl';

type Fetcher = (url: string) => Promise<Response>;

export class XrefGraphProvider implements IXrefGraphProvider {
  private arcs: Promise<ChapterArcs> | null = null;
  private books: Promise<BookMatrix> | null = null;

  constructor(
    private readonly base: string = `${API_BASE}/api/xref-graph`,
    private readonly fetcher: Fetcher = (url) => fetch(url),
  ) {}

  private async json<T>(path: string): Promise<T> {
    const res = await this.fetcher(`${this.base}${path}`);
    if (!res.ok) throw new Error(`Cross-reference graph request failed (${res.status})`);
    return await res.json() as T;
  }

  getEgoGraph(anchor: VerseId, opts: EgoOptions): Promise<XrefGraph> {
    const q = new URLSearchParams({ depth: String(opts.depth) });
    if (opts.maxNodes !== undefined) q.set('maxNodes', String(opts.maxNodes));
    if (opts.minWeight) q.set('minWeight', String(opts.minWeight));
    if (opts.sources?.length) q.set('sources', opts.sources.join(','));
    return this.json<XrefGraph>(`/ego/${anchor}?${q}`);
  }

  getNeighbours(verseId: VerseId, limit?: number): Promise<XrefEdge[]> {
    return this.json<XrefEdge[]>(`/neighbours/${verseId}${limit ? `?limit=${limit}` : ''}`);
  }

  getBookMatrix(): Promise<BookMatrix> {
    if (!this.books) {
      this.books = this.json<{ books: BookMatrix }>('/books').then(r => r.books);
      this.books.catch(() => { this.books = null; });
    }
    return this.books;
  }

  async getChapterArcs(minWeight = 0): Promise<ChapterArcs> {
    if (!this.arcs) {
      this.arcs = (async () => {
        const res = await this.fetcher(`${this.base}/chapters`);
        if (!res.ok) throw new Error(`Cross-reference graph request failed (${res.status})`);
        return decodeChapterArcs(new Uint8Array(await res.arrayBuffer()), res.headers.get('X-Xref-Fingerprint') ?? '');
      })();
      this.arcs.catch(() => { this.arcs = null; });
    }
    const arcs = await this.arcs;
    return minWeight > 0 ? { ...arcs, pairs: filterPairs(arcs, minWeight) } : arcs;
  }
}

export const xrefGraphProvider = new XrefGraphProvider();
