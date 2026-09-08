import React, { useEffect, useRef } from 'react';
import { useI18n } from '../contexts/useI18n';
import { SearchResult } from '@bible/core';
import { useSearchStore } from '../stores/useSearchStore';
import { sanitizeHtml } from '../utils/sanitize';
import { tElements } from '../utils/tElements';

/**
 * A keycap. `dir="ltr"` is load-bearing, not cosmetic: key names are always
 * Latin, and HTML's default `[dir] { unicode-bidi: isolate }` keeps them from
 * re-ordering the surrounding Arabic run.
 */
const Kbd: React.FC<{ children: React.ReactNode }> = ({ children }) => (
  <kbd dir="ltr" className="px-1 py-0.5 bg-surface border border-border-secondary rounded text-xs font-mono">
    {children}
  </kbd>
);

/**
 * LiveSearchSuggestions Component
 *
 * Displays live search suggestions as the user types in the search bar.
 * Shows top 10 verse matches with highlighted search terms and verse previews.
 */

interface LiveSearchSuggestionsProps {
  suggestions: SearchResult[];
  isLoading: boolean;
  query: string;
  selectedIndex: number;
  onSelectSuggestion: (result: SearchResult) => void;
}

const LiveSearchSuggestions: React.FC<LiveSearchSuggestionsProps> = ({
  suggestions,
  isLoading,
  query,
  selectedIndex,
  onSelectSuggestion,
}) => {
  const { t } = useI18n();
  // All hooks must be called unconditionally before any early returns
  // (React Rules of Hooks). Moving useSearchStore before conditional logic.
  const { semanticAvailable, toggleSemanticMode, isSemanticMode } = useSearchStore();

  // Show loading state while searching
  if (isLoading) {
    return (
      <div data-testid="live-suggestions" className="absolute top-full mt-1 w-full bg-surface-elevated border border-border rounded-lg shadow-lg z-50">
        <div className="px-3 py-4 flex items-center justify-center">
          <div className="animate-spin h-5 w-5 border-2 border-accent border-t-transparent rounded-full me-2"></div>
          <span className="text-sm text-text-secondary">{t('liveSearchSuggestions.searching', { query })}</span>
        </div>
      </div>
    );
  }

  // Show "no results" state when search is complete but no results found
  if (suggestions.length === 0) {
    // Don't show "No results" if the query is empty or just whitespace
    if (!query || query.trim().length === 0) {
      return (
        <div data-testid="live-suggestions" className="absolute top-full mt-1 w-full bg-surface-elevated border border-border rounded-lg shadow-lg z-50">
          <div className="px-3 py-4 flex items-center justify-center">
            <span className="text-sm text-text-secondary">{t('liveSearchSuggestions.emptyPrompt')}</span>
          </div>
        </div>
      );
    }

    return (
      <div data-testid="live-suggestions" className="absolute top-full mt-1 w-full bg-surface-elevated border border-border rounded-lg shadow-lg z-50">
        <div className="px-3 py-4 flex items-center justify-center">
          <span className="text-sm text-text-secondary">{t('liveSearchSuggestions.noResults', { query })}</span>
        </div>
      </div>
    );
  }

  return (
    <div data-testid="live-suggestions" className="absolute top-full mt-1 w-full bg-surface border border-border rounded-lg shadow-lg max-h-96 overflow-y-auto z-50">
      {/* Header */}
      <div className="px-3 py-2 text-xs font-semibold text-text-secondary border-b border-border bg-surface-secondary flex items-center justify-between">
        <span>{t('liveSearchSuggestions.topResults')}</span>
        {semanticAvailable && (
          <button
            type="button"
            onMouseDown={(e) => {
              e.preventDefault();
              toggleSemanticMode();
            }}
            className="text-xs text-accent-strong hover:text-accent-strong hover:underline cursor-pointer"
          >
            {isSemanticMode ? 'Back to Keyword Search' : 'Semantic Search'}
          </button>
        )}
      </div>

      {/* Suggestions List */}
      <div className="divide-y divide-border">
        {suggestions.map((result, index) => (
          <SuggestionItem
            key={`${result.verseId}-${index}`}
            result={result}
            isSelected={index === selectedIndex}
            onClick={() => onSelectSuggestion(result)}
          />
        ))}
      </div>

      {/* Footer */}
      <div className="px-3 py-2 border-t border-border text-xs text-text-secondary text-center bg-surface-secondary">
        {tElements(t, 'liveSearchSuggestions.hints', {
          navKeys: (
            <>
              <Kbd>↑</Kbd> <Kbd>↓</Kbd>
            </>
          ),
          enterKey: <Kbd>{t('liveSearchSuggestions.enterKey')}</Kbd>,
        })}
      </div>
    </div>
  );
};

// ============================================================================
// SuggestionItem Component
// ============================================================================

interface SuggestionItemProps {
  result: SearchResult;
  isSelected: boolean;
  onClick: () => void;
}

const SuggestionItem: React.FC<SuggestionItemProps> = ({ result, isSelected, onClick }) => {
  const { t } = useI18n();
  const itemRef = useRef<HTMLButtonElement>(null);

  // Scroll selected item into view
  useEffect(() => {
    if (isSelected && itemRef.current) {
      itemRef.current.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
    }
  }, [isSelected]);
  // Extract text without HTML tags for preview (in case highlighting was added)
  const textPreview = result.snippet || result.text;

  // Truncate text to ~150 characters for preview
  const truncatedText = textPreview.length > 150
    ? textPreview.substring(0, 150) + '...'
    : textPreview;

  return (
    <button
      type="button"
      ref={itemRef}
      onMouseDown={(e) => {
        // Use onMouseDown instead of onClick to prevent blur race condition
        // The blur event fires before onClick, hiding the dropdown before click registers
        e.preventDefault();
        onClick();
      }}
      className={`w-full px-3 py-2 text-start transition-colors group cursor-pointer ${
        isSelected ? 'bg-accent-soft' : 'hover:bg-accent-light'
      }`}
    >
      {/* Reference */}
      <div className="flex items-center justify-between mb-1">
        <span className="text-sm font-semibold text-accent-strong group-hover:text-accent-strong">
          {result.reference}
        </span>
        {result.type === 'fuzzy' && (
          <span className="text-xs bg-warning-soft text-warning-text px-1.5 py-0.5 rounded">
            {t('liveSearchSuggestions.fuzzy')}
          </span>
        )}
      </div>

      {/* Verse Preview */}
      <div
        className="text-sm text-text-secondary line-clamp-2"
        dangerouslySetInnerHTML={{ __html: sanitizeHtml(truncatedText) }}
      />
    </button>
  );
};

export default LiveSearchSuggestions;
