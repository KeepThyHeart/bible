import React, { useState, useEffect, useRef } from 'react';
import { useSearchStore } from '../stores/useSearchStore';
import { SearchScope, BibleRange } from '@bible/core';
import { useI18n } from '../contexts/useI18n';
import { useFocusTrap } from '../hooks/useFocusTrap';
import { ALL_BOOKS, BOOK_NAMES, MAX_CHAPTERS, PREDEFINED_RANGES } from '../constants/bibleBooks';

/**
 * How the user is specifying the "Specific range" scope.
 *
 * Three modes rather than one book-pair, because "search just Joshua" and
 * "search the Gospels" are the two overwhelmingly common asks and both are
 * clumsy to express as a from/to pair.
 */
type RangeMode = 'single' | 'books' | 'preset';

/**
 * AdvancedSearchDialog Component
 *
 * Modal dialog for configuring advanced search options.
 * Features:
 * - Query editing
 * - Scope selection (currentModule, allBibles, allModules, range)
 * - Search options (case sensitive, whole word, fuzzy, proximity, etc.)
 * - Save search functionality
 * - OK/Cancel actions
 */
const AdvancedSearchDialog: React.FC = () => {
  const { t } = useI18n();
  const {
    query,
    searchOptions,
    isAdvancedDialogOpen,
    closeAdvancedDialog,
    setSearchOptions,
    performSearch,
  } = useSearchStore();

  // Local state for form
  const [localQuery, setLocalQuery] = useState(query);
  const [scope, setScope] = useState<SearchScope>(searchOptions.scope || 'currentModule');
  const [caseSensitive, setCaseSensitive] = useState(searchOptions.caseSensitive || false);
  const [wholeWord, setWholeWord] = useState(searchOptions.wholeWord || false);
  const [fuzzyDistance, setFuzzyDistance] = useState(searchOptions.fuzzyDistance || 2);
  const [proximityDistanceStr, setProximityDistanceStr] = useState(String(searchOptions.proximityDistance || 0));
  const [maxResults, setMaxResults] = useState(searchOptions.maxResults || 200);
  const [includeContext, setIncludeContext] = useState(searchOptions.includeContext || false);
  const [autoFuzzy, setAutoFuzzy] = useState(searchOptions.autoFuzzy ?? true);

  // Range scope state (only meaningful while scope === 'range')
  const [rangeMode, setRangeMode] = useState<RangeMode>('single');
  const [rangeStartBook, setRangeStartBook] = useState(1);
  const [rangeEndBook, setRangeEndBook] = useState(66);
  const [rangePresetId, setRangePresetId] = useState('gospels');
  // Chapters are strings so the fields can be left empty, meaning "whole book".
  const [rangeStartChapter, setRangeStartChapter] = useState('');
  const [rangeEndChapter, setRangeEndChapter] = useState('');

  // Store the element that had focus before dialog opened
  const previousFocusRef = useRef<Element | null>(null);

  // Contains Tab within the dialog while it is open.
  const dialogRef = useFocusTrap<HTMLDivElement>(isAdvancedDialogOpen);

  // Sync form state when dialog opens, and track focused element
  useEffect(() => {
    if (isAdvancedDialogOpen) {
      // Store the currently focused element to restore focus later
      previousFocusRef.current = document.activeElement;

      setLocalQuery(query);
      setScope(searchOptions.scope || 'currentModule');
      setCaseSensitive(searchOptions.caseSensitive || false);
      setWholeWord(searchOptions.wholeWord || false);
      setFuzzyDistance(searchOptions.fuzzyDistance || 2);
      setProximityDistanceStr(String(searchOptions.proximityDistance || 0));
      setMaxResults(searchOptions.maxResults || 200);
      setIncludeContext(searchOptions.includeContext || false);
      setAutoFuzzy(searchOptions.autoFuzzy ?? true);

      // Restore a previously chosen range, inferring which mode expressed it so
      // reopening the dialog shows the same controls the user last used.
      const savedRange = searchOptions.range;
      if (savedRange) {
        const start = savedRange.startBook ?? 1;
        const end = savedRange.endBook ?? 66;
        setRangeStartBook(start);
        setRangeEndBook(end);
        setRangeStartChapter(savedRange.startChapter ? String(savedRange.startChapter) : '');
        setRangeEndChapter(savedRange.endChapter ? String(savedRange.endChapter) : '');

        const matchingPreset = PREDEFINED_RANGES.find(
          r => r.startBook === start && r.endBook === end
        );
        if (savedRange.predefinedRange && matchingPreset) {
          setRangePresetId(matchingPreset.id);
          setRangeMode('preset');
        } else if (start === end) {
          setRangeMode('single');
        } else {
          setRangeMode('books');
        }
      }
    }
  }, [isAdvancedDialogOpen, query, searchOptions]);

  // Restore focus when dialog closes
  const restoreFocus = () => {
    // Use setTimeout to ensure the dialog is fully closed before restoring focus
    setTimeout(() => {
      if (previousFocusRef.current && previousFocusRef.current instanceof HTMLElement) {
        previousFocusRef.current.focus();
      }
    }, 50);
  };

  /**
   * The range to search, or undefined when the scope isn't range-based.
   *
   * Returning undefined for every other scope matters: the store keeps the last
   * options, so a range left behind from an earlier search would keep silently
   * narrowing later whole-Bible searches.
   */
  const buildRange = (): BibleRange | undefined => {
    if (scope !== 'range') return undefined;

    if (rangeMode === 'preset') {
      const preset = PREDEFINED_RANGES.find(r => r.id === rangePresetId);
      if (!preset) return undefined;
      return {
        startBook: preset.startBook,
        endBook: preset.endBook,
        // The id, not the display name: a saved search outlives both a
        // rewording and a language change, and restore matches on book
        // numbers anyway - this field is only ever tested for presence.
        predefinedRange: preset.id,
      };
    }

    if (rangeMode === 'single') {
      return { startBook: rangeStartBook, endBook: rangeStartBook };
    }

    const startChapter = parseInt(rangeStartChapter, 10);
    const endChapter = parseInt(rangeEndChapter, 10);
    return {
      startBook: rangeStartBook,
      endBook: rangeEndBook,
      ...(startChapter > 0 ? { startChapter } : {}),
      ...(endChapter > 0 ? { endChapter } : {}),
    };
  };

  // Handle search with new options
  const handleSearch = async () => {
    // Update search options
    const proximityDistance = parseInt(proximityDistanceStr) || 0;
    setSearchOptions({
      scope,
      range: buildRange(),
      caseSensitive,
      wholeWord,
      fuzzyDistance,
      proximityDistance,
      maxResults,
      includeContext,
      autoFuzzy,
    });

    // Perform search with new query and options
    await performSearch(localQuery);

    // Close dialog and restore focus
    closeAdvancedDialog();
    restoreFocus();
  };

  // Handle cancel
  const handleCancel = () => {
    closeAdvancedDialog();
    restoreFocus();
  };

  if (!isAdvancedDialogOpen) return null;

  const labelClass = 'block text-sm font-semibold text-text-heading mb-xs';
  const hintClass = 'mt-xs text-xs text-text-secondary';
  const fieldClass =
    'w-full px-sm py-sm text-sm border border-border rounded focus:border-accent focus:ring-2 focus:ring-accent/30';

  // Plain-language echo of whatever the range controls currently add up to, so
  // the user can confirm the scope without mentally decoding three widgets.
  const rangeSummary = (() => {
    const range = buildRange();
    if (!range) return '';
    const startName = BOOK_NAMES[range.startBook ?? 1];
    const endName = BOOK_NAMES[range.endBook ?? 66];
    const start = range.startChapter ? `${startName} ${range.startChapter}` : startName;
    const end = range.endChapter ? `${endName} ${range.endChapter}` : endName;
    const span = start === end ? start : `${start} – ${end}`;
    return t('advancedSearchDialog.rangeSummary', { span });
  })();

  return (
    <>
      {/* Overlay */}
      <div
        className="fixed inset-0 bg-background-overlay z-40"
        aria-hidden="true"
        onClick={handleCancel}
      />

      {/* Dialog */}
      <div className="fixed inset-0 flex items-center justify-center z-50 p-lg">
        <div
          ref={dialogRef}
          className="bg-surface rounded-lg shadow-xl max-w-2xl w-full max-h-[90vh] overflow-y-auto"
          data-testid="advanced-search-dialog"
          role="dialog"
          aria-modal="true"
          aria-labelledby="advanced-search-dialog-title"
          onClick={(e) => e.stopPropagation()}
          onKeyDown={(e) => {
            if (e.key === 'Escape') {
              e.stopPropagation();
              handleCancel();
            }
          }}
        >
          {/* Header */}
          <div className="flex items-center justify-between px-xl py-lg border-b border-border">
            <h2 id="advanced-search-dialog-title" className="text-xl font-bold text-text-heading">{t('advancedSearchDialog.title')}</h2>
            <button
              onClick={handleCancel}
              className="p-1 hover:bg-background-active rounded transition-colors"
              title={t('advancedSearchDialog.closeTitle')}
              aria-label={t('advancedSearchDialog.closeTitle')}
            >
              <svg className="w-5 h-5 text-text-secondary" aria-hidden="true" focusable="false" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
              </svg>
            </button>
          </div>

          {/* Content */}
          <div className="px-xl py-lg space-y-lg">
            {/* Query */}
            <div>
              <label htmlFor="adv-search-query" className={labelClass}>
                {t('advancedSearchDialog.queryLabel')}
              </label>
              <input
                id="adv-search-query"
                aria-describedby="adv-search-query-hint"
                type="text"
                value={localQuery}
                onChange={(e) => setLocalQuery(e.target.value)}
                className={fieldClass}
                placeholder={t('advancedSearchDialog.queryPlaceholder')}
              />
              <div id="adv-search-query-hint" className={hintClass}>
                {t('advancedSearchDialog.queryHint')}
              </div>
            </div>

            {/* Scope */}
            <div>
              <label htmlFor="adv-search-scope" className={labelClass}>
                {t('advancedSearchDialog.scopeLabel')}
              </label>
              <select
                id="adv-search-scope"
                value={scope}
                onChange={(e) => setScope(e.target.value as SearchScope)}
                className={fieldClass}
              >
                <option value="currentModule">{t('advancedSearchDialog.scopeCurrentModule')}</option>
                <option value="allOpenModules">{t('advancedSearchDialog.scopeAllOpenModules')}</option>
                <option value="allBibles">{t('advancedSearchDialog.scopeAllBibles')}</option>
                <option value="allModules">{t('advancedSearchDialog.scopeAllModules')}</option>
                <option value="range">{t('advancedSearchDialog.scopeRange')}</option>
                <option value="lastResults">{t('advancedSearchDialog.scopeLastResults')}</option>
              </select>

              {/* Range picker for the "Specific range" scope. */}
              {scope === 'range' && (
                <fieldset className="mt-sm p-md border border-border rounded bg-background-warm">
                  <legend className="px-xs text-xs font-semibold text-text-secondary">
                    {t('advancedSearchDialog.rangeLegend')}
                  </legend>

                  <div className="flex flex-wrap gap-md mb-sm">
                    {([
                      ['single', t('advancedSearchDialog.rangeModeSingle')],
                      ['books', t('advancedSearchDialog.rangeModeBooks')],
                      ['preset', t('advancedSearchDialog.rangeModePreset')],
                    ] as Array<[RangeMode, string]>).map(([mode, label]) => (
                      <label key={mode} className="flex items-center gap-xs cursor-pointer text-sm">
                        <input
                          type="radio"
                          name="adv-search-range-mode"
                          value={mode}
                          checked={rangeMode === mode}
                          onChange={() => setRangeMode(mode)}
                          className="w-4 h-4"
                        />
                        <span>{label}</span>
                      </label>
                    ))}
                  </div>

                  {rangeMode === 'single' && (
                    <div>
                      <label htmlFor="adv-search-range-book" className={labelClass}>
                        {t('advancedSearchDialog.rangeBookLabel')}
                      </label>
                      <select
                        id="adv-search-range-book"
                        value={rangeStartBook}
                        onChange={(e) => setRangeStartBook(parseInt(e.target.value, 10))}
                        className={fieldClass}
                      >
                        {ALL_BOOKS.map(b => (
                          <option key={b.number} value={b.number}>{b.name}</option>
                        ))}
                      </select>
                    </div>
                  )}

                  {rangeMode === 'preset' && (
                    <div>
                      <label htmlFor="adv-search-range-preset" className={labelClass}>
                        {t('advancedSearchDialog.rangePresetLabel')}
                      </label>
                      <select
                        id="adv-search-range-preset"
                        value={rangePresetId}
                        onChange={(e) => setRangePresetId(e.target.value)}
                        className={fieldClass}
                      >
                        {PREDEFINED_RANGES.map(r => (
                          <option key={r.id} value={r.id}>
                            {t(r.labelKey)} ({BOOK_NAMES[r.startBook]}
                            {r.startBook === r.endBook ? '' : `–${BOOK_NAMES[r.endBook]}`})
                          </option>
                        ))}
                      </select>
                    </div>
                  )}

                  {rangeMode === 'books' && (
                    <div className="grid grid-cols-2 gap-md">
                      <div>
                        <label htmlFor="adv-search-range-from" className={labelClass}>
                          {t('advancedSearchDialog.rangeFromLabel')}
                        </label>
                        <select
                          id="adv-search-range-from"
                          value={rangeStartBook}
                          onChange={(e) => {
                            const next = parseInt(e.target.value, 10);
                            setRangeStartBook(next);
                            // Keep the pair ordered - an inverted range matches
                            // nothing, and silently returning zero results reads
                            // as a broken search rather than a bad input.
                            if (next > rangeEndBook) setRangeEndBook(next);
                          }}
                          className={fieldClass}
                        >
                          {ALL_BOOKS.map(b => (
                            <option key={b.number} value={b.number}>{b.name}</option>
                          ))}
                        </select>
                      </div>
                      <div>
                        <label htmlFor="adv-search-range-to" className={labelClass}>
                          {t('advancedSearchDialog.rangeToLabel')}
                        </label>
                        <select
                          id="adv-search-range-to"
                          value={rangeEndBook}
                          onChange={(e) => {
                            const next = parseInt(e.target.value, 10);
                            setRangeEndBook(next);
                            if (next < rangeStartBook) setRangeStartBook(next);
                          }}
                          className={fieldClass}
                        >
                          {ALL_BOOKS.map(b => (
                            <option key={b.number} value={b.number}>{b.name}</option>
                          ))}
                        </select>
                      </div>
                      <div>
                        <label htmlFor="adv-search-range-from-ch" className={labelClass}>
                          {t('advancedSearchDialog.rangeFromChapterLabel')}
                        </label>
                        <input
                          id="adv-search-range-from-ch"
                          type="number"
                          min={1}
                          max={MAX_CHAPTERS[rangeStartBook]}
                          value={rangeStartChapter}
                          onChange={(e) => setRangeStartChapter(e.target.value)}
                          placeholder="1"
                          className={fieldClass}
                        />
                      </div>
                      <div>
                        <label htmlFor="adv-search-range-to-ch" className={labelClass}>
                          {t('advancedSearchDialog.rangeToChapterLabel')}
                        </label>
                        <input
                          id="adv-search-range-to-ch"
                          type="number"
                          min={1}
                          max={MAX_CHAPTERS[rangeEndBook]}
                          value={rangeEndChapter}
                          onChange={(e) => setRangeEndChapter(e.target.value)}
                          placeholder={String(MAX_CHAPTERS[rangeEndBook])}
                          className={fieldClass}
                        />
                      </div>
                    </div>
                  )}

                  <div className={hintClass} aria-live="polite" data-testid="adv-search-range-summary">
                    {rangeSummary}
                  </div>
                </fieldset>
              )}
            </div>

            {/* Basic Options */}
            <div>
              <div className="text-sm font-semibold text-text-heading mb-sm">{t('advancedSearchDialog.searchOptionsHeading')}</div>
              <div className="space-y-sm">
                <label className="flex items-center gap-sm cursor-pointer">
                  <input
                    type="checkbox"
                    checked={caseSensitive}
                    onChange={(e) => setCaseSensitive(e.target.checked)}
                    className="w-4 h-4"
                  />
                  <span className="text-sm">{t('advancedSearchDialog.caseSensitive')}</span>
                </label>

                <label className="flex items-center gap-sm cursor-pointer">
                  <input
                    type="checkbox"
                    checked={wholeWord}
                    onChange={(e) => setWholeWord(e.target.checked)}
                    className="w-4 h-4"
                  />
                  <span className="text-sm">{t('advancedSearchDialog.wholeWordOnly')}</span>
                </label>

                <label className="flex items-center gap-sm cursor-pointer">
                  <input
                    type="checkbox"
                    checked={includeContext}
                    onChange={(e) => setIncludeContext(e.target.checked)}
                    className="w-4 h-4"
                  />
                  <span className="text-sm">{t('advancedSearchDialog.includeContext')}</span>
                </label>

                <label className="flex items-center gap-sm cursor-pointer">
                  <input
                    type="checkbox"
                    checked={autoFuzzy}
                    onChange={(e) => setAutoFuzzy(e.target.checked)}
                    className="w-4 h-4"
                  />
                  <span className="text-sm">{t('advancedSearchDialog.autoFuzzy')}</span>
                </label>
              </div>
            </div>

            {/* Advanced Options */}
            <div className="grid grid-cols-2 gap-md">
              {/* Fuzzy Distance */}
              <div>
                <label htmlFor="adv-search-fuzzy" className={labelClass}>
                  {t('advancedSearchDialog.fuzzyDistanceLabel')}
                </label>
                <input
                  id="adv-search-fuzzy"
                  aria-describedby="adv-search-fuzzy-hint"
                  type="number"
                  min={1}
                  max={3}
                  value={fuzzyDistance}
                  onChange={(e) => setFuzzyDistance(parseInt(e.target.value) || 2)}
                  className={fieldClass}
                />
                <div id="adv-search-fuzzy-hint" className={hintClass}>
                  {t('advancedSearchDialog.fuzzyDistanceHint')}
                </div>
              </div>

              {/* Proximity Distance */}
              <div>
                <label htmlFor="adv-search-proximity" className={labelClass}>
                  {t('advancedSearchDialog.proximityDistanceLabel')}
                </label>
                <input
                  id="adv-search-proximity"
                  aria-describedby="adv-search-proximity-hint"
                  type="text"
                  inputMode="numeric"
                  pattern="[0-9]*"
                  value={proximityDistanceStr}
                  onChange={(e) => {
                    // Allow empty string or valid numbers only
                    const val = e.target.value;
                    if (val === '' || /^\d+$/.test(val)) {
                      setProximityDistanceStr(val);
                    }
                  }}
                  onBlur={() => {
                    // Ensure valid value on blur (default to 0 if empty or invalid)
                    const num = parseInt(proximityDistanceStr) || 0;
                    setProximityDistanceStr(String(Math.min(100, Math.max(0, num))));
                  }}
                  className={fieldClass}
                />
                <div id="adv-search-proximity-hint" className={hintClass}>
                  {t('advancedSearchDialog.proximityDistanceHint')}
                </div>
              </div>

              {/* Max Results */}
              <div className="col-span-2">
                <label htmlFor="adv-search-max-results" className={labelClass}>
                  {t('advancedSearchDialog.maxResultsLabel')}
                </label>
                <input
                  id="adv-search-max-results"
                  aria-describedby="adv-search-max-results-hint"
                  type="number"
                  min={10}
                  max={1000}
                  step={10}
                  value={maxResults}
                  onChange={(e) => setMaxResults(parseInt(e.target.value) || 200)}
                  className={fieldClass}
                />
                <div id="adv-search-max-results-hint" className={hintClass}>
                  {t('advancedSearchDialog.maxResultsHint')}
                </div>
              </div>
            </div>

          </div>

          {/* Footer */}
          <div className="flex items-center justify-end gap-sm px-xl py-lg border-t border-border bg-background-warm">
            <button
              type="button"
              onClick={handleCancel}
              className="px-lg py-sm text-sm border border-border rounded hover:bg-background-hover transition-colors"
            >
              {t('advancedSearchDialog.cancel')}
            </button>
            <button
              type="button"
              onClick={handleSearch}
              className="px-lg py-sm text-sm bg-accent text-text-on-accent rounded hover:bg-accent-hover transition-colors"
            >
              {t('advancedSearchDialog.search')}
            </button>
          </div>
        </div>
      </div>
    </>
  );
};

export default AdvancedSearchDialog;
