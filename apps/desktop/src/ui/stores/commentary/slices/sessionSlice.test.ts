/**
 * FIX 3 (commentary side) - same "flashes the empty state during restore" bug
 * as the Bible pane. restoreFromSession published openTabs synchronously but
 * only ever set loadingByTab to `false` (once batchRestoreSession resolved),
 * never `true` - so `|| false` defaults made "restore in flight" and
 * "genuinely no commentary for this verse" indistinguishable, and
 * CommentaryContentArea rendered its "no commentary" empty state during the
 * IPC round trip.
 *
 * loadingByTab is now seeded true for every restored tab in the same
 * synchronous update that publishes openTabs.
 */
import { describe, it, expect, beforeEach, vi } from 'vitest';

vi.mock('../../../services/electronAPI', () => ({
  commentaryAPI: {
    getAvailableCommentaries: vi.fn().mockResolvedValue([]),
    getEntriesForVerse: vi.fn().mockResolvedValue([]),
    batchRestoreSession: vi.fn(),
  },
}));

vi.mock('../../helpers/sessionNotifier', () => ({
  markSessionDirty: vi.fn(),
}));

import { useCommentaryStore } from '../../useCommentaryStore';
import { commentaryAPI } from '../../../services/electronAPI';

const PANEL = 'commentary_session_restore_test_panel';
const MHC_TAB = { abbreviation: 'MHC', name: 'Matthew Henry' };

function panelState() {
  return useCommentaryStore.getState().getPanelState(PANEL);
}

describe('commentary sessionSlice.restoreFromSession — loadingByTab seeding', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    useCommentaryStore.setState({ panels: new Map() });
  });

  it('seeds loadingByTab true for every restored tab before batchRestoreSession resolves', async () => {
    let resolveBatch!: (value: {
      availableCommentaries: unknown[];
      entriesByTab: Record<string, unknown[]>;
      summariesByTab: Record<string, unknown[]>;
    }) => void;
    vi.mocked(commentaryAPI.batchRestoreSession).mockReturnValue(
      new Promise((resolve) => { resolveBatch = resolve; }),
    );

    const restorePromise = useCommentaryStore.getState().restoreFromSession(PANEL, {
      openTabs: [MHC_TAB],
      activeTabIndex: 0,
      currentVerseId: 43003016,
    });

    // Let the synchronous portion (openTabs publish + loadingByTab seed) run,
    // before batchRestoreSession's IPC round trip resolves.
    await Promise.resolve();
    await Promise.resolve();

    const psDuringRestore = panelState();
    expect(psDuringRestore.openTabs).toEqual([MHC_TAB]);
    expect(psDuringRestore.loadingByTab.get('MHC')).toBe(true);

    resolveBatch({
      availableCommentaries: [],
      entriesByTab: { MHC: [{ entry_id: 1, entry_level: 'verse', content: 'text' }] },
      summariesByTab: {},
    });
    await restorePromise;

    expect(panelState().loadingByTab.get('MHC')).toBe(false);
    expect(panelState().entriesByTab.get('MHC')?.length).toBe(1);
  });

  it('clears loadingByTab if batchRestoreSession rejects, instead of leaving the pane stuck loading forever', async () => {
    vi.mocked(commentaryAPI.batchRestoreSession).mockRejectedValue(new Error('IPC failed'));

    await expect(
      useCommentaryStore.getState().restoreFromSession(PANEL, {
        openTabs: [MHC_TAB],
        activeTabIndex: 0,
        currentVerseId: 43003016,
      }),
    ).rejects.toThrow('IPC failed');

    expect(panelState().loadingByTab.get('MHC')).toBe(false);
  });
});
