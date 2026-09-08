import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { BookSection, BookSectionSummary } from '../../stores/useBookStore';
import { useI18n } from '../../contexts/useI18n';
import { cleanModuleName } from '../../utils/verseFormatting';
import { bookAPI } from '../../services/electronAPI';
import BookSectionTree, { ancestorsOf } from './BookSectionTree';
import PaneLoadingSkeleton from '../onboarding/PaneLoadingSkeleton';

/**
 * A book's Home page: search the whole book, and browse its table of contents.
 *
 * A book is the one study module you cannot navigate by reference, so the way
 * in has to be its structure and its text. Home is both: a search box over the
 * full text, and the table of contents inline rather than in a modal - rather
 * than the book's first section, usually a title page, with the outline hidden
 * behind a "Contents" dialog.
 *
 * Search runs against `book_section_fts`, wired all the way through the IPC
 * bridge. A
 * hit names the section it is in, so "which chapter mentions this" is one
 * query rather than a manual walk.
 */

interface BookHomeProps {
  abbreviation: string;
  /** The book's display name, for the heading. */
  name: string;
  summaries: BookSectionSummary[];
  isLoading: boolean;
  error: string | null;
  onRetry: () => void;
  onSelectSection: (sectionId: number) => void;
}

/** How many full-text hits one search returns. */
const SEARCH_LIMIT = 50;

/** Debounce for the search box, matched to the dictionary's live search. */
const SEARCH_DEBOUNCE_MS = 250;

const BookHome: React.FC<BookHomeProps> = ({
  abbreviation,
  name,
  summaries,
  isLoading,
  error,
  onRetry,
  onSelectSection,
}) => {
  const { t } = useI18n();
  const [query, setQuery] = useState('');
  const [results, setResults] = useState<BookSection[] | null>(null);
  const [isSearching, setIsSearching] = useState(false);
  const [searchError, setSearchError] = useState<string | null>(null);

  /*
    Which search a response belongs to. Without it a slow query for "gr" could
    land after a fast one for "grace" and replace the right answer with a stale
    one - the classic out-of-order-response bug, and the reason this is a ref
    rather than state (it must be readable inside the async continuation).
  */
  const requestSeq = useRef(0);

  const trimmed = query.trim();

  useEffect(() => {
    if (trimmed.length < 2) {
      setResults(null);
      setIsSearching(false);
      setSearchError(null);
      return;
    }

    const seq = ++requestSeq.current;
    setIsSearching(true);
    const timer = window.setTimeout(() => {
      void (async () => {
        try {
          const found = await bookAPI.searchSections(abbreviation, trimmed, SEARCH_LIMIT);
          if (requestSeq.current !== seq) return;
          setResults(found ?? []);
          setSearchError(null);
        } catch (err) {
          if (requestSeq.current !== seq) return;
          setResults([]);
          // FTS5 rejects a bare operator ("and", a lone quote), which is easy
          // to type mid-word. Saying so beats an empty list that reads as "this
          // book does not contain the word you are looking at".
          setSearchError(err instanceof Error ? err.message : String(err));
        } finally {
          if (requestSeq.current === seq) setIsSearching(false);
        }
      })();
    }, SEARCH_DEBOUNCE_MS);

    return () => window.clearTimeout(timer);
  }, [abbreviation, trimmed]);

  // Searching a nested book is only useful if you can see where a hit sits, so
  // the tree opens the path down to every match.
  const matchAncestors = useMemo(() => {
    if (!results?.length) return undefined;
    const expanded = new Set<number>();
    for (const hit of results) {
      for (const id of ancestorsOf(summaries, hit.section_id ?? null)) expanded.add(id);
    }
    return expanded;
  }, [results, summaries]);

  const clearSearch = useCallback(() => {
    setQuery('');
    setResults(null);
    setSearchError(null);
  }, []);

  const searchLabel = t('bookPane.homeSearchLabel');

  return (
    <div className="h-full overflow-auto" data-testid="book-home">
      <div className="max-w-4xl mx-auto px-xl py-lg">
        <h2 className="text-2xl font-semibold text-text-heading mb-xs">
          {name || cleanModuleName(abbreviation)}
        </h2>
        <p className="text-sm text-text-secondary mb-lg">
          {t('bookPane.homeDescription')}
        </p>

        <div className="flex items-center gap-sm mb-lg">
          <input
            type="search"
            value={query}
            onChange={(e) => setQuery(e.currentTarget.value)}
            placeholder={t('bookPane.homeSearchPlaceholder')}
            aria-label={searchLabel}
            className="flex-1 px-md py-sm text-base border border-border rounded focus:outline-none focus:ring-2 focus:ring-accent"
            data-testid="book-home-search"
          />
          {trimmed.length > 0 && (
            <button
              type="button"
              onClick={clearSearch}
              className="px-md py-sm text-sm rounded border border-border text-text-secondary hover:bg-background-hover hover:text-text-primary"
              data-testid="book-home-search-clear"
            >
              {t('bookPane.homeClearSearch')}
            </button>
          )}
        </div>

        {/* Search results, when a search is running or has run. The contents
            tree stays below either way - a miss should still leave the reader
            somewhere to go. */}
        {trimmed.length >= 2 && (
          <div className="mb-xl" data-testid="book-home-results">
            <h3 className="text-sm font-semibold text-text-secondary mb-sm">
              {isSearching
                ? t('bookPane.homeSearching')
                : t('bookPane.homeResultCount', { count: results?.length ?? 0, })}
            </h3>
            {searchError ? (
              <p className="text-sm text-danger" data-testid="book-home-search-error">
                {t('bookPane.homeSearchFailed', { error: searchError, })}
              </p>
            ) : !isSearching && results?.length === 0 ? (
              <p className="text-sm text-text-secondary">
                {t('bookPane.homeNoMatches')}
              </p>
            ) : (
              <ul className="border border-border rounded divide-y divide-border">
                {/* A section with no id has nowhere to navigate to, so it is
                    dropped rather than listed as a dead row. */}
                {results?.filter(hit => hit.section_id != null).map(hit => (
                  <li key={hit.section_id}>
                    <button
                      type="button"
                      className="w-full text-start px-md py-sm hover:bg-background-warm"
                      onClick={() => onSelectSection(hit.section_id as number)}
                      data-testid="book-home-result"
                    >
                      <span className="flex items-center gap-sm">
                        {hit.section_number && (
                          <span className="text-xs text-text-secondary font-mono">
                            {hit.section_number}
                          </span>
                        )}
                        <span className="text-sm text-text-primary">{hit.title}</span>
                      </span>
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </div>
        )}

        <h3 className="text-sm font-semibold text-text-secondary mb-sm">
          {t('ui.bookTreeView.tableOfContents')}
        </h3>
        <div className="border border-border rounded">
          {isLoading ? (
            <PaneLoadingSkeleton testId="book-home-loading" />
          ) : error ? (
            <div className="flex flex-col items-center justify-center gap-sm py-xl" data-testid="book-home-error">
              <div className="text-danger">
                {t('ui.bookTreeView.loadFailed')}
              </div>
              <div className="text-xs text-text-secondary">{error}</div>
              <button
                type="button"
                className="px-lg py-sm bg-control text-text-primary rounded hover:bg-control-hover"
                onClick={onRetry}
              >
                {t('ui.bookTreeView.retry')}
              </button>
            </div>
          ) : summaries.length === 0 ? (
            <p className="py-xl text-center text-sm text-text-secondary">
              {t('ui.bookTreeView.noSections')}
            </p>
          ) : (
            <BookSectionTree
              summaries={summaries}
              currentSectionId={null}
              onSelectSection={onSelectSection}
              forceExpanded={matchAncestors}
            />
          )}
        </div>
      </div>
    </div>
  );
};

export default BookHome;
