import { useState, useEffect, useCallback, useRef } from 'preact/hooks';
import { bibleStore } from '../stores/bibleStore';
import { commentaryStore } from '../stores/commentaryStore';
import { searchStore } from '../stores/searchStore';
import { settingsStore } from '../stores/settingsStore';
import { eventBus } from '../events/eventBus';
import { keybindingRegistry } from '../plugins/registries/KeybindingRegistry';
import { useStore } from './useStore';
import { parseVerseId } from '../utils/verseId';
import { focusSearchField } from '../utils/focusSearchField';
import type { IDataProviders } from '../providers/interfaces';
import type { StrongsEntryData } from '../types';

/**
 * Provides shared application-level state and callbacks (settings dialogs,
 * Strong's popups, keyboard shortcuts, verse selection syncing, etc.) that
 * are used by multiple top-level app shells (standalone and embedded).
 *
 * "Shared" means shared across different app entry points/layouts, not
 * shared with other packages.
 */
export function useAppShared(providers: IDataProviders) {
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [settingsSection, setSettingsSection] = useState<string | undefined>(undefined);
  const [helpOpen, setHelpOpen] = useState(false);
  const [feedbackOpen, setFeedbackOpen] = useState(false);
  const [copyOpen, setCopyOpen] = useState(false);
  const [strongsPopup, setStrongsPopup] = useState<{ entry: StrongsEntryData; position: { top: number; left: number } } | null>(null);
  const [strongsTooltip, setStrongsTooltip] = useState<{ entry: StrongsEntryData; position: { top: number; left: number } } | null>(null);

  const activeTab = useStore(bibleStore, () => bibleStore.getActiveTab());
  const displayMode = activeTab?.displayMode ?? 'standard';
  const collapsed = useStore(commentaryStore, () => commentaryStore.collapsed);
  const rightPaneMode = useStore(commentaryStore, () => commentaryStore.rightPaneMode);
  const searchIsOpen = useStore(searchStore, () => searchStore.isOpen);
  const searchSeq = useStore(searchStore, () => searchStore.searchSeq);
  const fontSize = useStore(settingsStore, () => settingsStore.fontSize);
  const lineHeight = useStore(settingsStore, () => settingsStore.lineHeight);
  const studyLineHeight = useStore(settingsStore, () => settingsStore.studyLineHeight);
  const studyFontSize = useStore(settingsStore, () => settingsStore.studyFontSize);
  const studyFontFamily = useStore(settingsStore, () => settingsStore.studyFontFamily);
  const fontFamily = useStore(settingsStore, () => settingsStore.fontFamily);
  const headingFontFamily = useStore(settingsStore, () => settingsStore.headingFontFamily);

  /**
   * Display mode drives the right pane's visibility, in both directions.
   *
   * Reading mode collapses it. Leaving reading mode for Standard or Study used
   * to leave it collapsed, so the study tools silently stayed gone and the only
   * way back was the collapsed pane's own narrow toggle — which reads as the
   * mode switch having half-worked.
   *
   * Only *transitions* act, never the first run: on mount the persisted
   * collapsed state is the user's, and forcing it open would throw it away.
   */
  const prevDisplayModeRef = useRef<string | null>(null);
  useEffect(() => {
    const previous = prevDisplayModeRef.current;
    prevDisplayModeRef.current = displayMode ?? null;

    if (displayMode === 'reading') {
      commentaryStore.collapse();
    } else if (previous !== null && previous !== displayMode) {
      commentaryStore.expand();
    }
    // Dismiss Strongs popup/tooltip when display mode changes (e.g. Study → Standard)
    hoverActiveRef.current = false;
    setStrongsPopup(null);
    setStrongsTooltip(null);
  }, [displayMode]);

  const handleStrongsClick = useCallback(async (strongsNumber: string) => {
    try {
      const entry = await providers.strongs.getEntry(strongsNumber);
      setStrongsTooltip(null);
      setStrongsPopup({
        entry,
        position: { top: window.innerHeight / 4, left: window.innerWidth / 4 },
      });
    } catch (e) {
      console.error('Failed to load Strong\'s entry:', e);
    }
  }, [providers.strongs]);

  const hoverActiveRef = useRef(false);

  const handleStrongsHover = useCallback(async (strongsNumber: string, rect: DOMRect) => {
    if (strongsPopup) return;
    hoverActiveRef.current = true;
    try {
      const entry = await providers.strongs.getEntry(strongsNumber);
      if (hoverActiveRef.current) {
        setStrongsTooltip({
          entry,
          position: { top: rect.bottom + 4, left: rect.left },
        });
      }
    } catch { /* ignore tooltip errors */ }
  }, [providers.strongs, strongsPopup]);

  const handleStrongsLeave = useCallback(() => {
    hoverActiveRef.current = false;
    setStrongsTooltip(null);
  }, []);

  // Clear tooltip when navigating to a different chapter or tab
  useEffect(() => {
    hoverActiveRef.current = false;
    setStrongsTooltip(null);
  }, [activeTab?.id, activeTab?.book, activeTab?.chapter]);

  const openSettings = useCallback((section?: string) => {
    setSettingsSection(section);
    setSettingsOpen(true);
  }, []);

  // Keyboard shortcuts
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.ctrlKey && e.key === 'c' && !window.getSelection()?.toString()) {
        e.preventDefault();
        setCopyOpen(true);
      }
      const isInputFocused = document.activeElement instanceof HTMLInputElement || document.activeElement instanceof HTMLTextAreaElement;
      // All three shortcuts select the existing text as well as focusing.
      // Without that, pressing "/" and typing appends to the previous query
      // rather than replacing it, so the natural slash-type-Enter gesture
      // searches for the two queries concatenated.
      if ((e.ctrlKey || e.metaKey) && e.key === 'k') {
        e.preventDefault();
        focusSearchField();
      }
      if (e.key === '/' && !isInputFocused && !e.ctrlKey && !e.metaKey && !e.altKey) {
        e.preventDefault();
        focusSearchField();
      }
      // Ctrl+G / Cmd+G: focus search bar for quick verse jump
      if ((e.ctrlKey || e.metaKey) && e.key === 'g') {
        e.preventDefault();
        focusSearchField();
      }
      // Delegate to plugin keybinding registry
      if (keybindingRegistry.hasBindings()) {
        keybindingRegistry.handleKeyEvent(e);
      }
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, []);

  // Sync study store when study verse changes
  const studyVerse = activeTab?.studyVerse;
  const activeBook = activeTab?.book;
  const activeChapter = activeTab?.chapter;
  const activeVerseFootnotes = activeTab?.verses?.find(
    v => v.verse_id === studyVerse
  )?.footnotes;
  useEffect(() => {
    if (studyVerse && activeBook && activeChapter) {
      // Only emit if studyVerse actually belongs to the current chapter.
      // During preview navigation, book/chapter change but studyVerse stays
      // on the old chapter — emitting would send mismatched data.
      const { bookNumber: svBook, chapter: svChapter, verse } = parseVerseId(studyVerse);
      if (svBook !== activeBook || svChapter !== activeChapter) return;
      eventBus.emit('bible:verse-selected', {
        verseId: studyVerse,
        book: activeBook,
        chapter: activeChapter,
        verse,
        footnotes: activeVerseFootnotes,
      });
    } else if (!studyVerse && activeBook && activeChapter) {
      // No verse selected — but don't emit during preview navigation
      // (previewVerse is set, meaning the user hasn't committed to this chapter)
      if (activeTab?.previewVerse) return;
      const fallbackVerseId = (activeBook * 1000000) + (activeChapter * 1000) + 1;
      eventBus.emit('bible:verse-selected', {
        verseId: fallbackVerseId,
        book: activeBook,
        chapter: activeChapter,
        verse: 1,
      });
    }
  }, [studyVerse, activeBook, activeChapter]);

  // Hash navigation
  useEffect(() => {
    if (window.location.hash) {
      bibleStore.navigateFromHash(window.location.hash);
    }
    const handleHashChange = () => {
      bibleStore.navigateFromHash(window.location.hash);
    };
    window.addEventListener('hashchange', handleHashChange);
    return () => window.removeEventListener('hashchange', handleHashChange);
  }, []);

  // Find the verse element nearest to a point in the bible-content area
  const findVerseAtPoint = useCallback((_target: HTMLElement, _clientX: number, clientY: number): { el: Element; verseId: number } | null => {
    let verseEl: Element | null = _target.closest('.verse');
    if (!verseEl) {
      const contentEl = _target.closest('.bible-content');
      if (!contentEl) return null;
      const verses = contentEl.querySelectorAll('.verse');
      let closest: Element | null = null;
      let closestDist = Infinity;
      for (const v of verses) {
        const rect = v.getBoundingClientRect();
        const dist = Math.abs(clientY - (rect.top + rect.height / 2));
        if (dist < closestDist) {
          closestDist = dist;
          closest = v;
        }
      }
      verseEl = closest;
    }
    if (!verseEl) return null;
    const verseId = Number(verseEl.getAttribute('data-verse-id'));
    return verseId ? { el: verseEl, verseId } : null;
  }, []);

  return {
    // State
    settingsOpen, setSettingsOpen,
    settingsSection,
    helpOpen, setHelpOpen,
    feedbackOpen, setFeedbackOpen,
    copyOpen, setCopyOpen,
    strongsPopup, setStrongsPopup,
    strongsTooltip,
    // Store values
    activeTab, displayMode, collapsed, rightPaneMode, searchIsOpen, searchSeq,
    fontSize, lineHeight, studyLineHeight, studyFontSize, studyFontFamily, fontFamily, headingFontFamily,
    // Handlers
    handleStrongsClick, handleStrongsHover, handleStrongsLeave,
    openSettings, findVerseAtPoint,
  };
}
