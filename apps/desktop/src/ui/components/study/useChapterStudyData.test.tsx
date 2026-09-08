/**
 * The one chapter-wide load Study mode uses instead of a per-verse fan-out.
 *
 * ## The number this file exists to hold down
 *
 * A per-verse fan-out would issue, for a 31-verse chapter with one
 * cross-reference module installed:
 *
 *   xref:getAvailable            1   (StudyModeView's cross-reference effect)
 *   xref:getGroupsForVerse      31   (per verse, per module)
 *   study:getVerseLinks         31   (per verse, from VerseLinksDisplay)
 *   xref:getAvailable           31   (again, per verse, from VerseLinksDisplay)
 *   xref:getReverseReferences   31   (per verse, per module - the removed
 *                                     "Cited in" section's data)
 *   bible:getInterlinear...        1   (per chapter - already batched)
 *   ------------------------------
 *                              126
 *
 * and every one of those `study:getVerseLinks` calls would fan out in the
 * main process across 24 commentary modules and 26 book modules - roughly
 * 2,300 SQL statements for one chapter. Worse, issuing them from inside the
 * subtree the interlinear loading gate unmounts would make toggling
 * Interlinear re-run ~90 of them.
 *
 * The tests below assert the round-trip budget directly, so a future change
 * that reintroduces a per-verse call fails here rather than being noticed as
 * "the pane feels slow".
 */
import React from 'react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';

import { useChapterStudyData } from './useChapterStudyData';
import { StudyOverviewProvider, type StudyOverviewPayload } from '../../services/studyOverviewProvider';

/** John 3:14-18 - five verses is enough to prove nothing is per-verse. */
const VERSE_IDS = [43003014, 43003015, 43003016, 43003017, 43003018];

/** Minimal `Result<T>` envelope, as the preload layer returns. */
function ok<T>(value: T) {
  return Promise.resolve({ ok: true as const, value });
}

interface Calls {
  getAvailable: number;
  getGroupsForRange: number;
  getGroupsForVerse: number;
  getReverseReferencesForRange: number;
  getReverseReferences: number;
  getBatchVerseLinks: number;
  getVerseLinks: number;
  getOverview: number;
  total(): number;
}

let calls: Calls;

function newCalls(): Calls {
  return {
    getAvailable: 0,
    getGroupsForRange: 0,
    getGroupsForVerse: 0,
    getReverseReferencesForRange: 0,
    getReverseReferences: 0,
    getBatchVerseLinks: 0,
    getVerseLinks: 0,
    getOverview: 0,
    total(): number {
      return (
        this.getAvailable +
        this.getGroupsForRange +
        this.getGroupsForVerse +
        this.getReverseReferencesForRange +
        this.getReverseReferences +
        this.getBatchVerseLinks +
        this.getVerseLinks +
        this.getOverview
      );
    },
  };
}

const TSK_RANGE_GROUPS = [
  {
    group: { group_id: 1, verse_id: 43003016, verse_id_end: 43003016, phrase: 'loved.', sort_order: 0 },
    entries: [{ entry_id: 1, target_verse_id: 45005008, target_verse_end_id: null }],
  },
  {
    group: { group_id: 2, verse_id: 43003017, verse_id_end: 43003017, sort_order: 0 },
    entries: [{ entry_id: 2, target_verse_id: 62004009, target_verse_end_id: 62004010 }],
  },
];

function installElectron(options: { overview?: StudyOverviewPayload } = {}): void {
  Object.assign(window.electron, {
    crossReference: {
      getAvailable: () => {
        calls.getAvailable++;
        return ok([{ abbreviation: 'TSKxref', name: 'Treasury of Scripture Knowledge' }]);
      },
      getGroupsForRange: () => {
        calls.getGroupsForRange++;
        return ok(TSK_RANGE_GROUPS);
      },
      getGroupsForVerse: () => {
        calls.getGroupsForVerse++;
        return ok([]);
      },
      getReverseReferencesForRange: () => {
        calls.getReverseReferencesForRange++;
        return ok([
          // Two modules' worth of the same citation would de-duplicate; here
          // one row covers a RANGE of target verses, which must fan out to
          // each verse in it.
          { source_verse_id: 45005008, target_verse_id_start: 43003016, target_verse_id_end: 43003017 },
          { source_verse_id: 45005008, target_verse_id_start: 43003016, target_verse_id_end: 43003016 },
          { source_verse_id: 19023001, target_verse_id_start: 43003016, target_verse_id_end: 43003016 },
        ]);
      },
      getReverseReferences: () => {
        calls.getReverseReferences++;
        return ok([]);
      },
    },
    study: {
      getBatchVerseLinks: (verseIds: number[]) => {
        calls.getBatchVerseLinks++;
        const result: Record<number, unknown> = {};
        for (const id of verseIds) {
          result[id] = {
            verseId: id,
            commentaries: { direct: [], mentions: [] },
            crossReferences: { modules: [] },
            books: [],
            userContent: { notes: [], journals: [] },
            userRefCount: id === 43003016 ? 2 : 0,
          };
        }
        return ok(result);
      },
      getVerseLinks: () => {
        calls.getVerseLinks++;
        return ok(null);
      },
      getOverview: () => {
        calls.getOverview++;
        return ok(options.overview ?? { available: false, commentary: [], topics: {}, crossrefs: {}, entities: {} });
      },
    },
  });
}

/** Renders the hook and exposes its result as inspectable DOM. */
const Probe: React.FC<{ provider: StudyOverviewProvider; showCrossRefs?: boolean }> = ({
  provider,
  showCrossRefs = true,
}) => {
  const data = useChapterStudyData(VERSE_IDS, 43, 3, showCrossRefs, provider);
  if (!data.resolved) return <div data-testid="pending" />;
  return (
    <div
      data-testid="resolved"
      data-xref-modules={JSON.stringify(
        VERSE_IDS.map(id => (data.crossRefsByVerse.get(id) ?? []).length)
      )}
      data-phrases={JSON.stringify(
        (data.crossRefsByVerse.get(43003016) ?? []).flatMap(m => m.groups.map(g => g.phrase ?? null))
      )}
      data-user-refs={String(data.linksByVerse.get(43003016)?.userRefCount ?? -1)}
    />
  );
};

/**
 * A provider with an empty cache, using its DEFAULT transport so the
 * `study:getOverview` bridge stub above sees (and counts) the call.
 */
function freshProvider(): StudyOverviewProvider {
  return new StudyOverviewProvider();
}

describe('useChapterStudyData', () => {
  beforeEach(() => {
    calls = newCalls();
  });

  describe('IPC round trips per chapter', () => {
    /**
     * `study:getOverview` answers from the study cache when it has the chapter
     * and computes it on the spot when it does not, so the renderer's round
     * trip count is the SAME cold and warm - the difference between them is
     * main-process latency, not traffic. Both are asserted, because it would be
     * easy to reintroduce a renderer-side "is it cached?" probe.
     */
    const OVERVIEW = {
      available: true,
      commentary: [],
      topics: {},
      entities: {},
      crossrefs: {
        '43003016': [{ src: 'TSKxref', g: { id: 1, ph: 'loved.', so: 0 }, e: [{ tv: 45005008, so: 0 }] }],
      },
    };

    it('loads a whole chapter in three calls, none of them per verse', async () => {
      installElectron({ overview: OVERVIEW });
      render(<Probe provider={freshProvider()} />);
      const el = await screen.findByTestId('resolved');

      // 1 getAvailable + 1 getOverview + 1 getBatchVerseLinks = 3.
      expect(calls.total()).toBe(3);
      expect(calls.getGroupsForRange).toBe(0);
      // The reverse lookup is gone with the "Cited in" section it fed.
      expect(calls.getReverseReferencesForRange).toBe(0);
      // Nothing scales with the verse count.
      expect(calls.getGroupsForVerse).toBe(0);
      expect(calls.getReverseReferences).toBe(0);
      expect(calls.getVerseLinks).toBe(0);
      // The redundant second module list is gone: exactly one getAvailable.
      expect(calls.getAvailable).toBe(1);
      // ...and the data came through, phrase intact.
      expect(el.getAttribute('data-phrases')).toBe('["loved."]');
    });

    it('costs the same on a cold cache, because the main process computes the miss', async () => {
      // Whether the main process read this from its cache file or aggregated it
      // just now is invisible here - which is the design.
      installElectron({ overview: { ...OVERVIEW } });
      render(<Probe provider={freshProvider()} />);
      await screen.findByTestId('resolved');
      expect(calls.total()).toBe(3);
    });

    it('adds one call only when the main process cannot produce the chapter', async () => {
      // No cross-reference module installed, or the aggregation threw: the
      // renderer falls back to reading the modules itself.
      installElectron();
      render(<Probe provider={freshProvider()} />);
      await screen.findByTestId('resolved');

      expect(calls.getGroupsForRange).toBe(1);
      expect(calls.total()).toBe(4);
    });

    it('skips the cross-reference sources entirely when the toggle is off', async () => {
      installElectron();
      render(<Probe provider={freshProvider()} showCrossRefs={false} />);
      await screen.findByTestId('resolved');

      // Only the verse links remain.
      expect(calls.total()).toBe(1);
      expect(calls.getBatchVerseLinks).toBe(1);
    });
  });

  describe('falling back to live queries', () => {
    it('reads the range IPC when the cache reports itself unavailable', async () => {
      installElectron(); // getOverview replies { available: false }
      render(<Probe provider={freshProvider()} />);
      const el = await screen.findByTestId('resolved');

      expect(calls.getGroupsForRange).toBe(1);
      // The live groups are attributed to the verse each group anchors on -
      // John 3:16 gets one module, 3:17 gets one, the rest get none.
      expect(el.getAttribute('data-xref-modules')).toBe('[0,0,1,1,0]');
      expect(el.getAttribute('data-phrases')).toBe('["loved."]');
    });

    it('still resolves, un-adorned, when every source fails', async () => {
      Object.assign(window.electron, {
        crossReference: {
          getAvailable: () => Promise.reject(new Error('boom')),
          getGroupsForRange: () => Promise.reject(new Error('boom')),
          getReverseReferencesForRange: () => Promise.reject(new Error('boom')),
        },
        study: {
          getBatchVerseLinks: () => Promise.reject(new Error('boom')),
          getOverview: () => Promise.reject(new Error('boom')),
        },
      });
      vi.spyOn(console, 'error').mockImplementation(() => {});

      render(<Probe provider={freshProvider()} />);
      // Resolved either way: a failed load must let the verses paint, not
      // leave the chapter blank forever.
      const el = await screen.findByTestId('resolved');
      expect(el.getAttribute('data-user-refs')).toBe('-1');
    });
  });

  describe('per-verse attribution', () => {
    it('hands each verse its own links from the one batch reply', async () => {
      installElectron();
      render(<Probe provider={freshProvider()} />);
      const el = await screen.findByTestId('resolved');
      expect(el.getAttribute('data-user-refs')).toBe('2');
    });
  });

  describe('the single-load gate', () => {
    it('reports pending until every source has answered', async () => {
      let releaseLinks: (value: unknown) => void = () => {};
      installElectron();
      Object.assign(window.electron.study, {
        getBatchVerseLinks: () => {
          calls.getBatchVerseLinks++;
          return new Promise(resolve => {
            releaseLinks = resolve;
          });
        },
      });

      render(<Probe provider={freshProvider()} />);
      // Cross-references have landed but verse links have not: the caller must
      // still withhold the verses, or it paints them and then adorns them.
      await waitFor(() => expect(calls.getGroupsForRange).toBe(1));
      expect(screen.getByTestId('pending')).toBeInTheDocument();

      releaseLinks({ ok: true, value: {} });
      await screen.findByTestId('resolved');
    });
  });
});
