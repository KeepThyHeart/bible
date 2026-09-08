import { RefObject } from 'react';
import { TFn } from './types';

export interface DocumentationHeaderProps {
  t: TFn;
  searchQuery: string;
  onSearchChange: (value: string) => void;
  searchInputRef: RefObject<HTMLInputElement | null>;
  onClose: () => void;
}

export function DocumentationHeader({
  t,
  searchQuery,
  onSearchChange,
  searchInputRef,
  onClose,
}: DocumentationHeaderProps) {
  return (
    <div className="flex items-center justify-between px-5 py-3 border-b border-border bg-surface-secondary flex-shrink-0">
      <div className="flex items-center gap-3">
        <svg
          className="w-6 h-6 text-accent"
          aria-hidden="true"
          focusable="false"
          fill="none"
          viewBox="0 0 24 24"
          stroke="currentColor"
          strokeWidth={1.5}
        >
          <path
            strokeLinecap="round"
            strokeLinejoin="round"
            d="M12 6.253v13m0-13C10.832 5.477 9.246 5 7.5 5S4.168 5.477 3 6.253v13C4.168 18.477 5.754 18 7.5 18s3.332.477 4.5 1.253m0-13C13.168 5.477 14.754 5 16.5 5c1.747 0 3.332.477 4.5 1.253v13C19.832 18.477 18.247 18 16.5 18c-1.746 0-3.332.477-4.5 1.253"
          />
        </svg>
        <h2 id="documentation-dialog-title" className="text-lg font-semibold text-text-heading">
          {t('documentationDialog.headerTitle')}
        </h2>
      </div>

      <div className="flex items-center gap-2">
        {/* Search */}
        <div className="relative">
          <svg
            className="absolute start-2.5 top-1/2 -translate-y-1/2 w-4 h-4 text-text-muted"
            aria-hidden="true"
            focusable="false"
            fill="none"
            viewBox="0 0 24 24"
            stroke="currentColor"
            strokeWidth={2}
          >
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z"
            />
          </svg>
          <input
            ref={searchInputRef as RefObject<HTMLInputElement>}
            type="text"
            placeholder={t('documentationDialog.searchPlaceholder')}
            aria-label={t('documentationDialog.searchPlaceholder')}
            value={searchQuery}
            onChange={(e) => onSearchChange(e.target.value)}
            className="ps-8 pe-3 py-1.5 text-sm border border-border rounded w-56 bg-surface text-text-primary placeholder:text-text-muted focus:outline-none focus:ring-1 focus:ring-accent focus:border-accent"
          />
          {searchQuery && (
            <button
              type="button"
              onClick={() => onSearchChange('')}
              aria-label={t('documentationDialog.clearSearch')}
              className="absolute end-2 top-1/2 -translate-y-1/2 text-text-muted hover:text-text-secondary"
            >
              <svg
                className="w-3.5 h-3.5"
                aria-hidden="true"
                focusable="false"
                fill="none"
                viewBox="0 0 24 24"
                stroke="currentColor"
                strokeWidth={2}
              >
                <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
              </svg>
            </button>
          )}
        </div>

        {/* Close button */}
        <button
          type="button"
          onClick={onClose}
          className="p-1.5 text-text-secondary hover:text-text-primary hover:bg-background-active rounded transition-colors"
          title={t('documentationDialog.closeTitle')}
          aria-label={t('documentationDialog.closeTitle')}
        >
          <svg className="w-5 h-5" aria-hidden="true" focusable="false" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
          </svg>
        </button>
      </div>
    </div>
  );
}
