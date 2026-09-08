import React, { useCallback, useEffect, useRef, useState } from 'react';
import { activateFocusTrap } from '../utils/focusTrap';
import { useI18n } from '../contexts/useI18n';
import { useBookmarkStore } from '../stores/useBookmarkStore';
import { useBibleStore } from '../stores/useBibleStore';
import type { SerializedPinnedItem } from '../services/collectionAPI';

interface ManageBookmarksDialogProps {
  onClose: () => void;
}

/**
 * The bookmarks manager.
 *
 * A modal rather than a dockable pane on purpose. Bookmarks are a
 * jump-and-go list: the reader opens this, changes or picks something, and is
 * back in the text. Nothing here rewards being kept open beside the passage,
 * and a pane would have cost a dockview content type, an icon, a New Tab tile
 * and a place in every layout preset for a surface used in bursts.
 *
 * There is exactly one collection behind it (see `CollectionService`), so this
 * is a flat list with no tree, no folders, and no "add to which collection?"
 * step anywhere in the flow.
 *
 * A row is a name, a reference and three verbs: go to it, rename it, remove
 * it. Reordering is the drag handle (and the arrow keys on it, so the order is
 * not mouse-only). Bookmarks carry no notes here - a saved place either says
 * what it is in its name or it does not need to; anything longer is a note on
 * the verse, which the Notes pane already does properly.
 */
const ManageBookmarksDialog: React.FC<ManageBookmarksDialogProps> = ({ onClose }) => {
  const { t } = useI18n();
  const dialogRef = useRef<HTMLDivElement>(null);
  const previousFocusRef = useRef<Element | null>(null);

  const bookmarks = useBookmarkStore(s => s.bookmarks);
  const loadBookmarks = useBookmarkStore(s => s.loadBookmarks);
  const setBookmarkTitle = useBookmarkStore(s => s.setBookmarkTitle);
  const removeBookmark = useBookmarkStore(s => s.removeBookmark);
  const reorderBookmarks = useBookmarkStore(s => s.reorderBookmarks);

  /** The row whose name is being edited, and the text typed so far. */
  const [editingPinId, setEditingPinId] = useState<number | null>(null);
  const [draftTitle, setDraftTitle] = useState('');
  /**
   * Set when Escape backs out of an inline edit, so the blur that follows the
   * input unmounting discards the draft instead of saving it. Without it,
   * Escape - the universal "cancel" - silently committed whatever had been
   * typed, which is the opposite of what it promises.
   */
  const cancelledEditRef = useRef(false);
  /** Index being dragged, and the index it is currently hovering over. */
  const [dragIndex, setDragIndex] = useState<number | null>(null);
  const [dropIndex, setDropIndex] = useState<number | null>(null);

  // The dialog can be opened from a pane that never loaded the list.
  useEffect(() => {
    void loadBookmarks();
  }, [loadBookmarks]);

  useEffect(() => {
    previousFocusRef.current = document.activeElement;
    dialogRef.current?.focus();
    return () => {
      setTimeout(() => {
        if (previousFocusRef.current instanceof HTMLElement) {
          previousFocusRef.current.focus();
        }
      }, 50);
    };
  }, []);

  useEffect(() => {
    const node = dialogRef.current;
    if (!node) return;
    const handle = activateFocusTrap(node);
    return () => handle.release();
  }, []);

  /*
    Escape is handled on the document rather than as an `onKeyDown` on the
    dialog, because the dialog only sees the keystroke while focus is inside
    it - and focus is not guaranteed to be: the manager opens from a toolbar
    popover that unmounts as it opens, and a stray click on the backdrop or on
    inert chrome can leave focus on <body>. There the dialog looked
    permanently unclosable by keyboard.
  */
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return;
      e.stopPropagation();
      // Escape backs out of an inline edit before it closes the dialog -
      // otherwise a mistyped name takes the whole dialog down with it.
      if (editingPinId !== null) {
        cancelledEditRef.current = true;
        setEditingPinId(null);
        // Take focus back to the dialog; the cancelled input is about to
        // unmount and focus would otherwise fall out to <body>.
        dialogRef.current?.focus();
        return;
      }
      onClose();
    };
    document.addEventListener('keydown', handleKeyDown);
    return () => document.removeEventListener('keydown', handleKeyDown);
  }, [editingPinId, onClose]);

  const goTo = useCallback(
    (item: SerializedPinnedItem) => {
      if (item.verseIdStart === undefined) return;
      useBibleStore.getState().navigateToVerseInPrimary(item.verseIdStart); // allow-getstate: event handler - imperative navigation
      onClose();
    },
    [onClose],
  );

  const commitTitle = useCallback(
    async (pinId: number) => {
      setEditingPinId(null);
      if (cancelledEditRef.current) {
        cancelledEditRef.current = false;
        return;
      }
      await setBookmarkTitle(pinId, draftTitle);
    },
    [draftTitle, setBookmarkTitle],
  );

  /** Move a row to a new index and persist the whole resulting order. */
  const moveTo = useCallback(
    async (from: number, to: number) => {
      if (from === to || to < 0 || to >= bookmarks.length) return;
      const next = [...bookmarks];
      const [moved] = next.splice(from, 1);
      next.splice(to, 0, moved);
      await reorderBookmarks(next.map(b => b.pinId!).filter(id => id !== undefined));
    },
    [bookmarks, reorderBookmarks],
  );

  const handleBackdropClick = () => onClose();

  return (
    <>
      <div className="fixed inset-0 bg-background-overlay z-40" onClick={handleBackdropClick} />

      <div
        className="fixed inset-0 flex items-center justify-center z-50 p-lg"
        onClick={handleBackdropClick}
      >
        <div
          ref={dialogRef}
          tabIndex={-1}
          role="dialog"
          aria-label={t('ui.bookmarks.manageTitle')}
          aria-modal="true"
          className="bg-surface rounded-lg shadow-xl w-full max-w-xl max-h-[85vh] flex flex-col outline-none"
          onClick={e => e.stopPropagation()}
          data-testid="manage-bookmarks-dialog"
        >
          {/* -- Header -- */}
          <div className="flex items-center justify-between px-xl py-lg border-b border-border shrink-0">
            <h2 className="text-xl font-bold text-text-heading">
              {t('ui.bookmarks.manageTitle')}
            </h2>
            <button
              onClick={onClose}
              className="p-1 hover:bg-background-active rounded transition-colors"
              title={t('ui.bookmarks.close')}
              aria-label={t('ui.bookmarks.close')}
            >
              <svg className="w-5 h-5 text-text-secondary" aria-hidden="true" focusable="false" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
              </svg>
            </button>
          </div>

          {/* -- List -- */}
          <div className="flex-1 overflow-y-auto px-xl py-lg" tabIndex={0}>
            {bookmarks.length === 0 ? (
              <p className="text-sm text-text-secondary" data-testid="bookmarks-empty">
                {t('ui.bookmarks.empty')}
              </p>
            ) : (
              <ul className="space-y-1" role="list">
                {bookmarks.map((item, index) => {
                  const pinId = item.pinId!;
                  const isEditing = editingPinId === pinId;
                  const label = item.title?.trim() || item.referenceText || '';

                  return (
                    <li
                      key={pinId}
                      data-testid={`bookmark-row-${pinId}`}
                      draggable={!isEditing}
                      onDragStart={() => setDragIndex(index)}
                      onDragOver={e => {
                        e.preventDefault();
                        setDropIndex(index);
                      }}
                      onDragEnd={() => {
                        setDragIndex(null);
                        setDropIndex(null);
                      }}
                      onDrop={e => {
                        e.preventDefault();
                        if (dragIndex !== null) void moveTo(dragIndex, index);
                        setDragIndex(null);
                        setDropIndex(null);
                      }}
                      className={`rounded border px-2 py-1.5 ${
                        dropIndex === index && dragIndex !== null && dragIndex !== index
                          ? 'border-accent bg-accent-light'
                          : 'border-transparent hover:bg-background-hover'
                      }`}
                    >
                      <div className="flex items-center gap-2">
                        {/* The handle is a button so reordering is not
                            mouse-only: focus it and the arrow keys move the
                            row. A pair of up/down chevrons would do the same
                            job, but that is two more controls on every row
                            for a gesture the handle already advertises. */}
                        <button
                          className="text-text-muted cursor-grab select-none px-0.5"
                          title={t('ui.bookmarks.dragToReorder')}
                          aria-label={t('ui.bookmarks.dragToReorder')}
                          data-testid={`bookmark-handle-${pinId}`}
                          onKeyDown={e => {
                            if (e.key === 'ArrowUp') {
                              e.preventDefault();
                              void moveTo(index, index - 1);
                            } else if (e.key === 'ArrowDown') {
                              e.preventDefault();
                              void moveTo(index, index + 1);
                            }
                          }}
                        >
                          <span aria-hidden="true">⠿</span>
                        </button>

                        {isEditing ? (
                          <input
                            autoFocus
                            className="flex-1 min-w-0 px-2 py-1 text-sm rounded border border-border bg-background-input"
                            value={draftTitle}
                            placeholder={item.referenceText}
                            aria-label={t('ui.bookmarks.nameLabel')}
                            data-testid={`bookmark-name-input-${pinId}`}
                            onChange={e => setDraftTitle(e.target.value)}
                            onKeyDown={e => {
                              if (e.key === 'Enter') void commitTitle(pinId);
                            }}
                            onBlur={() => void commitTitle(pinId)}
                          />
                        ) : (
                          <button
                            className="flex-1 min-w-0 text-start"
                            onClick={() => goTo(item)}
                            title={t('ui.bookmarks.goToTitle', { reference: item.referenceText ?? '' })}
                            data-testid={`bookmark-goto-${pinId}`}
                          >
                            <span className="block truncate text-sm text-text-primary">{label}</span>
                            {/* Only worth a second line when the name isn't
                                already the reference. */}
                            {item.title?.trim() && (
                              <span className="block truncate text-xs text-text-secondary">
                                {item.referenceText}
                              </span>
                            )}
                          </button>
                        )}

                        <button
                          className="p-1 text-text-secondary hover:text-text-primary"
                          onClick={() => {
                            setDraftTitle(item.title ?? '');
                            setEditingPinId(pinId);
                          }}
                          title={t('ui.bookmarks.rename')}
                          aria-label={t('ui.bookmarks.rename')}
                          data-testid={`bookmark-rename-${pinId}`}
                        >
                          <svg className="w-4 h-4" aria-hidden="true" focusable="false" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z" />
                          </svg>
                        </button>

                        <button
                          className="p-1 text-text-secondary hover:text-status-error"
                          onClick={() => void removeBookmark(pinId)}
                          title={t('ui.bookmarks.remove')}
                          aria-label={t('ui.bookmarks.remove')}
                          data-testid={`bookmark-remove-${pinId}`}
                        >
                          <svg className="w-4 h-4" aria-hidden="true" focusable="false" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
                          </svg>
                        </button>
                      </div>
                    </li>
                  );
                })}
              </ul>
            )}
          </div>

          <div className="px-xl py-lg border-t border-border shrink-0 flex justify-between items-center">
            <span className="text-xs text-text-secondary">
              {t('ui.bookmarks.reorderHint')}
            </span>
            <button
              className="px-3 py-1.5 text-sm bg-accent text-text-on-accent rounded hover:bg-accent-hover"
              onClick={onClose}
            >
              {t('ui.bookmarks.done')}
            </button>
          </div>
        </div>
      </div>
    </>
  );
};

export default ManageBookmarksDialog;
