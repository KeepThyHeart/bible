import React from 'react';
import { useI18n } from '../../contexts/useI18n';
import { useBiblePaneContext } from '../BiblePaneContext';
import { useBookmarkStore } from '../../stores/useBookmarkStore';
import { useBibleStore } from '../../stores/useBibleStore';
import { BookmarkIcon, BOOKMARK_COLOR } from '../shared/icons/BookmarkIcon';
import ToolbarPopover from './ToolbarPopover';
import { useOverlayDismissal } from '../../hooks/useOverlayDismissal';

/** How many bookmarks the dropdown lists before deferring to the manager. */
const MAX_DROPDOWN_ITEMS = 12;

/**
 * The Bible pane's bookmark control: one ribbon that opens the list.
 *
 * It sits in the pane rather than in the app menu because bookmarking is a
 * per-verse act on the passage in front of the reader, and the spec's rule is
 * that such controls belong to the pane.
 *
 * The control is a menu button, not a toggle with a caret beside it, because
 * *going back to* a saved place is what a reader reaches for far more often
 * than saving a new one - and a button that saved on sight would make that
 * the accidental default. Saving is the first item inside the menu (and
 * <kbd>Ctrl+D</kbd> still does it with no menu at all); the ribbon itself
 * only fills in to report that the selected verse is saved.
 */
const BookmarkMenu: React.FC = () => {
  const { t } = useI18n();
  const { panelId, activeTab, selectedVerseId, selectionEndVerseId } = useBiblePaneContext();

  const bookmarks = useBookmarkStore(s => s.bookmarks);
  const bookmarkedVerses = useBookmarkStore(s => s.bookmarkedVerses);
  const toggleVerseBookmark = useBookmarkStore(s => s.toggleVerseBookmark);

  const [open, setOpen] = React.useState(false);
  const anchorRef = React.useRef<HTMLDivElement>(null);
  const close = React.useCallback(() => setOpen(false), []);
  useOverlayDismissal(open, close);

  const isBookmarked = selectedVerseId !== null && bookmarkedVerses.has(selectedVerseId);

  const toggle = async () => {
    if (selectedVerseId === null) return;
    // A shift-click passage is bookmarked whole; a plain click is one verse.
    const end =
      selectionEndVerseId !== null && selectionEndVerseId !== selectedVerseId
        ? selectionEndVerseId
        : undefined;
    await toggleVerseBookmark(selectedVerseId, end, activeTab?.moduleId);
  };

  const shown = bookmarks.slice(0, MAX_DROPDOWN_ITEMS);
  const overflow = bookmarks.length - shown.length;

  return (
    <div className="flex items-stretch" ref={anchorRef}>
      <button
        onClick={() => setOpen(!open)}
        // Keep the document-level dismissal from closing the menu a beat
        // before this button's own click would toggle it back open.
        onMouseDown={e => e.stopPropagation()}
        className="flex items-center gap-0.5 px-2 hover:bg-background-active transition-colors"
        style={{
          borderInlineEnd: '2px solid var(--theme-border-primary)',
          borderRadius: 0,
          color: isBookmarked ? BOOKMARK_COLOR : undefined,
        }}
        title={t('biblePane.bookmarksTitle')}
        aria-label={t('biblePane.bookmarksTitle')}
        aria-expanded={open}
        aria-haspopup="menu"
        // State, not a pressed toggle: the button opens a menu. Exposed as an
        // attribute so a test can read what the fill is saying.
        data-bookmarked={isBookmarked}
        data-testid="bookmark-toggle"
      >
        <BookmarkIcon marked={isBookmarked} className="w-4 h-4" />
        <svg className="w-3 h-3" aria-hidden="true" focusable="false" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
        </svg>
      </button>

      {open && (
        <ToolbarPopover
          anchorRef={anchorRef}
          align="start"
          aria-label={t('biblePane.bookmarksHeading')}
          onMouseDown={e => e.stopPropagation()}
        >
          {/* Saving is an item in the list rather than the button's own click,
              so that opening the list can never save anything by accident. */}
          <button
            role="menuitem"
            disabled={selectedVerseId === null}
            onClick={() => {
              void toggle();
              setOpen(false);
            }}
            className="w-full text-start px-3 py-2 text-sm hover:bg-background-hover disabled:opacity-40 disabled:cursor-not-allowed flex items-center gap-2"
            data-testid={isBookmarked ? 'bookmark-remove-current' : 'bookmark-add-current'}
          >
            <BookmarkIcon
              marked={isBookmarked}
              className="w-4 h-4"
              style={isBookmarked ? { color: BOOKMARK_COLOR } : undefined}
            />
            <span>
              {isBookmarked
                ? t('biblePane.removeBookmarkTitle')
                : t('biblePane.addCurrentVerse')}
            </span>
          </button>

          <div className="border-t border-border my-1" />

          <div className="px-3 py-1.5 text-xs font-semibold text-text-secondary border-b border-border bg-surface-secondary">
            {t('biblePane.bookmarksHeading')}
          </div>

          {bookmarks.length === 0 ? (
            <div className="px-3 py-2 text-sm text-text-secondary">
              {t('biblePane.noBookmarks')}
            </div>
          ) : (
            shown.map(item => (
              <button
                key={item.pinId}
                role="menuitem"
                onClick={() => {
                  if (item.verseIdStart !== undefined) {
                    useBibleStore.getState().navigateToVerse(panelId, item.verseIdStart); // allow-getstate: event handler - imperative navigation
                  }
                  setOpen(false);
                }}
                className="w-full text-start px-3 py-2 text-sm hover:bg-background-hover"
                data-testid={`bookmark-jump-${item.pinId}`}
              >
                <span className="block truncate">
                  {item.title?.trim() || item.referenceText}
                </span>
                {/* The reference only earns a second line when the name has
                    replaced it in the first. */}
                {item.title?.trim() && (
                  <span className="block truncate text-xs text-text-secondary">
                    {item.referenceText}
                  </span>
                )}
              </button>
            ))
          )}

          {overflow > 0 && (
            <div className="px-3 py-1 text-xs text-text-muted">
              {t('biblePane.bookmarksOverflow', { count: overflow })}
            </div>
          )}

          <div className="border-t border-border my-1" />
          <button
            role="menuitem"
            onClick={() => {
              setOpen(false);
              window.dispatchEvent(new CustomEvent('command:bookmarks:manage'));
            }}
            className="w-full text-start px-3 py-2 text-sm hover:bg-background-hover"
            data-testid="bookmark-manage"
          >
            {t('biblePane.manageBookmarks')}
          </button>
        </ToolbarPopover>
      )}
    </div>
  );
};

export default BookmarkMenu;
