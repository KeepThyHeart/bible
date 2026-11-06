import { Bdi } from '@bible/ui';
import React, { useEffect, useRef } from 'react';
import { useI18n } from '../contexts/useI18n';
import { SearchResult } from '@bible/core';
import { sanitizeHtml } from '../utils/sanitize';
import { tElements } from '../utils/tElements';
import { useTextSettingsStore } from '../stores/useTextSettingsStore';

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
  const showRedLetter = useTextSettingsStore((state) => state.getSettings('bible').showRedLetter);
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
    <div data-testid="live-suggestions" className={`absolute top-full mt-1 w-full bg-surface border border-border rounded-lg shadow-lg max-h-96 overflow-y-auto z-50${showRedLetter === false ? ' no-red-letter' : ''}`}>
      {/* Header */}
      <div className="px-3 py-2 text-xs font-semibold text-text-secondary border-b border-border bg-surface-secondary">
        <span>{t('liveSearchSuggestions.topResults')}</span>
      </div>

      {/* Suggestions List */}
      <div id="search-listbox" role="listbox" aria-label={t('liveSearchSuggestions.listLabel')} className="divide-y divide-border">
        {suggestions.map((result, index) => (
          <SuggestionItem
            key={`${result.verseId}-${index}`}
            result={result}
            isSelected={index === selectedIndex}
            index={index}
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

/** Cut `html` after `max` visible characters, keeping tags balanced; adds an ellipsis when cut. */
export function truncateHtml(html: string, max: number): string {
  let visible = 0;
  let out = '';
  const open: string[] = [];
  const re = /<[^>]*>|[^<]+/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(html)) !== null) {
    const tok = m[0];
    if (tok.startsWith('<')) {
      out += tok;
      const name = /^<\/?\s*([a-zA-Z][\w-]*)/.exec(tok)?.[1]?.toLowerCase();
      if (name && !tok.endsWith('/>')) {
        if (tok.startsWith('</')) open.pop();
        else open.push(name);
      }
      continue;
    }
    if (visible + tok.length > max) {
      out += tok.slice(0, max - visible) + '...';
      while (open.length) out += `</${open.pop()}>`;
      return out;
    }
    out += tok;
    visible += tok.length;
  }
  return out;
}

// ============================================================================
// SuggestionItem Component
// ============================================================================

interface SuggestionItemProps {
  result: SearchResult;
  isSelected: boolean;
  index: number;
  onClick: () => void;
}

const SuggestionItem: React.FC<SuggestionItemProps> = ({ result, isSelected, index, onClick }) => {
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

  // Truncate on the visible text length (tags do not count), so markup cannot eat the cut.
  const truncatedText = truncateHtml(textPreview, 150);

  return (
    <button
      type="button"
      id={`search-option-${index}`}
      role="option"
      aria-selected={isSelected}
      tabIndex={-1}
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
          <Bdi>{result.reference}</Bdi>
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
