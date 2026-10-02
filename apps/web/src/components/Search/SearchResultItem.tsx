import { useTranslation } from 'react-i18next';
import { sanitizeHtml } from '../../utils/sanitize';
import type { SearchResultData } from '../../types';
import { moduleContentAttrs } from '../../utils/contentDirection';
import { Bdi } from '@bible/ui';

interface SearchResultItemProps {
  result: SearchResultData;
  onClick: (result: SearchResultData) => void;
  onCtrlClick: (result: SearchResultData) => void;
  lastClicked?: boolean;
  /**
   * Stable id for this row (`searchResultId`), written to `data-result-id` so
   * the distribution chart can find the row it selected and scroll it into
   * view. Optional because other callers — the passage picker's inline result
   * list — reuse this component without a chart above it.
   */
  resultId?: string;
}

export function SearchResultItem({ result, onClick, onCtrlClick, lastClicked, resultId }: SearchResultItemProps) {
  const { t } = useTranslation();

  const handleClick = (e: MouseEvent) => {
    if (e.ctrlKey || e.metaKey) {
      onCtrlClick(result);
    } else {
      onClick(result);
    }
  };

  // Only keyword-family results carry a MatchType; a semantic result's `type` is
  // its retrieval level, and none of those levels is called "fuzzy", so this is
  // unambiguous without knowing which search produced the row.
  const isFuzzy = result.type === 'fuzzy';

  return (
    <div
      class={`search-result-item${lastClicked ? ' search-result-item--last-clicked' : ''}${isFuzzy ? ' search-result-item--fuzzy' : ''}`}
      data-result-id={resultId}
      onClick={handleClick}
    >
      <div class="search-result-item__ref">
        <span class="search-result-item__reference"><Bdi>{result.reference}</Bdi></span>
        <span class="search-result-item__module"><Bdi>{result.module}</Bdi></span>
        {isFuzzy && (
          <span class="search-result-item__match-type" data-testid="search-result-fuzzy-badge">
            <span aria-hidden="true">~</span> {t('search.approximateBadge')}
          </span>
        )}
      </div>
      {result.title && <div class="search-result-item__title">{result.title}</div>}
      <div
        class="search-result-item__text"
        {...moduleContentAttrs(result.module)}
        dangerouslySetInnerHTML={{ __html: sanitizeHtml(result.snippet || result.text) }}
      />
    </div>
  );
}
