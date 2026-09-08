import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import BookSinglePanel from './BookSinglePanel';
import { ContextProvider, type AppServices } from '../../contexts/ContextProvider';
import { useBookStore } from '../../stores/useBookStore';
import { bookAPI } from '../../services/electronAPI';

vi.mock('../../services/electronAPI', () => ({
  bookAPI: {
    getAvailableBooks: vi.fn().mockResolvedValue([]),
    getSection: vi.fn().mockResolvedValue(null),
    getTopLevelSections: vi.fn().mockResolvedValue([]),
    getSectionsByParent: vi.fn().mockResolvedValue([]),
    getAllSectionSummaries: vi.fn().mockResolvedValue([]),
    getNextSection: vi.fn().mockResolvedValue(null),
    getPreviousSection: vi.fn().mockResolvedValue(null),
  },
}));

vi.mock('../../stores/useTextSettingsStore', () => ({
  useTextSettingsStore: vi.fn().mockReturnValue({ fontFamily: 'serif', fontSize: 16, lineHeight: 1.6 }),
  getFontFamilyCSS: vi.fn().mockReturnValue('serif'),
}));

vi.mock('../../utils/sanitize', () => ({ sanitizeHtml: (html: string) => html }));
vi.mock('../BookTreeView', () => ({ default: () => <div data-testid="book-tree-view" /> }));

const mockMoveIntoBooksPane = vi.fn();
vi.mock('../BookPane/moveIntoBooksPane', () => ({
  moveIntoBooksPane: (...args: unknown[]) => mockMoveIntoBooksPane(...args),
}));

function createMockServices(): AppServices {
  return {
    registry: {} as AppServices['registry'],
    whenContext: {} as AppServices['whenContext'],
    keybindings: {} as AppServices['keybindings'],
    i18n: {
      t: (key: string) => key,
      currentLocale: 'en' as const,
      onDidChangeLocale: () => ({ dispose: vi.fn() }),
      resolve: (v: unknown) => String(v),
      loadCatalog: vi.fn(),
      setLocale: vi.fn(),
    } as unknown as AppServices['i18n'],
  };
}

function renderPanel(panelId = 'book_mhc_1') {
  return render(
    <ContextProvider services={createMockServices()}>
      <BookSinglePanel contentKey="mhc" panelId={panelId} />
    </ContextProvider>,
  );
}

const FIRST_SECTION = { section_id: 7, title: 'Preface', content: '<p>hi</p>' };

describe('BookSinglePanel', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    useBookStore.setState({ availableBooks: [], loadingBooks: false });
    vi.mocked(bookAPI.getAvailableBooks).mockResolvedValue([]);
    vi.mocked(bookAPI.getTopLevelSections).mockResolvedValue([]);
    vi.mocked(bookAPI.getSectionsByParent).mockResolvedValue([]);
    vi.mocked(bookAPI.getAllSectionSummaries).mockResolvedValue([]);
  });

  // -------------------------------------------------------------------
  // F19 - "Open in own panel" was one-way; this is the way back.
  // -------------------------------------------------------------------
  describe('move into the Books pane (F19)', () => {
    it('moves the book back as a tab, carrying the open section with it', async () => {
      const user = userEvent.setup();
      vi.mocked(bookAPI.getTopLevelSections).mockResolvedValue([FIRST_SECTION]);
      vi.mocked(bookAPI.getAvailableBooks).mockResolvedValue([
        { abbreviation: 'mhc', name: 'Matthew Henry', database_path: 'x.db' },
      ]);

      renderPanel();
      await screen.findByText('Preface');

      await user.click(screen.getByTestId('book-single-move-into-books'));

      expect(mockMoveIntoBooksPane).toHaveBeenCalledWith({
        type: 'book',
        abbreviation: 'mhc',
        name: 'Matthew Henry',
        sectionId: 7,
        sourcePanelId: 'book_mhc_1',
      });
    });

    // The toolbar must render even before a section has loaded, or a book
    // that fails to open has no controls at all - including no way back out.
    it('is reachable even when the book failed to load', async () => {
      const user = userEvent.setup();
      vi.mocked(bookAPI.getTopLevelSections).mockRejectedValue(new Error('database is locked'));

      renderPanel();
      expect(await screen.findByText('database is locked')).toBeInTheDocument();

      await user.click(screen.getByTestId('book-single-move-into-books'));

      expect(mockMoveIntoBooksPane).toHaveBeenCalledWith(
        expect.objectContaining({ type: 'book', abbreviation: 'mhc', sectionId: null }),
      );
    });
  });
});
