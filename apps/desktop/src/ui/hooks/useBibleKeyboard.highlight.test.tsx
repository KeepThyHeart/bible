import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { renderHook } from '@testing-library/react';
import { useBibleKeyboard } from './useBibleKeyboard';
import { useLayoutStore } from '../stores/useLayoutStore';

/**
 * Ctrl+Shift+H, which the verse context menu advertises next to
 * "Highlight / Underline...". With a verse selected by clicking (no DOM word
 * selection) it used to do nothing at all.
 */

const h = vi.hoisted(() => ({ createHighlight: vi.fn().mockResolvedValue(undefined) }));

vi.mock('../stores/useHighlightStore', () => ({
  useHighlightStore: () => ({ createHighlight: h.createHighlight, lastUsedColor: 'green' }),
}));
vi.mock('../stores/useNotesStore', () => ({
  useNotesStore: { getState: () => ({ syncAllPanelsWithVerse: vi.fn() }) },
}));
vi.mock('../stores/useFindStore', () => ({
  useFindStore: () => ({ isOpen: false, matches: [], setMatches: vi.fn(), close: vi.fn() }),
}));
vi.mock('../services/announcer', () => ({ announceKey: vi.fn() }));

const JOHN_3_16 = 43003016;
const JOHN_3_17 = 43003017;

function mountPane(overrides: {
  panelId?: string;
  selectedVerseId?: number | null;
  selectionEndVerseId?: number | null;
  wordSelection?: boolean;
} = {}) {
  renderHook(() =>
    useBibleKeyboard({
      panelId: overrides.panelId ?? 'bible_default',
      currentBook: 43,
      currentChapter: 3,
      currentVerses: [],
      selectedVerseId: 'selectedVerseId' in overrides ? overrides.selectedVerseId! : JOHN_3_16,
      selectionEndVerseId: 'selectionEndVerseId' in overrides ? overrides.selectionEndVerseId! : null,
      activeTab: { moduleId: 7, abbreviation: 'KJV' } as never,
      canGoBack: () => false,
      goBackWithScroll: vi.fn(),
      handlePreviousChapter: vi.fn(),
      handleNextChapter: vi.fn(),
      setCopyOptionsDialog: vi.fn(),
      buildSelectionFromDOM: () =>
        overrides.wordSelection
          ? { startVerseId: JOHN_3_16, startWordIndex: 2, endVerseId: JOHN_3_16, endWordIndex: 4, hasExistingMarkup: false }
          : null,
      dismissFloatingToolbar: vi.fn(),
      highlightRepository: {} as never,
      loadChapter: vi.fn(),
    }),
  );
}

function pressCtrlShiftH(): void {
  window.dispatchEvent(new KeyboardEvent('keydown', { key: 'H', ctrlKey: true, shiftKey: true, bubbles: true }));
}

describe('useBibleKeyboard - Ctrl+Shift+H', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    document.body.innerHTML = '';
    useLayoutStore.setState({ lastActiveBiblePanelId: null });
  });
  afterEach(() => {
    document.body.innerHTML = '';
  });

  it('highlights the selected verse whole when no words are selected', () => {
    mountPane();
    pressCtrlShiftH();
    expect(h.createHighlight).toHaveBeenCalledTimes(1);
    const markup = h.createHighlight.mock.calls[0][0];
    expect(markup.verseIdStart).toBe(JOHN_3_16);
    expect(markup.textStart).toBe(0);
    expect(markup.color).toBe('green');
  });

  it('highlights a shift-click passage across its verses', () => {
    mountPane({ selectionEndVerseId: JOHN_3_17 });
    pressCtrlShiftH();
    const markup = h.createHighlight.mock.calls[0][0];
    expect(markup.verseIdStart).toBe(JOHN_3_16);
    expect(markup.verseIdEnd).toBe(JOHN_3_17);
  });

  it('prefers a word selection over the verse', () => {
    mountPane({ wordSelection: true });
    pressCtrlShiftH();
    const markup = h.createHighlight.mock.calls[0][0];
    expect(markup.textStart).toBe(2);
    expect(markup.textEnd).toBe(4);
  });

  it('does nothing with no verse selected', () => {
    mountPane({ selectedVerseId: null });
    pressCtrlShiftH();
    expect(h.createHighlight).not.toHaveBeenCalled();
  });

  it('leaves the keystroke alone in a text field', () => {
    const input = document.createElement('input');
    document.body.appendChild(input);
    input.focus();
    mountPane();
    pressCtrlShiftH();
    expect(h.createHighlight).not.toHaveBeenCalled();
  });

  it('only the last-active Bible pane answers', () => {
    useLayoutStore.setState({ lastActiveBiblePanelId: 'bible_other' });
    mountPane({ panelId: 'bible_default' });
    pressCtrlShiftH();
    expect(h.createHighlight).not.toHaveBeenCalled();
  });
});
