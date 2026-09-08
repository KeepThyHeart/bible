import React, { useState, useRef, useEffect, useCallback } from 'react';
import { PaneOverlay } from './shared/PaneOverlay';
import { useI18n } from '../contexts/useI18n';
import { tElements } from '../utils/tElements';

/**
 * Keycap. `dir="ltr"` is load-bearing rather than cosmetic: HTML's default
 * `[dir] { unicode-bidi: isolate }` is what stops a Latin key name from
 * re-ordering the Arabic run around it.
 */
const Kbd: React.FC<{ children: React.ReactNode }> = ({ children }) => (
  <kbd dir="ltr" className="px-1 py-0.5 bg-surface border border-border-secondary rounded text-xs font-mono">
    {children}
  </kbd>
);

export interface ModuleItem {
  id: string; // Unique identifier (abbreviation or module_id)
  name: string;
  /**
   * Secondary line under the name. Display text, not identity - a caller whose
   * module is shown under a different name than its database abbreviation
   * (the "SYNTHESIS" digest, which readers know as "Combined Summary") passes
   * the reader-facing string here and keeps the real one in `id`. Act on `id`,
   * never on this.
   */
  abbreviation: string;
  languageCode?: string;
  version?: string;
  openCount?: number; // Number of times this module is currently open
  /**
   * Opt-in per-passage availability badge (e.g. "Has content for John 3:16").
   * Callers pass an already-localized label; omit for module kinds with no
   * notion of per-passage content (Bible translations, dictionaries, etc.) -
   * ModuleSelector renders nothing extra unless a caller supplies one.
   */
  availabilityLabel?: string;
  /** Shows a lightweight loading indicator in place of the badge while a caller's availability check is in flight. */
  availabilityLoading?: boolean;
}

interface ModuleSelectorProps {
  title: string;
  modules: ModuleItem[];
  isLoading?: boolean;
  onSelect: (module: ModuleItem) => void;
  onClose: () => void;
  /**
   * Opt-in "close this one" affordance for modules that are already open.
   * Without it the selector is add-only: an already-open module shows an
   * "open" badge and the only way back out is the tab's own context menu,
   * which is not discoverable. Callers that can close a module pass this and
   * get a x on every row whose `openCount` is above zero.
   */
  onRemove?: (module: ModuleItem) => void;
  /** Tooltip/aria-label for the x button; required in practice when `onRemove` is passed. */
  removeLabel?: string;
  /**
   * Overrides the default "no modules available" copy. Callers pass an
   * already-localized string; when omitted the catalog's generic wording is
   * used rather than a hardcoded English default.
   */
  emptyMessage?: string;
  /** When true, renders without the outer modal overlay (for embedding in another dialog) */
  embedded?: boolean;
}

/**
 * Reusable module selector dialog with search/filter functionality.
 * Used for selecting Bible translations, commentaries, dictionaries, etc.
 */
const ModuleSelector: React.FC<ModuleSelectorProps> = ({
  title,
  modules,
  isLoading = false,
  emptyMessage,
  onSelect,
  onRemove,
  removeLabel,
  onClose,
  embedded = false
}) => {
  const { t } = useI18n();
  const [searchQuery, setSearchQuery] = useState('');
  const [selectedIndex, setSelectedIndex] = useState(0);
  const searchInputRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLDivElement>(null);

  // Auto-focus search input when dialog opens
  useEffect(() => {
    // Small delay to ensure DOM is ready
    const timer = setTimeout(() => {
      searchInputRef.current?.focus();
    }, 50);
    return () => clearTimeout(timer);
  }, []);

  // Filter modules based on search query
  const filteredModules = modules.filter(module => {
    if (!searchQuery.trim()) return true;
    const query = searchQuery.toLowerCase();
    return (
      module.name.toLowerCase().includes(query) ||
      module.abbreviation.toLowerCase().includes(query) ||
      (module.languageCode && module.languageCode.toLowerCase().includes(query))
    );
  });

  // Reset selected index when search query changes or filtered results change
  useEffect(() => {
    setSelectedIndex(0);
  }, [searchQuery]);

  // Scroll selected item into view
  useEffect(() => {
    if (listRef.current && filteredModules.length > 0) {
      const selectedItem = listRef.current.querySelector(`[data-index="${selectedIndex}"]`);
      if (selectedItem) {
        selectedItem.scrollIntoView({ block: 'nearest' });
      }
    }
  }, [selectedIndex, filteredModules.length]);

  // Handle keyboard events
  const handleKeyDown = useCallback((e: React.KeyboardEvent) => {
    if (e.key === 'Escape') {
      onClose();
    } else if (e.key === 'Enter' && filteredModules.length > 0) {
      // Select the currently highlighted result
      onSelect(filteredModules[selectedIndex]);
    } else if (e.key === 'ArrowDown') {
      e.preventDefault();
      setSelectedIndex(prev => Math.min(prev + 1, filteredModules.length - 1));
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      setSelectedIndex(prev => Math.max(prev - 1, 0));
    }
  }, [filteredModules, selectedIndex, onSelect, onClose]);


  const innerContent = (
    <>
        {/* Search Input */}
        <div className={embedded ? "px-xl py-md" : "px-xl py-md border-b border-border"}>
          <input
            ref={searchInputRef}
            type="text"
            placeholder={t('ui.moduleSelector.filterPlaceholder')}
            className="w-full px-md py-sm border border-border rounded focus:outline-none focus:ring-2 focus:ring-accent focus:border-transparent"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            onKeyDown={handleKeyDown}
          />
          {filteredModules.length > 0 && (
            <div className="mt-1 text-xs text-text-secondary">
              {/*
                One whole ICU message: the count is a real ICU plural and the
                two key names are element placeholders the translator can move.
                Concatenating an English plural suffix (`result` + `s`) with a
                hardcoded English hint and its own ` - ` separator would leave
                no translator able to reach the word order, the separator, or
                the plural rule.
              */}
              {tElements(
                t,
                'ui.moduleSelector.resultsHint',
                {
                  navKeys: (
                    <>
                      <Kbd>↑</Kbd> <Kbd>↓</Kbd>
                    </>
                  ),
                  enterKey: <Kbd>{t('ui.moduleSelector.enterKey')}</Kbd>,
                },
                { count: filteredModules.length },
              )}
            </div>
          )}
        </div>

        {/* Module List */}
        <div ref={listRef} className="overflow-y-auto max-h-[50vh] p-xl">
          {isLoading ? (
            <div className="text-center text-text-secondary">{t('ui.moduleSelector.loading')}</div>
          ) : filteredModules.length === 0 ? (
            <div className="text-center text-text-secondary">
              {modules.length === 0
                ? (emptyMessage ?? t('ui.moduleSelector.noModules'))
                : t('ui.moduleSelector.noMatches')}
            </div>
          ) : (
            <div className="space-y-sm">
              {/*
                Real buttons, not clickable divs: the rows were unreachable by
                keyboard and announced as plain text, so the only way to pick a
                module was the arrow/Enter handling bound to the search input.
              */}
              {filteredModules.map((module, index) => {
                const isOpen = (module.openCount ?? 0) > 0;
                // The x is a sibling of the row button, not a child: a nested
                // <button> is invalid HTML and swallows the outer click.
                return (
                <div key={module.id} className="relative">
                <button
                  type="button"
                  data-testid="module-selector-item"
                  data-index={index}
                  aria-current={index === selectedIndex ? 'true' : undefined}
                  className={`
                    block w-full text-start p-md border rounded transition-colors
                    ${isOpen
                      ? 'bg-accent/10 border-accent'
                      : 'border-border hover:bg-background-warm'}
                    ${index === selectedIndex ? 'ring-2 ring-accent' : ''}
                    ${onRemove && isOpen ? 'pe-10' : ''}
                  `}
                  onClick={() => onSelect(module)}
                >
                  <span className="flex items-start justify-between">
                    <span className="flex-1">
                      <span className="block font-semibold text-text-heading">
                        {module.name}
                        {module.openCount !== undefined && module.openCount > 0 && (
                          <span className="ms-sm text-accent text-sm">
                            {t('ui.moduleSelector.openCount', { count: module.openCount })}
                          </span>
                        )}
                      </span>
                      <span className="block text-sm text-text-secondary">
                        {module.abbreviation}
                        {module.languageCode && ` • ${module.languageCode.toUpperCase()}`}
                        {module.version && ` • v${module.version}`}
                      </span>
                      {/* Opt-in per-passage availability badge - see `availabilityLabel` doc comment */}
                      {module.availabilityLoading ? (
                        <span className="block mt-1 text-xs text-text-secondary">
                          {t('ui.moduleSelector.checkingAvailability')}
                        </span>
                      ) : module.availabilityLabel ? (
                        <span className="mt-1 text-xs text-accent flex items-center gap-1">
                          <span aria-hidden="true">✓</span>
                          <span>{module.availabilityLabel}</span>
                        </span>
                      ) : null}
                    </span>
                  </span>
                </button>
                {onRemove && isOpen && (
                  <button
                    type="button"
                    data-testid="module-selector-remove"
                    data-module-id={module.id}
                    className="absolute end-2 top-1/2 -translate-y-1/2 w-6 h-6 rounded flex items-center justify-center text-text-secondary hover:text-text-primary hover:bg-background-hover transition-colors"
                    title={removeLabel}
                    aria-label={removeLabel}
                    onClick={(e) => {
                      e.stopPropagation();
                      onRemove(module);
                    }}
                  >
                    <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                    </svg>
                  </button>
                )}
                </div>
                );
              })}
            </div>
          )}
        </div>

        {/* Footer */}
        {!embedded && (
          <div className="px-xl py-md border-t border-border flex justify-end">
            <button
              className="px-lg py-sm bg-control text-text-primary rounded hover:bg-control-hover"
              onClick={onClose}
            >
              {t('ui.moduleSelector.closeButton')}
            </button>
          </div>
        )}
    </>
  );

  if (embedded) {
    return <div onKeyDown={handleKeyDown}>{innerContent}</div>;
  }

  return (
    // The backdrop's own click dismisses; the dialog below stops propagation,
    // so a click inside it never reaches here.
    <PaneOverlay onDismiss={onClose}>
      <div
        onKeyDown={handleKeyDown}
        data-testid="module-selector"
        className="bg-surface rounded-lg shadow-xl w-full max-w-2xl max-h-[80vh] overflow-hidden"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="px-xl py-lg border-b border-border">
          <h2 className="text-2xl font-semibold text-text-heading">{title}</h2>
        </div>

        {innerContent}
      </div>
    </PaneOverlay>
  );
};

export default ModuleSelector;
