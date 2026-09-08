import { useEffect, useRef, useState, useCallback } from 'react';
import { useHighlightStore } from '../stores/useHighlightStore';
import { IPCHighlightRepository } from '../services/highlightsAPI';
import { HighlightColor, MarkupType, UnderlineStyle, UserTextMarkup } from '@bible/core';
import { WordSelection, HighlightMenuState, FloatingToolbarState, BibleTabInfo } from '../components/BiblePaneContext';
import {
  selectedWordElements,
  wordSelectionFromElements,
} from '../components/highlights/capturedSelection';

/**
 * Manages highlight state, the highlight color menu, and the floating annotation toolbar.
 *
 * Responsibilities:
 * - Load highlights when chapter changes
 * - Create / delete highlights
 * - Show/hide the highlight color picker menu
 * - Show/hide the floating annotation toolbar after text selection
 * - Build selection data from DOM
 */
export function useBibleHighlights(
  activeTab: BibleTabInfo | undefined,
  currentBook: number,
  currentChapter: number,
  currentVerses: any[],
  bibleTextRef: React.RefObject<HTMLDivElement | null>,
) {
  const highlightRepository = useRef<IPCHighlightRepository>(new IPCHighlightRepository()).current;
  const {
    loadHighlightsForVerseRange,
    createHighlight,
    deleteHighlight,
    lastUsedColor,
    setLastUsedColor,
    recordMarkupStyle,
  } = useHighlightStore();

  // Highlight menu state
  const [highlightMenu, setHighlightMenu] = useState<HighlightMenuState>({
    visible: false,
    position: { x: 0, y: 0 },
    selection: null
  });

  // Floating annotation toolbar state
  const [floatingToolbar, setFloatingToolbar] = useState<FloatingToolbarState>({
    visible: false,
    selection: null,
    hasExistingMarkup: false
  });

  // Load highlights when chapter/verses change
  useEffect(() => {
    if (currentVerses.length > 0 && activeTab) {
      const startVerseId = currentVerses[0].verse_id;
      const endVerseId = currentVerses[currentVerses.length - 1].verse_id;
      const moduleId = activeTab.moduleId;

      if (moduleId) {
        loadHighlightsForVerseRange(moduleId, startVerseId, endVerseId, highlightRepository);
      }
    }
  }, [currentBook, currentChapter, activeTab, currentVerses.length, loadHighlightsForVerseRange, highlightRepository]);

  /**
   * Build a selection state object from the current DOM text selection.
   * Returns null if no valid word-level selection is found.
   */
  const buildSelectionFromDOM = useCallback((): (WordSelection & { hasExistingMarkup: boolean }) | null => {
    const selection = window.getSelection();
    if (!selection || selection.isCollapsed || selection.rangeCount === 0) return null;

    const range = selection.getRangeAt(0);

    // Only process selections within the Bible text area
    const container = range.commonAncestorContainer;
    let currentElement: Node | null = container;
    let isWithinBibleText = false;
    while (currentElement && currentElement !== document.body) {
      if (currentElement instanceof Element) {
        if (
          currentElement.classList?.contains('bible-text') ||
          currentElement.classList?.contains('pane-content-bible') ||
          currentElement.hasAttribute('data-verse-id')
        ) {
          isWithinBibleText = true;
          break;
        }
      }
      currentElement = currentElement.parentNode;
    }
    if (!isWithinBibleText) return null;

    // Find all selected word elements, scoped to THIS pane's text.
    const root = bibleTextRef.current;
    if (!root) return null;

    const selectedWords = selectedWordElements(range, root);
    const wordSelection = wordSelectionFromElements(selectedWords);
    if (!wordSelection) return null;

    return {
      ...wordSelection,
      hasExistingMarkup: selectedWords.some(w => w.hasAttribute('data-markup-id')),
    };
  }, [bibleTextRef]);

  /**
   * Show the floating toolbar after text selection completes.
   */
  const showFloatingToolbar = useCallback(() => {
    if (highlightMenu.visible) return;

    const selectionData = buildSelectionFromDOM();
    if (!selectionData) {
      setFloatingToolbar({ visible: false, selection: null, hasExistingMarkup: false });
      return;
    }

    setFloatingToolbar({
      visible: true,
      selection: {
        startVerseId: selectionData.startVerseId,
        startWordIndex: selectionData.startWordIndex,
        endVerseId: selectionData.endVerseId,
        endWordIndex: selectionData.endWordIndex,
      },
      hasExistingMarkup: selectionData.hasExistingMarkup,
    });
  }, [highlightMenu.visible, buildSelectionFromDOM]);

  const dismissFloatingToolbar = useCallback(() => {
    setFloatingToolbar({ visible: false, selection: null, hasExistingMarkup: false });
  }, []);

  // Show highlight menu (dismisses floating toolbar first)
  const handleShowHighlightMenu = useCallback((
    position: { x: number; y: number },
    selection: WordSelection
  ) => {
    dismissFloatingToolbar();
    setHighlightMenu({ visible: true, position, selection });
  }, [dismissFloatingToolbar]);

  /**
   * Apply a fully-specified style - the one path that takes all four fields.
   *
   * Both surfaces that can name a whole style feed it: the full HighlightMenu,
   * and the floating toolbar's "Recent" row (whose swatches replay a remembered
   * style in one click, without opening the menu). So the selection comes from
   * whichever surface is actually open, rather than from the menu alone; the
   * toolbar's recents fire while `highlightMenu.selection` is still null.
   */
  const handleSelectHighlight = useCallback(async (
    color: HighlightColor,
    markupType: MarkupType,
    underlineStyle?: UnderlineStyle,
    underlineColor?: HighlightColor
  ) => {
    const fromToolbar = !highlightMenu.selection;
    const activeSelection = highlightMenu.selection ?? floatingToolbar.selection;
    if (!activeSelection || !activeTab) return;
    if (!activeTab.moduleId) {
      console.error('Cannot create highlight: moduleId is undefined for tab', activeTab.abbreviation);
      setHighlightMenu({ visible: false, position: { x: 0, y: 0 }, selection: null });
      return;
    }

    const { startVerseId, startWordIndex, endVerseId, endWordIndex } = activeSelection;
    setLastUsedColor(color);

    const markup = new UserTextMarkup({
      moduleId: activeTab.moduleId,
      verseIdStart: startVerseId,
      verseIdEnd: endVerseId,
      textStart: startWordIndex,
      textEnd: endWordIndex,
      color,
      metadata: { markupType, underlineStyle, underlineColor, version: 1 }
    });

    try {
      await createHighlight(markup as any, highlightRepository);
      // Only a mark that actually saved is worth offering back.
      recordMarkupStyle({ markupType, color, underlineStyle, underlineColor });
    } catch (error) {
      console.error('Failed to create highlight:', error);
    }

    setHighlightMenu({ visible: false, position: { x: 0, y: 0 }, selection: null });
    if (fromToolbar) {
      // The toolbar path leaves the browser selection standing; clear it so the
      // new mark is visible rather than sitting under the selection wash.
      window.getSelection()?.removeAllRanges();
      dismissFloatingToolbar();
    }
  }, [
    highlightMenu.selection,
    floatingToolbar.selection,
    activeTab,
    setLastUsedColor,
    recordMarkupStyle,
    createHighlight,
    highlightRepository,
    dismissFloatingToolbar,
  ]);

  const handleCancelHighlightMenu = useCallback(() => {
    setHighlightMenu({ visible: false, position: { x: 0, y: 0 }, selection: null });
  }, []);

  // Remove a highlight
  const handleRemoveHighlight = useCallback(async (markupId: number) => {
    if (!activeTab?.moduleId) {
      console.error('Cannot remove highlight: moduleId is undefined for tab', activeTab?.abbreviation);
      return;
    }
    try {
      await deleteHighlight(markupId, activeTab.moduleId, highlightRepository);
    } catch (error) {
      console.error('[BiblePane] Failed to remove highlight:', error);
    }
  }, [activeTab, deleteHighlight, highlightRepository]);

  // Floating toolbar: quick highlight
  const handleFloatingHighlight = useCallback(async (color: HighlightColor) => {
    if (!floatingToolbar.selection || !activeTab?.moduleId) return;

    setLastUsedColor(color);
    const { startVerseId, startWordIndex, endVerseId, endWordIndex } = floatingToolbar.selection;
    const markup = new UserTextMarkup({
      moduleId: activeTab.moduleId,
      verseIdStart: startVerseId,
      verseIdEnd: endVerseId,
      textStart: startWordIndex,
      textEnd: endWordIndex,
      color,
      metadata: { markupType: 'highlight' as MarkupType, version: 1 }
    });

    try {
      await createHighlight(markup as any, highlightRepository);
      recordMarkupStyle({ markupType: 'highlight', color });
    } catch (error) {
      console.error('[BiblePane] Failed to create highlight from floating toolbar:', error);
    }

    window.getSelection()?.removeAllRanges();
    dismissFloatingToolbar();
  }, [floatingToolbar.selection, activeTab, createHighlight, highlightRepository, dismissFloatingToolbar, setLastUsedColor, recordMarkupStyle]);

  // Floating toolbar: underline
  const handleFloatingUnderline = useCallback(async () => {
    if (!floatingToolbar.selection || !activeTab?.moduleId) return;

    const { startVerseId, startWordIndex, endVerseId, endWordIndex } = floatingToolbar.selection;
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

    try {
      await createHighlight(markup as any, highlightRepository);
      recordMarkupStyle({
        markupType: 'underline',
        color: lastUsedColor,
        underlineStyle: 'solid',
        underlineColor: lastUsedColor,
      });
    } catch (error) {
      console.error('[BiblePane] Failed to create underline from floating toolbar:', error);
    }

    window.getSelection()?.removeAllRanges();
    dismissFloatingToolbar();
  }, [floatingToolbar.selection, activeTab, lastUsedColor, createHighlight, highlightRepository, dismissFloatingToolbar, recordMarkupStyle]);

  // Floating toolbar: remove formatting
  const handleFloatingRemoveFormatting = useCallback(async () => {
    if (!activeTab?.moduleId) return;

    const selection = window.getSelection();
    if (!selection || selection.isCollapsed || selection.rangeCount === 0) return;

    const range = selection.getRangeAt(0);
    const allWords = bibleTextRef.current?.querySelectorAll('.word');
    if (!allWords) return;

    const markupIdsToRemove = new Set<number>();
    allWords.forEach(word => {
      const wordElement = word as HTMLElement;
      if (range.intersectsNode(wordElement) && wordElement.hasAttribute('data-markup-id')) {
        const ids = wordElement.getAttribute('data-markup-id')?.split(',') || [];
        ids.forEach(id => {
          const parsed = parseInt(id, 10);
          if (!isNaN(parsed)) markupIdsToRemove.add(parsed);
        });
      }
    });

    for (const markupId of markupIdsToRemove) {
      try {
        await deleteHighlight(markupId, activeTab.moduleId, highlightRepository);
      } catch (error) {
        console.error('[BiblePane] Failed to remove highlight:', markupId, error);
      }
    }

    window.getSelection()?.removeAllRanges();
    dismissFloatingToolbar();
  }, [activeTab, deleteHighlight, highlightRepository, dismissFloatingToolbar, bibleTextRef]);

  return {
    highlightRepository,
    highlightMenu,
    setHighlightMenu,
    handleSelectHighlight,
    handleCancelHighlightMenu,
    handleRemoveHighlight,
    handleShowHighlightMenu,
    floatingToolbar,
    handleFloatingHighlight,
    handleFloatingUnderline,
    handleFloatingRemoveFormatting,
    dismissFloatingToolbar,
    showFloatingToolbar,
    buildSelectionFromDOM,
  };
}
