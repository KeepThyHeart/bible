/**
 * FIX 2 - verse opened in a NEW Bible tab highlights but doesn't scroll.
 *
 * navigateToVerse (verseSlice.ts) explicitly sets scrollMode: 'center' and
 * bumps scrollTrigger when navigating to a verse. useContentKeyInit seeds a
 * brand-new panel (from "+ New tab", a Ctrl-clicked scripture link, or a
 * pop-out) with a selectedVerseId the same way, and must set
 * scrollMode/scrollTrigger the same way too: left at
 * createDefaultPanelState's defaults ('nearest' / 0), 'nearest' mode no-ops
 * against a panel dockview has only just created. This mirrors
 * navigateToVerse's behavior for the seed path.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, waitFor } from '@testing-library/react';
import { useContentKeyInit } from './useContentKeyInit';
import { useBibleStore } from '../../../stores/useBibleStore';
import { encodeBibleContentKey } from '../../../stores/bible/contentKey';

vi.mock('../../../services/electronAPI', () => ({
  bibleAPI: {
    getBookName: vi.fn().mockResolvedValue('John'),
  },
}));

const PANEL_ID = 'content-key-test-panel';
const KJV = { abbreviation: 'KJV', name: 'King James Version', database_path: 'bible_kjv.db' };

function panelState() {
  return useBibleStore.getState().panels.get(PANEL_ID);
}

describe('useContentKeyInit — scroll seeding (FIX 2)', () => {
  beforeEach(() => {
    const panels = new Map(useBibleStore.getState().panels);
    panels.delete(PANEL_ID);
    useBibleStore.setState({
      panels,
      availableBibles: [KJV],
      // Neutralize openBible's real IPC/action chain - this test is only
      // concerned with the scrollMode/scrollTrigger seeding useContentKeyInit
      // itself performs, not the rest of the store's tab-opening behavior.
      openBible: vi.fn(),
    });
  });

  it('sets scrollMode to "center" and bumps scrollTrigger when seeding a target verse', async () => {
    const contentKey = encodeBibleContentKey({
      abbreviation: 'KJV',
      book: 43,
      chapter: 3,
      selectedVerseId: 43003016,
    });

    renderHook(() => useContentKeyInit({
      contentKey,
      panelId: PANEL_ID,
      openTabsLength: 0,
      availableBibles: [KJV],
      hasStagedSession: false,
      dockviewPanelApi: undefined,
    }));

    await waitFor(() => {
      expect(panelState()?.selectedVerseId).toBe(43003016);
    });

    const ps = panelState()!;
    expect(ps.scrollMode).toBe('center');
    expect(ps.scrollTrigger).toBe(1);
  });

  it('leaves scrollMode/scrollTrigger at their defaults when the seed has no target verse', async () => {
    const contentKey = encodeBibleContentKey({
      abbreviation: 'KJV',
      book: 43,
      chapter: 3,
      // no selectedVerseId - e.g. "+ New tab" with no specific verse
    });

    renderHook(() => useContentKeyInit({
      contentKey,
      panelId: PANEL_ID,
      openTabsLength: 0,
      availableBibles: [KJV],
      hasStagedSession: false,
      dockviewPanelApi: undefined,
    }));

    await waitFor(() => {
      expect(panelState()?.currentChapter).toBe(3);
    });

    const ps = panelState()!;
    expect(ps.scrollMode).toBe('nearest');
    expect(ps.scrollTrigger).toBe(0);
  });
});
