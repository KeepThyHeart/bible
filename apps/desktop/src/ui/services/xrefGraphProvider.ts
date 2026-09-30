/**
 * IPC-backed cross-reference graph provider (task 0068): implements the core `IXrefGraphProvider`
 * over the `xrefGraph:*` channels. The whole-canon indexes are fetched once per session (the main
 * process fingerprints and caches them; a module install needs a reload to show up here).
 */
import { filterPairs } from '@bible/core/browser';
import type { BookMatrix, ChapterArcs, EgoOptions, IXrefGraphProvider, VerseId, XrefEdge, XrefGraph } from '@bible/core/browser';
import { requireElectronAPI } from './electronAPI';
import { unwrap } from './ipcResult';

type Api = ReturnType<typeof requireElectronAPI>['xrefGraph'];

export class XrefGraphIpcProvider implements IXrefGraphProvider {
  private arcs: Promise<ChapterArcs> | null = null;
  private books: Promise<BookMatrix> | null = null;

  constructor(private readonly api: () => Api = () => requireElectronAPI().xrefGraph) {}

  getEgoGraph(anchor: VerseId, opts: EgoOptions): Promise<XrefGraph> {
    return unwrap(this.api().getEgoGraph(anchor, opts)) as Promise<XrefGraph>;
  }

  getNeighbours(verseId: VerseId, limit?: number): Promise<XrefEdge[]> {
    return unwrap(this.api().getNeighbours(verseId, limit)) as Promise<XrefEdge[]>;
  }

  getBookMatrix(): Promise<BookMatrix> {
    if (!this.books) {
      this.books = unwrap(this.api().getBookMatrix());
      this.books.catch(() => { this.books = null; });
    }
    return this.books;
  }

  async getChapterArcs(minWeight = 0): Promise<ChapterArcs> {
    if (!this.arcs) {
      this.arcs = unwrap(this.api().getChapterArcs()) as Promise<ChapterArcs>;
      this.arcs.catch(() => { this.arcs = null; });
    }
    const arcs = await this.arcs;
    return minWeight > 0 ? { ...arcs, pairs: filterPairs(arcs, minWeight) } : arcs;
  }
}

export const xrefGraphProvider = new XrefGraphIpcProvider();
