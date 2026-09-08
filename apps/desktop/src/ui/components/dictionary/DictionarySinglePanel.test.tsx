import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import DictionarySinglePanel from './DictionarySinglePanel';
import { ContextProvider, type AppServices } from '../../contexts/ContextProvider';
import { useDictionaryStore } from '../../stores/useDictionaryStore';
import { dictionaryAPI } from '../../services/electronAPI';
import { enT } from '../../testing/enCatalog';

vi.mock('../../services/electronAPI', () => ({
  dictionaryAPI: {
    getAvailableDictionaries: vi.fn().mockResolvedValue([]),
    getEntryByKey: vi.fn().mockResolvedValue(null),
    getEntry: vi.fn().mockResolvedValue(null),
    searchEntries: vi.fn().mockResolvedValue([]),
    getAllEntries: vi.fn().mockResolvedValue([]),
  },
}));

vi.mock('../../stores/useTextSettingsStore', () => ({
  useTextSettingsStore: vi.fn().mockReturnValue({ fontFamily: 'serif', fontSize: 16, lineHeight: 1.6 }),
  getFontFamilyCSS: vi.fn().mockReturnValue('serif'),
}));

vi.mock('../../utils/verseReference', () => ({
  formatVerseReference: (id: number) => `Verse ${id}`,
}));

vi.mock('../../utils/sanitize', () => ({
  sanitizeHtml: (html: string) => html,
}));

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
      t: (key: string, params?: Record<string, unknown>) => enT(key, params),
      currentLocale: 'en' as const,
      onDidChangeLocale: () => ({ dispose: vi.fn() }),
      resolve: (v: unknown) => String(v),
      loadCatalog: vi.fn(),
      setLocale: vi.fn(),
    } as unknown as AppServices['i18n'],
  };
}

function renderPanel(contentKey = 'StrongsGreek', panelId?: string) {
  return render(
    <ContextProvider services={createMockServices()}>
      <DictionarySinglePanel contentKey={contentKey} panelId={panelId} />
    </ContextProvider>,
  );
}

function makeEntries(count: number, offset = 0) {
  return Array.from({ length: count }, (_, i) => ({
    entry_key: String(i + offset).padStart(5, '0'),
    word: `word${i + offset}`,
    definition: `definition ${i + offset}`,
  }));
}

describe('DictionarySinglePanel', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    useDictionaryStore.setState({ availableDictionaries: [], loadingDictionaries: false });
    vi.mocked(dictionaryAPI.getAvailableDictionaries).mockResolvedValue([]);
    vi.mocked(dictionaryAPI.getEntryByKey).mockResolvedValue(null);
    vi.mocked(dictionaryAPI.searchEntries).mockResolvedValue([]);
    vi.mocked(dictionaryAPI.getAllEntries).mockResolvedValue([]);
  });

  // -------------------------------------------------------------------
  // F8 - the panel restores from the layout, so it may be the only thing
  // that ever asks for the dictionary catalog.
  // -------------------------------------------------------------------
  describe('module name resolution (F8)', () => {
    it('loads the catalog itself when nothing else has, and shows the resolved name', async () => {
      vi.mocked(dictionaryAPI.getAvailableDictionaries).mockResolvedValue([
        { abbreviation: 'StrongsGreek', name: "Strong's Greek Lexicon", database_path: 'x.db' },
      ]);

      renderPanel();

      expect(dictionaryAPI.getAvailableDictionaries).toHaveBeenCalled();
      expect(await screen.findByText("Strong's Greek Lexicon")).toBeInTheDocument();
    });

    it('falls back to a cleaned abbreviation when the module is not in the catalog', async () => {
      renderPanel('StrongsGreek2');

      // Trailing SWORD-import digit stripped, rather than showing the raw key.
      expect(await screen.findByText('StrongsGreek')).toBeInTheDocument();
    });
  });

  // -------------------------------------------------------------------
  // F22 - the browse dialog was a bare div with clickable divs inside.
  // -------------------------------------------------------------------
  describe('browse dialog accessibility (F22)', () => {
    it('is a modal dialog whose rows are real buttons', async () => {
      const user = userEvent.setup();
      vi.mocked(dictionaryAPI.getAllEntries).mockResolvedValue(makeEntries(3));

      renderPanel();
      await user.click(screen.getByRole('button', { name: 'Browse' }));

      const dialog = await screen.findByRole('dialog');
      expect(dialog).toHaveAttribute('aria-modal', 'true');
      expect(dialog).toHaveAttribute('aria-labelledby', 'dictionary-single-browse-title');
      expect(screen.getAllByRole('button', { name: /definition \d/ })).toHaveLength(3);
    });

    it('closes on Escape', async () => {
      const user = userEvent.setup();
      vi.mocked(dictionaryAPI.getAllEntries).mockResolvedValue(makeEntries(3));

      renderPanel();
      await user.click(screen.getByRole('button', { name: 'Browse' }));
      const dialog = await screen.findByRole('dialog');

      // The focus trap moves focus into the dialog on a requestAnimationFrame,
      // so the dialog being in the DOM does not yet mean focus is inside it.
      // Escape is handled by a keydown listener on the dialog, which only sees
      // the event once focus is within - without this wait the key is delivered
      // to the still-focused Browse button and the assertion races the trap.
      await waitFor(() => expect(dialog.contains(document.activeElement)).toBe(true));

      await user.keyboard('{Escape}');

      await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
    });

    it('offers an actionable empty state instead of a bare line of grey text', async () => {
      const user = userEvent.setup();
      vi.mocked(dictionaryAPI.getAllEntries).mockResolvedValue(makeEntries(2));

      renderPanel();
      expect(screen.getByTestId('dictionary-single-no-entry-state')).toBeInTheDocument();

      await user.click(screen.getByTestId('dictionary-single-empty-browse'));
      expect(await screen.findByRole('dialog')).toBeInTheDocument();
    });
  });

  // -------------------------------------------------------------------
  // F14 - the list stopped dead at 100 entries with nothing said.
  // -------------------------------------------------------------------
  describe('browse list disclosure and paging (F14)', () => {
    it('discloses a truncated list and loads the next page on demand', async () => {
      const user = userEvent.setup();
      vi.mocked(dictionaryAPI.getAllEntries).mockResolvedValueOnce(makeEntries(100));

      renderPanel();
      await user.click(screen.getByRole('button', { name: 'Browse' }));

      expect(await screen.findByTestId('dictionary-single-browse-count'))
        .toHaveTextContent('Showing the first 100 entries');

      vi.mocked(dictionaryAPI.getAllEntries).mockResolvedValueOnce(makeEntries(5, 100));
      await user.click(screen.getByTestId('dictionary-single-browse-load-more'));

      expect(dictionaryAPI.getAllEntries).toHaveBeenLastCalledWith('StrongsGreek', 100, 100);
      await waitFor(() =>
        expect(screen.getByTestId('dictionary-single-browse-count'))
          .toHaveTextContent('Showing all 105 entries'),
      );
      // A short page means the end of the dictionary - nothing more to offer.
      expect(screen.queryByTestId('dictionary-single-browse-load-more')).not.toBeInTheDocument();
    });

    it('does not offer more when the first page already exhausted the dictionary', async () => {
      const user = userEvent.setup();
      vi.mocked(dictionaryAPI.getAllEntries).mockResolvedValue(makeEntries(4));

      renderPanel();
      await user.click(screen.getByRole('button', { name: 'Browse' }));

      expect(await screen.findByTestId('dictionary-single-browse-count'))
        .toHaveTextContent('Showing all 4 entries');
      expect(screen.queryByTestId('dictionary-single-browse-load-more')).not.toBeInTheDocument();
    });
  });

  // -------------------------------------------------------------------
  // A failed lookup landed on a bare red line, while DictionaryPane offered
  // two ways forward. The Enter cascade makes this state easy to reach.
  // -------------------------------------------------------------------
  describe('lookup failure', () => {
    it('offers a search and the browse list instead of a bare red line', async () => {
      const user = userEvent.setup();
      renderPanel();

      await user.type(screen.getByRole('textbox'), 'Joshua{Enter}');

      const errorState = await screen.findByTestId('dictionary-single-error-state');
      expect(errorState).toHaveTextContent('No entry found for');
      expect(screen.getByTestId('dictionary-single-error-search')).toBeInTheDocument();
      expect(screen.getByTestId('dictionary-single-error-browse')).toBeInTheDocument();
    });

    it('runs the text search from the error state, on the term still in the box', async () => {
      const user = userEvent.setup();
      renderPanel();
      await user.type(screen.getByRole('textbox'), 'Joshua{Enter}');
      await screen.findByTestId('dictionary-single-error-state');

      vi.mocked(dictionaryAPI.searchEntries).mockResolvedValueOnce(makeEntries(3));
      await user.click(screen.getByTestId('dictionary-single-error-search'));

      expect(dictionaryAPI.searchEntries).toHaveBeenLastCalledWith('StrongsGreek', 'Joshua', 50);
      expect(await screen.findByRole('dialog')).toBeInTheDocument();
    });
  });

  // -------------------------------------------------------------------
  // F19 - "Open in own panel" was one-way; this is the way back.
  // -------------------------------------------------------------------
  describe('move into the Books pane (F19)', () => {
    it('moves the dictionary back as a tab, carrying the open entry with it', async () => {
      const user = userEvent.setup();
      vi.mocked(dictionaryAPI.getAvailableDictionaries).mockResolvedValue([
        { abbreviation: 'StrongsGreek', name: "Strong's Greek Lexicon", database_path: 'x.db' },
      ]);
      vi.mocked(dictionaryAPI.getEntryByKey).mockResolvedValue({
        entry_key: '00025', word: 'agape', definition: 'love',
      });

      renderPanel('StrongsGreek', 'dictionary_StrongsGreek_1');
      await user.type(screen.getByRole('textbox'), '00025{Enter}');
      await screen.findByText('agape');

      await user.click(screen.getByTestId('dictionary-single-move-into-books'));

      expect(mockMoveIntoBooksPane).toHaveBeenCalledWith({
        type: 'dictionary',
        abbreviation: 'StrongsGreek',
        name: "Strong's Greek Lexicon",
        entryKey: '00025',
        sourcePanelId: 'dictionary_StrongsGreek_1',
      });
    });

    it('moves back with no entry key when nothing has been looked up', async () => {
      const user = userEvent.setup();
      renderPanel('StrongsGreek', 'dictionary_StrongsGreek_1');

      await user.click(screen.getByTestId('dictionary-single-move-into-books'));

      expect(mockMoveIntoBooksPane).toHaveBeenCalledWith(
        expect.objectContaining({ type: 'dictionary', entryKey: null }),
      );
    });
  });
});
