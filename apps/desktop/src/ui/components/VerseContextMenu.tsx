import React, { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import {
  BibleVerse,
  VerseContext,
} from '../services/verseCopyService';
import { useI18n } from '../contexts/useI18n';
import { useAppServices } from '../contexts/ContextProvider';
import { useExtensionUiStore } from '../extensions/extensionUiStore';
import type { SerializedPinnedItem } from '../services/collectionAPI';
import { BookmarkIcon, BOOKMARK_COLOR } from './shared/icons/BookmarkIcon';

/**
 * How long the bookmarks flyout survives the pointer leaving its item, so the
 * pointer can travel to the panel across the menu items in between.
 */
const SUBMENU_CLOSE_GRACE_MS = 250;

export interface VerseContextMenuProps {
  /** Single verse or array of verses to copy */
  verses: BibleVerse | BibleVerse[];
  /** Context information (book name, chapter, translation) */
  context: VerseContext;
  /** Position to display the menu */
  position: { x: number; y: number };
  /** Callback when menu is closed */
  onClose: () => void;
  /** Whether this is a multi-verse selection */
  isMultipleVerses?: boolean;
  /** Callback to open copy options dialog */
  onOpenCopyOptions?: () => void;
  /** Callback to open highlight menu */
  onOpenHighlightMenu?: () => void;
  /** Callback to open/create a verse note */
  onAddNote?: () => void;
  /** Markup ID if right-clicking on highlighted text */
  markupId?: number;
  /** Callback to remove a highlight */
  onRemoveHighlight?: (markupId: number) => void;
  /**
   * Existing bookmarks, offered as targets to re-point at this verse. Ordered
   * as the user ordered them in the manager.
   */
  bookmarks?: SerializedPinnedItem[];
  /** Whether this verse already has a bookmark on it. */
  isBookmarked?: boolean;
  /** Save this verse/passage as a new bookmark. Enables the bookmarks item. */
  onAddBookmark?: () => void;
  /** Re-point an existing bookmark at this verse, keeping any custom name. */
  onReplaceBookmark?: (pinId: number) => void;
  /** Remove every bookmark on this verse. */
  onRemoveBookmark?: () => void;
}

/**
 * Context menu for Bible verses
 *
 * Displays at cursor position with a single "Copy Passage" option
 * that opens the copy dialog, plus note, bookmark and highlight options.
 *
 * **Portalled to `<body>`.** `position: fixed` is only viewport-relative while
 * no ancestor establishes a containing block for it, and dockview's root
 * (`.dv-dockview`) sets `contain: layout`, which does exactly that. Rendered
 * inside the pane, the menu's `clientX/clientY` were applied relative to the
 * dockview root instead of the viewport, so it opened offset down and to the
 * right of the cursor by however far the dockview root sits from the window's
 * top-left - the "the right-click menu is too low" report.
 */
/**
 * Arguments for a contributed `verse` menu item's command: the item's own
 * `args` with `verse` - what was right-clicked - merged in. Without it a
 * handler could only guess from the active verse, which a right-click does not
 * change. Non-object `args` cannot carry the key, so they pass unchanged; see
 * `ContextMenuItemDescriptor.args`.
 */
export function withVerseMenuContext(
  args: unknown,
  verses: BibleVerse | BibleVerse[],
  module: string,
): unknown {
  const isPlainObject =
    typeof args === 'object' && args !== null && !Array.isArray(args);
  if (args !== undefined && !isPlainObject) return args;
  const verseIds = (Array.isArray(verses) ? verses : [verses]).map((v) => v.verse_id);
  if (verseIds.length === 0) return args;
  return {
    ...(isPlainObject ? (args as Record<string, unknown>) : {}),
    verse: { verseId: verseIds[0], verseIds, module },
  };
}

const VerseContextMenu: React.FC<VerseContextMenuProps> = ({
  verses,
  context,
  position,
  onClose,
  isMultipleVerses: _isMultipleVerses = false,
  onOpenCopyOptions,
  onOpenHighlightMenu,
  onAddNote,
  markupId,
  onRemoveHighlight,
  bookmarks = [],
  isBookmarked = false,
  onAddBookmark,
  onReplaceBookmark,
  onRemoveBookmark
}) => {
  const { t, i18n } = useI18n();
  const { registry } = useAppServices();
  // Note: _isMultipleVerses is kept in the interface for API compatibility but
  // is not used since we now have a single "Copy Passage" option that opens
  // the dialog. `context` supplies the translation for extension menu items.
  void _isMultipleVerses;

  /*
    Extension-contributed items for this target.

    Scoped to items with no `when` clause. `when` evaluates against
    `IContextApi` keys through the when-context service, and wiring that
    expression evaluator into a menu that opens on every right-click is a
    separate piece of work; blocking the common case on it would leave the
    whole surface unrendered, which is where this started. An item that
    carries a `when` is held back rather than shown unconditionally, because
    showing it would be the wrong answer in the one case the author cared
    enough to write a condition for.
  */
  const contributedItems = useExtensionUiStore((s) => s.contextMenuItems);
  const extensionItems = React.useMemo(
    () =>
      contributedItems
        .filter((c) => c.target === 'verse' && c.item.when === undefined)
        .sort((a, b) => (a.item.order ?? 0) - (b.item.order ?? 0)),
    [contributedItems],
  );

  /*
    Contributed items dispatch a command rather than calling back into the
    extension directly. `RendererCommandBridge` has already put extension
    commands into the same `ICommandRegistry` that serves the palette, the
    keyboard and the application menu, so this reuses a path that is wired in
    both directions and needs no new IPC.

    A command that throws must not take the menu with it: the menu is already
    closing, and an extension's failure is its own to report.
  */
  const runExtensionCommand = React.useCallback(
    async (commandId: string, args: unknown) => {
      try {
        await registry.execute(commandId, args);
      } catch (err) {
        // eslint-disable-next-line no-console
        console.error(`[VerseContextMenu] extension command '${commandId}' failed`, err);
      }
    },
    [registry],
  );
  const menuRef = useRef<HTMLDivElement>(null);
  const previouslyFocusedRef = useRef<HTMLElement | null>(null);
  const versesArray = Array.isArray(verses) ? verses : [verses];

  /*
    The bookmarks branch opens as a flyout beside its item, the way a submenu
    behind a ">" is expected to. Replacing the menu's contents instead would
    be cheaper - one keyboard ring, no placement - but it would take the main
    menu away to show a list of four things, so the reader would lose their
    place and need a Back item to get it again.

    `placement` is measured once per opening: `flip` swings the panel to the
    other side of the menu when it would run off the window, and `offsetY`
    lifts it when its foot would fall below the viewport (the list of existing
    bookmarks can be long).
  */
  const [bookmarksOpen, setBookmarksOpen] = useState(false);
  const [placement, setPlacement] = useState<{ flip: boolean; offsetY: number }>({
    flip: false,
    offsetY: 0,
  });
  const submenuRef = useRef<HTMLDivElement>(null);
  const bookmarksItemRef = useRef<HTMLButtonElement>(null);

  const openBookmarks = (focusFirst = false) => {
    // Re-measure from scratch only for a fresh opening - a click on an item
    // the pointer already hover-opened must not throw away its placement.
    if (!bookmarksOpen) setPlacement({ flip: false, offsetY: 0 });
    setBookmarksOpen(true);
    if (focusFirst) {
      // After the panel exists. One frame is enough - it mounts in the very
      // next commit.
      requestAnimationFrame(() => {
        submenuRef.current?.querySelector<HTMLButtonElement>('[role="menuitem"]')?.focus();
      });
    }
  };

  const closeBookmarks = (restoreFocus = false) => {
    cancelScheduledClose();
    setBookmarksOpen(false);
    if (restoreFocus) bookmarksItemRef.current?.focus();
  };

  /*
    Leaving the item does not close the flyout at once. The pointer's route
    from the item to the panel beside it usually crosses the menu item below,
    and an immediate close there would snatch the submenu away mid-travel -
    the classic reason hover submenus feel unusable. Re-entering within the
    grace period cancels the close.
  */
  const closeTimerRef = useRef<number | null>(null);

  function cancelScheduledClose(): void {
    if (closeTimerRef.current !== null) {
      window.clearTimeout(closeTimerRef.current);
      closeTimerRef.current = null;
    }
  }

  const scheduleClose = () => {
    cancelScheduledClose();
    closeTimerRef.current = window.setTimeout(() => {
      closeTimerRef.current = null;
      setBookmarksOpen(false);
    }, SUBMENU_CLOSE_GRACE_MS);
  };

  useEffect(() => cancelScheduledClose, []);

  // Measure before paint, so the panel never appears half off-screen and jumps.
  useLayoutEffect(() => {
    if (!bookmarksOpen) return;
    const node = submenuRef.current;
    if (!node) return;
    const rect = node.getBoundingClientRect();
    // `left < 0` catches the RTL case, where the flyout opens leftwards.
    const flip = rect.right > window.innerWidth - 4 || rect.left < 4;
    const overflowY = Math.max(0, rect.bottom - (window.innerHeight - 4));
    if (flip || overflowY > 0) setPlacement({ flip, offsetY: -overflowY });
  }, [bookmarksOpen]);

  // Capture trigger element so focus can be restored when the menu closes.
  useEffect(() => {
    previouslyFocusedRef.current = (document.activeElement as HTMLElement | null) ?? null;
    return () => {
      const prev = previouslyFocusedRef.current;
      if (prev && typeof prev.focus === 'function' && document.contains(prev)) {
        prev.focus();
      }
    };
  }, []);

  // Focus the first menu item on open.
  useEffect(() => {
    const node = menuRef.current;
    if (!node) return;
    const first = node.querySelector<HTMLButtonElement>('[role="menuitem"]');
    first?.focus();
  }, []);

  // Close menu when clicking outside
  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(event.target as Node)) {
        onClose();
      }
    };

    const handleEscape = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return;
      // Escape closes the flyout first, the way it backs out one level of any
      // nested menu; a second press then closes the menu itself.
      if (bookmarksOpen) {
        closeBookmarks(true);
        return;
      }
      onClose();
    };

    document.addEventListener('mousedown', handleClickOutside);
    document.addEventListener('keydown', handleEscape);

    return () => {
      document.removeEventListener('mousedown', handleClickOutside);
      document.removeEventListener('keydown', handleEscape);
    };
  }, [onClose, bookmarksOpen]);

  // Keyboard navigation within a menu: arrow keys move between menuitems,
  // Home/End jump to first/last. Enter/Space activates the focused item
  // (native button behavior, no extra handler needed).
  //
  // Takes the container so the flyout gets its own ring: while it is open the
  // arrow keys belong to it, not to the items behind it.
  const moveFocusWithin = (
    container: HTMLElement | null,
    event: React.KeyboardEvent<HTMLDivElement>,
    exclude?: HTMLElement | null,
  ): void => {
    if (!container) return;
    const items = Array.from(
      container.querySelectorAll<HTMLButtonElement>('[role="menuitem"]'),
    ).filter((el) => !el.disabled && !exclude?.contains(el));
    if (items.length === 0) return;
    const currentIndex = items.findIndex((el) => el === document.activeElement);
    let nextIndex: number | null = null;
    switch (event.key) {
      case 'ArrowDown':
        nextIndex = currentIndex < 0 ? 0 : (currentIndex + 1) % items.length;
        break;
      case 'ArrowUp':
        nextIndex = currentIndex <= 0 ? items.length - 1 : currentIndex - 1;
        break;
      case 'Home':
        nextIndex = 0;
        break;
      case 'End':
        nextIndex = items.length - 1;
        break;
      default:
        return;
    }
    event.preventDefault();
    if (nextIndex !== null) items[nextIndex].focus();
  };

  const handleMenuKeyDown = (event: React.KeyboardEvent<HTMLDivElement>) => {
    // The flyout handles its own keys and stops them here, so anything that
    // reaches this belongs to the main list - and must not step into the
    // flyout's items, which are inside this container in the DOM.
    moveFocusWithin(menuRef.current, event, submenuRef.current);
  };

  const handleSubmenuKeyDown = (event: React.KeyboardEvent<HTMLDivElement>) => {
    // Left is "back out one level" in every menu that nests, and so is Escape
    // here. Escape has to be handled on the flyout itself: stopping the event
    // below would keep it from the document listener that otherwise does this.
    if (event.key === 'ArrowLeft' || event.key === 'Escape') {
      event.preventDefault();
      event.stopPropagation();
      closeBookmarks(true);
      return;
    }
    event.stopPropagation();
    moveFocusWithin(submenuRef.current, event);
  };

  // Calculate menu position (adjust if near screen edges)
  const menuStyle: React.CSSProperties = {
    position: 'fixed',
    top: position.y,
    left: position.x,
    zIndex: 9999
  };

  // Adjust position after mount to prevent overflow
  useEffect(() => {
    if (menuRef.current) {
      const rect = menuRef.current.getBoundingClientRect();
      const viewportWidth = window.innerWidth;
      const viewportHeight = window.innerHeight;

      let adjustedTop = position.y;
      let adjustedLeft = position.x;

      // Adjust if menu overflows right edge
      if (rect.right > viewportWidth) {
        adjustedLeft = viewportWidth - rect.width - 10;
      }

      // Adjust if menu overflows bottom edge
      if (rect.bottom > viewportHeight) {
        adjustedTop = viewportHeight - rect.height - 10;
      }

      // Ensure menu doesn't go off left or top edges
      adjustedLeft = Math.max(10, adjustedLeft);
      adjustedTop = Math.max(10, adjustedTop);

      if (adjustedTop !== position.y || adjustedLeft !== position.x) {
        menuRef.current.style.top = `${adjustedTop}px`;
        menuRef.current.style.left = `${adjustedLeft}px`;
      }
    }
  }, [position]);

  const menu = (
    <div
      ref={menuRef}
      style={menuStyle}
      className="bg-surface border border-border-secondary rounded-md shadow-lg min-w-[180px] py-1"
      role="menu"
      aria-label={t('verseContextMenu.verseActions')}
      onClick={(e) => e.stopPropagation()}
      onKeyDown={handleMenuKeyDown}
    >
      {/* Single "Copy Passage" option that opens the copy dialog */}
      {onOpenCopyOptions && (
        <button
          onClick={() => {
            onClose();
            onOpenCopyOptions();
          }}
          className="w-full px-4 py-2 text-start text-sm hover:bg-background-hover transition-colors flex items-center gap-2 cursor-pointer"
          role="menuitem"
        >
          <span className="text-base">
            <svg className="w-4 h-4 inline" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 16H6a2 2 0 01-2-2V6a2 2 0 012-2h8a2 2 0 012 2v2m-6 12h8a2 2 0 002-2v-8a2 2 0 00-2-2h-8a2 2 0 00-2 2v8a2 2 0 002 2z" />
            </svg>
          </span>
          <span>{t('ui.verseContextMenu.copyPassage')}</span>
        </button>
      )}

      {/* Add/Edit Note Option (single verse only) */}
      {versesArray.length === 1 && onAddNote && (
        <>
          <div className="border-t border-border my-1"></div>
          <button
            onClick={() => {
              onClose();
              onAddNote();
            }}
            className="w-full px-4 py-2 text-start text-sm hover:bg-background-hover transition-colors flex items-center gap-2 cursor-pointer"
            role="menuitem"
          >
            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z" />
            </svg>
            <span>{t('ui.verseContextMenu.addNote')}</span>
          </button>
        </>
      )}

      {/* Bookmarks. A flyout rather than an immediate save: "add" and
          "re-point an existing one" are both one click in, and the reader can
          see what they already have before choosing - without losing sight of
          the menu they opened. */}
      {onAddBookmark && (
        <>
          <div className="border-t border-border my-1"></div>
          <div
            className="relative"
            onMouseEnter={() => {
              cancelScheduledClose();
              openBookmarks();
            }}
            onMouseLeave={(e) => {
              // Moving *into* the flyout is not leaving: it renders inside
              // this wrapper, and closing there would make the submenu
              // unreachable by pointer. `relatedTarget` is not always an
              // element - leaving the window hands over `window` itself.
              const to = e.relatedTarget;
              if (to instanceof Node && e.currentTarget.contains(to)) return;
              scheduleClose();
            }}
          >
            <button
              ref={bookmarksItemRef}
              // Always opens, never toggles: the pointer arriving here has
              // already opened the flyout by hover, and a click that closed it
              // again would make the item feel broken.
              onClick={() => openBookmarks(true)}
              onKeyDown={(e) => {
                // Right opens a submenu; the ">" on this item is the promise.
                if (e.key === 'ArrowRight') {
                  e.preventDefault();
                  e.stopPropagation();
                  openBookmarks(true);
                }
              }}
              className="w-full px-4 py-2 text-start text-sm hover:bg-background-hover transition-colors flex items-center gap-2 cursor-pointer"
              role="menuitem"
              aria-haspopup="menu"
              aria-expanded={bookmarksOpen}
              data-testid="verse-bookmarks"
            >
              <BookmarkIcon className="w-4 h-4" />
              <span className="flex-1">{t('ui.verseContextMenu.addToBookmarks')}</span>
              <svg className="w-4 h-4 text-text-muted" aria-hidden="true" focusable="false" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
              </svg>
            </button>

            {bookmarksOpen && (
              <div
                ref={submenuRef}
                role="menu"
                aria-label={t('ui.verseContextMenu.bookmarksHeading')}
                onKeyDown={handleSubmenuKeyDown}
                className="absolute bg-surface border border-border-secondary rounded-md shadow-lg min-w-[220px] py-1 z-10"
                style={{
                  top: placement.offsetY,
                  // Logical inset, so the flyout opens outward in RTL too.
                  ...(placement.flip
                    ? { insetInlineEnd: '100%' }
                    : { insetInlineStart: '100%' }),
                }}
                data-testid="verse-bookmarks-submenu"
              >
                <div className="px-4 py-1.5 text-xs font-semibold text-text-secondary border-b border-border">
                  {t('ui.verseContextMenu.bookmarksHeading')}
                </div>

                <button
                  onClick={() => {
                    onClose();
                    onAddBookmark();
                  }}
                  className="w-full px-4 py-2 text-start text-sm hover:bg-background-hover transition-colors flex items-center gap-2 cursor-pointer"
                  role="menuitem"
                  data-testid="verse-add-bookmark"
                >
                  <BookmarkIcon className="w-4 h-4" />
                  <span>{t('ui.verseContextMenu.addAsNewBookmark')}</span>
                </button>

                {/* Re-pointing an existing bookmark is what makes a *named*
                    one useful: the name stays, the reference moves. */}
                {bookmarks.length > 0 && onReplaceBookmark && (
                  <>
                    <div className="border-t border-border my-1"></div>
                    <div className="px-4 py-1 text-xs text-text-muted">
                      {t('ui.verseContextMenu.replaceExisting')}
                    </div>
                    <div className="max-h-64 overflow-y-auto">
                      {bookmarks.map((bookmark) => (
                        <button
                          key={bookmark.pinId}
                          onClick={() => {
                            onClose();
                            onReplaceBookmark(bookmark.pinId!);
                          }}
                          className="w-full px-4 py-2 text-start text-sm hover:bg-background-hover transition-colors cursor-pointer"
                          role="menuitem"
                          data-testid={`verse-replace-bookmark-${bookmark.pinId}`}
                        >
                          <span className="block truncate">
                            {bookmark.title?.trim() || bookmark.referenceText}
                          </span>
                          {bookmark.title?.trim() && (
                            <span className="block truncate text-xs text-text-secondary">
                              {bookmark.referenceText}
                            </span>
                          )}
                        </button>
                      ))}
                    </div>
                  </>
                )}
              </div>
            )}
          </div>

          {isBookmarked && onRemoveBookmark && (
            <button
              onClick={() => {
                onClose();
                onRemoveBookmark();
              }}
              className="w-full px-4 py-2 text-start text-sm hover:bg-background-hover transition-colors flex items-center gap-2 cursor-pointer"
              role="menuitem"
              data-testid="verse-remove-bookmark"
            >
              <BookmarkIcon marked className="w-4 h-4" style={{ color: BOOKMARK_COLOR }} />
              <span>{t('ui.verseContextMenu.removeBookmark')}</span>
            </button>
          )}
        </>
      )}

      {/* Highlight/Underline Option */}
      {onOpenHighlightMenu && (
        <>
          <div className="border-t border-border my-1"></div>
          <button
            /*
              Keep the text selection alive across this click. Without it the
              mousedown collapses the DOM Selection before onClick runs, and the
              highlight branch - which needs to know WHICH words were selected -
              sees nothing and highlights the whole verse instead. Belt and
              braces: the selection is also snapshotted when the menu opens
              (see capturedSelection.ts), which is what actually guarantees the
              behaviour on platforms where mousedown does collapse it.
            */
            onMouseDown={(e) => e.preventDefault()}
            onClick={() => {
              // Open the highlight menu FIRST: it consumes the snapshot taken
              // when this menu opened, and onClose() discards that snapshot.
              onOpenHighlightMenu();
              onClose();
            }}
            className="w-full px-4 py-2 text-start text-sm hover:bg-background-hover transition-colors flex items-center gap-2 cursor-pointer"
            role="menuitem"
          >
            <svg className="w-4 h-4" fill="currentColor" viewBox="0 0 24 24">
              <path d="M16.24 3.56l4.95 4.94c.78.79.78 2.05 0 2.84L12 20.53a4.008 4.008 0 0 1-5.66 0L2.81 17c-.78-.79-.78-2.05 0-2.84l10.6-10.6c.79-.78 2.05-.78 2.83 0M4.22 15.58l3.54 3.53c.78.79 2.04.79 2.83 0l3.53-3.53-4.95-4.95-4.95 4.95z"/>
            </svg>
            <span className="flex-1">{t('ui.verseContextMenu.highlightUnderline')}</span>
            <span className="text-xs text-text-muted ms-4 bidi-isolate">{'Ctrl+Shift+H'}</span>
          </button>
        </>
      )}

      {/*
        Extension-contributed items, beneath the built-ins and separated from
        them. The order is deliberate: the app's own actions are what a reader
        reaches for, and a freshly installed extension should not be able to
        push "Copy passage" down the list.
      */}
      {extensionItems.length > 0 && (
        <>
          <div className="border-t border-border-secondary my-1" role="separator" />
          {extensionItems.map(({ key, item }) => (
            <button
              key={key}
              onClick={() => {
                onClose();
                void runExtensionCommand(
                  item.command,
                  withVerseMenuContext(item.args, verses, context.translation),
                );
              }}
              className="w-full px-4 py-2 text-start text-sm hover:bg-background-hover transition-colors flex items-center gap-2 cursor-pointer"
              role="menuitem"
            >
              {/*
                No icon slot. `ContextMenuItemDescriptor.icon` is a string the
                extension chooses, and rendering arbitrary extension-supplied
                markup into the app's own menu is exactly the injection this
                platform is built to avoid. A named-icon vocabulary can be
                added later; a gap where an icon would be is honest until then.
              */}
              <span className="w-4 h-4 shrink-0" aria-hidden="true" />
              <span>{i18n.resolve(item.label)}</span>
            </button>
          ))}
        </>
      )}

      {/* Remove Highlight Option - shown only when right-clicking on highlighted text */}
      {markupId && onRemoveHighlight && (
        <button
          onClick={() => {
            onRemoveHighlight(markupId);
            onClose();
          }}
          className="w-full px-4 py-2 text-start text-sm hover:bg-background-hover transition-colors flex items-center gap-2 cursor-pointer"
          role="menuitem"
        >
          <svg className="w-4 h-4" fill="currentColor" viewBox="0 0 24 24">
            <path d="M16.24 3.56l4.95 4.94c.78.79.78 2.05 0 2.84L12 20.53a4.008 4.008 0 0 1-5.66 0L2.81 17c-.78-.79-.78-2.05 0-2.84l10.6-10.6c.79-.78 2.05-.78 2.83 0M4.22 15.58l3.54 3.53c.78.79 2.04.79 2.83 0l3.53-3.53-4.95-4.95-4.95 4.95z"/>
          </svg>
          <span>{t('ui.verseContextMenu.removeHighlight')}</span>
        </button>
      )}
    </div>
  );

  // See the component comment: in place, `position: fixed` resolves against
  // dockview's `contain: layout` root rather than the viewport.
  return typeof document === 'undefined' ? menu : createPortal(menu, document.body);
};

export default VerseContextMenu;
