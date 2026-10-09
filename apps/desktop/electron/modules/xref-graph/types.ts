/**
 * The Cross-ref graph module's main-process API, shared by `./index.ts` (implements it through
 * `ipc.handle`) and the renderer's `createModuleClient<XrefGraphApi>('xref-graph')`.
 */
import type { BookMatrix, ChapterArcs, EgoOptions, VerseId, XrefEdge, XrefGraph } from '@bible/core/browser';

export interface XrefGraphApi {
  getEgoGraph(anchor: VerseId, opts: EgoOptions): XrefGraph;
  getNeighbours(verseId: VerseId, limit?: number): XrefEdge[];
  getBookMatrix(): BookMatrix;
  getChapterArcs(): ChapterArcs;
}
