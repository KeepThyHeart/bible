/**
 * Occurrence data: bundled, lazy per testament, filtered by chapter and review status.
 */
import type { MeasureOccurrence } from './types';

export interface IMeasureDataSource {
  load(testament: 'ot' | 'nt'): Promise<MeasureOccurrence[]>;
}

const cache = new Map<'ot' | 'nt', Promise<MeasureOccurrence[]>>();

function unwrap(mod: unknown): MeasureOccurrence[] {
  const m = mod as { default?: unknown };
  const list = (m && typeof m === 'object' && 'default' in m ? m.default : mod) as unknown;
  return Array.isArray(list) ? (list as MeasureOccurrence[]) : [];
}

/** The occurrences shipped in core, loaded with a dynamic import (so bundlers split them out) and cached. */
export const bundledMeasureDataSource: IMeasureDataSource = {
  load(testament) {
    let p = cache.get(testament);
    if (!p) {
      p = (testament === 'ot' ? import('./data/occurrences/ot.json') : import('./data/occurrences/nt.json')).then(unwrap);
      p.catch(() => cache.delete(testament));
      cache.set(testament, p);
    }
    return p;
  },
};

export interface LoadChapterOptions {
  /** Include unreviewed (draft) rows. Default false. */
  includeDrafts?: boolean;
  source?: IMeasureDataSource;
}

function ordinalOf(id: string): number {
  return Number(id.slice(id.lastIndexOf('.') + 1)) || 0;
}

/** Occurrences of one chapter (book 1..66, KJV numbering), in verse then ordinal order. */
export async function loadChapterOccurrences(
  book: number, chapter: number, opts: LoadChapterOptions = {},
): Promise<MeasureOccurrence[]> {
  const source = opts.source ?? bundledMeasureDataSource;
  const all = await source.load(book >= 40 ? 'nt' : 'ot');
  const lo = book * 1_000_000 + chapter * 1_000;
  const hi = lo + 999;
  return all
    .filter((o) => o.verseId >= lo && o.verseId <= hi && (opts.includeDrafts || o.review.status !== 'draft'))
    .sort((a, b) => a.verseId - b.verseId || ordinalOf(a.id) - ordinalOf(b.id));
}
