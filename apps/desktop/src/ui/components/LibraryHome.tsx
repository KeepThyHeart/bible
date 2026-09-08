import React, { useMemo, useState } from 'react';
import { useI18n } from '../contexts/useI18n';
import { cleanModuleName } from '../utils/verseFormatting';
import { BOOK_PANE_TAB_ICONS } from './paneIcons';

/**
 * The subset of `BookModule` / `DictionaryModule` this shelf needs. Declared
 * structurally rather than importing either store's type, so the component has
 * no dependency on which store a module came from - the two shapes are
 * identical, and the pane already holds both kinds side by side.
 */
export interface LibraryModule {
  abbreviation: string;
  name: string;
  language_code?: string;
  version?: string;
}

export type LibraryKind = 'book' | 'dictionary';

interface LibraryHomeProps {
  /**
   * Which kind of module this shelf lists. Books and dictionaries live in
   * separate panes now, so a shelf shows one section, not both.
   */
  kind: LibraryKind;
  books: LibraryModule[];
  dictionaries: LibraryModule[];
  /** Abbreviations currently open as tabs, so the shelf can say so. */
  openBooks: Set<string>;
  openDictionaries: Set<string>;
  loadingBooks?: boolean;
  loadingDictionaries?: boolean;
  onOpen: (kind: LibraryKind, abbreviation: string, name: string) => void;
  onInstall: (kind: LibraryKind) => void;
}

interface SectionProps {
  kind: LibraryKind;
  heading: string;
  modules: LibraryModule[];
  open: Set<string>;
  isLoading: boolean;
  filtered: boolean;
  onOpen: LibraryHomeProps['onOpen'];
  onInstall: LibraryHomeProps['onInstall'];
}

const LibrarySection: React.FC<SectionProps> = ({
  kind, heading, modules, open, isLoading, filtered, onOpen, onInstall,
}) => {
  const { t } = useI18n();

  return (
    <section className="mb-6" data-testid={`library-section-${kind}`}>
      <h3 className="flex items-center gap-2 mb-2 text-sm font-semibold text-text-secondary uppercase tracking-wide">
        <span aria-hidden="true">{BOOK_PANE_TAB_ICONS[kind]}</span>
        <span>{heading}</span>
        <span className="font-normal normal-case tracking-normal opacity-70">
          ({modules.length})
        </span>
      </h3>

      {isLoading ? (
        <p className="text-sm text-text-secondary px-1">
          {t('libraryHome.loading')}
        </p>
      ) : modules.length === 0 ? (
        // A filtered-to-nothing shelf and a genuinely empty one need different
        // copy: offering "Get a book" because the search box says "xyzzy" would
        // be wrong, and saying "no matches" when none are installed hides the
        // real problem.
        filtered ? (
          <p className="text-sm text-text-secondary px-1" data-testid={`library-no-matches-${kind}`}>
            {t('libraryHome.noMatches')}
          </p>
        ) : (
          <div className="px-1">
            <p className="text-sm text-text-secondary mb-2">
              {kind === 'book'
                ? t('libraryHome.noBooks')
                : t('libraryHome.noDictionaries')}
            </p>
            <button
              type="button"
              className="px-3 py-1.5 text-sm rounded bg-accent-primary text-on-accent hover:opacity-90 transition-opacity"
              onClick={() => onInstall(kind)}
              data-testid={`library-install-${kind}`}
            >
              {kind === 'book'
                ? t('libraryHome.getBook')
                : t('libraryHome.getDictionary')}
            </button>
          </div>
        )
      ) : (
        <ul className="flex flex-col gap-1">
          {modules.map(mod => {
            const isOpen = open.has(mod.abbreviation);
            const label = mod.name || cleanModuleName(mod.abbreviation);
            return (
              <li key={mod.abbreviation}>
                <button
                  type="button"
                  // A real button, not a clickable div: these are the shelf's
                  // only interactive elements, so keyboard users would otherwise
                  // have no way through the list at all.
                  className="w-full text-start px-3 py-2 rounded border border-border-secondary hover:bg-background-hover transition-colors flex items-baseline gap-2"
                  onClick={() => onOpen(kind, mod.abbreviation, label)}
                  data-testid={`library-item-${mod.abbreviation}`}
                  data-open={isOpen ? 'true' : 'false'}
                >
                  <span className="flex-1 text-text-primary">{label}</span>
                  {mod.version && (
                    <span className="text-xs text-text-secondary opacity-70">{mod.version}</span>
                  )}
                  {isOpen && (
                    <span className="text-xs px-1.5 py-0.5 rounded bg-warning-soft text-text-secondary whitespace-nowrap">
                      {t('libraryHome.alreadyOpen')}
                    </span>
                  )}
                </button>
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
};

/**
 * A pane's landing shelf: every installed module of its kind in one place, with
 * the ones already open marked.
 *
 * Commentary has had an Overview tab for a while; Books and Dictionaries had
 * nothing equivalent, so once a single module was open the only route to any
 * other was an unlabelled "+" in the tab strip. Selecting a module that is
 * already open switches to its tab rather than opening a duplicate - that
 * decision lives in the caller, which is the side that knows about tabs.
 */
const LibraryHome: React.FC<LibraryHomeProps> = ({
  kind, books, dictionaries, openBooks, openDictionaries,
  loadingBooks = false, loadingDictionaries = false, onOpen, onInstall,
}) => {
  const { t } = useI18n();
  const [filter, setFilter] = useState('');

  const query = filter.trim().toLowerCase();
  const matches = useMemo(() => {
    const apply = (mods: LibraryModule[]) =>
      query
        ? mods.filter(m =>
            m.name.toLowerCase().includes(query) ||
            m.abbreviation.toLowerCase().includes(query))
        : mods;
    return { books: apply(books), dictionaries: apply(dictionaries) };
  }, [books, dictionaries, query]);

  const isDictionary = kind === 'dictionary';
  const totalInstalled = isDictionary ? dictionaries.length : books.length;

  return (
    <div className="h-full overflow-auto p-4" data-testid="library-home">
      <div className="mb-4">
        <h2 className="text-lg font-semibold text-text-primary mb-1">
          {isDictionary
            ? t('libraryHome.dictionaryTitle')
            : t('libraryHome.bookTitle')}
        </h2>
        <p className="text-sm text-text-secondary">
          {isDictionary
            ? t('libraryHome.dictionaryDescription')
            : t('libraryHome.bookDescription')}
        </p>
      </div>

      {/* Hidden rather than disabled when there is nothing to filter: an empty
          shelf's problem is that nothing is installed, and a search box implies
          the opposite. */}
      {totalInstalled > 0 && (
        <input
          type="text"
          value={filter}
          onChange={e => setFilter(e.target.value)}
          placeholder={t('libraryHome.filterPlaceholder')}
          aria-label={isDictionary
            ? t('libraryHome.dictionaryFilterLabel')
            : t('libraryHome.bookFilterLabel')}
          data-testid="library-filter"
          className="w-full mb-4 px-3 py-2 text-sm rounded border border-border-secondary bg-surface text-text-primary"
        />
      )}

      {isDictionary ? (
        <LibrarySection
          kind="dictionary"
          heading={t('libraryHome.dictionariesHeading')}
          modules={matches.dictionaries}
          open={openDictionaries}
          isLoading={loadingDictionaries}
          filtered={query.length > 0}
          onOpen={onOpen}
          onInstall={onInstall}
        />
      ) : (
        <LibrarySection
          kind="book"
          heading={t('libraryHome.booksHeading')}
          modules={matches.books}
          open={openBooks}
          isLoading={loadingBooks}
          filtered={query.length > 0}
          onOpen={onOpen}
          onInstall={onInstall}
        />
      )}
    </div>
  );
};

export default LibraryHome;
