/**
 * The renderer's client for the pre-generated study cache.
 *
 * Three properties are load-bearing and each was a real cost before:
 *
 *  1. **Chapter caching.** Study mode asks per verse; without a chapter-keyed
 *     cache that is one request per verse all over again.
 *  2. **In-flight de-duplication.** Two panes (or a pane and a re-render)
 *     opening the same chapter must produce ONE request, not two.
 *  3. **Graceful degradation.** A missing or stale cache must report itself as
 *     unavailable so every consumer falls back to live queries. The cache is
 *     never a source of truth: a user who installs a module has to see that
 *     module's data, and slower is fine where missing is not.
 */
import { describe, it, expect, vi } from 'vitest';
import { StudyOverviewProvider, type StudyOverviewPayload } from './studyOverviewProvider';

function payload(overrides: Partial<StudyOverviewPayload> = {}): StudyOverviewPayload {
  return {
    available: true,
    sections: ['crossrefs'],
    commentary: [],
    topics: {},
    crossrefs: {},
    entities: {},
    ...overrides,
  };
}

/** John 3:16 with one whole-verse group and one phrase group, in cache shape. */
const JOHN_3_CROSSREFS = {
  '43003016': [
    {
      src: 'TSKxref',
      g: { id: 1, so: 0 },
      e: [{ tv: 45005008, so: 0 }],
    },
    {
      src: 'TSKxref',
      g: { id: 2, ph: 'loved.', so: 1 },
      e: [{ tv: 62004009, tve: 62004010, so: 0 }],
    },
  ],
};

describe('StudyOverviewProvider', () => {
  it('fetches a chapter once and answers every later verse from memory', async () => {
    const fetcher = vi.fn().mockResolvedValue(payload({ crossrefs: JOHN_3_CROSSREFS }));
    const provider = new StudyOverviewProvider(fetcher);

    await provider.loadChapter(43, 3);
    await provider.loadChapter(43, 3);
    await provider.loadChapter(43, 3);

    expect(fetcher).toHaveBeenCalledTimes(1);
    expect(provider.hasChapter(43, 3)).toBe(true);
    // Every verse of the chapter is served from that one reply.
    expect(provider.getCrossRefsForVerse(43, 3, 43003016)).toHaveLength(2);
    expect(provider.getCrossRefsForVerse(43, 3, 43003017)).toHaveLength(0);
    expect(fetcher).toHaveBeenCalledTimes(1);
  });

  it('keeps chapters apart', async () => {
    const fetcher = vi.fn().mockResolvedValue(payload());
    const provider = new StudyOverviewProvider(fetcher);

    await provider.loadChapter(43, 3);
    await provider.loadChapter(43, 4);

    expect(fetcher).toHaveBeenCalledTimes(2);
    expect(fetcher).toHaveBeenNthCalledWith(1, 43, 3);
    expect(fetcher).toHaveBeenNthCalledWith(2, 43, 4);
  });

  it('de-duplicates concurrent loads of the same chapter into one request', async () => {
    let release: (value: StudyOverviewPayload) => void = () => {};
    const fetcher = vi.fn().mockReturnValue(
      new Promise<StudyOverviewPayload>(resolve => {
        release = resolve;
      })
    );
    const provider = new StudyOverviewProvider(fetcher);

    // Three panes opening the same chapter in the same tick.
    const all = Promise.all([
      provider.loadChapter(43, 3),
      provider.loadChapter(43, 3),
      provider.loadChapter(43, 3),
    ]);
    expect(fetcher).toHaveBeenCalledTimes(1);

    release(payload({ crossrefs: JOHN_3_CROSSREFS }));
    await all;

    expect(fetcher).toHaveBeenCalledTimes(1);
    expect(provider.getCrossRefsForVerse(43, 3, 43003016)).toHaveLength(2);
  });

  describe('re-inflating cached cross-references', () => {
    it('produces the same shape the live xref IPC returns', async () => {
      const provider = new StudyOverviewProvider(
        vi.fn().mockResolvedValue(payload({ crossrefs: JOHN_3_CROSSREFS }))
      );
      await provider.loadChapter(43, 3);

      const [whole, phrase] = provider.getCrossRefsForVerse(43, 3, 43003016);
      // Whole-verse group first: `ph` is omitted, not null, in the wire format.
      expect(whole.group.phrase).toBeUndefined();
      expect(whole.group.group_id).toBe(1);
      expect(whole.entries).toEqual([
        { entry_id: 0, target_verse_id: 45005008, target_verse_end_id: null, note: undefined },
      ]);

      expect(phrase.group.phrase).toBe('loved.');
      expect(phrase.entries[0].target_verse_end_id).toBe(62004010);
      // The source module is carried through so a multi-module chapter can be
      // split back into per-module rows.
      expect(phrase.source).toBe('TSKxref');
    });
  });

  describe('fallback', () => {
    it('reports unavailable and caches nothing when the fingerprint no longer matches', async () => {
      // A stale cache (the user installed a module since generation) is
      // reported by the main process as `available: false`.
      const fetcher = vi.fn().mockResolvedValue(payload({ available: false }));
      const provider = new StudyOverviewProvider(fetcher);

      await provider.loadChapter(43, 3);

      expect(provider.isAvailable()).toBe(false);
      expect(provider.hasChapter(43, 3)).toBe(false);
      // The consumer's live-query fallback has to see "no data here", not a
      // silently empty chapter that looks like "this verse has no references".
      expect(provider.getCrossRefsForVerse(43, 3, 43003016)).toEqual([]);
    });

    it('stops asking once the cache is known to be unusable', async () => {
      const fetcher = vi.fn().mockResolvedValue(payload({ available: false }));
      const provider = new StudyOverviewProvider(fetcher);

      await provider.loadChapter(43, 3);
      await provider.loadChapter(43, 4);
      await provider.loadChapter(1, 1);

      // One wasted round trip, not one per navigation for the rest of the
      // session - the main process decides availability once per process.
      expect(fetcher).toHaveBeenCalledTimes(1);
    });

    it('treats a failed request as no cache rather than propagating', async () => {
      const fetcher = vi.fn().mockRejectedValue(new Error('ipc exploded'));
      const provider = new StudyOverviewProvider(fetcher);

      await expect(provider.loadChapter(43, 3)).resolves.toBeUndefined();
      expect(provider.isAvailable()).toBe(false);
      expect(provider.hasChapter(43, 3)).toBe(false);
    });
  });

  it('reports which sections the payload actually carries', async () => {
    const provider = new StudyOverviewProvider(
      vi.fn().mockResolvedValue(payload({ sections: ['crossrefs'], crossrefs: JOHN_3_CROSSREFS }))
    );
    await provider.loadChapter(43, 3);

    // Only `crossrefs` is computed (see CACHED_SECTIONS in the main process).
    // A consumer wanting another section has to widen that constant; the marker
    // is what stops it silently reading an uncomputed field as empty.
    expect(provider.sectionsFor(43, 3)).toEqual(['crossrefs']);
  });
});
