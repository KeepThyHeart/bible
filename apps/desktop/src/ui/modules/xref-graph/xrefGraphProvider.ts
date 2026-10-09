/**
 * IPC-backed cross-reference graph provider (task 0068): implements the core `IXrefGraphProvider`
 * over the `module:xref-graph:*` channels (the module's main-process half). The whole-canon indexes are fetched once per session (the main
 * process fingerprints and caches them; a module install needs a reload to show up here).
 */
import { filterPairs } from '@bible/core/browser';
import type { BookMatrix, ChapterArcs, EgoOptions, IXrefGraphProvider, VerseId, XrefEdge, XrefGraph } from '@bible/core/browser';
import { createModuleClient } from '../../services/moduleClient';
import type { ModuleClient } from '../../services/moduleClient';
import type { XrefGraphApi } from '../../../../electron/modules/xref-graph/types';

type Api = ModuleClient<XrefGraphApi>;

const client = createModuleClient<XrefGraphApi>('xref-graph');

export class XrefGraphIpcProvider implements IXrefGraphProvider {
  private arcs: Promise<ChapterArcs> | null = null;
  private books: Promise<BookMatrix> | null = null;

  constructor(private readonly api: () => Api = () => client) {}

  getEgoGraph(anchor: VerseId, opts: EgoOptions): Promise<XrefGraph> {
    return this.api().getEgoGraph(anchor, opts);
  }

  getNeighbours(verseId: VerseId, limit?: number): Promise<XrefEdge[]> {
    return this.api().getNeighbours(verseId, limit);
  }

  getBookMatrix(): Promise<BookMatrix> {
    if (!this.books) {
      this.books = this.api().getBookMatrix();
      this.books.catch(() => { this.books = null; });
    }
    return this.books;
  }

  async getChapterArcs(minWeight = 0): Promise<ChapterArcs> {
    if (!this.arcs) {
      this.arcs = this.api().getChapterArcs();
      this.arcs.catch(() => { this.arcs = null; });
    }
    const arcs = await this.arcs;
    return minWeight > 0 ? { ...arcs, pairs: filterPairs(arcs, minWeight) } : arcs;
  }
}

export const xrefGraphProvider = new XrefGraphIpcProvider();
