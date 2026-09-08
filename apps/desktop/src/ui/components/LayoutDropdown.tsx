import React, { useState, useRef, useEffect } from 'react';
import { useI18n } from '../contexts/useI18n';
import { layoutPresetService } from '../commands/layoutCommands';
import { BUILT_IN_PRESETS, DEFAULT_LAYOUT_PRESET_ID } from '../presets';
import { useLayoutStore } from '../stores/useLayoutStore';
import { usePreferencesStore } from '../stores/usePreferencesStore';

const LayoutDropdown: React.FC = () => {
  const { t } = useI18n();
  const [isOpen, setIsOpen] = useState(false);
  const dropdownRef = useRef<HTMLDivElement>(null);
  const buttonRef = useRef<HTMLButtonElement>(null);
  const collapsedGroups = useLayoutStore(s => s.collapsedGroups);
  const expandCollapsedGroups = useLayoutStore(s => s.expandCollapsedGroups);
  const advancedEnabled = usePreferencesStore(s => s.advancedPaneManagerEnabled);
  const setAdvancedEnabled = usePreferencesStore(s => s.setAdvancedPaneManagerEnabled);

  // Close on outside click
  useEffect(() => {
    if (!isOpen) return;
    const handler = (e: MouseEvent) => {
      if (dropdownRef.current && !dropdownRef.current.contains(e.target as Node)) {
        setIsOpen(false);
      }
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, [isOpen]);

  // Escape closes the popup and returns focus to the button that opened it.
  // Capture phase so the key never reaches a global shortcut handler first.
  useEffect(() => {
    if (!isOpen) return;
    const handler = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return;
      e.stopPropagation();
      e.preventDefault();
      setIsOpen(false);
      buttonRef.current?.focus();
    };
    document.addEventListener('keydown', handler, true);
    return () => document.removeEventListener('keydown', handler, true);
  }, [isOpen]);

  const handleApply = async (presetId: string) => {
    setIsOpen(false);
    await layoutPresetService.apply(presetId);
  };

  // "Reset" must ignore the arrangement remembered for the default preset -
  // otherwise it would restore the very state the user is trying to escape.
  const handleReset = async () => {
    setIsOpen(false);
    await layoutPresetService.apply(DEFAULT_LAYOUT_PRESET_ID, { forceRebuild: true });
  };

  const handleExpand = () => {
    setIsOpen(false);
    expandCollapsedGroups();
  };

  return (
    <div ref={dropdownRef} className="relative flex-shrink-0">
      <button
        ref={buttonRef}
        onClick={() => setIsOpen(!isOpen)}
        className="px-3 py-1.5 text-sm border border-border rounded-lg hover:bg-background-hover transition-colors flex items-center gap-1.5"
        title={t('layout.dropdown.tooltip')}
        data-testid="layout-dropdown-button"
      >
        {/* Grid/layout icon */}
        <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 5a1 1 0 011-1h4a1 1 0 011 1v4a1 1 0 01-1 1H5a1 1 0 01-1-1V5zm10 0a1 1 0 011-1h4a1 1 0 011 1v4a1 1 0 01-1 1h-4a1 1 0 01-1-1V5zM4 15a1 1 0 011-1h4a1 1 0 011 1v4a1 1 0 01-1 1H5a1 1 0 01-1-1v-4zm10 0a1 1 0 011-1h4a1 1 0 011 1v4a1 1 0 01-1 1h-4a1 1 0 01-1-1v-4z" />
        </svg>
        <span>{t('layout.dropdown.label')}</span>
        <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
        </svg>
      </button>

      {isOpen && (
        <div className="absolute top-full start-0 mt-1 w-64 bg-surface-elevated border border-border rounded-lg shadow-lg z-50 py-1">
          {BUILT_IN_PRESETS.map(preset => {
            const isCurrent = layoutPresetService.currentPresetId === preset.id;
            return (
              <button
                key={preset.id}
                onClick={() => handleApply(preset.id)}
                className={`w-full text-start px-3 py-2 hover:bg-background-hover transition-colors ${isCurrent ? 'bg-accent-light' : ''}`}
                data-testid={`layout-preset-${preset.id}`}
              >
                <div className="flex items-center gap-2">
                  {isCurrent && (
                    <svg className="w-4 h-4 text-accent flex-shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
                    </svg>
                  )}
                  <div className={isCurrent ? '' : 'ps-6'}>
                    <div className="text-sm font-medium">{t(preset.name.key)}</div>
                    {preset.description && (
                      <div className="text-xs text-text-secondary">{t(preset.description.key)}</div>
                    )}
                  </div>
                </div>
              </button>
            );
          })}

          {collapsedGroups.length > 0 && (
            <>
              <div className="my-1 border-t border-border" />
              <button
                onClick={handleExpand}
                className="w-full text-start px-3 py-2 hover:bg-background-hover transition-colors flex items-center gap-2"
                data-testid="layout-expand-collapsed"
              >
                <svg className="w-4 h-4 text-text-secondary flex-shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 8V4m0 0h4M4 4l5 5m11-1V4m0 0h-4m4 0l-5 5M4 16v4m0 0h4m-4 0l5-5m11 5l-5-5m5 5v-4m0 4h-4" />
                </svg>
                <span className="text-sm font-medium">{t('layout.expandCollapsed.label')}</span>
              </button>
            </>
          )}

          {/* D4: an explicit recovery action so a novice who has dragged panes
              into a mangled state can get back to the default in one click. */}
          <div className="my-1 border-t border-border" />
          <button
            onClick={handleReset}
            className="w-full text-start px-3 py-2 hover:bg-background-hover transition-colors flex items-center gap-2"
            data-testid="layout-reset-default"
          >
            <svg className="w-4 h-4 text-text-secondary flex-shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
            </svg>
            <span className="text-sm font-medium">{t('layout.reset.label')}</span>
          </button>

          {/* Advanced layout mode is the one setting people reach for while they
              are already in this menu, so it lives here as well as in
              Preferences > General. The "?" opens the full setting with its
              explanation rather than trying to fit the prose into the popup. */}
          <div className="my-1 border-t border-border" />
          <div className="flex items-center gap-2 px-3 py-2">
            <label className="flex items-center gap-2 cursor-pointer flex-1 min-w-0">
              <input
                type="checkbox"
                checked={advancedEnabled}
                onChange={e => setAdvancedEnabled(e.target.checked)}
                className="w-4 h-4 rounded flex-shrink-0"
                style={{ accentColor: 'var(--theme-accent-primary)' }}
                data-testid="layout-advanced-mode-checkbox"
              />
              <span className="text-sm font-medium truncate">
                {t('layout.advancedMode.label')}
              </span>
            </label>
            <button
              type="button"
              onClick={() => {
                setIsOpen(false);
                window.dispatchEvent(new CustomEvent('command:app:openPreferences'));
              }}
              className="flex-shrink-0 w-5 h-5 rounded-full border border-border text-text-secondary hover:bg-background-hover transition-colors flex items-center justify-center text-xs font-semibold"
              title={t('layout.advancedMode.helpTooltip')}
              aria-label={t('layout.advancedMode.helpAria')}
              data-testid="layout-advanced-mode-help"
            >
              ?
            </button>
          </div>
        </div>
      )}
    </div>
  );
};

export default LayoutDropdown;
