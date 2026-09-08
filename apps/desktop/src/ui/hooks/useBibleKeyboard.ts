import { useEffect } from 'react';
import { useNotesStore } from '../stores/useNotesStore';
import { hasTextSelection, copyToClipboard } from '../services/verseCopyService';
import { MarkupType, UserTextMarkup } from '@bible/core';
import { WordSelection, BibleTabInfo, CopyOptionsDialogState } from '../components/BiblePaneContext';
import { IPCHighlightRepository } from '../services/highlightsAPI';
import { useHighlightStore } from '../stores/useHighlightStore';
import { extractWordsWithFormatting } from '../utils/wordIndexing';
import { useFindStore, FindMatch } from '../stores/useFindStore';
import { computeSelectedRange } from '../stores/bible/internals/verseRange';
import { useLayoutStore } from '../stores/useLayoutStore';
import { useBookmarkStore } from '../stores/useBookmarkStore';

/**
 * Is this node inside a Bible pane's text? Walks up looking for the markers
 * every rendered verse row and pane body carries.
 */
function isInsideBibleText(node: Node | null): boolean {
  let current: Node | null = node;
  while (current && current !== document.body) {
    if (current instanceof Element) {
      if (
        current.classList?.contains('bible-text') ||
        current.classList?.contains('pane-content-bible') ||
        current.hasAttribute('data-verse-id')
      ) {
        return true;
      }
    }
    current = current.parentNode;
  }
  return false;
}

/**
 * Is focus somewhere the user types? A note editor, the search box or any
 * other field owns its own Ctrl+C, and must never have it stolen to open the
 * Bible pane's copy dialog.
 */
function isEditableTarget(element: Element | null): boolean {
  if (!(element instanceof HTMLElement)) return false;
  if (element.isContentEditable) return true;
  const tag = element.tagName;
  return tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT';
}

interface UseBibleKeyboardParams {
  panelId: string;
  currentBook: number;
  currentChapter: number;
  currentVerses: any[];
  selectedVerseId: number | null;
  /** Far end of a shift-click passage selection, or null. */
  selectionEndVerseId: number | null;
  activeTab: BibleTabInfo | undefined;
  canGoBack: () => boolean;
  goBackWithScroll: () => void;
  handlePreviousChapter: () => void;
  handleNextChapter: () => void;
  setCopyOptionsDialog: React.Dispatch<React.SetStateAction<CopyOptionsDialogState | null>>;
  buildSelectionFromDOM: () => (WordSelection & { hasExistingMarkup: boolean }) | null;
  dismissFloatingToolbar: () => void;
  highlightRepository: IPCHighlightRepository;
  loadChapter: (book: number, chapter: number) => void;
}

/**
 * Handles all keyboard shortcuts for the Bible pane:
 * - Ctrl+C: copy selected text / open copy dialog
 * - Alt+Left: navigation history (back)
 * - Alt+Up/Down: chapter navigation
 * - Ctrl+G: go-to-verse
 * - Ctrl+D: bookmark the selected verse (or remove its bookmark)
 * - Ctrl+Shift+N: add note on selected verse
 * - Ctrl+Shift+H: apply highlight with last-used color
 * - Ctrl+U: apply underline
 */
export function useBibleKeyboard({
  panelId,
  currentBook,
  currentChapter,
  currentVerses,
  selectedVerseId,
  selectionEndVerseId,
  activeTab,
  canGoBack,
  goBackWithScroll,
  handlePreviousChapter,
  handleNextChapter,
  setCopyOptionsDialog,
  buildSelectionFromDOM,
  dismissFloatingToolbar,
  highlightRepository,
  loadChapter: _loadChapter,
}: UseBibleKeyboardParams) {
  const { createHighlight } = useHighlightStore();
  const { lastUsedColor } = useHighlightStore();

  // Ctrl+C handler
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (!((e.ctrlKey || e.metaKey) && e.key === 'c')) return;

      // Where is the caret? A DOM text selection inside the Bible pane means
      // the reader wants those words; one outside it means they are copying
      // something else entirely and this pane must keep its hands off.
      const selection = window.getSelection();
      const caretIsInBiblePane = selection !== null
        && selection.rangeCount > 0
        && isInsideBibleText(selection.getRangeAt(0).commonAncestorContainer);

      if (caretIsInBiblePane && hasTextSelection()) {
        e.preventDefault();
        e.stopPropagation();
        const selectedText = selection?.toString() || '';
        const normalized = selectedText
          .replace(/\s+/g, ' ')
          .replace(/\u00B6/g, '')
          .trim();
        copyToClipboard(normalized);
        return;
      }

      // No Bible-pane caret. The pane can still own this Ctrl+C - a verse
      // selection is a selection even when the DOM holds no caret - but only
      // once we are sure the keystroke was not meant for something else.
      //
      // This is the gap the reader can hit: Ctrl+L, "John 3:16", Enter leaves
      // the caret in the search box (which then blurs, planting no caret in
      // the pane), and shift+click deliberately preventDefaults its mousedown
      // so it leaves no DOM selection either. A gate that asks only where the
      // caret is would show verses 16-17 as selected with Ctrl+C doing
      // nothing - clicking a verse first would "fix" it purely by planting
      // one.
      if (isEditableTarget(document.activeElement)) return;

      // A text selection somewhere else on screen is that widget's to copy.
      if (!caretIsInBiblePane && hasTextSelection()) return;

      // With several Bible panes open, only the one the reader was last in
      // should answer - every pane installs this same window listener. Matches
      // how `navigateToVerseInPrimary` picks its target pane.
      const lastActiveBibleId = useLayoutStore.getState().lastActiveBiblePanelId; // allow-getstate: event handler - reads latest focus tracking, not a render
      if (lastActiveBibleId && lastActiveBibleId !== panelId) return;

      if (selectedVerseId) {
        e.preventDefault();
        e.stopPropagation();
        // Shift-click can have widened the selection past the anchor, and the
        // copy dialog takes an array - so hand it the whole passage. With no
        // extension the range is the anchor alone and this is the single-verse
        // copy it always was.
        const range = computeSelectedRange(selectedVerseId, selectionEndVerseId);
        const verses = range
          ? currentVerses.filter(v => v.verse_id >= range.start && v.verse_id <= range.end)
          : [];
        if (verses.length > 0) {
          setCopyOptionsDialog({ visible: true, verses });
        }
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [currentVerses, selectedVerseId, selectionEndVerseId, setCopyOptionsDialog, panelId]);

  // Alt+Left for navigation history. There is deliberately no Alt+Right: the
  // pane has no forward button either - anything ahead of the cursor is
  // reachable by name from the history menu.
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.altKey && e.key === 'ArrowLeft' && canGoBack()) {
        e.preventDefault();
        goBackWithScroll();
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [canGoBack, goBackWithScroll]);

  // Alt+Up/Down for chapter navigation, Ctrl+G, Ctrl+Shift+N
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.altKey && !e.ctrlKey && !e.metaKey && e.key === 'ArrowUp') {
        e.preventDefault();
        handlePreviousChapter();
        return;
      }
      if (e.altKey && !e.ctrlKey && !e.metaKey && e.key === 'ArrowDown') {
        e.preventDefault();
        handleNextChapter();
        return;
      }
      if ((e.ctrlKey || e.metaKey) && !e.shiftKey && e.key.toLowerCase() === 'g') {
        e.preventDefault();
        const searchInput = document.querySelector<HTMLInputElement>('[data-testid="search-input"]');
        if (searchInput) {
          searchInput.focus();
          searchInput.select();
        }
        return;
      }
      // Ctrl+D: the fast path. Adds the selection without asking for a name
      // - naming happens in the manager, so the shortcut never blocks. A
      // second press on a bookmarked verse removes it, which is what the
      // toolbar menu's Remove Bookmark does too.
      if ((e.ctrlKey || e.metaKey) && !e.shiftKey && e.key.toLowerCase() === 'd') {
        if (isEditableTarget(document.activeElement)) return;
        e.preventDefault();
        if (selectedVerseId) {
          const end =
            selectionEndVerseId !== null && selectionEndVerseId !== selectedVerseId
              ? selectionEndVerseId
              : undefined;
          useBookmarkStore
            .getState()
            .toggleVerseBookmark(selectedVerseId, end, activeTab?.moduleId)
            .catch(error => {
              console.error('[BiblePane] Failed to toggle bookmark via shortcut:', error);
            });
        }
        return;
      }

      if ((e.ctrlKey || e.metaKey) && e.shiftKey && e.key.toLowerCase() === 'n') {
        e.preventDefault();
        if (selectedVerseId) {
          const notesStore = useNotesStore.getState();
          notesStore.createNote({
            title: `Note on verse ${selectedVerseId}`,
            content: '',
            contentFormat: 'html',
            noteType: 'verse_note',
            visibility: 'private',
            tags: [],
            verseIdStart: selectedVerseId,
            verseIdEnd: selectedVerseId,
          }).catch(error => {
            console.error('[BiblePane] Failed to create note via shortcut:', error);
          });
        }
        return;
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [
    currentBook,
    currentChapter,
    selectedVerseId,
    selectionEndVerseId,
    activeTab,
    handlePreviousChapter,
    handleNextChapter,
  ]);

  // Ctrl+Shift+H: highlight, Ctrl+U: underline
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.shiftKey && e.key.toLowerCase() === 'h') {
        e.preventDefault();
        e.stopPropagation();

        const selectionData = buildSelectionFromDOM();
        if (!selectionData || !activeTab?.moduleId) return;

        const { startVerseId, startWordIndex, endVerseId, endWordIndex } = selectionData;
        const markup = new UserTextMarkup({
          moduleId: activeTab.moduleId,
          verseIdStart: startVerseId,
          verseIdEnd: endVerseId,
          textStart: startWordIndex,
          textEnd: endWordIndex,
          color: lastUsedColor,
          metadata: { markupType: 'highlight' as MarkupType, version: 1 }
        });

        createHighlight(markup as any, highlightRepository)
          .then(() => {
            window.getSelection()?.removeAllRanges();
            dismissFloatingToolbar();
          })
          .catch(error => console.error('[BiblePane] Failed to apply highlight via shortcut:', error));
        return;
      }

      if ((e.ctrlKey || e.metaKey) && !e.shiftKey && e.key.toLowerCase() === 'u') {
        e.preventDefault();
        e.stopPropagation();

        const selectionData = buildSelectionFromDOM();
        if (!selectionData || !activeTab?.moduleId) return;

        const { startVerseId, startWordIndex, endVerseId, endWordIndex } = selectionData;
        const markup = new UserTextMarkup({
          moduleId: activeTab.moduleId,
          verseIdStart: startVerseId,
          verseIdEnd: endVerseId,
          textStart: startWordIndex,
          textEnd: endWordIndex,
          color: lastUsedColor,
          metadata: {
            markupType: 'underline' as MarkupType,
            underlineStyle: 'solid',
            underlineColor: lastUsedColor,
            version: 1
          }
        });

        createHighlight(markup as any, highlightRepository)
          .then(() => {
            window.getSelection()?.removeAllRanges();
            dismissFloatingToolbar();
          })
          .catch(error => console.error('[BiblePane] Failed to apply underline via shortcut:', error));
        return;
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [activeTab, lastUsedColor, createHighlight, highlightRepository, buildSelectionFromDOM, dismissFloatingToolbar]);
}

/**
 * Manages find-in-page (Ctrl+F) match highlighting and navigation.
 * Separated from the main keyboard hook because it has its own state lifecycle.
 */
export function useBibleFind(
  bibleTextRef: React.RefObject<HTMLDivElement | null>,
  currentVerses: any[],
) {
  const {
    isVisible: isFindVisible,
    query: findQuery,
    matches: findMatches,
    currentMatchIndex,
    isCaseSensitive,
    setMatches: setFindMatches
  } = useFindStore();

  const prevMatchesLengthRef = { current: 0 };

  // Find matches when query or verses change
  useEffect(() => {
    if (!isFindVisible || !findQuery || findQuery.length === 0) {
      if (prevMatchesLengthRef.current > 0) {
        setFindMatches([]);
        prevMatchesLengthRef.current = 0;
      }
      return;
    }

    const newMatches: FindMatch[] = [];
    const searchQuery = isCaseSensitive ? findQuery : findQuery.toLowerCase();

    for (const verse of currentVerses) {
      const verseText = verse.text || '';
      const wordsInfo = extractWordsWithFormatting(verseText);

      wordsInfo.forEach((wordInfo, wordIndex) => {
        const wordToSearch = isCaseSensitive ? wordInfo.text : wordInfo.text.toLowerCase();
        if (wordToSearch.includes(searchQuery)) {
          newMatches.push({ verseId: verse.verse_id, wordIndex });
        }
      });
    }

    setFindMatches(newMatches);
    prevMatchesLengthRef.current = newMatches.length;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [findQuery, currentVerses, isFindVisible, isCaseSensitive]);

  // Apply find highlights to DOM and scroll to current match
  useEffect(() => {
    if (!bibleTextRef.current) return;

    const allWords = bibleTextRef.current.querySelectorAll('.word');
    allWords.forEach(word => {
      word.classList.remove('find-match', 'find-match-current');
    });

    if (!isFindVisible || findMatches.length === 0) return;

    findMatches.forEach((match, index) => {
      const verseContainer = bibleTextRef.current?.querySelector(`[data-verse-id="${match.verseId}"]`);
      if (!verseContainer) return;

      const wordElement = verseContainer.querySelector(`[data-word-index="${match.wordIndex}"]`);
      if (wordElement) {
        wordElement.classList.add('find-match');
        if (index === currentMatchIndex) {
          wordElement.classList.add('find-match-current');
          wordElement.scrollIntoView({ behavior: 'smooth', block: 'center' });
        }
      }
    });
  }, [findMatches, currentMatchIndex, isFindVisible, bibleTextRef]);
}
