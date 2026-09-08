import React from 'react';
import type { SearchBarMode } from '../types/SearchBarMode';
import type { CommandQueryResult } from '../types/Command';
import TopSearchBarCommandResult from './TopSearchBarCommandResult';
import TopSearchBarReferenceHint from './TopSearchBarReferenceHint';
import { useI18n } from '../contexts/useI18n';
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

interface TopSearchBarDropdownProps {
  mode: SearchBarMode;
  commands?: CommandQueryResult[];
  referenceText?: string;
  referenceTarget?: string;
  selectedIndex: number;
  onSelectCommand?: (id: string) => void;
  onSelectReference?: () => void;
}

/**
 * Dropdown panel for TopSearchBar. Switches template based on the active mode:
 *
 * - **command** -- list of matching commands from the registry
 * - **reference** -- single reference hint with navigate action
 * - **empty** / **search** -- not rendered (search mode uses LiveSearchSuggestions directly)
 */
const TopSearchBarDropdown: React.FC<TopSearchBarDropdownProps> = ({
  mode,
  commands,
  referenceText,
  referenceTarget,
  selectedIndex,
  onSelectCommand,
  onSelectReference,
}) => {
  const { t } = useI18n();

  if (mode === 'command') {
    if (!commands || commands.length === 0) {
      return (
        <div data-testid="search-dropdown" className="absolute top-full mt-1 w-full bg-surface-elevated border border-border rounded-lg shadow-lg z-50">
          <div className="px-3 py-4 text-center text-sm text-text-secondary">
            {t('searchBar.commandMode.empty')}
          </div>
        </div>
      );
    }

    return (
      <div data-testid="search-dropdown" className="absolute top-full mt-1 w-full bg-surface-elevated border border-border rounded-lg shadow-lg max-h-80 overflow-y-auto z-50">
        <div className="px-3 py-2 text-xs font-semibold text-text-secondary border-b border-border bg-surface-secondary">
          {t('searchBar.commandMode.label')}
        </div>
        <div className="divide-y divide-border">
          {commands.map((cmd, index) => (
            <TopSearchBarCommandResult
              key={cmd.id}
              command={cmd}
              isSelected={index === selectedIndex}
              onClick={() => onSelectCommand?.(cmd.id)}
            />
          ))}
        </div>
        <div className="px-3 py-2 border-t border-border text-xs text-text-secondary text-center bg-surface-secondary">
          {tElements(t, 'searchBar.commandModeHints', {
            navKeys: (
              <>
                <Kbd>{'↑'}</Kbd> <Kbd>{'↓'}</Kbd>
              </>
            ),
            enterKey: <Kbd>{t('searchBar.enterKey')}</Kbd>,
            tabKey: <Kbd>{t('searchBar.tabKey')}</Kbd>,
          })}
        </div>
      </div>
    );
  }

  if (mode === 'reference') {
    if (!referenceText || !referenceTarget) return null;

    return (
      <div data-testid="search-dropdown" className="absolute top-full mt-1 w-full bg-surface-elevated border border-border rounded-lg shadow-lg z-50">
        <TopSearchBarReferenceHint
          referenceText={referenceText}
          referenceTarget={referenceTarget}
          isSelected={selectedIndex === 0}
          onClick={() => onSelectReference?.()}
        />
        <div className="px-3 py-2 border-t border-border text-xs text-text-secondary text-center bg-surface-secondary">
          {tElements(t, 'searchBar.hintNavigateToReference', {
            key: <Kbd>{t('searchBar.enterKey')}</Kbd>,
          })}
        </div>
      </div>
    );
  }

  // 'empty' and 'search' modes don't use this dropdown
  return null;
};

export default TopSearchBarDropdown;
