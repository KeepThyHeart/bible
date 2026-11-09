import React, { useCallback, useEffect, useRef, useState } from 'react';
import { useI18n } from '../contexts/useI18n';
import { useSearchStore } from '../stores/useSearchStore';

/** Magnifier: the next search is a keyword search. */
export const MagnifierIcon: React.FC<{ className?: string }> = ({ className = 'w-5 h-5' }) => (
  <svg className={className} fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden="true">
    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
  </svg>
);

/** Light bulb: the next search is an Ideas (meaning) search. */
export const LightbulbIcon: React.FC<{ className?: string }> = ({ className = 'w-5 h-5' }) => (
  <svg className={className} fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden="true">
    <path
      strokeLinecap="round"
      strokeLinejoin="round"
      strokeWidth={2}
      d="M9 18h6m-5 3h4M12 3a6 6 0 00-3.6 10.8c.6.5 1.1 1.2 1.1 2V16h5v-.2c0-.8.5-1.5 1.1-2A6 6 0 0012 3z"
    />
  </svg>
);

/**
 * The search icon of the unified bar, doubled as the Search / Ideas selector.
 *
 * The icon shows what the next search will be (magnifier = keyword, light bulb
 * = Ideas); clicking opens a small menu with both options and a one-line
 * explanation each. It reads and writes the same `isSemanticMode` the results
 * pane's "Ideas search / Keyword search" link does, so the two stay in step.
 * Rendered only when Ideas search is available; otherwise the plain magnifier.
 */
const SearchTypeSelector: React.FC<{ onChosen?: () => void }> = ({ onChosen }) => {
  const { t } = useI18n();
  const semanticAvailable = useSearchStore((s) => s.semanticAvailable);
  const isSemanticMode = useSearchStore((s) => s.isSemanticMode);
  const setSemanticMode = useSearchStore((s) => s.setSemanticMode);
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent): void => {
      if (rootRef.current && !rootRef.current.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') setOpen(false);
    };
    document.addEventListener('mousedown', onDown);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onDown);
      document.removeEventListener('keydown', onKey);
    };
  }, [open]);

  const choose = useCallback(
    (semantic: boolean) => {
      setOpen(false);
      setSemanticMode(semantic);
      onChosen?.();
    },
    [setSemanticMode, onChosen],
  );

  if (!semanticAvailable) return <MagnifierIcon />;

  const options: Array<{ semantic: boolean; label: string; hint: string; testId: string; icon: React.ReactNode }> = [
    { semantic: false, label: t('searchBar.type.keyword'), hint: t('searchBar.type.keywordHint'), testId: 'search-type-keyword', icon: <MagnifierIcon className="w-4 h-4" /> },
    { semantic: true, label: t('searchBar.type.ideas'), hint: t('searchBar.type.ideasHint'), testId: 'search-type-ideas', icon: <LightbulbIcon className="w-4 h-4" /> },
  ];

  return (
    <div ref={rootRef} className="relative">
      <button
        type="button"
        data-testid="search-type-button"
        data-search-type={isSemanticMode ? 'ideas' : 'keyword'}
        aria-haspopup="menu"
        aria-expanded={open}
        title={t('searchBar.type.title')}
        aria-label={`${t('searchBar.type.title')}: ${isSemanticMode ? t('searchBar.type.ideas') : t('searchBar.type.keyword')}`}
        onMouseDown={(e) => e.preventDefault()}
        onClick={() => setOpen((o) => !o)}
        className="flex items-center hover:text-text-primary cursor-pointer rounded"
      >
        {isSemanticMode ? <LightbulbIcon /> : <MagnifierIcon />}
      </button>
      {open && (
        <div
          role="menu"
          aria-label={t('searchBar.type.title')}
          data-testid="search-type-menu"
          className="absolute start-0 top-full mt-2 w-64 bg-surface-elevated border border-border rounded-lg shadow-lg z-50 py-1 text-start"
        >
          {options.map((o) => {
            const selected = o.semantic === isSemanticMode;
            return (
              <button
                key={o.testId}
                type="button"
                role="menuitemradio"
                aria-checked={selected}
                data-testid={o.testId}
                onClick={() => choose(o.semantic)}
                className={`w-full flex items-start gap-2 px-3 py-2 text-start cursor-pointer hover:bg-accent-light ${selected ? 'bg-accent-soft' : ''}`}
              >
                <span className="mt-0.5 text-text-secondary">{o.icon}</span>
                <span className="flex flex-col">
                  <span className="text-sm font-semibold text-text-primary">{o.label}</span>
                  <span className="text-xs text-text-secondary whitespace-normal">{o.hint}</span>
                </span>
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
};

export default SearchTypeSelector;
