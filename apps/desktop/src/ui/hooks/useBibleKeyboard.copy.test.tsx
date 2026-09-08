import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { renderHook } from '@testing-library/react';
import { useBibleKeyboard } from './useBibleKeyboard';
import { useLayoutStore } from '../stores/useLayoutStore';
import * as verseCopyService from '../services/verseCopyService';

/**
 * Ctrl+C in the Bible pane.
 *
 * Deciding "is this mine?" purely from where the DOM caret was would be wrong
 * for the app's own selection model: a shift-click passage selection is
 * deliberately built WITHOUT a DOM selection (the mousedown is
 * preventDefaulted so the browser does not sweep text across verse rows), and
 * the Ctrl+L reference flow blurs the search box without planting a caret in
 * the pane. So the reader could see verses 16-17 highlighted, press Ctrl+C,
 * and get nothing - while clicking a verse first "fixed" it purely by planting
 * a caret the check happened to accept.
 */

vi.mock('../stores/useHighlightStore', () => ({
  useHighlightStore: () => ({ createHighlight: vi.fn(), lastUsedColor: 'yellow' }),
}));
vi.mock('../stores/useNotesStore', () => ({
  useNotesStore: { getState: () => ({ syncAllPanelsWithVerse: vi.fn() }) },
}));
vi.mock('../stores/useFindStore', () => ({
  useFindStore: () => ({ isOpen: false, matches: [], setMatches: vi.fn(), close: vi.fn() }),
}));

const JOHN_3_16 = 43003016;
const JOHN_3_17 = 43003017;

const VERSES = [
  { verse_id: JOHN_3_16, book_number: 43, chapter: 3, verse: 16, text: 'For God so loved' },
  { verse_id: JOHN_3_17, book_number: 43, chapter: 3, verse: 17, text: 'For God sent not' },
];

function mountPane(overrides: {
  panelId?: string;
  selectedVerseId?: number | null;
  selectionEndVerseId?: number | null;
} = {}) {
  const setCopyOptionsDialog = vi.fn();
  renderHook(() =>
    useBibleKeyboard({
      panelId: overrides.panelId ?? 'bible_default',
      currentBook: 43,
      currentChapter: 3,
      currentVerses: VERSES,
      // `in`, not `??` - null is a meaningful value here (no selection / no
      // extension), and `??` would quietly substitute the default for it.
      selectedVerseId: 'selectedVerseId' in overrides ? overrides.selectedVerseId! : JOHN_3_16,
      selectionEndVerseId:
        'selectionEndVerseId' in overrides ? overrides.selectionEndVerseId! : JOHN_3_17,
      activeTab: undefined,
      canGoBack: () => false,
      goBackWithScroll: vi.fn(),
      handlePreviousChapter: vi.fn(),
      handleNextChapter: vi.fn(),
      setCopyOptionsDialog,
      buildSelectionFromDOM: () => null,
      dismissFloatingToolbar: vi.fn(),
      highlightRepository: {} as never,
      loadChapter: vi.fn(),
    }),
  );
  return setCopyOptionsDialog;
}

function pressCtrlC(): void {
  window.dispatchEvent(new KeyboardEvent('keydown', { key: 'c', ctrlKey: true, bubbles: true }));
}

describe('useBibleKeyboard — Ctrl+C', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    document.body.innerHTML = '';
    useLayoutStore.setState({ lastActiveBiblePanelId: null });
    // No DOM text selection anywhere - the state shift+click deliberately
    // leaves behind.
    vi.spyOn(verseCopyService, 'hasTextSelection').mockReturnValue(false);
    window.getSelection()?.removeAllRanges();
  });

  afterEach(() => {
    document.body.innerHTML = '';
  });

  it('copies a shift-click passage with no DOM caret in the pane', () => {
    const setCopyOptionsDialog = mountPane();

    pressCtrlC();

    expect(setCopyOptionsDialog).toHaveBeenCalledWith({
      visible: true,
      verses: VERSES,
    });
  });

  it('copies the anchor alone when the selection was never extended', () => {
    const setCopyOptionsDialog = mountPane({ selectionEndVerseId: null });

    pressCtrlC();

    expect(setCopyOptionsDialog).toHaveBeenCalledWith({
      visible: true,
      verses: [VERSES[0]],
    });
  });

  it('does nothing when no verse is selected', () => {
    const setCopyOptionsDialog = mountPane({ selectedVerseId: null, selectionEndVerseId: null });

    pressCtrlC();

    expect(setCopyOptionsDialog).not.toHaveBeenCalled();
  });

  it('leaves Ctrl+C alone while the user is typing', () => {
    const setCopyOptionsDialog = mountPane();
    const input = document.createElement('input');
    document.body.appendChild(input);
    input.focus();

    pressCtrlC();

    expect(setCopyOptionsDialog).not.toHaveBeenCalled();
  });

  it('leaves Ctrl+C alone while the caret sits in a contenteditable note', () => {
    const setCopyOptionsDialog = mountPane();
    const editor = document.createElement('div');
    editor.setAttribute('contenteditable', 'true');
    // jsdom does not derive isContentEditable from the attribute.
    Object.defineProperty(editor, 'isContentEditable', { value: true });
    document.body.appendChild(editor);
    editor.focus();

    pressCtrlC();

    expect(setCopyOptionsDialog).not.toHaveBeenCalled();
  });

  it('yields to a text selection made outside the Bible pane', () => {
    const setCopyOptionsDialog = mountPane();
    vi.spyOn(verseCopyService, 'hasTextSelection').mockReturnValue(true);

    const elsewhere = document.createElement('p');
    elsewhere.textContent = 'a commentary paragraph';
    document.body.appendChild(elsewhere);
    const range = document.createRange();
    range.selectNodeContents(elsewhere);
    window.getSelection()?.addRange(range);

    pressCtrlC();

    expect(setCopyOptionsDialog).not.toHaveBeenCalled();
  });

  it('answers from only the Bible pane the reader was last in', () => {
    useLayoutStore.setState({ lastActiveBiblePanelId: 'bible_second' });
    const setCopyOptionsDialog = mountPane({ panelId: 'bible_default' });

    pressCtrlC();

    expect(setCopyOptionsDialog).not.toHaveBeenCalled();
  });
});
