import React, { useCallback, useEffect, useId, useState } from 'react';
import { useI18n } from '../../contexts/useI18n';
import { useOverlayDismissal } from '../../hooks/useOverlayDismissal';
import type { DictionaryEntrySummary } from '../../stores/useDictionaryStore';

/**
 * Shortest query worth a round trip. One character matches a large fraction of
 * any dictionary, so the list it returns is noise and the query is the slowest
 * one the module will ever run.
 */
const MIN_QUERY_LENGTH = 2;

/**
 * How long typing has to pause before the search runs.
 *
 * 200ms is what `TopicSearchBar` uses and it is the right order here: a
 * dictionary search is a local SQLite `LIKE` plus an FTS pass, so the result is
 * back well inside the next keystroke, and the debounce exists to stop a
 * ten-letter word from queuing ten of them rather than to hide latency.
 */
const DEBOUNCE_MS = 200;

/** How much of a definition a result row previews. */
const SNIPPET_LENGTH = 140;

interface DictionaryLiveSearchProps {
  /** Current query text. Owned by the parent so it can seed other views with it. */
  value: string;
  onChange: (value: string) => void;
  /**
   * Run a search. Called on a debounce with the trimmed query; must be stable
   * (`useCallback`) or the debounce restarts on every parent render.
   */
  onSearch: (query: string) => void;
  results: DictionaryEntrySummary[];
  isSearching: boolean;
  /** Open one entry by its key. */
  onSelectEntry: (entryKey: string) => void;
  /**
   * What Enter does when there is no result to open - the exact-key lookup
   * cascade, which still matters for a query the search itself misses.
   */
  onSubmitFallback: (term: string) => void;
}

/** Plain-text preview of a definition, which is stored as HTML. */
function snippet(definition: string): string {
  const text = definition.replace(/<[^>]*>/g, '').trim();
  return text.length > SNIPPET_LENGTH ? `${text.slice(0, SNIPPET_LENGTH)}…` : text;
}

/**
 * The dictionary's search box: one large field whose matches appear underneath
 * it as the user types.
 *
 * Assuming the user already knows the exact entry key - type a term, press
 * "Look up", and find out only afterwards whether it exists (and, if it does
 * not, land in a dialog called "Browse") - is backwards for the case this is
 * most often used for: someone who is unsure of the spelling of a name, or
 * wants to see what a dictionary calls a thing before committing to a
 * lookup. Showing candidates while the word is still being typed answers the
 * spelling question without the user ever submitting anything.
 *
 * Enter still runs the exact-key cascade when there is nothing highlighted,
 * so a Strong's number pasted in and submitted before the debounce fires
 * resolves the same way.
 */
const DictionaryLiveSearch: React.FC<DictionaryLiveSearchProps> = ({
  value,
  onChange,
  onSearch,
  results,
  isSearching,
  onSelectEntry,
  onSubmitFallback,
}) => {
  const { t } = useI18n();
  const [selectedIndex, setSelectedIndex] = useState(0);
  /** Set by Escape, by selecting a result, and by clicking away. Cleared by typing. */
  const [dismissed, setDismissed] = useState(false);

  const listId = useId();
  const term = value.trim();
  const isQueryable = term.length >= MIN_QUERY_LENGTH;
  const showResults = isQueryable && !dismissed;

  // Debounced search. The cleanup cancels the pending timer on every keystroke,
  // so only the pause at the end of a word actually issues a query.
  useEffect(() => {
    if (!isQueryable) return;
    const timer = setTimeout(() => onSearch(term), DEBOUNCE_MS);
    return () => clearTimeout(timer);
  }, [term, isQueryable, onSearch]);

  // A new result set invalidates the old highlight - keeping the index would
  // point Enter at whatever happened to land in that row.
  useEffect(() => {
    setSelectedIndex(0);
  }, [results]);

  const dismiss = useCallback(() => setDismissed(true), []);
  useOverlayDismissal(showResults, dismiss);

  const selectEntry = (entryKey: string): void => {
    setDismissed(true);
    onSelectEntry(entryKey);
  };

  const handleChange = (e: React.ChangeEvent<HTMLInputElement>): void => {
    setDismissed(false);
    onChange(e.target.value);
  };

  const handleSubmit = (e: React.FormEvent): void => {
    e.preventDefault();
    if (!term) return;

    const highlighted = showResults ? results[selectedIndex] : undefined;
    if (highlighted) {
      selectEntry(highlighted.entry_key);
      return;
    }

    setDismissed(true);
    onSubmitFallback(term);
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLInputElement>): void => {
    if (!showResults || results.length === 0) return;

    if (e.key === 'ArrowDown') {
      e.preventDefault();
      setSelectedIndex((prev) => Math.min(prev + 1, results.length - 1));
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      setSelectedIndex((prev) => Math.max(prev - 1, 0));
    }
    // Escape and Enter are handled by useOverlayDismissal and onSubmit.
  };

  const placeholder = t('dictionaryPane.livePlaceholder');

  return (
    // The results panel is positioned against this wrapper, and the wrapper
    // swallows mousedown so the document-level dismissal above does not close
    // the list on the same press that starts a click on one of its rows.
    <div className="relative flex-1" onMouseDown={(e) => e.stopPropagation()}>
      <form onSubmit={handleSubmit} className="flex items-center gap-sm">
        <input
          type="search"
          value={value}
          onChange={handleChange}
          onKeyDown={handleKeyDown}
          onFocus={() => setDismissed(false)}
          placeholder={placeholder}
          aria-label={placeholder}
          role="combobox"
          aria-expanded={showResults}
          aria-controls={listId}
          aria-autocomplete="list"
          aria-activedescendant={
            showResults && results[selectedIndex] ? `${listId}-${selectedIndex}` : undefined
          }
          className="flex-1 px-md py-sm text-lg border border-border rounded focus:outline-none focus:ring-2 focus:ring-accent"
          data-testid="dictionary-lookup-input"
        />
        {/*
          Enter does the same thing, but the button is the only affordance that
          says so - and it is what a user who has typed an exact Strong's number
          reaches for rather than arrowing into a list.

          Styled as a quiet secondary control rather than a filled accent
          button. At full weight it would read as a second, competing action
          beside the box - "what does Look up do that typing doesn't?" -
          when all it is is the visible form of Enter.
        */}
        <button
          type="submit"
          disabled={!term}
          className="px-md py-sm text-sm rounded border border-border text-text-secondary hover:bg-background-hover hover:text-text-primary disabled:opacity-40 disabled:cursor-not-allowed"
          data-testid="dictionary-lookup-btn"
        >
          {t('dictionaryPane.lookupButton')}
        </button>
      </form>

      {showResults && (
        <div
          className="absolute start-0 end-0 top-full mt-xs border border-border rounded shadow-lg z-20 max-h-[50vh] overflow-y-auto"
          style={{ backgroundColor: 'var(--theme-surface-elevated)' }}
          data-testid="dictionary-live-results"
        >
          {isSearching && results.length === 0 ? (
            <p className="px-md py-sm text-sm text-text-secondary">
              {t('dictionaryPane.liveSearching')}
            </p>
          ) : results.length === 0 ? (
            <p
              className="px-md py-sm text-sm text-text-secondary"
              data-testid="dictionary-live-no-matches"
            >
              {t('dictionaryPane.browseNoMatches', { query: term, })}
            </p>
          ) : (
            <ul
              id={listId}
              role="listbox"
              aria-label={t('dictionaryPane.liveResultsLabel')}
              className="divide-y divide-border"
            >
              {results.map((result, index) => (
                <li
                  key={result.entry_key}
                  id={`${listId}-${index}`}
                  role="option"
                  aria-selected={index === selectedIndex}
                  // mousedown, not click: the input keeps focus and the row acts
                  // before any blur-driven teardown can remove it.
                  onMouseDown={() => selectEntry(result.entry_key)}
                  onMouseEnter={() => setSelectedIndex(index)}
                  className={`px-md py-sm cursor-pointer ${
                    index === selectedIndex ? 'bg-accent-soft' : 'hover:bg-background-warm'
                  }`}
                  data-testid="dictionary-live-result"
                >
                  <span className="block font-semibold text-text-heading">
                    {result.entry_key}
                    {result.word && <span className="ms-md text-text-secondary">{result.word}</span>}
                  </span>
                  {result.transliteration && (
                    <span className="block text-sm text-text-secondary italic">
                      {result.transliteration}
                    </span>
                  )}
                  <span className="block text-sm text-text-secondary line-clamp-2">
                    {snippet(result.definition)}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
    </div>
  );
};

export default DictionaryLiveSearch;
