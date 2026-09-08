import React, { useState, useRef, useEffect, useMemo, useCallback, useImperativeHandle, forwardRef } from 'react';
import { useI18n } from '../contexts/useI18n';
import { useSearchStore, normalizeSearchQuery } from '../stores/useSearchStore';
import { useBibleStore } from '../stores/useBibleStore';
import { syncPanesWithVerse } from '../stores/syncPanesWithVerse';
import { useCommands } from '../contexts/useCommands';
import { useWhenContext } from '../contexts/useWhenContext';
import { ReferenceParser } from '@bible/core';
import type { ParsedReference, SearchResult } from '@bible/core';
import { DEFAULT_PANEL_ID } from '../stores/helpers/panelStateHelpers';
import { tElements } from '../utils/tElements';
import { ReferenceClassifier } from '../services/ReferenceClassifier';
import type { SearchBarMode } from '../types/SearchBarMode';
import type { CommandQueryResult } from '../types/Command';
import TopSearchBarDropdown from './TopSearchBarDropdown';
import LiveSearchSuggestions from './LiveSearchSuggestions';

// ============================================================================
// Module-level singleton - avoids re-creating the classifier on every render.
// ============================================================================

/**
 * How the focus shortcut is written on the badge in the box.
 *
 * Same platform test `CommandRegistry` uses for its own shortcut labels, so the
 * badge and the command palette never disagree about which modifier this is.
 */
const FOCUS_SHORTCUT_LABEL =
  typeof navigator !== 'undefined' && /Mac/i.test(navigator.platform) ? '⌘L' : 'Ctrl+L';

const classifierInstance = new ReferenceClassifier();
const referenceParserInstance = new ReferenceParser();

// ============================================================================
// Mode detection
// ============================================================================

function determineMode(input: string): SearchBarMode {
  const trimmed = input.trimStart();
  if (trimmed === '') return 'empty';
  if (trimmed.startsWith('/')) return 'command';
  if (trimmed.startsWith('?')) return 'search';
  if (classifierInstance.looksLikeReference(trimmed)) return 'reference';
  return 'search';
}

/**
 * Parses `input` as a Bible reference, or returns undefined if it is not one.
 *
 * Deliberately a free function rather than only a `useMemo`: Enter has to be
 * able to re-parse the *live* input value, which - while the user is typing
 * fast - can be several keystrokes ahead of the `query` the last committed
 * render memoized from. See `resolveLiveQuery` below.
 */
function parseReference(input: string): ParsedReference | undefined {
  const parsed = referenceParserInstance.parse(input.trim());
  if (!parsed.isValid || !parsed.book || !parsed.chapter) return undefined;
  return parsed;
}

/** How long typing pauses before live suggestions are fetched. */
const LIVE_SEARCH_DEBOUNCE_MS = 300;

// ============================================================================
// Public imperative handle
// ============================================================================

export interface TopSearchBarHandle {
  focus(): void;
  setInput(value: string): void;
}

// ============================================================================
// TopSearchBar Component
// ============================================================================

/**
 * Unified search bar replacing the original SearchBar.
 *
 * Modes:
 * - **empty** -- show keyboard hints
 * - **search** -- live search with debounced suggestions (default for text)
 * - **reference** -- Bible reference detected, show navigation hint
 * - **command** -- `/` prefix, query the command registry
 */
const TopSearchBar = forwardRef<TopSearchBarHandle>(function TopSearchBar(_props, ref) {
  const { t } = useI18n();
  const {
    query,
    setQuery,
    performSearch,
    clearSearch,
    isSearching,
    searchResults,
    resultsForQuery,
    isResultsVisible,
    isSemanticMode,
    semanticResults,
    error,
    clearError,
    openAdvancedDialog,
    liveSuggestions,
    isLiveSearching,
    liveSearchQuery,
    performLiveSearch,
  } = useSearchStore();

  const navigateToVerse = useBibleStore(s => s.navigateToVerseInPrimary);
  const registry = useCommands();
  const { snapshot: whenSnapshot } = useWhenContext();

  const [isFocused, setIsFocused] = useState(false);
  const [selectedIndex, setSelectedIndex] = useState(-1);
  const inputRef = useRef<HTMLInputElement>(null);
  const hasUserInteracted = useRef(false);

  // Expose imperative handle
  useImperativeHandle(ref, () => ({
    focus() {
      hasUserInteracted.current = true;
      inputRef.current?.focus();
      inputRef.current?.select();
    },
    setInput(value: string) {
      setQuery(value);
    },
  }));

  // Derived state
  const mode = useMemo(() => determineMode(query), [query]);

  // --------------------------------------------------------------------------
  // Command mode: query registry whenever prefix changes
  // --------------------------------------------------------------------------
  const commandPrefix = useMemo(() => {
    if (mode !== 'command') return '';
    return query.trimStart().slice(1); // strip leading '/'
  }, [mode, query]);

  const matchedCommands: CommandQueryResult[] = useMemo(() => {
    if (mode !== 'command') return [];
    return registry.query(commandPrefix, whenSnapshot);
  }, [mode, commandPrefix, registry, whenSnapshot]);

  // --------------------------------------------------------------------------
  // Reference mode: parse the reference
  // --------------------------------------------------------------------------
  const parsedReference = useMemo(() => {
    if (mode !== 'reference') return undefined;
    return parseReference(query);
  }, [mode, query]);

  const referenceText = useMemo(() => {
    if (!parsedReference) return undefined;
    return referenceParserInstance.format(parsedReference);
  }, [parsedReference]);

  const referenceTarget = useMemo(() => {
    if (!parsedReference) return undefined;
    const bookName = referenceParserInstance.getBookName(parsedReference.book!);
    if (parsedReference.verse) {
      return `${bookName} ${parsedReference.chapter}:${parsedReference.verse}`;
    }
    return `${bookName} ${parsedReference.chapter}`;
  }, [parsedReference]);

  // --------------------------------------------------------------------------
  // The live input value
  //
  // `query` (and therefore `mode`, `parsedReference`, ...) is only as fresh as
  // the last *committed* render. A fast typist can finish "john 3:16" and press
  // Enter before React has committed the renders for the final keystrokes, and
  // the handler that runs is the one closed over a prefix - "john " or
  // "john 3:", both of which fail the anchored reference regex and so read as
  // `mode === 'search'`. Running a full-text search from that stale branch,
  // with the *complete* reference as payload (performSearch re-reads the
  // store), reproduces the reported "typing john 3:16 fast searches instead
  // of navigating" bug: stale branch, fresh payload, zero results.
  //
  // The DOM input is never stale - it holds every keystroke the moment it is
  // typed - so Enter re-derives everything from it.
  // --------------------------------------------------------------------------
  const resolveLiveQuery = useCallback(
    () => inputRef.current?.value ?? useSearchStore.getState().query, // allow-getstate: event handler - read latest state without re-subscribing
    [],
  );

  // --------------------------------------------------------------------------
  // Search mode: debounced live search
  //
  // A hand-rolled timer rather than `debounce()` from utils because this one
  // has to be *cancellable*: a timer armed while the string was still a search
  // prefix ("john") would otherwise fire 300 ms later and repopulate
  // `liveSuggestions` for a query the user has already turned into a reference.
  // --------------------------------------------------------------------------
  const liveSearchTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const cancelLiveSearch = useCallback(() => {
    if (liveSearchTimerRef.current !== null) {
      clearTimeout(liveSearchTimerRef.current);
      liveSearchTimerRef.current = null;
    }
  }, []);

  useEffect(() => {
    if (mode === 'search' && query.trim().length >= 3) {
      const stripped = query.startsWith('?') ? query.slice(1).trim() : query.trim();
      if (stripped.length >= 3) {
        liveSearchTimerRef.current = setTimeout(() => {
          liveSearchTimerRef.current = null;
          performLiveSearch(stripped);
        }, LIVE_SEARCH_DEBOUNCE_MS);
      }
    }
    setSelectedIndex(-1);
    // Cleanup on every query/mode change is what makes this a debounce, and is
    // also what disarms a pending fetch the moment the input becomes a reference.
    return cancelLiveSearch;
  }, [query, mode, performLiveSearch, cancelLiveSearch]);

  useEffect(() => {
    setSelectedIndex(-1);
  }, [liveSuggestions, matchedCommands]);

  // --------------------------------------------------------------------------
  // Global keyboard shortcuts (F6 / Ctrl+L / Ctrl+K)
  //
  // Ctrl+L is the desktop app's own shortcut and the one the badge above
  // advertises. Ctrl+K is kept bound as an alias because the web app uses it
  // (see `useAppShared.ts`) and nothing else in this app claims it.
  // --------------------------------------------------------------------------
  useEffect(() => {
    const handleGlobalKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'F6' || ((e.ctrlKey || e.metaKey) && (e.key === 'l' || e.key === 'k'))) {
        e.preventDefault();
        hasUserInteracted.current = true;
        inputRef.current?.focus();
        inputRef.current?.select();
      }
    };
    window.addEventListener('keydown', handleGlobalKeyDown);
    return () => window.removeEventListener('keydown', handleGlobalKeyDown);
  }, []);

  // --------------------------------------------------------------------------
  // Command-registry entry points
  //
  // `searchBarCommands.ts` dispatches these two events and its own doc comment
  // says "TopSearchBar listens for" them - but nothing did, so `app.focusSearchBar`
  // (Ctrl+L) worked only through the raw keydown listener above, and
  // `app.openCommandMode` (Ctrl+Shift+P / F1) did nothing at all. That left the
  // command palette unreachable from the keyboard, which is the one route a
  // keyboard-only or screen-reader user needs most.
  // --------------------------------------------------------------------------
  useEffect(() => {
    const focusInput = () => {
      hasUserInteracted.current = true;
      inputRef.current?.focus();
      inputRef.current?.select();
    };
    const openCommandMode = () => {
      hasUserInteracted.current = true;
      // `/` is the command prefix (see determineMode above); prefilling it is
      // what turns the search bar into the command palette.
      setQuery('/');
      inputRef.current?.focus();
      // Caret after the prefix rather than selecting it, so the next keystroke
      // extends the command instead of replacing the prefix.
      requestAnimationFrame(() => {
        const el = inputRef.current;
        if (el) el.setSelectionRange(el.value.length, el.value.length);
      });
    };
    window.addEventListener('command:app:focusSearchBar', focusInput);
    window.addEventListener('command:app:openCommandMode', openCommandMode);
    return () => {
      window.removeEventListener('command:app:focusSearchBar', focusInput);
      window.removeEventListener('command:app:openCommandMode', openCommandMode);
    };
  }, [setQuery]);

  // --------------------------------------------------------------------------
  // Reference navigation helper
  // --------------------------------------------------------------------------
  // `reference` is passed explicitly by the Enter handler, which re-parses the
  // live input; the dropdown's click path has no race and falls back to the
  // memoized value.
  const handleReferenceNavigation = useCallback(async (reference?: ParsedReference) => {
    const target = reference ?? parsedReference;
    if (!target) return;

    const validationError = referenceParserInstance.validate(target);
    if (validationError) {
      console.error('Reference validation failed:', validationError);
      return;
    }

    try {
      let verse = target.verse ?? null;

      if (verse === null) {
        const ps = useBibleStore.getState().getPanelState(DEFAULT_PANEL_ID); // allow-getstate: event handler - read latest state without re-subscribing
        const historyMatch = ps.navigationHistory.find(
          h => h.bookNumber === target.book && h.chapter === target.chapter,
        );
        if (historyMatch) {
          verse = historyMatch.verseId % 1000;
        } else {
          verse = 1;
        }
      }

      const verseId = (target.book! * 1000000) + (target.chapter! * 1000) + verse;

      // A typed range selects the whole span, exactly as clicking the first
      // verse and shift-clicking the last does. The parser has always returned
      // the far end; nothing read it, so "John 3:16-17" landed on 16 alone.
      // `endChapter` covers the cross-chapter form ("John 3:16-4:2"); a bare
      // "-17" keeps the start chapter.
      const endVerse = target.endVerse;
      const endVerseId = endVerse === undefined
        ? undefined
        : (target.book! * 1000000) + ((target.endChapter ?? target.chapter!) * 1000) + endVerse;

      await navigateToVerse(verseId, endVerseId);
      // Typing a reference is the reader choosing a verse, exactly as a click
      // is. Without this the Bible pane moved on its own and the study panes
      // stayed on the previous verse, so the reference looked like it had not
      // really been selected until the user clicked the verse already showing.
      syncPanesWithVerse(verseId);
    } catch (err) {
      console.error('Error navigating to reference:', err, target);
    }

    clearSearch();
    setIsFocused(false);
    inputRef.current?.blur();
  }, [parsedReference, navigateToVerse, clearSearch]);

  // --------------------------------------------------------------------------
  // Command execution helper
  // --------------------------------------------------------------------------
  const handleExecuteCommand = useCallback(async (commandId: string) => {
    try {
      await registry.execute(commandId);
    } catch (err) {
      console.error('Error executing command:', err);
    }
    clearSearch();
    setIsFocused(false);
    inputRef.current?.blur();
  }, [registry, clearSearch]);

  // --------------------------------------------------------------------------
  // Search submission (search mode)
  // --------------------------------------------------------------------------
  // `rawQuery` defaults to the memoized store query for non-Enter callers; the
  // Enter handler passes the live input value. The stripped text is handed to
  // `performSearch` explicitly rather than letting it re-read the store, so
  // the text that was classified is the text that is searched - re-reading
  // the store would classify a `?`-prefixed query stripped but search it with
  // the `?` still on.
  const handleSearch = useCallback(async (rawQuery?: string) => {
    const source = rawQuery ?? query;
    const stripped = source.startsWith('?') ? source.slice(1).trim() : source.trim();
    if (!stripped) return;

    await performSearch(stripped);
    setIsFocused(false);
    inputRef.current?.blur();
  }, [query, performSearch]);

  // --------------------------------------------------------------------------
  // Suggestion selection (search mode)
  // --------------------------------------------------------------------------
  const handleSelectSuggestion = useCallback(async (result: SearchResult) => {
    try {
      await navigateToVerse(result.verseId);
      syncPanesWithVerse(result.verseId);
      clearSearch();
      setIsFocused(false);
      inputRef.current?.blur();
    } catch (err) {
      console.error('Error navigating to suggestion:', err, result);
    }
  }, [navigateToVerse, clearSearch]);

  // --------------------------------------------------------------------------
  // Tab auto-complete for command mode
  // --------------------------------------------------------------------------
  const handleTabAutocomplete = useCallback(() => {
    if (mode !== 'command' || matchedCommands.length === 0) return;

    // Find longest common prefix among matched command titles
    const titles = matchedCommands.map(c => c.title.toLowerCase());
    let lcp = titles[0];
    for (let i = 1; i < titles.length; i++) {
      while (!titles[i].startsWith(lcp)) {
        lcp = lcp.slice(0, -1);
        if (lcp === '') break;
      }
    }

    if (lcp.length > commandPrefix.length) {
      setQuery('/' + lcp);
    } else if (matchedCommands.length === 1) {
      // Single match: fill in the full title
      setQuery('/' + matchedCommands[0].title);
    }
  }, [mode, matchedCommands, commandPrefix, setQuery]);

  // --------------------------------------------------------------------------
  // Determine what's visible in the dropdown
  // --------------------------------------------------------------------------
  const showingSearchSuggestions = isFocused && mode === 'search' && query.trim().length >= 3 && liveSuggestions.length > 0;
  const showingDropdown = isFocused && (mode === 'command' || mode === 'reference');

  // Effective item count for arrow-key navigation
  const itemCount = useMemo(() => {
    if (mode === 'command') return matchedCommands.length;
    if (mode === 'reference') return 1;
    if (showingSearchSuggestions) return liveSuggestions.length;
    return 0;
  }, [mode, matchedCommands.length, showingSearchSuggestions, liveSuggestions.length]);

  // --------------------------------------------------------------------------
  // Keyboard handler
  // --------------------------------------------------------------------------
  const handleKeyDown = useCallback((e: React.KeyboardEvent) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      // Re-derive from the live input, not from the memoized `mode`/`query` of
      // the last committed render - see `resolveLiveQuery`.
      const liveQuery = resolveLiveQuery();
      const liveMode = determineMode(liveQuery);
      if (liveMode === 'command') {
        const target = selectedIndex >= 0 && selectedIndex < matchedCommands.length
          ? matchedCommands[selectedIndex]
          : matchedCommands[0];
        if (target) {
          handleExecuteCommand(target.id);
        }
      } else if (liveMode === 'reference') {
        // A suggestion fetch may have been armed while the string was still a
        // search prefix ("john"); it must not land after we navigate away.
        cancelLiveSearch();
        // Parsed from the live text too - falling back to the memoized
        // `parsedReference` here could navigate to a *previous* reference.
        const liveReference = parseReference(liveQuery);
        if (liveReference) handleReferenceNavigation(liveReference);
      } else if (showingSearchSuggestions && selectedIndex >= 0 && selectedIndex < liveSuggestions.length) {
        handleSelectSuggestion(liveSuggestions[selectedIndex]);
      } else {
        handleSearch(liveQuery);
      }
    } else if (e.key === 'Escape') {
      e.preventDefault();
      clearSearch();
      inputRef.current?.blur();
    } else if (e.key === 'ArrowDown') {
      e.preventDefault();
      if (itemCount > 0) {
        setSelectedIndex(prev => (prev < itemCount - 1 ? prev + 1 : prev));
      }
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      if (itemCount > 0) {
        setSelectedIndex(prev => (prev > 0 ? prev - 1 : -1));
      }
    } else if (e.key === 'Tab' && mode === 'command') {
      e.preventDefault();
      handleTabAutocomplete();
    }
  }, [
    mode, selectedIndex, matchedCommands, liveSuggestions, itemCount,
    showingSearchSuggestions, handleExecuteCommand, handleReferenceNavigation,
    handleSelectSuggestion, handleSearch, handleTabAutocomplete, clearSearch,
    resolveLiveQuery, cancelLiveSearch,
  ]);

  // --------------------------------------------------------------------------
  // Input / focus handlers
  // --------------------------------------------------------------------------
  const handleInputChange = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    setQuery(e.target.value);
    if (error) clearError();
  }, [setQuery, error, clearError]);

  const handleFocus = useCallback(() => {
    if (hasUserInteracted.current) {
      setIsFocused(true);
    }
  }, []);

  const handleBlur = useCallback(() => {
    setTimeout(() => {
      setIsFocused(false);
    }, 200);
  }, []);

  // --------------------------------------------------------------------------
  // Mode-specific icon
  // --------------------------------------------------------------------------
  const modeIcon = useMemo(() => {
    if (mode === 'reference') {
      return (
        <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 6.253v13m0-13C10.832 5.477 9.246 5 7.5 5S4.168 5.477 3 6.253v13C4.168 18.477 5.754 18 7.5 18s3.332.477 4.5 1.253m0-13C13.168 5.477 14.754 5 16.5 5c1.747 0 3.332.477 4.5 1.253v13C19.832 18.477 18.247 18 16.5 18c-1.746 0-3.332.477-4.5 1.253" />
        </svg>
      );
    }
    if (mode === 'command') {
      return (
        <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 9l3 3-3 3m5 0h3M5 20h14a2 2 0 002-2V6a2 2 0 00-2-2H5a2 2 0 00-2 2v12a2 2 0 002 2z" />
        </svg>
      );
    }
    // search / empty
    return (
      <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
      </svg>
    );
  }, [mode]);

  // --------------------------------------------------------------------------
  // Mode CSS class for tinting
  // --------------------------------------------------------------------------
  const modeClass = `mode-${mode}`;

  // Accent ring color per mode
  const ringClass = useMemo(() => {
    if (!isFocused) return '';
    if (mode === 'reference') return 'border-accent ring-2 ring-accent/30';
    if (mode === 'command') return 'border-indigo-500 ring-2 ring-indigo-200';
    return 'border-accent ring-2 ring-accent/30';
  }, [isFocused, mode]);

  // --------------------------------------------------------------------------
  // Effective search query (strip ? prefix for display purposes)
  // --------------------------------------------------------------------------
  const effectiveSearchQuery = useMemo(() => {
    if (mode === 'search' && query.startsWith('?')) return query.slice(1).trim();
    return query.trim();
  }, [mode, query]);

  // --------------------------------------------------------------------------
  // Result count badge
  //
  // The badge is a confirmation of the search that just ran, so it may only be
  // on screen while that search is still the one the user is looking at.
  // Deriving it from `searchResults.length` alone would outlive all three of
  // the things that end a search: closing the results pane (by its own X or
  // by its dockview tab), and editing the text in the box. It would also
  // report keyword hits while the pane was showing semantic ones.
  //
  // Counting what the pane counts - `semanticResults` in semantic mode - is
  // what keeps the two numbers from contradicting each other.
  // --------------------------------------------------------------------------
  const badgeCount = isSemanticMode ? semanticResults.length : searchResults.length;

  const showResultCountBadge =
    isResultsVisible &&
    !isSearching &&
    badgeCount > 0 &&
    normalizeSearchQuery(query) === normalizeSearchQuery(resultsForQuery);

  // --------------------------------------------------------------------------
  // Render
  // --------------------------------------------------------------------------
  return (
    <div className={`flex-1 max-w-2xl relative ${modeClass}`}>
      {/* Search Input Container */}
      <div className="relative">
        {/* Mode Icon */}
        <div className="absolute start-3 top-1/2 transform -translate-y-1/2 text-text-muted">
          {modeIcon}
        </div>

        {/*
          Input Field.

          Deliberately NOT `disabled` while searching: a disabled input is
          blurred by the browser and swallows every keystroke, so a search the
          user did not mean to start (see the stale-mode race above) also cost
          them their place and the characters they typed next. The spinner and
          the tinted background still say "busy"; `aria-busy` says it to
          assistive tech.
        */}
        <input
          ref={inputRef}
          type="text"
          value={query}
          onChange={handleInputChange}
          onKeyDown={handleKeyDown}
          onFocus={handleFocus}
          onBlur={handleBlur}
          onMouseDown={() => {
            hasUserInteracted.current = true;
          }}
          placeholder={t('searchBar.unifiedPlaceholder')}
          data-testid="search-input"
          className={`w-full ps-10 pe-24 py-2 text-sm border rounded-lg transition-colors ${
            ringClass || (error ? 'border-danger' : 'border-border')
          } ${isSearching ? 'bg-surface-secondary' : 'bg-surface'}`}
          aria-busy={isSearching}
        />

        {/* Right Side Icons */}
        <div className="absolute end-2 top-1/2 transform -translate-y-1/2 flex items-center gap-2">
          {/* Loading Spinner */}
          {isSearching && (
            <div className="animate-spin h-4 w-4 border-2 border-accent border-t-transparent rounded-full" />
          )}

          {/* Result Count Badge */}
          {showResultCountBadge && (
            <div
              className="bg-accent text-text-on-accent text-xs font-semibold px-2 py-1 rounded"
              data-testid="search-result-count-badge"
            >
              {badgeCount}
            </div>
          )}

          {/* Clear Button */}
          {query && !isSearching && (
            <button
              onClick={(e) => {
                e.preventDefault();
                clearSearch();
                inputRef.current?.focus();
              }}
              className="p-1 hover:bg-background-active rounded transition-colors"
              title={t('searchBar.clearTitle')}
              aria-label={t('searchBar.clearTitle')}
            >
              <svg className="w-4 h-4 text-text-secondary" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
              </svg>
            </button>
          )}

          {/* The shortcut, shown where the shortcut takes you. Only while the
              box is idle and unfocused: once the user is typing it is noise,
              and it would sit where the clear button appears. */}
          {!query && !isFocused && !isSearching && (
            <kbd
              dir="ltr"
              aria-hidden="true"
              className="hidden sm:inline-block px-1.5 py-0.5 bg-surface border border-border rounded text-xs font-mono text-text-secondary select-none"
              data-testid="search-shortcut-hint"
            >
              {FOCUS_SHORTCUT_LABEL}
            </kbd>
          )}

          {/* Advanced Search Button */}
          <button
            onClick={openAdvancedDialog}
            className="p-1.5 hover:bg-background-active rounded transition-colors"
            title={t('searchBar.advancedTitle')}
            aria-label={t('searchBar.advancedTitle')}
            data-testid="search-options-button"
            disabled={isSearching}
          >
            <svg className="w-4 h-4 text-text-secondary" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth={2}
                d="M10.325 4.317c.426-1.756 2.924-1.756 3.35 0a1.724 1.724 0 002.573 1.066c1.543-.94 3.31.826 2.37 2.37a1.724 1.724 0 001.065 2.572c1.756.426 1.756 2.924 0 3.35a1.724 1.724 0 00-1.066 2.573c.94 1.543-.826 3.31-2.37 2.37a1.724 1.724 0 00-2.572 1.065c-.426 1.756-2.924 1.756-3.35 0a1.724 1.724 0 00-2.573-1.066c-1.543.94-3.31-.826-2.37-2.37a1.724 1.724 0 00-1.065-2.572c-1.756-.426-1.756-2.924 0-3.35a1.724 1.724 0 001.066-2.573c-.94-1.543.826-3.31 2.37-2.37.996.608 2.296.07 2.572-1.065z"
              />
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
            </svg>
          </button>
        </div>
      </div>

      {/* Error Message */}
      {/* These three drop-out panels - error, "type at least 3", and the
          shortcut hint - used `bg-accent-light` / `bg-danger-soft`, which are
          the accent and danger colours at 12% and 22% alpha (see
          tailwind.config.cjs). Absolutely positioned over the panes below,
          that let the Bible text read straight through them. They now use the
          same opaque `bg-surface-elevated` + `shadow-lg` + `z-50` as the
          dropdown and the live-search suggestions, which drop from this very
          input and never had the problem. */}
      {error && (
        <div className="absolute top-full mt-1 w-full bg-surface-elevated border border-danger-border text-danger-text shadow-lg z-50 px-3 py-2 rounded text-sm">
          {error}
        </div>
      )}

      {/* Dropdowns - only when focused and no error */}
      {!error && isFocused && (
        <>
          {/* Command / Reference dropdown */}
          {showingDropdown && (
            <TopSearchBarDropdown
              mode={mode}
              commands={matchedCommands}
              referenceText={referenceText}
              referenceTarget={referenceTarget}
              selectedIndex={selectedIndex}
              onSelectCommand={handleExecuteCommand}
              onSelectReference={handleReferenceNavigation}
            />
          )}

          {/* Live Search Suggestions (search mode, 3+ chars) */}
          {mode === 'search' && effectiveSearchQuery.length >= 3 && (
            <LiveSearchSuggestions
              suggestions={liveSuggestions}
              isLoading={isLiveSearching}
              query={liveSearchQuery}
              selectedIndex={selectedIndex}
              onSelectSuggestion={handleSelectSuggestion}
            />
          )}

          {/* Helper message when 1-2 characters typed (search mode) */}
          {mode === 'search' && effectiveSearchQuery.length > 0 && effectiveSearchQuery.length < 3 && (
            <div className="absolute top-full mt-1 w-full bg-surface-elevated border border-border shadow-lg z-50 px-3 py-2 rounded text-xs text-accent-strong">
              {t('searchBar.typeAtLeast3')}
            </div>
          )}

          {/* Keyboard Shortcuts Hint (empty mode) */}
          {mode === 'empty' && (
            <div className="absolute top-full mt-1 w-full bg-surface-elevated border border-border shadow-lg z-50 px-3 py-2 rounded text-xs text-accent-strong">
              <div className="flex items-center gap-4">
                <span>
                  {tElements(t, 'searchBar.hintSearch', {
                    key: <kbd dir="ltr" className="px-1.5 py-0.5 bg-surface border border-accent-soft rounded text-xs font-mono">{t('searchBar.enterKey')}</kbd>,
                  })}
                </span>
                <span>
                  {tElements(t, 'searchBar.hintCommands', {
                    key: <kbd dir="ltr" className="px-1.5 py-0.5 bg-surface border border-accent-soft rounded text-xs font-mono">/</kbd>,
                  })}
                </span>
                <span>
                  {tElements(t, 'searchBar.hintClear', {
                    key: <kbd dir="ltr" className="px-1.5 py-0.5 bg-surface border border-accent-soft rounded text-xs font-mono">{t('searchBar.escKey')}</kbd>,
                  })}
                </span>
              </div>
            </div>
          )}
        </>
      )}
    </div>
  );
});

export default TopSearchBar;
