/**
 * Unit tests for the commentary store's `sharedSlice` (mute/favorite state).
 *
 * Exercised through the composed `useCommentaryStore`, mirroring
 * `../../useCommentaryStore.test.ts`. Focused specifically on `toggleMuted`/
 * `togglePromoted`'s mutual exclusion and localStorage persistence, since
 * `CommentaryHome.tsx`'s new mute-confirmation dialog wires directly into
 * `toggleMuted` on confirm - that UI is only correct if muting a
 * previously-favorited module also clears its favorited state (and vice
 * versa), matching the single accent-colored/left-border treatment a module
 * row can have at once.
 */
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { useCommentaryStore } from '../useCommentaryStore';
import { STORAGE_KEY_COMMENTARY_MUTED, STORAGE_KEY_COMMENTARY_PROMOTED } from '../../../constants';

vi.mock('../../../services/electronAPI', () => ({
  commentaryAPI: {
    getAvailableCommentaries: vi.fn().mockResolvedValue([]),
    getEntriesForVerse: vi.fn().mockResolvedValue([]),
    getNextVerseWithContent: vi.fn().mockResolvedValue(null),
    getPreviousVerseWithContent: vi.fn().mockResolvedValue(null),
    getAllEntrySummaries: vi.fn().mockResolvedValue([]),
    batchRestoreSession: vi.fn().mockResolvedValue({
      availableCommentaries: [],
      entriesByTab: {},
      summariesByTab: {}
    }),
  }
}));

vi.mock('../../helpers/sessionNotifier', () => ({
  markSessionDirty: vi.fn()
}));

describe('commentary sharedSlice - mute/favorite', () => {
  beforeEach(() => {
    localStorage.clear();
    useCommentaryStore.setState({
      availableCommentaries: [],
      loadingCommentaries: false,
      mutedModules: new Set(),
      promotedModules: new Set(),
      panels: new Map(),
    });
  });

  it('starts with no muted or favorited (promoted) modules', () => {
    expect(useCommentaryStore.getState().mutedModules.size).toBe(0);
    expect(useCommentaryStore.getState().promotedModules.size).toBe(0);
  });

  it('toggleMuted adds/removes a module from mutedModules and persists to localStorage', () => {
    useCommentaryStore.getState().toggleMuted('MHC');
    expect(useCommentaryStore.getState().mutedModules.has('MHC')).toBe(true);
    expect(JSON.parse(localStorage.getItem(STORAGE_KEY_COMMENTARY_MUTED) ?? '[]')).toEqual(['MHC']);

    useCommentaryStore.getState().toggleMuted('MHC');
    expect(useCommentaryStore.getState().mutedModules.has('MHC')).toBe(false);
    expect(JSON.parse(localStorage.getItem(STORAGE_KEY_COMMENTARY_MUTED) ?? '[]')).toEqual([]);
  });

  it('togglePromoted adds/removes a module from promotedModules and persists to localStorage', () => {
    useCommentaryStore.getState().togglePromoted('TSK');
    expect(useCommentaryStore.getState().promotedModules.has('TSK')).toBe(true);
    expect(JSON.parse(localStorage.getItem(STORAGE_KEY_COMMENTARY_PROMOTED) ?? '[]')).toEqual(['TSK']);

    useCommentaryStore.getState().togglePromoted('TSK');
    expect(useCommentaryStore.getState().promotedModules.has('TSK')).toBe(false);
  });

  it('muting a favorited (promoted) module clears its favorited state — a module cannot be both at once', () => {
    useCommentaryStore.getState().togglePromoted('MHC');
    expect(useCommentaryStore.getState().promotedModules.has('MHC')).toBe(true);

    useCommentaryStore.getState().toggleMuted('MHC');

    expect(useCommentaryStore.getState().mutedModules.has('MHC')).toBe(true);
    expect(useCommentaryStore.getState().promotedModules.has('MHC')).toBe(false);
    expect(JSON.parse(localStorage.getItem(STORAGE_KEY_COMMENTARY_PROMOTED) ?? '[]')).toEqual([]);
  });

  it('favoriting a muted module clears its muted state — the reverse direction', () => {
    useCommentaryStore.getState().toggleMuted('MHC');
    expect(useCommentaryStore.getState().mutedModules.has('MHC')).toBe(true);

    useCommentaryStore.getState().togglePromoted('MHC');

    expect(useCommentaryStore.getState().promotedModules.has('MHC')).toBe(true);
    expect(useCommentaryStore.getState().mutedModules.has('MHC')).toBe(false);
    expect(JSON.parse(localStorage.getItem(STORAGE_KEY_COMMENTARY_MUTED) ?? '[]')).toEqual([]);
  });

  it('mute/favorite state is independent per module', () => {
    useCommentaryStore.getState().toggleMuted('MHC');
    useCommentaryStore.getState().togglePromoted('TSK');

    expect(useCommentaryStore.getState().mutedModules.has('MHC')).toBe(true);
    expect(useCommentaryStore.getState().promotedModules.has('TSK')).toBe(true);
    expect(useCommentaryStore.getState().mutedModules.has('TSK')).toBe(false);
    expect(useCommentaryStore.getState().promotedModules.has('MHC')).toBe(false);
  });
});
