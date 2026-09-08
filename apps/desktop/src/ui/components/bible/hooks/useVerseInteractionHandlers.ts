import React, { useCallback } from 'react';
import { BibleVerse as BibleVerseCopy, hasTextSelection, getSelectedVerseIds } from '../../../services/verseCopyService';
import { useNotesStore } from '../../../stores/useNotesStore';
import { syncPanesWithVerse } from '../../../stores/syncPanesWithVerse';
import { useDictionaryStore } from '../../../stores/useDictionaryStore';
import { ContextMenuState } from '../../BiblePaneContext';
import { revealNotesPanel } from '../revealNotesPanel';
import { openStrongsInDictionary } from '../openStrongsInDictionary';
import { captureWordSelection } from '../../highlights/capturedSelection';
import { computeSelectedRange } from '../../../stores/bible/internals/verseRange';

/**
 * Bundles the verse-level interaction callbacks: click (with cross-pane sync),
 * Strong's lookup, the right-click context menu builder, and note-indicator click.
 *
 * Reads from currentVerses + the floating-toolbar dismiss callback.
 */
export function useVerseInteractionHandlers(args: {
  currentVerses: any[];
  setSelectedVerse: (verseId: number) => void;
  /** Shift-click: widen the selection without moving the anchor. */
  extendSelectionTo: (verseId: number) => void;
  /** The current anchor, and the far end of a shift-click range (or null). */
  selectedVerseId: number | null;
  selectionEndVerseId: number | null;
  setContextMenu: React.Dispatch<React.SetStateAction<ContextMenuState | null>>;
  setNoteTooltipHidden: () => void;
  dismissFloatingToolbar: () => void;
}) {
  const {
    currentVerses, setSelectedVerse, extendSelectionTo,
    selectedVerseId, selectionEndVerseId,
    setContextMenu, setNoteTooltipHidden, dismissFloatingToolbar,
  } = args;

  // Only the Notes pane is still read as a hook here - the note-indicator
  // handler needs it on its own, without the other three. The four-way fan-out
  // moved to `syncPanesWithVerse` so paths other than a click can reuse it.
  const { syncAllPanelsWithVerse: syncAllNotesPanelsWithVerse } = useNotesStore();
  const { setStudyPaneActiveTab } = useDictionaryStore();

  /**
   * Click a verse. `extend` is the shift key: it widens the passage out to
   * this verse instead of choosing a new one.
   *
   * The extend branch returns early, deliberately skipping all four cross-pane
   * syncs. The anchor has not moved - `selectedVerseId` is still the verse the
   * reader chose - so commentary, notes, study and topics panes have nothing
   * to reload, and reloading them would make a shift-click look like a
   * navigation. Matches the web app's `handleVerseClick` in `BibleContent`.
   */
  const handleVerseClick = useCallback((verseId: number, extend: boolean = false) => {
    if (extend) {
      extendSelectionTo(verseId);
      return;
    }
    setSelectedVerse(verseId);
    syncPanesWithVerse(verseId);
  }, [setSelectedVerse, extendSelectionTo]);

  /**
   * Strong's number click: open the full lexicon entry in the Dictionary pane.
   *
   * The three steps that takes - and why each is needed - live in
   * `openStrongsInDictionary`, shared with the Strong's search header so both
   * routes to "the full entry" land in the same place.
   */
  const handleStrongsClick = useCallback(async (strongsNumber: string) => {
    await openStrongsInDictionary(strongsNumber);
  }, []);

  /**
   * The note indicator beside a verse: reveal the note it stands for.
   *
   * Nudging only the notes *store* would do nothing with no Notes pane in the
   * layout - the default. Adding or activating the pane first is what makes
   * the gesture land; the store work then has somewhere to show up.
   */
  const handleNoteIndicatorClick = useCallback(async (e: React.MouseEvent, verseId: number) => {
    e.stopPropagation();
    setNoteTooltipHidden();

    // Select the verse too, so the Bible pane agrees with the note that opens.
    setSelectedVerse(verseId);

    try {
      setStudyPaneActiveTab('notes');
      revealNotesPanel();

      // Two frames: enough for a just-created Notes pane to mount and register
      // itself with the notes store before it is asked to sync and open.
      requestAnimationFrame(() => {
        requestAnimationFrame(() => {
          try {
            syncAllNotesPanelsWithVerse(verseId);
            window.dispatchEvent(new CustomEvent('open-verse-note'));
          } catch (error) {
            console.error('Failed to open the verse note:', error);
          }
        });
      });
    } catch (error) {
      console.error('Failed to reveal the notes pane:', error);
    }
  }, [syncAllNotesPanelsWithVerse, setStudyPaneActiveTab, setNoteTooltipHidden, setSelectedVerse]);

  const handleVerseContextMenu = useCallback((event: React.MouseEvent, verse: any) => {
    event.preventDefault();
    event.stopPropagation();

    dismissFloatingToolbar();

    /*
      Snapshot the selection NOW, while it is still the one the user made.
      The highlight branch of this menu runs after a click on a menu item, and
      re-reading window.getSelection() at that point can find it collapsed -
      treating that as "nothing selected" would silently highlight the whole
      verse instead. Scoped to this pane's Bible text so a second Bible pane's
      words can't join the selection.
    */
    const target = event.target as HTMLElement;
    const paneRoot = target.closest('.pane-content-bible') ?? document;
    captureWordSelection(paneRoot);

    const hasSelection = hasTextSelection();
    let markupId: number | undefined;
    if (target.classList?.contains('word') && target.hasAttribute('data-markup-id')) {
      const markupIdStr = target.getAttribute('data-markup-id');
      if (markupIdStr) {
        markupId = parseInt(markupIdStr, 10);
      }
    }

    let versesToCopy: BibleVerseCopy[] = [verse];
    let isMultiple = false;

    /*
      A shift-click passage wins over the single right-clicked verse, so
      "select five verses, right-click, Copy" copies the five. Only when the
      click lands INSIDE the range - right-clicking elsewhere is a fresh
      gesture about that verse, not about the passage.

      A live DOM text selection still takes precedence below: shift-click
      preventDefaults its mousedown precisely so it leaves none, so if one
      exists the reader made it afterwards and it is the more recent intent.
    */
    const shiftRange = computeSelectedRange(selectedVerseId, selectionEndVerseId);
    if (!hasSelection && shiftRange && selectionEndVerseId !== null
        && verse.verse_id >= shiftRange.start && verse.verse_id <= shiftRange.end) {
      const rangeVerses = currentVerses.filter(
        v => v.verse_id >= shiftRange.start && v.verse_id <= shiftRange.end
      );
      if (rangeVerses.length > 1) {
        versesToCopy = rangeVerses;
        isMultiple = true;
      }
    }

    if (hasSelection) {
      const selectedVerseIds = getSelectedVerseIds();
      if (selectedVerseIds.length > 1) {
        isMultiple = true;
        versesToCopy = currentVerses.filter(v => selectedVerseIds.includes(v.verse_id));
        if (versesToCopy.length === 0) {
          versesToCopy = [verse];
          isMultiple = false;
        }
      } else if (selectedVerseIds.length === 1) {
        const selectedVerse = currentVerses.find(v => v.verse_id === selectedVerseIds[0]);
        if (selectedVerse) {
          versesToCopy = [selectedVerse];
        }
      }
    }

    setContextMenu({
      visible: true,
      verses: versesToCopy,
      position: { x: event.clientX, y: event.clientY },
      isMultiple,
      markupId
    });
  }, [currentVerses, dismissFloatingToolbar, setContextMenu, selectedVerseId, selectionEndVerseId]);

  return {
    handleVerseClick,
    handleStrongsClick,
    handleNoteIndicatorClick,
    handleVerseContextMenu,
    syncAllNotesPanelsWithVerse,
    setStudyPaneActiveTab,
  };
}
