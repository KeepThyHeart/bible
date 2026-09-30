/**
 * Cross-reference graph: shared types (task 0068).
 *
 * Pure type declarations, safe for the browser barrel. See `docs/features/xref-graph.md`.
 */
import type { VerseId } from '../../Data/Core/Types';

/** A verse in the graph. A range target is represented by its first verse; `endVerseId` keeps the range. */
export interface XrefNode {
  verseId: VerseId;
  /** Inclusive end when the linked passage is a range (11.6% of TSK links are). */
  endVerseId?: VerseId;
  /** Hops from the anchor (0 for the anchor itself). */
  hop: number;
  /** Number of distinct verses this verse is linked to, either way. */
  degree: number;
}

export type XrefDirection = 'out' | 'in' | 'both';

export interface XrefEdge {
  from: VerseId;
  to: VerseId;
  /** 0..1, see {@link edgeWeight}. */
  weight: number;
  /** Abbreviations of the modules (or `user`) that contain the link. */
  sources: string[];
  /** `out`: `from` cites `to`; `in`: `to` cites `from`; `both`: each cites the other. */
  direction: XrefDirection;
  /** TSK phrase the link hangs off, when there is one. */
  phrase?: string;
  /** Inclusive end of `to` when it is a passage. */
  toEnd?: VerseId;
}

export interface XrefGraph {
  anchor: VerseId;
  nodes: XrefNode[];
  edges: XrefEdge[];
  /** True when the node budget or the weight floor left out linked verses. */
  truncated: boolean;
}

export interface EgoOptions {
  depth: 1 | 2 | 3;
  /** Node budget including the anchor. Default 60, max 200. */
  maxNodes?: number;
  /** Drop edges lighter than this (0..1). */
  minWeight?: number;
  /** Restrict to these module abbreviations (`user` is the user's own links). */
  sources?: string[];
  /** Include the user's own cross-references. Default true. */
  includeUser?: boolean;
}

export const DEFAULT_EGO_DEPTH = 2;
export const DEFAULT_EGO_NODES = 60;
export const MAX_EGO_NODES = 200;

/** Packed chapter-pair index: `[a, b, weightx1000, count] * n`, chapter indexes 0..1188, a < b. */
export interface ChapterArcs {
  chapterCount: number;
  pairs: Uint32Array;
  /** Per chapter: total linked-verse weight x1000 (both ends), for sizing and labels. */
  chapterTotals: Uint32Array;
  fingerprint: string;
}

/** 66 x 66, symmetric, entry = summed link weight between two books (diagonal = within a book). */
export type BookMatrix = number[][];

/** Per-verse degree: out, in, and weighted degree x1000. Sorted by verse id. */
export interface VerseDegrees {
  verseIds: Uint32Array;
  out: Uint32Array;
  in: Uint32Array;
  weighted: Uint32Array;
}

export interface XrefGraphIndex {
  fingerprint: string;
  arcs: ChapterArcs;
  books: BookMatrix;
  degrees: VerseDegrees;
  /** Total number of links scanned. */
  linkCount: number;
}

/** Data source the views talk to. Web implements it over fetch, desktop over IPC. */
export interface IXrefGraphProvider {
  getEgoGraph(anchor: VerseId, opts: EgoOptions): Promise<XrefGraph>;
  /** Ranked neighbours, strongest first, for the hopper. */
  getNeighbours(verseId: VerseId, limit?: number): Promise<XrefEdge[]>;
  /** Chapter pairs at or above a weight floor (0..1 of the heaviest pair). */
  getChapterArcs(minWeight?: number): Promise<ChapterArcs>;
  getBookMatrix(): Promise<BookMatrix>;
}

/** One link's evidence, from one source, as {@link edgeWeight} needs it. */
export interface EdgeEvidenceItem {
  source: string;
  /** `ranked`: position in an ordered list (TSK). `votes`: community votes. `user`: the user's own link. */
  kind: 'ranked' | 'votes' | 'user';
  /** 0-based position in the phrase group, for `ranked`. */
  rank?: number;
  votes?: number;
  maxVotes?: number;
}

export interface EdgeEvidence {
  items: EdgeEvidenceItem[];
  /** Both A to B and B to A exist. */
  reciprocal: boolean;
  /** Per-source multiplier, default 1. */
  trust?: Record<string, number>;
}
