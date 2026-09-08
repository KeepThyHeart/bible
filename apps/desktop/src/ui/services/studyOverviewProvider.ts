/**
 * Study Overview Provider (renderer)
 *
 * Fetches the pre-generated per-chapter study overview in a single IPC call
 * and then answers per-verse questions from memory. Mirrors the web app's
 * `apps/web/src/providers/StudyOverviewProvider.ts`, over `study:getOverview`
 * instead of an HTTP route.
 *
 * The cache it reads is pre-generated into
 * `apps/desktop/data/cache/study-cache.db`. It may be absent (a build that
 * never generated it) or stale (the user installed a module after generation),
 * and the main process reports either as `available: false`. **Every consumer
 * must have a live-query fallback** - see `StudyCacheService` for why
 * invalidation is wholesale rather than per module.
 */

import type {
  ChapterCommentaryOverview,
  TopicsByVerse,
  CrossRefsByVerse,
  EntitiesByVerse,
} from '@bible/core';
import { unwrap } from './ipcResult';

/** The payload `study:getOverview` replies with. */
export interface StudyOverviewPayload {
  available: boolean;
  /**
   * The sections this payload actually carries, from the main process's
   * `CACHED_SECTIONS`. A field whose section is absent here was **not
   * computed** - which is not the same fact as "computed and empty", and is why
   * this provider exposes a getter only for the sections that are cached.
   */
  sections?: string[];
  commentary: ChapterCommentaryOverview;
  topics: TopicsByVerse;
  crossrefs: CrossRefsByVerse;
  entities: EntitiesByVerse;
}

/**
 * One phrase group with its entries, in the shape `xref:getGroupsForVerse` and
 * `xref:getGroupsForRange` return.
 *
 * The provider re-inflates the cache's compact `{g, e}` records into this shape
 * so Study mode's renderer cannot tell which source it is reading - the cached
 * path and the live path are interchangeable at the call site.
 */
export interface XrefGroupWithEntries {
  group: {
    group_id?: number;
    verse_id?: number;
    verse_id_end?: number;
    phrase?: string;
    sort_order?: number;
  };
  entries: Array<{
    entry_id?: number;
    target_verse_id: number;
    target_verse_end_id?: number | null;
    note?: string;
  }>;
  /** Source module abbreviation, present on cache-backed groups. */
  source?: string;
}

interface ChapterEntry {
  payload: StudyOverviewPayload;
}

/** Injectable transport, so tests do not need a fake `window.electron`. */
export type StudyOverviewFetcher = (book: number, chapter: number) => Promise<StudyOverviewPayload>;

const UNAVAILABLE: StudyOverviewPayload = {
  available: false,
  commentary: [],
  topics: {},
  crossrefs: {},
  entities: {},
};

async function ipcFetcher(book: number, chapter: number): Promise<StudyOverviewPayload> {
  return unwrap<StudyOverviewPayload>(window.electron.study.getOverview(book, chapter));
}

export class StudyOverviewProvider {
  private cache = new Map<string, ChapterEntry>();
  /** In-flight loads, keyed the same way, so N mounts cause ONE request. */
  private pending = new Map<string, Promise<void>>();
  /**
   * Set once the main process reports the cache is unusable. Stops every
   * further request for the life of the session - a missing or stale cache
   * cannot become usable without a restart (the fingerprint check runs once
   * per process), and re-asking per chapter would add a wasted round trip to
   * every navigation.
   */
  private unavailable = false;

  constructor(private fetcher: StudyOverviewFetcher = ipcFetcher) {}

  private key(book: number, chapter: number): string {
    return `${book}-${chapter}`;
  }

  /**
   * Ensure the chapter's overview is loaded. Resolves immediately when it is
   * already cached, when a load for the same chapter is already in flight
   * (returning that same promise), or when the cache is known to be
   * unavailable.
   */
  async loadChapter(book: number, chapter: number): Promise<void> {
    if (this.unavailable) return;
    const key = this.key(book, chapter);
    if (this.cache.has(key)) return;

    const inFlight = this.pending.get(key);
    if (inFlight) return inFlight;

    const promise = this.fetchChapter(book, chapter, key);
    this.pending.set(key, promise);
    try {
      await promise;
    } finally {
      this.pending.delete(key);
    }
  }

  private async fetchChapter(book: number, chapter: number, key: string): Promise<void> {
    try {
      const payload = await this.fetcher(book, chapter);
      if (!payload.available) {
        // Missing or stale cache: remember it and let every consumer fall back.
        this.unavailable = true;
        return;
      }
      this.cache.set(key, { payload });
    } catch {
      // A failed read is indistinguishable from no cache at the call site, and
      // the fallback is always correct. Swallow rather than propagate so one
      // bad chapter cannot break the pane.
      this.unavailable = true;
    }
  }

  /** Whether this chapter's overview is in memory. */
  hasChapter(book: number, chapter: number): boolean {
    return this.cache.has(this.key(book, chapter));
  }

  /** False once the main process has reported the cache unusable. */
  isAvailable(): boolean {
    return !this.unavailable;
  }

  private payload(book: number, chapter: number): StudyOverviewPayload {
    return this.cache.get(this.key(book, chapter))?.payload ?? UNAVAILABLE;
  }

  /**
   * Cross-reference phrase groups for one verse, re-inflated into the shape the
   * live `xref:*` IPC returns.
   *
   * Groups are ordered whole-verse first, then by `sort_order`, matching what
   * `CrossReferenceRepository.getGroupsForVerse` yields per verse.
   */
  getCrossRefsForVerse(book: number, chapter: number, verseId: number): XrefGroupWithEntries[] {
    const groups = this.payload(book, chapter).crossrefs[String(verseId)];
    if (!groups) return [];

    return groups
      .map(block => ({
        group: {
          group_id: block.g.id,
          verse_id: verseId,
          verse_id_end: verseId,
          // `ph` is omitted (not null) when the group is whole-verse - see the
          // wire-format note in `@bible/core`'s StudyOverview types.
          phrase: block.g.ph,
          sort_order: block.g.so,
        },
        entries: block.e.map((entry, index) => ({
          // The cache does not store entry ids; the index is stable within a
          // group and is only used as a React key.
          entry_id: index,
          target_verse_id: entry.tv,
          target_verse_end_id: entry.tve ?? null,
          note: entry.n,
        })),
        source: block.src,
      }))
      .sort((a, b) => (a.group.sort_order ?? 0) - (b.group.sort_order ?? 0));
  }

  /**
   * Which sections the loaded chapter actually carries.
   *
   * Only `crossrefs` is computed today (see `CACHED_SECTIONS` in the main
   * process). Adding a getter for another section means widening that constant
   * as well - otherwise the getter would report an empty result for data that
   * was never computed.
   */
  sectionsFor(book: number, chapter: number): string[] {
    return this.payload(book, chapter).sections ?? [];
  }

  /** Drop everything. Tests only - the cache is otherwise session-lived. */
  reset(): void {
    this.cache.clear();
    this.pending.clear();
    this.unavailable = false;
  }
}

/**
 * Session-wide singleton. Chapter data is identical for every pane, so a
 * second Study pane on the same chapter costs nothing.
 */
export const studyOverviewProvider = new StudyOverviewProvider();
