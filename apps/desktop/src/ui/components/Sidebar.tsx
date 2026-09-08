/**
 * NOT CURRENTLY MOUNTED.
 *
 * No component renders `Sidebar`, and `CollectionTree` (its only non-trivial
 * child) has no other importer.
 *
 * Bookmarks themselves *do* ship - through the Bible toolbar's star and jump
 * list (`bible/BookmarkMenu.tsx`), the verse context menu, Ctrl+D, and
 * `ManageBookmarksDialog`. What this pair still draws that nothing else does
 * is the collection **hierarchy**: nested folders of pinned items. The v1 UI
 * deliberately has one flat list and no folders, so there is nothing here to
 * "restore" - this is a head start on a feature that has not been asked for.
 *
 * If folders are ever wanted: render `<Sidebar isCollapsed={...}
 * onToggle={...} />` from `App.tsx` beside the dockview layout (it is a
 * fixed-width flex column, not a dockview panel), add the create/rename/
 * reorder affordances - `useBookmarkStore` exposes those operations, but
 * neither component calls them today - and decide how a bookmark in a
 * non-default collection should behave in the flat list, which today ignores
 * it. Then update docs/features/bookmarks-collections.md and
 * docs/features/sidebar-layout.md.
 */
import React, { useState, useEffect } from 'react';
import { useBookmarkStore } from '../stores/useBookmarkStore';
import { useBiblePanel } from '../stores/hooks/useBiblePanel';
import CollectionTree from './CollectionTree';
import { useI18n } from '../contexts/useI18n';

interface SidebarProps {
  isCollapsed: boolean;
  onToggle: () => void;
}

const Sidebar: React.FC<SidebarProps> = ({ isCollapsed, onToggle }) => {
  const { t } = useI18n();
  const [showBookmarks, setShowBookmarks] = useState(true);
  const { collectionTree, pinnedItemsByCollection, loadCollectionItems } = useBookmarkStore();
  const { navigateToVerse, selectedVerseId } = useBiblePanel();

  // Load pinned items for each collection when component mounts
  useEffect(() => {
    if (collectionTree.length > 0) {
      collectionTree.forEach(collection => {
        if (collection.collectionId) {
          loadCollectionItems(collection.collectionId);
        }
      });
    }
  }, [collectionTree, loadCollectionItems]);

  const handleNavigateToVerse = (verseId: number) => {
    navigateToVerse(verseId);
  };

  const toggleLabel = isCollapsed
    ? t('sidebar.expandLabel')
    : t('sidebar.collapseLabel');

  return (
    <div
      className={`h-full bg-surface border-e border-border transition-all duration-300 flex flex-col ${
        isCollapsed ? 'w-12' : 'w-64'
      }`}
    >
      {/* Sidebar Header */}
      <div className="flex items-center justify-between px-md py-sm border-b border-border flex-shrink-0">
        {!isCollapsed && (
          <h2 id="sidebar-heading" className="text-sm font-semibold text-text-heading">{t('sidebar.navigationHeading')}</h2>
        )}
        <button
          type="button"
          onClick={onToggle}
          className="p-1 hover:bg-background-hover rounded transition-colors"
          title={toggleLabel}
          aria-label={toggleLabel}
          aria-expanded={!isCollapsed}
        >
          {isCollapsed ? (
            <svg
              className="w-5 h-5 rtl-mirror"
              aria-hidden="true"
              focusable="false"
              fill="none"
              stroke="currentColor"
              viewBox="0 0 24 24"
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth={2}
                d="M9 5l7 7-7 7"
              />
            </svg>
          ) : (
            <svg
              className="w-5 h-5 rtl-mirror"
              aria-hidden="true"
              focusable="false"
              fill="none"
              stroke="currentColor"
              viewBox="0 0 24 24"
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth={2}
                d="M15 19l-7-7 7-7"
              />
            </svg>
          )}
        </button>
      </div>

      {/* Sidebar Content - Scrollable */}
      <nav
        className="flex-1 overflow-y-auto"
        aria-label={t('sidebar.navigationHeading')}
      >
        {!isCollapsed ? (
          <>
            {/* Home Option */}
            <button
              type="button"
              className="w-full flex items-center px-md py-sm hover:bg-background-hover transition-colors text-start"
              title={t('sidebar.homeTitle')}
            >
              <svg
                className="w-5 h-5 flex-shrink-0"
                aria-hidden="true"
                focusable="false"
                fill="none"
                stroke="currentColor"
                viewBox="0 0 24 24"
              >
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  strokeWidth={2}
                  d="M3 12l2-2m0 0l7-7 7 7M5 10v10a1 1 0 001 1h3m10-11l2 2m-2-2v10a1 1 0 01-1 1h-3m-6 0a1 1 0 001-1v-4a1 1 0 011-1h2a1 1 0 011 1v4a1 1 0 001 1m-6 0h6"
                />
              </svg>
              <span className="ms-md text-sm text-text-primary">{t('sidebar.homeLabel')}</span>
            </button>

            {/* Bookmarks Section */}
            <div className="mt-4">
              <button
                type="button"
                onClick={() => setShowBookmarks(!showBookmarks)}
                aria-expanded={showBookmarks}
                aria-controls="sidebar-bookmarks-section"
                className="w-full flex items-center justify-between px-md py-sm hover:bg-background-hover transition-colors text-start"
              >
                <div className="flex items-center gap-2">
                  <span aria-hidden="true" className="text-base">⭐</span>
                  <span className="text-sm font-semibold text-text-heading">
                    {t('sidebar.bookmarksHeading')}
                  </span>
                </div>
                <svg
                  className={`w-4 h-4 transition-transform ${
                    showBookmarks ? 'rotate-90' : ''
                  } rtl-mirror`}
                  aria-hidden="true"
                  focusable="false"
                  fill="none"
                  stroke="currentColor"
                  viewBox="0 0 24 24"
                >
                  <path
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    strokeWidth={2}
                    d="M9 5l7 7-7 7"
                  />
                </svg>
              </button>

              {showBookmarks && (
                <div id="sidebar-bookmarks-section" className="mt-1">
                  <CollectionTree
                    collections={collectionTree}
                    pinnedItemsByCollection={pinnedItemsByCollection}
                    onNavigateToVerse={handleNavigateToVerse}
                    currentVerseId={selectedVerseId}
                  />
                </div>
              )}
            </div>
          </>
        ) : (
          // Collapsed view - show icons only
          <div className="flex flex-col items-center py-2 gap-2">
            <button
              type="button"
              className="p-2 hover:bg-background-hover rounded transition-colors"
              title={t('sidebar.homeTitle')}
              aria-label={t('sidebar.homeLabel')}
            >
              <svg
                className="w-5 h-5"
                aria-hidden="true"
                focusable="false"
                fill="none"
                stroke="currentColor"
                viewBox="0 0 24 24"
              >
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  strokeWidth={2}
                  d="M3 12l2-2m0 0l7-7 7 7M5 10v10a1 1 0 001 1h3m10-11l2 2m-2-2v10a1 1 0 01-1 1h-3m-6 0a1 1 0 001-1v-4a1 1 0 011-1h2a1 1 0 011 1v4a1 1 0 001 1m-6 0h6"
                />
              </svg>
            </button>
            <button
              type="button"
              onClick={() => {
                onToggle();
                setShowBookmarks(true);
              }}
              className="p-2 hover:bg-background-hover rounded transition-colors text-base"
              title={t('sidebar.bookmarksTitle')}
              aria-label={t('sidebar.bookmarksTitle')}
            >
              <span aria-hidden="true">⭐</span>
            </button>
          </div>
        )}
      </nav>
    </div>
  );
};

export default Sidebar;
