/**
 * The note indicator on a verse advertises "click to view the note".
 *
 * Poking only the notes *store* is not enough: with no Notes pane in the
 * layout - which is the default - clicking it would do nothing visible at
 * all, so the click must also reveal the pane. These tests pin the reveal
 * step.
 */
import { describe, it, expect, vi, beforeEach, afterEach, type Mock } from 'vitest';
import { renderHook, waitFor } from '@testing-library/react';
import React from 'react';

const h = vi.hoisted(() => ({
  revealNotesPanel: vi.fn<() => string | null>(),
  syncNotes: vi.fn(),
  syncCommentary: vi.fn(),
  syncStudy: vi.fn(),
  syncTopics: vi.fn(),
  setStudyPaneActiveTab: vi.fn(),
}));

vi.mock('../revealNotesPanel', () => ({ revealNotesPanel: h.revealNotesPanel }));

// The four-pane fan-out moved into `stores/syncPanesWithVerse`, which reads
// each store through `getState()` so non-component callers (the search bar,
// the results pane) can use it too. These stubs therefore need a `getState`,
// not just a callable hook.
vi.mock('../../../stores/useCommentaryStore', () => ({
  useCommentaryStore: Object.assign(
    () => ({ syncAllPanelsWithVerse: h.syncCommentary }),
    { getState: () => ({ syncAllPanelsWithVerse: h.syncCommentary }) },
  ),
}));
vi.mock('../../../stores/useStudyStore', () => ({
  useStudyStore: Object.assign(
    () => ({ syncAllPanelsWithVerse: h.syncStudy }),
    { getState: () => ({ syncAllPanelsWithVerse: h.syncStudy }) },
  ),
}));
vi.mock('../../../stores/useTopicsStore', () => ({
  useTopicsStore: Object.assign(
    () => ({ syncAllPanelsWithVerse: h.syncTopics }),
    { getState: () => ({ syncAllPanelsWithVerse: h.syncTopics }) },
  ),
}));
vi.mock('../../../stores/useDictionaryStore', () => ({
  useDictionaryStore: () => ({
    lookupStrongsNumber: vi.fn(),
    setStudyPaneActiveTab: h.setStudyPaneActiveTab,
  }),
}));
vi.mock('../../../stores/useNotesStore', () => ({
  useNotesStore: Object.assign(
    () => ({ syncAllPanelsWithVerse: h.syncNotes }),
    { getState: () => ({ syncAllPanelsWithVerse: h.syncNotes }) },
  ),
}));

import { useVerseInteractionHandlers } from './useVerseInteractionHandlers';

const setSelectedVerse = vi.fn();
const extendSelectionTo = vi.fn();

function renderHandlers(overrides: {
  currentVerses?: unknown[];
  selectedVerseId?: number | null;
  selectionEndVerseId?: number | null;
  setContextMenu?: Mock;
} = {}) {
  return renderHook(() => useVerseInteractionHandlers({
    currentVerses: overrides.currentVerses ?? [],
    setSelectedVerse,
    extendSelectionTo,
    selectedVerseId: overrides.selectedVerseId ?? null,
    selectionEndVerseId: overrides.selectionEndVerseId ?? null,
    setContextMenu: overrides.setContextMenu ?? vi.fn(),
    setNoteTooltipHidden: vi.fn(),
    dismissFloatingToolbar: vi.fn(),
  }));
}

const clickEvent = { stopPropagation: vi.fn() } as unknown as React.MouseEvent;

describe('handleNoteIndicatorClick', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    h.revealNotesPanel.mockReturnValue('notes_1');
    // Collapse the double requestAnimationFrame the handler uses to wait for a
    // freshly created pane to mount.
    vi.stubGlobal('requestAnimationFrame', (cb: FrameRequestCallback) => {
      cb(0);
      return 0;
    });
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('reveals a Notes pane so the note has somewhere to appear', async () => {
    const { result } = renderHandlers();

    await result.current.handleNoteIndicatorClick(clickEvent, 43003016);

    expect(h.revealNotesPanel).toHaveBeenCalledTimes(1);
  });

  it('selects the verse so the Bible pane agrees with the note that opens', async () => {
    const { result } = renderHandlers();

    await result.current.handleNoteIndicatorClick(clickEvent, 43003016);

    expect(setSelectedVerse).toHaveBeenCalledWith(43003016);
  });

  it('points the revealed pane at the verse', async () => {
    const { result } = renderHandlers();

    await result.current.handleNoteIndicatorClick(clickEvent, 43003016);

    await waitFor(() => expect(h.syncNotes).toHaveBeenCalledWith(43003016));
  });

  it('dispatches open-verse-note once the pane is in place', async () => {
    const listener = vi.fn();
    window.addEventListener('open-verse-note', listener);
    const { result } = renderHandlers();

    await result.current.handleNoteIndicatorClick(clickEvent, 43003016);

    await waitFor(() => expect(listener).toHaveBeenCalledTimes(1));
    window.removeEventListener('open-verse-note', listener);
  });

  it('still opens the note when dockview could not add a pane', async () => {
    h.revealNotesPanel.mockReturnValue(null);
    const listener = vi.fn();
    window.addEventListener('open-verse-note', listener);
    const { result } = renderHandlers();

    await result.current.handleNoteIndicatorClick(clickEvent, 43003016);

    await waitFor(() => expect(listener).toHaveBeenCalledTimes(1));
    window.removeEventListener('open-verse-note', listener);
  });
});

/**
 * Shift-click passage selection, from the click handler's side.
 *
 * Two rules live here and nowhere else:
 *  - an extending click widens the passage and returns BEFORE the four
 *    cross-pane syncs, because the anchor has not moved and reloading the
 *    commentary/notes/study/topics panes would make it read as a navigation;
 *  - right-clicking inside an active range acts on the whole passage.
 */
describe('shift-click extension', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('extends the selection and does NOT re-anchor', () => {
    const { result } = renderHandlers({ selectedVerseId: 43003016 });

    result.current.handleVerseClick(43003018, true);

    expect(extendSelectionTo).toHaveBeenCalledWith(43003018);
    expect(setSelectedVerse).not.toHaveBeenCalled();
  });

  it('does not reload the dependent panes on an extending click', () => {
    const { result } = renderHandlers({ selectedVerseId: 43003016 });

    result.current.handleVerseClick(43003018, true);

    // None of the four panes may move: the anchor has not changed.
    expect(h.syncNotes).not.toHaveBeenCalled();
    expect(h.syncCommentary).not.toHaveBeenCalled();
    expect(h.syncStudy).not.toHaveBeenCalled();
    expect(h.syncTopics).not.toHaveBeenCalled();
  });

  it('a plain click re-anchors and syncs as before', () => {
    const { result } = renderHandlers({ selectedVerseId: 43003016 });

    result.current.handleVerseClick(43003018);

    expect(setSelectedVerse).toHaveBeenCalledWith(43003018);
    expect(extendSelectionTo).not.toHaveBeenCalled();
    // All four, not just notes - a click is the reader choosing a verse.
    expect(h.syncNotes).toHaveBeenCalledWith(43003018);
    expect(h.syncCommentary).toHaveBeenCalledWith(43003018);
    expect(h.syncStudy).toHaveBeenCalledWith(43003018);
    expect(h.syncTopics).toHaveBeenCalledWith(43003018);
  });
});

describe('right-click inside an active range acts on the range', () => {
  const VERSES = [15, 16, 17, 18].map(verse => ({
    verse_id: 43003000 + verse,
    book_number: 43,
    chapter: 3,
    verse,
    text: `Verse ${verse}`,
  }));

  function contextMenuEvent(target: Partial<HTMLElement> = {}) {
    return {
      preventDefault: vi.fn(),
      stopPropagation: vi.fn(),
      clientX: 10,
      clientY: 20,
      target: { closest: () => null, classList: { contains: () => false }, hasAttribute: () => false, ...target },
    } as unknown as React.MouseEvent;
  }

  beforeEach(() => {
    vi.clearAllMocks();
    // No DOM text selection: a shift-click preventDefaults its mousedown
    // precisely so it leaves none.
    window.getSelection = () => ({ isCollapsed: true, toString: () => '' }) as unknown as Selection;
  });

  it('passes the whole passage, flagged isMultiple', () => {
    const setContextMenu = vi.fn();
    const { result } = renderHandlers({
      currentVerses: VERSES,
      selectedVerseId: 43003016,
      selectionEndVerseId: 43003018,
      setContextMenu,
    });

    result.current.handleVerseContextMenu(contextMenuEvent(), VERSES[2]);

    const arg = setContextMenu.mock.calls[0][0];
    expect(arg.isMultiple).toBe(true);
    expect(arg.verses.map((v: { verse: number }) => v.verse)).toEqual([16, 17, 18]);
  });

  it('falls back to the single verse when the click lands OUTSIDE the range', () => {
    const setContextMenu = vi.fn();
    const { result } = renderHandlers({
      currentVerses: VERSES,
      selectedVerseId: 43003016,
      selectionEndVerseId: 43003018,
      setContextMenu,
    });

    result.current.handleVerseContextMenu(contextMenuEvent(), VERSES[0]); // v15

    const arg = setContextMenu.mock.calls[0][0];
    expect(arg.isMultiple).toBe(false);
    expect(arg.verses.map((v: { verse: number }) => v.verse)).toEqual([15]);
  });

  it('falls back to the single verse when only one verse is selected', () => {
    const setContextMenu = vi.fn();
    const { result } = renderHandlers({
      currentVerses: VERSES,
      selectedVerseId: 43003016,
      selectionEndVerseId: null,
      setContextMenu,
    });

    result.current.handleVerseContextMenu(contextMenuEvent(), VERSES[1]);

    const arg = setContextMenu.mock.calls[0][0];
    expect(arg.isMultiple).toBe(false);
    expect(arg.verses.map((v: { verse: number }) => v.verse)).toEqual([16]);
  });
});
