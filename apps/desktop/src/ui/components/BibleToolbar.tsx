import React from 'react';
import { useI18n } from '../contexts/useI18n';
import { useBiblePaneContext } from './BiblePaneContext';
import { useBibleStore } from '../stores/useBibleStore';
import PassageSettingsMenu from './bible/PassageSettingsMenu';
import BookmarkMenu from './bible/BookmarkMenu';
import ToolbarPopover from './bible/ToolbarPopover';
import { useOverlayDismissal } from '../hooks/useOverlayDismissal';
import { openModuleManager } from '../utils/openModuleManager';

/**
 * The Bible pane's single control band.
 *
 * Contains: back (visit stack), history dropdown, the bookmark menu (jump
 * list, with saving inside it), version selector, display mode dropdown, parallel view toggle,
 * the Interlinear/Notes chapter toggles, the passage settings menu, and
 * chapter navigation.
 *
 * This is deliberately the *only* persistent chrome the pane owns. The passage
 * itself is a dockview tab (so there is no second tab strip), and the
 * Interlinear/Notes toggles live here rather than in a strip of their own.
 * Anything new and rarely-used belongs in the settings menu, not in another
 * row.
 */
const BibleToolbar: React.FC = () => {
  const { t } = useI18n();
  const ctx = useBiblePaneContext();

  const {
    panelId,
    activeTab,
    openTabs,
    availableBibles,
    isParallelViewMode,
    isLoading,
    currentBook,
    currentChapter,
    displayMode,
    showHistoryDropdown,
    setShowHistoryDropdown,
    canGoBack,
    goBackWithScroll,
    navigateToHistoryEntryWithScroll,
    setVersionSelectorTabId,
    setShowSelector,
    handleSetDisplayMode,
    toggleParallelView,
    setShowParallelPicker,
    setParallelSelections,
    handlePreviousChapter,
    handleNextChapter,
  } = ctx;

  // The history menu hangs off this button but is portalled out of the
  // toolbar's overflow clip - see ToolbarPopover.
  const historyAnchorRef = React.useRef<HTMLDivElement>(null);
  const closeHistory = React.useCallback(
    () => setShowHistoryDropdown(false),
    [setShowHistoryDropdown],
  );
  useOverlayDismissal(showHistoryDropdown, closeHistory);

  // The history list and the cursor into it, read as state rather than through
  // getState() so the open menu re-renders when a click navigates.
  const history = useBibleStore(s => s.panels.get(panelId)?.navigationHistory ?? []);
  const historyIndex = useBibleStore(s => s.panels.get(panelId)?.historyIndex ?? -1);

  if (!activeTab || openTabs.length === 0) return null;

  return (
    <div
      className="flex items-stretch justify-between border-b border-border flex-shrink-0 min-w-0 overflow-hidden"
      style={{ background: 'var(--theme-bg-secondary)', padding: 0 }}
      role="toolbar"
      aria-label={t('biblePane.toolbarLabel')}
    >
      {/* Left: History + Display mode + Parallel */}
      <div className="flex items-stretch min-w-0 overflow-hidden flex-shrink">
        {/* Back: undoes the last view change, off the visit stack rather than
            the history cursor. See stores/bible/internals/visitStack.ts. */}
        <button
          onClick={() => goBackWithScroll()}
          disabled={!canGoBack()}
          className="flex items-center px-2.5 hover:bg-background-active disabled:opacity-30 disabled:cursor-not-allowed transition-colors"
          style={{ borderInlineEnd: '1px solid var(--theme-border-primary)', borderRadius: 0 }}
          title={t('biblePane.goBackTitle')}
          aria-label={t('biblePane.goBackTitle')}
        >
          <svg className="w-4 h-4" aria-hidden="true" focusable="false" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 15L3 9m0 0l6-6M3 9h12a6 6 0 010 12h-3" />
          </svg>
        </button>
        {/* No forward button: Back plus the history menu covers it, and the
            menu names where it is going instead of leaving the reader to guess. */}
        {/* History dropdown */}
        <div className="relative flex items-stretch" ref={historyAnchorRef}>
          <button
            onClick={() => setShowHistoryDropdown(!showHistoryDropdown)}
            // Keep the document-level dismissal from closing the menu a beat
            // before this button's own click would toggle it back open.
            onMouseDown={(e) => e.stopPropagation()}
            className="flex items-center px-2.5 hover:bg-background-active transition-colors"
            style={{ borderInlineEnd: '2px solid var(--theme-border-primary)', borderRadius: 0 }}
            title={t('biblePane.navHistoryTitle')}
            aria-label={t('biblePane.navHistoryTitle')}
            aria-expanded={showHistoryDropdown}
            aria-haspopup="menu"
            data-testid="history-dropdown-toggle"
          >
            <svg className="w-4 h-4" aria-hidden="true" focusable="false" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z" />
            </svg>
          </button>
          {showHistoryDropdown && (
            <ToolbarPopover
              anchorRef={historyAnchorRef}
              align="start"
              aria-label={t('biblePane.navHistoryHeading')}
              onMouseDown={(e) => e.stopPropagation()}
            >
              <div className="px-3 py-1.5 text-xs font-semibold text-text-secondary border-b border-border bg-surface-secondary">
                {t('biblePane.navHistoryHeading')}
              </div>
              {history.length === 0 ? (
                <div className="px-3 py-2 text-sm text-text-secondary">{t('biblePane.noHistory')}</div>
              ) : (
                history.map((entry, index) => ({ entry, originalIndex: index }))
                  // Most recent first: the entry a reader wants is almost
                  // always the one they just came from.
                  .reverse()
                  .map(({ entry, originalIndex }) => {
                    const isCurrent = originalIndex === historyIndex;
                    return (
                      <button
                        key={originalIndex}
                        role="menuitem"
                        aria-current={isCurrent ? 'true' : undefined}
                        onClick={() => {
                          navigateToHistoryEntryWithScroll(originalIndex);
                          setShowHistoryDropdown(false);
                        }}
                        className={`w-full text-start px-3 py-2 text-sm hover:bg-background-hover flex items-center gap-2 ${
                          isCurrent ? 'bg-accent-light' : ''
                        }`}
                      >
                        <span aria-hidden="true" className={`w-1.5 h-1.5 rounded-full flex-shrink-0 ${
                          isCurrent ? 'bg-accent' : 'bg-transparent'
                        }`} />
                        <span className={isCurrent ? 'font-medium' : ''}>
                          {entry.bookName} {entry.chapter}:{entry.verseId % 1000}
                        </span>
                      </button>
                    );
                  })
              )}
            </ToolbarPopover>
          )}
        </div>

        {/* Bookmarks: the ribbon menu - jump list, with saving inside it. */}
        <BookmarkMenu />

        {/* Version selector button */}
        <button
          onClick={() => {
            setVersionSelectorTabId(activeTab.tabId);
            setShowSelector(true);
          }}
          className="flex items-center gap-1 text-xs font-semibold cursor-pointer text-text-primary hover:bg-background-active transition-colors"
          style={{
            background: 'none',
            border: 'none',
            borderInlineEnd: '2px solid var(--theme-border-primary)',
            borderRadius: 0,
            padding: '8px 12px',
          }}
          title={t('biblePane.changeVersionTitle')}
          aria-label={t('biblePane.changeVersionLabel', { version: activeTab.abbreviation, })}
          aria-haspopup="dialog"
        >
          {activeTab.abbreviation}
          <svg className="w-3 h-3" aria-hidden="true" focusable="false" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
          </svg>
        </button>

        {/* Display mode dropdown */}
        <select
          value={displayMode}
          onChange={(e) => handleSetDisplayMode(e.target.value as any)}
          aria-label={t('biblePane.displayModeLabel')}
          className="text-xs font-medium cursor-pointer text-text-primary outline-none hover:bg-background-active transition-colors"
          style={{
            background: 'none',
            border: 'none',
            borderInlineEnd: '2px solid var(--theme-border-primary)',
            borderRadius: 0,
            padding: '8px 12px',
          }}
          data-testid="display-mode-select"
        >
          <option value="standard">{t('biblePane.displayModeStandard')}</option>
          <option value="reading">{t('biblePane.displayModeReading')}</option>
          <option value="study">{t('biblePane.displayModeStudy')}</option>
        </select>

        {/* Parallel View Toggle.
            D1a: v1 ships only KJV, so there is often no second translation to
            compare against. Rather than opening an empty second pane or doing
            nothing, when fewer than two translations are installed the control
            explains what is missing and routes to the Module Manager (filtered
            to Bibles) to get one. */}
        {(() => {
          const canCompare = isParallelViewMode || availableBibles.length >= 2;
          return (
            <button
              onClick={() => {
                if (isParallelViewMode) {
                  toggleParallelView();
                } else if (availableBibles.length < 2) {
                  // No second translation installed - send the user to where
                  // they can add one instead of showing a broken picker.
                  openModuleManager('bible');
                } else {
                  // Prefill slot 1 with this panel's translation and slot 2 with
                  // the next installed one, so the picker opens on a usable pair.
                  const selections = ['', '', '', ''];
                  selections[0] = activeTab.abbreviation;
                  const other = availableBibles.find(b => b.abbreviation !== activeTab.abbreviation);
                  if (other) selections[1] = other.abbreviation;
                  setParallelSelections(selections);
                  setShowParallelPicker(true);
                }
              }}
              className={`flex items-center text-xs font-medium transition-colors ${
                isParallelViewMode
                  ? 'bg-accent text-text-on-accent'
                  : canCompare
                    ? 'text-text-secondary hover:bg-background-active'
                    : 'text-text-muted hover:bg-background-active opacity-70'
              }`}
              style={{
                borderInlineEnd: '2px solid var(--theme-border-primary)',
                borderRadius: 0,
                padding: '8px 12px',
              }}
              title={canCompare
                ? t('biblePane.toggleParallelTitle')
                : t('biblePane.parallelNeedsTranslation')}
              aria-pressed={isParallelViewMode}
              data-testid="parallel-toggle"
            >
              <span aria-hidden="true" className="me-1">&#x2AF4;</span>
              {t('biblePane.parallelLabel')}
            </button>
          );
        })()}
      </div>

      {/* Right: settings + chapter navigation */}
      <div className="flex items-stretch flex-shrink-0">
        {/* Interlinear and Footnotes are deliberately not offered here as a
            pair of toggle buttons. They would duplicate the checkbox strip at
            the top of the chapter (`study/StudyControls.tsx`) - which is the
            richer control, since it also carries cross-references and the
            interlinear layout choice - and the two surfaces disagree, because
            the strip writes only to `studyOptionsByTab` while toolbar buttons
            write to the passage record as well. One control, at the top of the
            passage it governs, is enough. */}

        {/* Gear - opens Text Settings directly (no intermediate menu). */}
        <PassageSettingsMenu />

        {/* Previous Chapter */}
        <button
          onClick={handlePreviousChapter}
          disabled={isLoading || (currentBook === 1 && currentChapter === 1)}
          className="flex items-center px-2.5 hover:bg-background-active disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
          style={{ borderInlineStart: '2px solid var(--theme-border-primary)', borderRadius: 0 }}
          title={t('biblePane.previousChapterTitle')}
          aria-label={t('biblePane.previousChapterTitle')}
          data-testid="prev-chapter"
        >
          <svg className="w-4 h-4 rtl-mirror" aria-hidden="true" focusable="false" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
          </svg>
        </button>
        {/* Next Chapter */}
        <button
          onClick={handleNextChapter}
          disabled={isLoading}
          className="flex items-center px-2.5 hover:bg-background-active disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
          style={{ borderInlineStart: '2px solid var(--theme-border-primary)', borderRadius: 0 }}
          title={t('biblePane.nextChapterTitle')}
          aria-label={t('biblePane.nextChapterTitle')}
          data-testid="next-chapter"
        >
          <svg className="w-4 h-4 rtl-mirror" aria-hidden="true" focusable="false" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
          </svg>
        </button>
      </div>
    </div>
  );
};

export default BibleToolbar;
