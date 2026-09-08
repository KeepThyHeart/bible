/**
 * NOT CURRENTLY MOUNTED - rendered only by `Sidebar.tsx`, which is itself
 * unmounted. See the header of `Sidebar.tsx` for why the pair is kept and what
 * wiring it up involves.
 */
import React, { useState } from 'react';
import { useBookmarkStore } from '../stores/useBookmarkStore';
import { anchorAtPointerX } from '../utils/overlayPosition';
import { PinIcon } from './shared/icons/PinIcon';
import { useI18n } from '../contexts/useI18n';

// Collection item structure (matching what we get from the store)
interface CollectionItem {
  collectionId?: number;
  name: string;
  icon?: string;
  color?: string;
  children?: CollectionItem[];
  metadata?: any;
}

// Pinned item structure
interface PinnedItem {
  pinId?: number;
  collectionId?: number;
  itemType: string;
  verseIdStart?: number;
  referenceText?: string;
  notes?: string;
}

interface CollectionTreeProps {
  collections: CollectionItem[];
  pinnedItemsByCollection: Map<number, PinnedItem[]>;
  onNavigateToVerse: (verseId: number) => void;
  currentVerseId: number | null;
}

interface CollectionNodeProps {
  collection: CollectionItem;
  pinnedItems: PinnedItem[];
  onNavigateToVerse: (verseId: number) => void;
  currentVerseId: number | null;
  depth?: number;
}

const CollectionNode: React.FC<CollectionNodeProps> = ({
  collection,
  pinnedItems,
  onNavigateToVerse,
  currentVerseId,
  depth = 0
}) => {
  const [isExpanded, setIsExpanded] = useState(true);

  const itemCount = collection.metadata?.itemCount ?? pinnedItems.length;
  const hasChildren = collection.children && collection.children.length > 0;

  return (
    <div className="select-none">
      {/* Collection Header */}
      <button
        onClick={() => setIsExpanded(!isExpanded)}
        className="w-full flex items-center gap-1 px-2 py-1.5 hover:bg-background-hover rounded transition-colors text-start group"
        style={{ paddingInlineStart: `${depth * 12 + 8}px` }}
      >
        {/* Expand/Collapse Triangle */}
        <svg
          className={`w-3 h-3 flex-shrink-0 transition-transform ${
            isExpanded ? 'rotate-90' : ''
          } rtl-mirror`}
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

        {/* Icon */}
        <span className="text-base flex-shrink-0" title={collection.name}>
          {collection.icon || '📁'}
        </span>

        {/* Name */}
        <span className="text-sm font-medium text-text-primary truncate flex-1">
          {collection.name}
        </span>

        {/* Count Badge */}
        {itemCount > 0 && (
          <span className="text-xs text-text-secondary bg-background-tertiary group-hover:bg-background-active px-1.5 py-0.5 rounded">
            {itemCount}
          </span>
        )}
      </button>

      {/* Expanded Content */}
      {isExpanded && (
        <div className="ms-2">
          {/* Pinned Items */}
          {pinnedItems.map((item) => (
            <PinnedItemNode
              key={item.pinId}
              item={item}
              onNavigate={onNavigateToVerse}
              isActive={currentVerseId === item.verseIdStart}
              depth={depth + 1}
            />
          ))}

          {/* Child Collections (recursive) */}
          {hasChildren &&
            collection.children!.map((child) => (
              <CollectionNode
                key={child.collectionId}
                collection={child}
                pinnedItems={[]} // Will be populated by parent component
                onNavigateToVerse={onNavigateToVerse}
                currentVerseId={currentVerseId}
                depth={depth + 1}
              />
            ))}
        </div>
      )}
    </div>
  );
};

interface PinnedItemNodeProps {
  item: PinnedItem;
  onNavigate: (verseId: number) => void;
  isActive: boolean;
  depth: number;
}

const PinnedItemNode: React.FC<PinnedItemNodeProps> = ({
  item,
  onNavigate,
  isActive,
  depth
}) => {
  const { t } = useI18n();
  const { removeItem } = useBookmarkStore();
  const [contextMenu, setContextMenu] = useState<{ x: number; y: number } | null>(null);

  const handleClick = () => {
    if (item.verseIdStart) {
      onNavigate(item.verseIdStart);
    }
  };

  const handleContextMenu = (e: React.MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setContextMenu({ x: e.clientX, y: e.clientY });
  };

  const handleRemove = async () => {
    if (item.pinId) {
      try {
        await removeItem(item.pinId);
        setContextMenu(null);
      } catch (error) {
        console.error('Failed to remove bookmark:', error);
      }
    }
  };

  // Close menu when clicking elsewhere
  React.useEffect(() => {
    if (!contextMenu) return;
    const handleClickOutside = () => setContextMenu(null);
    document.addEventListener('click', handleClickOutside);
    return () => document.removeEventListener('click', handleClickOutside);
  }, [contextMenu]);

  return (
    <>
      <button
        onClick={handleClick}
        onContextMenu={handleContextMenu}
        className={`w-full flex items-center gap-1.5 px-2 py-1 rounded transition-colors text-start ${
          isActive
            ? 'bg-accent-soft hover:bg-accent-soft'
            : 'hover:bg-background-hover'
        }`}
        style={{ paddingInlineStart: `${depth * 12 + 8}px` }}
        title={item.notes ? `Notes: ${item.notes.substring(0, 100)}...` : item.referenceText}
      >
        {/*
          Every row here is a pinned (bookmarked) item by definition, so the
          thumbtack is shown unconditionally as the "this is pinned"
          indicator - matching the icon used everywhere else pinning shows
          up in the app. Whether the item also has notes attached is
          separate information (not every pinned item has notes, and the
          note glyph communicates "open this to read/edit notes"), so it is
          rendered as an additional glyph rather than replacing the pin icon.
        */}
        <span className="flex items-center gap-1 flex-shrink-0" data-testid="pinned-item-indicator">
          <PinIcon pinned className="w-3 h-3 text-text-secondary" />
          {item.notes && (
            <span className="text-xs" title={t('collectionTree.hasNotes')} data-testid="pinned-item-note-indicator">📝</span>
          )}
        </span>

        {/* Reference Text */}
        <span
          className={`text-sm truncate ${
            isActive ? 'font-medium text-accent-strong' : 'text-text-primary'
          }`}
        >
          {item.referenceText}
        </span>
      </button>

      {/* Context Menu */}
      {contextMenu && (
        <div
          className="fixed bg-surface-elevated shadow-lg border border-border-secondary rounded-md py-1 z-50"
          style={{ ...anchorAtPointerX(contextMenu.x), top: contextMenu.y }}
          onClick={(e) => e.stopPropagation()}
        >
          <button
            onClick={handleRemove}
            className="w-full px-4 py-2 text-start text-sm hover:bg-background-hover text-danger"
          >
            {t('collectionTree.remove')}
          </button>
        </div>
      )}
    </>
  );
};

const CollectionTree: React.FC<CollectionTreeProps> = ({
  collections,
  pinnedItemsByCollection,
  onNavigateToVerse,
  currentVerseId
}) => {
  const { t } = useI18n();
  const { viewMode } = useBookmarkStore();

  if (collections.length === 0) {
    return (
      <div className="px-4 py-6 text-center">
        <p className="text-sm text-text-secondary italic">
          {t('collectionTree.noCollectionsYet')}
        </p>
        <p className="text-xs text-text-secondary mt-1">
          {t('collectionTree.clickTheBookmarkIconOnAny')}
        </p>
      </div>
    );
  }

  // Flat mode: show all bookmarks in biblical order
  if (viewMode === 'flat') {
    // Collect all pinned items from all collections
    const allItems: PinnedItem[] = [];
    pinnedItemsByCollection.forEach((items) => {
      allItems.push(...items);
    });

    // Remove duplicates based on verseIdStart (same verse can be in multiple collections)
    const uniqueItems = allItems.reduce((acc, item) => {
      if (item.verseIdStart && !acc.some(i => i.verseIdStart === item.verseIdStart)) {
        acc.push(item);
      }
      return acc;
    }, [] as PinnedItem[]);

    // Sort by verse ID (biblical order)
    const sortedItems = uniqueItems.sort((a, b) => {
      return (a.verseIdStart || 0) - (b.verseIdStart || 0);
    });

    if (sortedItems.length === 0) {
      return (
        <div className="px-4 py-6 text-center">
          <p className="text-sm text-text-secondary italic">
            {t('collectionTree.noBookmarksYet')}
          </p>
          <p className="text-xs text-text-secondary mt-1">
            {t('collectionTree.clickTheBookmarkIconOnAny')}
          </p>
        </div>
      );
    }

    return (
      <div className="py-1">
        {sortedItems.map((item) => (
          <PinnedItemNode
            key={item.pinId}
            item={item}
            onNavigate={onNavigateToVerse}
            isActive={currentVerseId === item.verseIdStart}
            depth={0}
          />
        ))}
      </div>
    );
  }

  // Tree mode: show hierarchical collections
  return (
    <div className="py-1">
      {collections.map((collection) => (
        <CollectionNode
          key={collection.collectionId}
          collection={collection}
          pinnedItems={
            collection.collectionId
              ? pinnedItemsByCollection.get(collection.collectionId) || []
              : []
          }
          onNavigateToVerse={onNavigateToVerse}
          currentVerseId={currentVerseId}
          depth={0}
        />
      ))}
    </div>
  );
};

export default CollectionTree;
