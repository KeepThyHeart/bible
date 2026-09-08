import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import CollectionTree from './CollectionTree';
import { useBookmarkStore } from '../stores/useBookmarkStore';
import { enT } from '../testing/enCatalog';

// The component resolves its own strings; mocking the hook keeps the test
// free of a ContextProvider while still asserting the shipped English.
vi.mock('../contexts/useI18n', () => ({
  useI18n: () => ({
    t: (key: string, params?: Record<string, unknown>) => enT(key, params),
    locale: 'en' as const,
    i18n: {},
  }),
}));

describe('CollectionTree', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    useBookmarkStore.setState({
      viewMode: 'tree',
      removeItem: vi.fn(),
    });
  });

  it('renders message when no collections', () => {
    const onNavigateToVerse = vi.fn();
    render(
      <CollectionTree
        collections={[]}
        pinnedItemsByCollection={new Map()}
        onNavigateToVerse={onNavigateToVerse}
        currentVerseId={null}
      />
    );

    expect(screen.getByText(/No collections yet/i)).toBeInTheDocument();
  });

  it('renders collection names', () => {
    const onNavigateToVerse = vi.fn();
    const collections = [
      { collectionId: 1, name: 'Favorites', icon: '⭐' },
      { collectionId: 2, name: 'Study Notes', icon: '📚' },
    ];

    render(
      <CollectionTree
        collections={collections}
        pinnedItemsByCollection={new Map()}
        onNavigateToVerse={onNavigateToVerse}
        currentVerseId={null}
      />
    );

    expect(screen.getByText('Favorites')).toBeInTheDocument();
    expect(screen.getByText('Study Notes')).toBeInTheDocument();
  });

  it('renders collection icons', () => {
    const onNavigateToVerse = vi.fn();
    const collections = [
      { collectionId: 1, name: 'Favorites', icon: '⭐' },
    ];

    render(
      <CollectionTree
        collections={collections}
        pinnedItemsByCollection={new Map()}
        onNavigateToVerse={onNavigateToVerse}
        currentVerseId={null}
      />
    );

    expect(screen.getByText('⭐')).toBeInTheDocument();
  });

  it('displays item count in collection', () => {
    const onNavigateToVerse = vi.fn();
    const collections = [
      {
        collectionId: 1,
        name: 'My Verses',
        icon: '✨',
        metadata: { itemCount: 5 },
      },
    ];

    render(
      <CollectionTree
        collections={collections}
        pinnedItemsByCollection={new Map()}
        onNavigateToVerse={onNavigateToVerse}
        currentVerseId={null}
      />
    );

    expect(screen.getByText('5')).toBeInTheDocument();
  });

  it('expands and collapses collections', async () => {
    const user = userEvent.setup();
    const onNavigateToVerse = vi.fn();
    const collections = [
      { collectionId: 1, name: 'Collection', icon: '📁' },
    ];
    const pinnedItems = [
      {
        pinId: 1,
        collectionId: 1,
        itemType: 'verse',
        verseIdStart: 43003016,
        referenceText: 'John 3:16',
      },
    ];

    render(
      <CollectionTree
        collections={collections}
        pinnedItemsByCollection={new Map([[1, pinnedItems]])}
        onNavigateToVerse={onNavigateToVerse}
        currentVerseId={null}
      />
    );

    // Collection should be expanded by default
    expect(screen.getByText('John 3:16')).toBeInTheDocument();

    // Click to collapse
    const collectionButton = screen.getByText('Collection').closest('button');
    await user.click(collectionButton!);

    // Items should disappear
    expect(screen.queryByText('John 3:16')).not.toBeInTheDocument();
  });

  it('navigates to verse when item is clicked', async () => {
    const user = userEvent.setup();
    const onNavigateToVerse = vi.fn();
    const collections = [
      { collectionId: 1, name: 'Collection', icon: '📁' },
    ];
    const pinnedItems = [
      {
        pinId: 1,
        collectionId: 1,
        itemType: 'verse',
        verseIdStart: 43003016,
        referenceText: 'John 3:16',
      },
    ];

    render(
      <CollectionTree
        collections={collections}
        pinnedItemsByCollection={new Map([[1, pinnedItems]])}
        onNavigateToVerse={onNavigateToVerse}
        currentVerseId={null}
      />
    );

    const verseLink = screen.getByText('John 3:16');
    await user.click(verseLink);

    expect(onNavigateToVerse).toHaveBeenCalledWith(43003016);
  });

  it('highlights current verse', () => {
    const onNavigateToVerse = vi.fn();
    const collections = [
      { collectionId: 1, name: 'Collection', icon: '📁' },
    ];
    const pinnedItems = [
      {
        pinId: 1,
        collectionId: 1,
        itemType: 'verse',
        verseIdStart: 43003016,
        referenceText: 'John 3:16',
      },
    ];

    const { container } = render(
      <CollectionTree
        collections={collections}
        pinnedItemsByCollection={new Map([[1, pinnedItems]])}
        onNavigateToVerse={onNavigateToVerse}
        currentVerseId={43003016}
      />
    );

    const verseButton = Array.from(container.querySelectorAll('button')).find(
      btn => btn.textContent?.includes('John 3:16')
    );
    expect(verseButton).toHaveClass('bg-accent-soft');
  });

  it('shows flat view mode when enabled', () => {
    const onNavigateToVerse = vi.fn();
    useBookmarkStore.setState({ viewMode: 'flat' });

    const collections = [
      { collectionId: 1, name: 'Collection1', icon: '📁' },
      { collectionId: 2, name: 'Collection2', icon: '📁' },
    ];
    const pinnedItems1 = [
      {
        pinId: 1,
        collectionId: 1,
        itemType: 'verse',
        verseIdStart: 43003016,
        referenceText: 'John 3:16',
      },
    ];
    const pinnedItems2 = [
      {
        pinId: 2,
        collectionId: 2,
        itemType: 'verse',
        verseIdStart: 40001001,
        referenceText: 'Matthew 1:1',
      },
    ];

    render(
      <CollectionTree
        collections={collections}
        pinnedItemsByCollection={
          new Map([
            [1, pinnedItems1],
            [2, pinnedItems2],
          ])
        }
        onNavigateToVerse={onNavigateToVerse}
        currentVerseId={null}
      />
    );

    // In flat view, items appear without collection headers
    expect(screen.getByText('John 3:16')).toBeInTheDocument();
    expect(screen.getByText('Matthew 1:1')).toBeInTheDocument();
  });

  it('handles nested collections', () => {
    const onNavigateToVerse = vi.fn();
    const collections = [
      {
        collectionId: 1,
        name: 'Parent',
        icon: '📁',
        children: [
          { collectionId: 2, name: 'Child', icon: '📂' },
        ],
      },
    ];

    render(
      <CollectionTree
        collections={collections}
        pinnedItemsByCollection={new Map()}
        onNavigateToVerse={onNavigateToVerse}
        currentVerseId={null}
      />
    );

    expect(screen.getByText('Parent')).toBeInTheDocument();
    expect(screen.getByText('Child')).toBeInTheDocument();
  });

  it('shows note indicator for items with notes', () => {
    const onNavigateToVerse = vi.fn();
    const collections = [
      { collectionId: 1, name: 'Collection', icon: '📁' },
    ];
    const pinnedItems = [
      {
        pinId: 1,
        collectionId: 1,
        itemType: 'verse',
        verseIdStart: 43003016,
        referenceText: 'John 3:16',
        notes: 'Important verse',
      },
    ];

    render(
      <CollectionTree
        collections={collections}
        pinnedItemsByCollection={new Map([[1, pinnedItems]])}
        onNavigateToVerse={onNavigateToVerse}
        currentVerseId={null}
      />
    );

    expect(screen.getByText('📝')).toBeInTheDocument();
  });

  it('does not show note indicator for items without notes', () => {
    const onNavigateToVerse = vi.fn();
    const collections = [
      { collectionId: 1, name: 'Collection', icon: '📁' },
    ];
    const pinnedItems = [
      {
        pinId: 1,
        collectionId: 1,
        itemType: 'verse',
        verseIdStart: 43003016,
        referenceText: 'John 3:16',
      },
    ];

    render(
      <CollectionTree
        collections={collections}
        pinnedItemsByCollection={new Map([[1, pinnedItems]])}
        onNavigateToVerse={onNavigateToVerse}
        currentVerseId={null}
      />
    );

    expect(screen.queryByTestId('pinned-item-note-indicator')).not.toBeInTheDocument();
  });

  it('shows the shared pin icon on every pinned item, with or without notes', () => {
    const onNavigateToVerse = vi.fn();
    const collections = [
      { collectionId: 1, name: 'Collection', icon: '📁' },
    ];
    const pinnedItems = [
      {
        pinId: 1,
        collectionId: 1,
        itemType: 'verse',
        verseIdStart: 43003016,
        referenceText: 'John 3:16',
        notes: 'Important verse',
      },
      {
        pinId: 2,
        collectionId: 1,
        itemType: 'verse',
        verseIdStart: 1001001,
        referenceText: 'Gen 1:1',
      },
    ];

    const { container } = render(
      <CollectionTree
        collections={collections}
        pinnedItemsByCollection={new Map([[1, pinnedItems]])}
        onNavigateToVerse={onNavigateToVerse}
        currentVerseId={null}
      />
    );

    const indicators = container.querySelectorAll('[data-testid="pinned-item-indicator"]');
    expect(indicators.length).toBe(2);
    indicators.forEach((indicator) => {
      expect(indicator.querySelector('svg')).toBeInTheDocument();
    });
    // Only the item with notes gets the additional note glyph.
    expect(container.querySelectorAll('[data-testid="pinned-item-note-indicator"]').length).toBe(1);
  });

  it('removes item from context menu', async () => {
    const user = userEvent.setup();
    const removeItem = vi.fn().mockResolvedValue(undefined);
    useBookmarkStore.setState({ removeItem });

    const onNavigateToVerse = vi.fn();
    const collections = [
      { collectionId: 1, name: 'Collection', icon: '📁' },
    ];
    const pinnedItems = [
      {
        pinId: 1,
        collectionId: 1,
        itemType: 'verse',
        verseIdStart: 43003016,
        referenceText: 'John 3:16',
      },
    ];

    const { container } = render(
      <CollectionTree
        collections={collections}
        pinnedItemsByCollection={new Map([[1, pinnedItems]])}
        onNavigateToVerse={onNavigateToVerse}
        currentVerseId={null}
      />
    );

    const verseButton = Array.from(container.querySelectorAll('button')).find(
      btn => btn.textContent?.includes('John 3:16')
    );

    // Right-click to open context menu
    await user.pointer({ target: verseButton, keys: '[MouseRight]' });

    const removeButton = screen.getByText('Remove');
    await user.click(removeButton);

    expect(removeItem).toHaveBeenCalledWith(1);
  });

  it('displays verse in biblical order in flat view', () => {
    const onNavigateToVerse = vi.fn();
    useBookmarkStore.setState({ viewMode: 'flat' });

    const collections = [
      { collectionId: 1, name: 'Mixed', icon: '📁' },
    ];
    const pinnedItems = [
      {
        pinId: 1,
        collectionId: 1,
        itemType: 'verse',
        verseIdStart: 66022021,
        referenceText: 'Rev 22:21',
      },
      {
        pinId: 2,
        collectionId: 1,
        itemType: 'verse',
        verseIdStart: 1001001,
        referenceText: 'Gen 1:1',
      },
      {
        pinId: 3,
        collectionId: 1,
        itemType: 'verse',
        verseIdStart: 40001001,
        referenceText: 'Matt 1:1',
      },
    ];

    render(
      <CollectionTree
        collections={collections}
        pinnedItemsByCollection={new Map([[1, pinnedItems]])}
        onNavigateToVerse={onNavigateToVerse}
        currentVerseId={null}
      />
    );

    // Items should be sorted in biblical order
    const buttons = screen.getAllByRole('button');
    const textContent = buttons.map(b => b.textContent).join(' ');
    expect(textContent).toMatch(/Gen 1:1.*Matt 1:1.*Rev 22:21/);
  });
});
