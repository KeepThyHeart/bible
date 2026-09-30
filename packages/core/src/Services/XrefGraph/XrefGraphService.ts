/**
 * Ego graphs and ranked neighbours from the installed cross-reference modules and the
 * user's own links (task 0068). Node-side: it needs repositories. The walk itself is
 * the pure {@link buildEgoGraph}, so the same logic is testable without a database.
 */
import type { VerseId } from '../../Data/Core/Types';
import type { ICrossReferenceRepository } from '../../Data/Repositories/ICrossReferenceRepository';
import type { IUserCrossReferenceRepository } from '../../Data/Repositories/IUserCrossReferenceRepository';
import type { AggregationModule } from '../StudyOverview/types';
import { edgeWeight } from './edgeWeight';
import { buildEgoGraph } from './egoGraph';
import type { NeighbourFilter } from './egoGraph';
import type { EdgeEvidenceItem, EgoOptions, XrefDirection, XrefEdge, XrefGraph } from './types';

/** Source name for the user's own cross-references. */
export const USER_SOURCE = 'user';

/**
 * A reverse lookup says where a link comes from but not where it sat in its phrase group,
 * so incoming-only links are ranked as "middling" (rank 2, base weight 0.77).
 */
export const UNKNOWN_RANK = 2;

interface Acc {
  toEnd?: VerseId;
  phrase?: string;
  out: boolean;
  in: boolean;
  /** One evidence item per source (best rank wins). */
  items: Map<string, EdgeEvidenceItem>;
}

export class XrefGraphService {
  constructor(
    private readonly modules: AggregationModule<ICrossReferenceRepository>[],
    private readonly userXrefs?: IUserCrossReferenceRepository,
  ) {}

  /** Abbreviations of the modules that can contribute, plus `user` when there is a user repository. */
  getSources(): string[] {
    const out = this.modules.map(m => m.abbreviation);
    if (this.userXrefs) out.push(USER_SOURCE);
    return out;
  }

  /** Ranked neighbours of one verse, strongest first. `from` is always `verseId`. */
  getNeighbours(verseId: VerseId, limit?: number, filter: NeighbourFilter = {}): XrefEdge[] {
    const acc = new Map<VerseId, Acc>();
    const wanted = filter.sources && new Set(filter.sources.map(s => s.toLowerCase()));

    const touch = (other: VerseId, source: string, item: EdgeEvidenceItem, dir: 'out' | 'in', toEnd?: VerseId, phrase?: string) => {
      let a = acc.get(other);
      if (!a) { a = { out: false, in: false, items: new Map() }; acc.set(other, a); }
      if (dir === 'out') {
        a.out = true;
        if (toEnd !== undefined && toEnd > other && (a.toEnd === undefined || toEnd > a.toEnd)) a.toEnd = toEnd;
        if (phrase && !a.phrase) a.phrase = phrase;
      } else {
        a.in = true;
        if (phrase && !a.phrase) a.phrase = phrase;
      }
      const prev = a.items.get(source);
      if (!prev || (item.rank ?? 0) < (prev.rank ?? 0)) a.items.set(source, item);
    };

    for (const mod of this.modules) {
      if (wanted && !wanted.has(mod.abbreviation.toLowerCase())) continue;
      const src = mod.abbreviation;
      for (const { group, entries } of mod.repository.getGroupsWithEntries(verseId)) {
        entries.forEach((e, i) => {
          const end = e.targetVerseEndId ?? e.targetVerseId;
          if (verseId >= e.targetVerseId && verseId <= end) return; // link back into itself
          touch(e.targetVerseId, src, { source: src, kind: 'ranked', rank: i }, 'out', end, group.phrase);
        });
      }
      for (const r of mod.repository.getReverseReferences(verseId)) {
        if (r.sourceVerseId === verseId) continue;
        touch(r.sourceVerseId, src, { source: src, kind: 'ranked', rank: UNKNOWN_RANK }, 'in', undefined, r.phrase);
      }
    }

    if (this.userXrefs && (filter.includeUser ?? true) && (!wanted || wanted.has(USER_SOURCE))) {
      const item: EdgeEvidenceItem = { source: USER_SOURCE, kind: 'user' };
      for (const x of this.userXrefs.getFromVerse(verseId)) {
        if (verseId >= x.toVerseIdStart && verseId <= x.toVerseIdEnd) continue;
        touch(x.toVerseIdStart, USER_SOURCE, item, 'out', x.toVerseIdEnd);
      }
      for (const x of this.userXrefs.getToVerse(verseId)) {
        if (verseId >= x.fromVerseIdStart && verseId <= x.fromVerseIdEnd) continue;
        touch(x.fromVerseIdStart, USER_SOURCE, item, 'in');
      }
    }

    const edges: XrefEdge[] = [];
    for (const [other, a] of acc) {
      const items = [...a.items.values()];
      const weight = edgeWeight({ items, reciprocal: a.out && a.in });
      if (weight <= 0) continue;
      const direction: XrefDirection = a.out && a.in ? 'both' : a.out ? 'out' : 'in';
      edges.push({
        from: verseId,
        to: other,
        weight,
        sources: items.map(i => i.source).sort(),
        direction,
        ...(a.phrase ? { phrase: a.phrase } : {}),
        ...(a.toEnd !== undefined ? { toEnd: a.toEnd } : {}),
      });
    }
    edges.sort((x, y) => y.weight - x.weight || x.to - y.to);
    return limit !== undefined ? edges.slice(0, limit) : edges;
  }

  getEgoGraph(anchor: VerseId, opts: EgoOptions): XrefGraph {
    return buildEgoGraph(anchor, opts, (v, f) => this.getNeighbours(v, undefined, f));
  }
}
