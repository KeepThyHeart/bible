import React from 'react';
import { useBibleStore } from '../stores/useBibleStore';
import { revealNotesPanel } from './bible/revealNotesPanel';
import VerseContextMenu from './VerseContextMenu';
import CopyOptionsDialog from './CopyOptionsDialog';
import ModuleSelector, { ModuleItem } from './ModuleSelector';
import BookChapterPicker from './BookChapterPicker';
import { HighlightMenu } from './highlights/HighlightMenu';
import { FloatingAnnotationToolbar } from './highlights/FloatingAnnotationToolbar';
import {
  takeCapturedWordSelection,
  clearCapturedWordSelection,
  readWordSelection,
} from './highlights/capturedSelection';
import NotePreviewTooltip from './NotePreviewTooltip';
import { BibleVerse as BibleVerseCopy } from '../services/verseCopyService';
import { HighlightColor, MarkupType, UnderlineStyle } from '@bible/core';
import { StudyPaneTab } from '../stores/useDictionaryStore';
import { useI18n } from '../contexts/useI18n';
import { useEscapeKey } from '../hooks/useOverlayDismissal';
import { useBookmarkStore } from '../stores/useBookmarkStore';

interface BibleTabInfo {
  tabId: string;
  abbreviation: string;
  name: string;
  book: number;
  bookName: string;
  chapter: number;
  moduleId?: number;
  selectedVerseId?: number | null;
  displayMode: string;
}

interface AvailableBible {
  abbreviation: string;
  name: string;
  language_code?: string;
  version?: string;
}

export interface BiblePaneOverlaysProps {
  // Book/Chapter Picker.
  // One panel shows one passage, so picking a book/chapter always navigates
  // *this* passage. Reading somewhere else alongside it means opening another
  // panel, which is the dockview "+" / Ctrl-click path, not this dialog.
  showBookPicker: boolean;
  setShowBookPicker: React.Dispatch<React.SetStateAction<boolean>>;
  currentBook: number;
  currentChapter: number;
  currentBookName: string;
  panelId: string;

  // Module Selector
  showSelector: boolean;
  setShowSelector: React.Dispatch<React.SetStateAction<boolean>>;
  versionSelectorTabId: string | null;
  setVersionSelectorTabId: React.Dispatch<React.SetStateAction<string | null>>;
  availableBibles: AvailableBible[];
  loadingBibles: boolean;
  openTabs: BibleTabInfo[];
  openBible: (abbreviation: string, name: string) => void;
  changeTabVersion: (tabId: string, abbreviation: string, name: string) => void;

  // Parallel Picker
  showParallelPicker: boolean;
  setShowParallelPicker: React.Dispatch<React.SetStateAction<boolean>>;
  parallelSelections: string[];
  setParallelSelections: React.Dispatch<React.SetStateAction<string[]>>;
  isParallelViewMode: boolean;
  toggleParallelView: () => void;

  // Context Menu
  contextMenu: {
    visible: boolean;
    verses: BibleVerseCopy[];
    position: { x: number; y: number };
    isMultiple: boolean;
    markupId?: number;
  } | null;
  setContextMenu: React.Dispatch<React.SetStateAction<{
    visible: boolean;
    verses: BibleVerseCopy[];
    position: { x: number; y: number };
    isMultiple: boolean;
    markupId?: number;
  } | null>>;
  activeTab: BibleTabInfo | undefined;
  handleRemoveHighlight: (markupId: number) => Promise<void>;
  syncAllNotesPanelsWithVerse: (verseId: number) => void;
  setSelectedVerse: (verseId: number) => void;
  setStudyPaneActiveTab: (tab: StudyPaneTab) => void;

  // Copy Options Dialog
  copyOptionsDialog: {
    visible: boolean;
    verses: BibleVerseCopy[];
  } | null;
  setCopyOptionsDialog: React.Dispatch<React.SetStateAction<{
    visible: boolean;
    verses: BibleVerseCopy[];
  } | null>>;

  // Highlight Menu
  highlightMenu: {
    visible: boolean;
    position: { x: number; y: number };
    selection: {
      startVerseId: number;
      startWordIndex: number;
      endVerseId?: number;
      endWordIndex?: number;
    } | null;
  };
  setHighlightMenu: React.Dispatch<React.SetStateAction<{
    visible: boolean;
    position: { x: number; y: number };
    selection: {
      startVerseId: number;
      startWordIndex: number;
      endVerseId?: number;
      endWordIndex?: number;
    } | null;
  }>>;
  handleSelectHighlight: (
    color: HighlightColor,
    markupType: MarkupType,
    underlineStyle?: UnderlineStyle,
    underlineColor?: HighlightColor
  ) => Promise<void>;
  handleCancelHighlightMenu: () => void;

  // Floating Annotation Toolbar
  floatingToolbar: {
    visible: boolean;
    selection: {
      startVerseId: number;
      startWordIndex: number;
      endVerseId?: number;
      endWordIndex?: number;
    } | null;
    hasExistingMarkup: boolean;
  };
  handleFloatingHighlight: (color: HighlightColor) => Promise<void>;
  handleFloatingUnderline: () => Promise<void>;
  handleFloatingRemoveFormatting: () => Promise<void>;
  dismissFloatingToolbar: () => void;

  // Note Preview Tooltip
  noteTooltip: {
    visible: boolean;
    verseId: number;
    position: { x: number; y: number };
  };
  setNoteTooltip: React.Dispatch<React.SetStateAction<{
    visible: boolean;
    verseId: number;
    position: { x: number; y: number };
  }>>;
  handleNoteTooltipClose: () => void;
  handleNoteTooltipEnter: () => void;
}

const BiblePaneOverlays: React.FC<BiblePaneOverlaysProps> = ({
  showBookPicker,
  setShowBookPicker,
  currentBook,
  currentChapter,
  currentBookName,
  panelId,
  showSelector,
  setShowSelector,
  versionSelectorTabId,
  setVersionSelectorTabId,
  availableBibles,
  loadingBibles,
  openTabs,
  openBible,
  changeTabVersion,
  showParallelPicker,
  setShowParallelPicker,
  parallelSelections,
  setParallelSelections,
  isParallelViewMode,
  toggleParallelView,
  contextMenu,
  setContextMenu,
  activeTab,
  handleRemoveHighlight,
  syncAllNotesPanelsWithVerse,
  setSelectedVerse,
  setStudyPaneActiveTab,
  copyOptionsDialog,
  setCopyOptionsDialog,
  highlightMenu,
  setHighlightMenu,
  handleSelectHighlight,
  handleCancelHighlightMenu,
  floatingToolbar,
  handleFloatingHighlight,
  handleFloatingUnderline,
  handleFloatingRemoveFormatting,
  dismissFloatingToolbar,
  noteTooltip,
  setNoteTooltip,
  handleNoteTooltipClose,
  handleNoteTooltipEnter,
}) => {
  const { t } = useI18n();

  const bookmarks = useBookmarkStore(s => s.bookmarks);
  const bookmarkedVerses = useBookmarkStore(s => s.bookmarkedVerses);
  const addBookmark = useBookmarkStore(s => s.addBookmark);
  const replaceBookmarkRef = useBookmarkStore(s => s.replaceBookmarkRef);
  const removeVerseFromAllCollections = useBookmarkStore(s => s.removeVerseFromAllCollections);
  const loadBookmarks = useBookmarkStore(s => s.loadBookmarks);

  /**
   * What the context menu's bookmark actions should point at.
   *
   * A right-click on a multi-verse selection bookmarks the whole passage,
   * not just the verse under the cursor - the selection is what the reader
   * means by "this". `end` is undefined for a single verse so the service
   * stores it as a verse rather than a one-verse range.
   */
  const contextMenuVerseRange = (): { start: number; end?: number } | null => {
    const verses = contextMenu?.verses ?? [];
    const start = verses[0]?.verse_id;
    if (start === undefined) return null;
    const last = verses[verses.length - 1]?.verse_id;
    return { start, end: last !== undefined && last !== start ? last : undefined };
  };

  // Escape is the generic Cancel; this popup had only its Cancel button and a
  // backdrop click.
  const closeParallelPicker = React.useCallback(
    () => setShowParallelPicker(false),
    [setShowParallelPicker]
  );
  useEscapeKey(showParallelPicker, closeParallelPicker);

  return (
    <>
      {/* Book/Chapter Picker Modal */}
      <BookChapterPicker
        isOpen={showBookPicker}
        onClose={() => setShowBookPicker(false)}
        onSelect={(book, chapter, verse) => {
          setShowBookPicker(false);
          const verseId = (book * 1000000) + (chapter * 1000) + (verse ?? 1);
          useBibleStore.getState().navigateToVerse(panelId, verseId); // allow-getstate: event handler - imperative navigation, no subscription needed
        }}
        currentBook={currentBook}
        currentChapter={currentChapter}
      />

      {/* Bible Translation Selector Modal */}
      {showSelector && (
        <ModuleSelector
          title={versionSelectorTabId ? "Switch Bible Version" : "Select Bible Translation"}
          modules={availableBibles.map((bible): ModuleItem => ({
            id: bible.abbreviation,
            name: bible.name,
            abbreviation: bible.abbreviation,
            languageCode: bible.language_code,
            version: bible.version,
            openCount: openTabs.filter(tab => tab.abbreviation === bible.abbreviation).length
          }))}
          isLoading={loadingBibles}
          emptyMessage={t('biblePaneOverlays.noBibleTranslationsInstalledPleaseInstall')}
          onSelect={(module) => {
            if (versionSelectorTabId) {
              changeTabVersion(versionSelectorTabId, module.abbreviation, module.name);
              setVersionSelectorTabId(null);
            } else {
              openBible(module.abbreviation, module.name);
            }
            setShowSelector(false);
          }}
          onClose={() => {
            setShowSelector(false);
            setVersionSelectorTabId(null);
          }}
        />
      )}

      {/* Parallel Version Picker Dialog */}
      {showParallelPicker && (
        <div
          className="fixed inset-0 bg-background-overlay z-50 flex items-center justify-center"
          onClick={() => setShowParallelPicker(false)}
        >
          {/* `overflow-hidden` + a viewport-relative cap are the container half
              of the fix below: the popup can never be wider than the window,
              and nothing inside it can paint past its rounded edge. */}
          <div
            data-testid="parallel-version-picker"
            className="bg-surface rounded-lg shadow-xl w-[380px] max-w-[90vw] overflow-hidden flex flex-col"
            style={{ backgroundColor: 'var(--theme-bg-primary)' }}
            onClick={(e) => e.stopPropagation()}
          >
            <div className="px-4 py-3 border-b border-border">
              <h3 className="text-lg font-semibold">{t('biblePaneOverlays.parallelTitle')}</h3>
              <p className="text-xs text-text-secondary mt-1">{t('biblePaneOverlays.parallelSubtitle')}</p>
            </div>
            <div className="px-4 py-3 space-y-2">
              {[0, 1, 2, 3].map(slot => (
                <div key={slot} className="flex items-center gap-2 min-w-0">
                  <span className="text-xs text-text-secondary w-6">{slot + 1}.</span>
                  {/* `min-w-0` is the load-bearing class. A flex item's default
                      `min-width: auto` resolves, for a <select>, to its
                      min-content width -- the widest <option> label, here
                      "{abbr} - {full translation name}". `flex-shrink` cannot
                      go below that floor, so the select rendered at its
                      min-content width and jutted straight through the popup
                      border. `truncate` then ellipsises the selected label
                      rather than letting it clip mid-glyph. */}
                  <select
                    className="flex-1 min-w-0 truncate px-2 py-1.5 border border-border rounded text-sm"
                    style={{ backgroundColor: 'var(--theme-bg-primary)' }}
                    value={parallelSelections[slot]}
                    onChange={(e) => {
                      const newSelections = [...parallelSelections];
                      newSelections[slot] = e.target.value;
                      setParallelSelections(newSelections);
                    }}
                  >
                    <option value="">{slot < 2 ? 'Select version...' : '(none)'}</option>
                    {availableBibles.map(bible => (
                      <option key={bible.abbreviation} value={bible.abbreviation}>
                        {bible.abbreviation} - {bible.name}
                      </option>
                    ))}
                  </select>
                </div>
              ))}
            </div>
            <div className="px-4 py-3 border-t border-border flex justify-end gap-2">
              <button
                className="px-3 py-1.5 text-sm rounded hover:bg-background-hover"
                onClick={() => setShowParallelPicker(false)}
              >
                {t('biblePaneOverlays.cancel')}
              </button>
              <button
                className="px-3 py-1.5 text-sm bg-accent text-text-on-accent rounded hover:bg-accent-hover disabled:opacity-50"
                disabled={parallelSelections.filter(v => v).length < 2}
                onClick={() => {
                  const selected = parallelSelections.filter(v => v);
                  useBibleStore.getState().setParallelVersions(panelId, selected); // allow-getstate: event handler - imperative setting
                  if (!isParallelViewMode) toggleParallelView();
                  setShowParallelPicker(false);
                }}
              >
                {t('biblePaneOverlays.compareVersions', { v1: parallelSelections.filter(v => v).length })}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Context Menu */}
      {contextMenu && (
        <VerseContextMenu
          verses={contextMenu.verses}
          context={{
            bookName: currentBookName,
            chapter: currentChapter,
            translation: activeTab?.abbreviation || ''
          }}
          position={contextMenu.position}
          onClose={() => {
            // Dismissing the menu (or taking a non-highlight action from it)
            // must not leave a snapshot behind for some later gesture to pick up.
            clearCapturedWordSelection();
            setContextMenu(null);
          }}
          isMultipleVerses={contextMenu.isMultiple}
          markupId={contextMenu.markupId}
          onRemoveHighlight={handleRemoveHighlight}
          bookmarks={bookmarks}
          isBookmarked={
            contextMenu.verses[0]?.verse_id !== undefined &&
            bookmarkedVerses.has(contextMenu.verses[0].verse_id)
          }
          onAddBookmark={() => {
            const range = contextMenuVerseRange();
            if (!range) return;
            void addBookmark(range.start, range.end, activeTab?.moduleId);
          }}
          onReplaceBookmark={(pinId) => {
            const range = contextMenuVerseRange();
            if (!range) return;
            void replaceBookmarkRef(pinId, range.start, range.end);
          }}
          onRemoveBookmark={() => {
            const verseId = contextMenu.verses[0]?.verse_id;
            if (verseId === undefined) return;
            void removeVerseFromAllCollections(verseId).then(() => loadBookmarks());
          }}
          onAddNote={() => {
            const verseId = contextMenu.verses[0]?.verse_id;
            if (!verseId) return;
            // Reveal the Notes pane first (adding one if the layout has none),
            // then sync it to this verse - syncing only reaches panes that are
            // already registered, so the order matters for a pane just created.
            revealNotesPanel();
            requestAnimationFrame(() => {
              requestAnimationFrame(() => {
                syncAllNotesPanelsWithVerse(verseId);
                window.dispatchEvent(new CustomEvent('open-verse-note'));
              });
            });
          }}
          onOpenCopyOptions={() => {
            setCopyOptionsDialog({
              visible: true,
              verses: contextMenu.verses
            });
          }}
          onOpenHighlightMenu={() => {
            /*
              Prefer the selection captured when the menu OPENED over whatever
              window.getSelection() says now: getting here took a click on a
              menu item, and that click's mousedown can collapse the selection.
              Re-reading it at this point is what made "select three words,
              right-click, Highlight" highlight the entire verse.

              The live selection is still consulted as a fallback, for menus
              opened by a path that didn't capture (e.g. the keyboard shortcut).
            */
            const captured =
              takeCapturedWordSelection() ??
              readWordSelection(document.querySelector('.pane-content-bible') ?? document);

            if (captured) {
              setHighlightMenu({
                visible: true,
                position: contextMenu.position,
                selection: captured
              });
              return;
            }

            // No text selection - highlight entire verse(s)
            const verses = contextMenu.verses;
            const firstVerse = verses[0];
            const lastVerse = verses[verses.length - 1];

            setHighlightMenu({
              visible: true,
              position: contextMenu.position,
              selection: {
                startVerseId: firstVerse.verse_id,
                startWordIndex: 0,
                endVerseId: verses.length > 1 ? lastVerse.verse_id : undefined,
                endWordIndex: undefined
              }
            });
          }}
        />
      )}

      {/* Copy Options Dialog */}
      {copyOptionsDialog && (
        <CopyOptionsDialog
          verses={copyOptionsDialog.verses}
          context={{
            bookName: currentBookName,
            bookAbbreviation: currentBookName.substring(0, 3), // Use first 3 chars as fallback
            chapter: currentChapter,
            translation: activeTab?.abbreviation || ''
          }}
          bibleAbbreviation={activeTab?.abbreviation}
          onClose={() => setCopyOptionsDialog(null)}
        />
      )}


      {/* Highlight Menu */}
      {highlightMenu.visible && (
        <HighlightMenu
          position={highlightMenu.position}
          onSelectHighlight={handleSelectHighlight}
          onCancel={handleCancelHighlightMenu}
        />
      )}

      {/* Floating Annotation Toolbar (KAN-48) */}
      {floatingToolbar.visible && floatingToolbar.selection && (
        <FloatingAnnotationToolbar
          selection={floatingToolbar.selection}
          hasExistingMarkup={floatingToolbar.hasExistingMarkup}
          onHighlight={handleFloatingHighlight}
          onUnderline={handleFloatingUnderline}
          onRemoveFormatting={handleFloatingRemoveFormatting}
          onDismiss={dismissFloatingToolbar}
          /*
            "More..." is a handoff between two siblings: close the toolbar, open
            the full menu on the SAME selection. The word range is carried
            across explicitly rather than re-read from the DOM - clicking the
            button collapses the browser selection, and re-reading it there is
            precisely the bug the context-menu path had (three selected words
            silently became the whole verse).
          */
          onMore={(position) => {
            const selection = floatingToolbar.selection;
            dismissFloatingToolbar();
            if (selection) setHighlightMenu({ visible: true, position, selection });
          }}
          /*
            A remembered style names all four fields, so it goes through the
            full-menu apply path; that handler falls back to the toolbar's
            selection when no menu is open.
          */
          onApplyStyle={(style) => {
            void handleSelectHighlight(
              style.color,
              style.markupType,
              style.underlineStyle,
              style.underlineColor,
            );
          }}
        />
      )}

      {/* Note Preview Tooltip */}
      {noteTooltip.visible && (
        <NotePreviewTooltip
          verseId={noteTooltip.verseId}
          position={noteTooltip.position}
          onClose={handleNoteTooltipClose}
          onMouseEnter={handleNoteTooltipEnter}
          onViewNote={(verseId) => {
            setNoteTooltip({ visible: false, verseId: 0, position: { x: 0, y: 0 } });
            try {
              // Also select/activate this verse in the Bible pane
              setSelectedVerse(verseId);
              setStudyPaneActiveTab('notes');
              // Same gesture as the note indicator: the pane has to be on
              // screen before the store is told which note to show.
              revealNotesPanel();
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
          }}
        />
      )}
    </>
  );
};

export default BiblePaneOverlays;
