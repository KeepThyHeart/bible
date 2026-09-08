/**
 * Preview navigation - "show me that verse, but don't move my study".
 *
 * Following a scripture link that moves `selectedVerseId` directly - which
 * the commentary, notes, study and topics panes all follow - would let
 * tracing five cross-references out of John 3:16 quietly relocate the whole
 * workspace to the fifth of them. These tests pin the two-verse model:
 * `selectedVerseId` is what the reader chose, `previewVerseId` is what they
 * are looking at, and only the first one moves anything.
 *
 * See `stores/bible/slices/previewSlice.ts`.
 */
import { describe, it, expect, beforeEach, vi } from 'vitest';

vi.mock('../../services/electronAPI', () => ({
  bibleAPI: {
    getAvailableBibles: vi.fn().mockResolvedValue([]),
    getInitialData: vi.fn().mockResolvedValue({ verses: [], currentBook: 43, currentChapter: 3 }),
    getBookName: vi.fn().mockImplementation(async (n: number) => `Book${n}`),
    getChapter: vi.fn().mockResolvedValue({ verses: [] }),
    getVerses: vi.fn().mockResolvedValue([]),
    getVerse: vi.fn().mockResolvedValue(null),
  },
  commentaryAPI: {
    getAvailableCommentaries: vi.fn().mockResolvedValue([]),
    getEntriesForVerse: vi.fn().mockResolvedValue([]),
  },
}));

vi.mock('../helpers/sessionNotifier', () => ({
  markSessionDirty: vi.fn(),
}));

import { useBibleStore } from '../useBibleStore';

const PANEL = 'test_panel_preview';
const TAB = 'tab-preview';

/** John 3:16 - the verse the reader has chosen and is studying. */
const JOHN_3_16 = 43003016;
/** John 3:20 - a cross-reference within the same chapter. */
const JOHN_3_20 = 43003020;
/** Romans 8:28 - a cross-reference out of the chapter. */
const ROMANS_8_28 = 45008028;
const ROMANS_8_30 = 45008030;

function seed(): void {
  useBibleStore.setState({ panels: new Map() });
  useBibleStore.getState().initPanel(PANEL);

  const s = useBibleStore.getState();
  const ps = s.getPanelState(PANEL);
  const panels = new Map(s.panels);
  panels.set(PANEL, {
    ...ps,
    openTabs: [{
      tabId: TAB,
      abbreviation: 'KJV',
      name: 'King James',
      displayMode: 'standard',
      book: 43,
      chapter: 3,
      bookName: 'John',
      selectedVerseId: JOHN_3_16,
      history: [],
      historyIndex: -1,
    }],
    activeTabIndex: 0,
    currentBook: 43,
    currentChapter: 3,
    currentBookName: 'John',
    selectedVerseId: JOHN_3_16,
  });
  useBibleStore.setState({ panels });
}

const panel = () => useBibleStore.getState().getPanelState(PANEL);

describe('preview navigation', () => {
  beforeEach(seed);

  describe('within the same chapter', () => {
    it('marks the verse without moving the selection', async () => {
      await useBibleStore.getState().navigateToPreview(PANEL, JOHN_3_20);

      expect(panel().previewVerseId).toBe(JOHN_3_20);
      // The whole point: every pane that follows this is still on John 3:16.
      expect(panel().selectedVerseId).toBe(JOHN_3_16);
    });

    it('raises no back bar — the verse they came from is still on screen', async () => {
      await useBibleStore.getState().navigateToPreview(PANEL, JOHN_3_20);
      expect(panel().backBarVerseId).toBeNull();
    });

    it('scrolls to the previewed verse', async () => {
      const before = panel().scrollTrigger;
      await useBibleStore.getState().navigateToPreview(PANEL, JOHN_3_20);
      expect(panel().scrollTrigger).toBe(before + 1);
    });
  });

  describe('into another chapter', () => {
    it('loads the chapter but leaves the selection where the reader put it', async () => {
      await useBibleStore.getState().navigateToPreview(PANEL, ROMANS_8_28);

      expect(panel().currentBook).toBe(45);
      expect(panel().currentChapter).toBe(8);
      expect(panel().previewVerseId).toBe(ROMANS_8_28);
      // Deliberately pointing outside the loaded chapter: that is the state
      // that says "the study is still back there".
      expect(panel().selectedVerseId).toBe(JOHN_3_16);
    });

    it('offers a way back to the verse the reader was studying', async () => {
      await useBibleStore.getState().navigateToPreview(PANEL, ROMANS_8_28);
      expect(panel().backBarVerseId).toBe(JOHN_3_16);
    });

    // A chain of link-clicks must keep naming the verse the reader actually
    // chose, not the previous hop - otherwise "Back" walks them out one
    // cross-reference at a time.
    it('keeps naming the original verse across a chain of previews', async () => {
      await useBibleStore.getState().navigateToPreview(PANEL, ROMANS_8_28);
      await useBibleStore.getState().navigateToPreview(PANEL, 40005003);
      await useBibleStore.getState().navigateToPreview(PANEL, 19023001);

      expect(panel().backBarVerseId).toBe(JOHN_3_16);
    });

    it('marks a whole passage when the link points at a range', async () => {
      await useBibleStore.getState().navigateToPreview(PANEL, ROMANS_8_28, ROMANS_8_30);
      expect(panel().previewVerseId).toBe(ROMANS_8_28);
      expect(panel().previewVerseEndId).toBe(ROMANS_8_30);
    });
  });

  describe('ending a preview', () => {
    it('clicking a verse supersedes it', async () => {
      await useBibleStore.getState().navigateToPreview(PANEL, ROMANS_8_28);
      useBibleStore.getState().setSelectedVerse(PANEL, ROMANS_8_28);

      expect(panel().previewVerseId).toBeNull();
      expect(panel().backBarVerseId).toBeNull();
      expect(panel().selectedVerseId).toBe(ROMANS_8_28);
    });

    it('shift-clicking supersedes it too', async () => {
      await useBibleStore.getState().navigateToPreview(PANEL, JOHN_3_20);
      useBibleStore.getState().extendSelectionTo(PANEL, JOHN_3_20);

      expect(panel().previewVerseId).toBeNull();
    });

    it('a deliberate navigation supersedes it', async () => {
      await useBibleStore.getState().navigateToPreview(PANEL, ROMANS_8_28);
      await useBibleStore.getState().navigateToVerse(PANEL, JOHN_3_20);

      expect(panel().previewVerseId).toBeNull();
      expect(panel().backBarVerseId).toBeNull();
    });

    it('adopting it promotes the previewed verse to the real selection', async () => {
      await useBibleStore.getState().navigateToPreview(PANEL, ROMANS_8_28);
      const adopted = useBibleStore.getState().adoptPreview(PANEL);

      expect(adopted).toBe(ROMANS_8_28);
      expect(panel().selectedVerseId).toBe(ROMANS_8_28);
      expect(panel().previewVerseId).toBeNull();
      expect(panel().backBarVerseId).toBeNull();
      // Written through to the passage record the session persists.
      expect(panel().openTabs[0].selectedVerseId).toBe(ROMANS_8_28);
    });

    it('adopting nothing is a no-op', () => {
      expect(useBibleStore.getState().adoptPreview(PANEL)).toBeNull();
      expect(panel().selectedVerseId).toBe(JOHN_3_16);
    });

    it('going back returns to the verse the bar names', async () => {
      await useBibleStore.getState().navigateToPreview(PANEL, ROMANS_8_28);
      await useBibleStore.getState().returnFromPreview(PANEL);

      expect(panel().selectedVerseId).toBe(JOHN_3_16);
      expect(panel().currentBook).toBe(43);
      expect(panel().currentChapter).toBe(3);
      expect(panel().previewVerseId).toBeNull();
      expect(panel().backBarVerseId).toBeNull();
    });

    // Dismissing the bar is "stop telling me", not "I am here now": the mark
    // is still saying something true about which verse the panes are *not* on.
    it('dismissing the bar leaves the preview mark alone', async () => {
      await useBibleStore.getState().navigateToPreview(PANEL, ROMANS_8_28);
      useBibleStore.getState().dismissBackBar(PANEL);

      expect(panel().backBarVerseId).toBeNull();
      expect(panel().previewVerseId).toBe(ROMANS_8_28);
    });

    it('clearPreview drops both', async () => {
      await useBibleStore.getState().navigateToPreview(PANEL, ROMANS_8_28);
      useBibleStore.getState().clearPreview(PANEL);

      expect(panel().previewVerseId).toBeNull();
      expect(panel().backBarVerseId).toBeNull();
    });
  });
});
