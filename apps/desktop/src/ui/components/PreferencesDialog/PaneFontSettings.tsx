/**
 * PaneFontSettings.tsx
 *
 * Collapsible per-pane font settings (family, size, line height,
 * red-letter toggle for Bible) with live preview. Extracted from
 * PreferencesDialog.tsx as part of the 2026-04-14 desktop cleanup
 * (item 2.1).
 */

import React from 'react';
import { useI18n } from '../../contexts/useI18n';
import {
  PaneType,
  AVAILABLE_FONTS,
  TextSettings,
  getFontFamilyCSS
} from '../../stores/useTextSettingsStore';

export interface PaneFontSettingsProps {
  paneType: PaneType;
  label: string;
  sampleText: string;
  settings: TextSettings;
  isExpanded: boolean;
  onToggle: () => void;
  onUpdate: (settings: Partial<TextSettings>) => void;
  onReset: () => void;
  globalFontScale: number;
}

export const PaneFontSettings: React.FC<PaneFontSettingsProps> = ({
  paneType,
  label,
  sampleText,
  settings,
  isExpanded,
  onToggle,
  onUpdate,
  onReset,
  globalFontScale
}) => {
  const { t } = useI18n();
  const effectiveFontSize = Math.round(settings.fontSize * globalFontScale);

  return (
    <div
      className="rounded-lg overflow-hidden"
      style={{
        border: '1px solid var(--theme-border-primary)',
        backgroundColor: isExpanded ? 'var(--theme-surface-secondary)' : 'transparent'
      }}
    >
      {/* Collapsible header */}
      <button
        type="button"
        onClick={onToggle}
        aria-expanded={isExpanded}
        aria-controls={`pane-font-panel-${paneType}`}
        className="w-full flex items-center justify-between px-4 py-3 text-sm font-medium transition-colors"
        style={{ color: 'var(--theme-text-primary)' }}
        onMouseEnter={(e) => {
          if (!isExpanded) {
            e.currentTarget.style.backgroundColor = 'var(--theme-bg-hover)';
          }
        }}
        onMouseLeave={(e) => {
          if (!isExpanded) {
            e.currentTarget.style.backgroundColor = 'transparent';
          }
        }}
      >
        <span className="flex items-center gap-2">
          <svg
            className={`w-4 h-4 transition-transform ${isExpanded ? 'rotate-90' : ''} rtl-mirror`}
            aria-hidden="true"
            focusable="false"
            fill="none"
            viewBox="0 0 24 24"
            stroke="currentColor"
            strokeWidth={2}
          >
            <path strokeLinecap="round" strokeLinejoin="round" d="m8.25 4.5 7.5 7.5-7.5 7.5" />
          </svg>
          {label}
        </span>
        <span
          className="text-xs"
          style={{ color: 'var(--theme-text-muted)' }}
        >
          {settings.fontFamily}, {settings.fontSize}px
        </span>
      </button>

      {/* Expanded content */}
      {isExpanded && (
        <div className="px-4 pb-4 space-y-4" id={`pane-font-panel-${paneType}`}>
          {/* Font Family */}
          <div>
            <label
              htmlFor={`pane-font-family-${paneType}`}
              className="block text-xs font-medium mb-1"
              style={{ color: 'var(--theme-text-secondary)' }}
            >
              {t('ui.preferences.fontFamilyLabel')}
            </label>
            <select
              id={`pane-font-family-${paneType}`}
              value={settings.fontFamily}
              onChange={(e) => onUpdate({ fontFamily: e.target.value })}
              className="w-full px-3 py-2 rounded text-sm focus:outline-none"
              style={{
                backgroundColor: 'var(--theme-input-bg)',
                border: '1px solid var(--theme-input-border)',
                color: 'var(--theme-input-text)'
              }}
            >
              {AVAILABLE_FONTS.map((font) => (
                <option key={font.name} value={font.name}>
                  {font.labelKey ? t(font.labelKey, { fontName: font.label }) : font.label}
                </option>
              ))}
            </select>
          </div>

          {/* Font Size */}
          <div>
            <label
              htmlFor={`pane-font-size-${paneType}`}
              className="block text-xs font-medium mb-1"
              style={{ color: 'var(--theme-text-secondary)' }}
            >
              {t('ui.preferences.fontSizeValue', { size: settings.fontSize, })}
              {globalFontScale !== 1 && (
                <span style={{ color: 'var(--theme-text-muted)' }}>
                  {' '}
                  {t(
                    'ui.preferences.effectiveFontSize',
                    { effective: effectiveFontSize, scale: Math.round(globalFontScale * 100), },
                  )}
                </span>
              )}
            </label>
            <div className="flex items-center gap-2">
              <span aria-hidden="true" className="text-xs" style={{ color: 'var(--theme-text-muted)' }}>14</span>
              <input
                id={`pane-font-size-${paneType}`}
                type="range"
                min="14"
                max="30"
                step="1"
                value={settings.fontSize}
                onChange={(e) => onUpdate({ fontSize: Number(e.target.value) })}
                className="flex-1 h-2 rounded-lg appearance-none cursor-pointer"
              />
              <span aria-hidden="true" className="text-xs" style={{ color: 'var(--theme-text-muted)' }}>30</span>
            </div>
          </div>

          {/* Line Height */}
          <div>
            <label
              htmlFor={`pane-line-height-${paneType}`}
              className="block text-xs font-medium mb-1"
              style={{ color: 'var(--theme-text-secondary)' }}
            >
              {t('ui.preferences.lineHeightValue', { value: settings.lineHeight.toFixed(2), })}
            </label>
            <div className="flex items-center gap-2">
              <span aria-hidden="true" className="text-xs" style={{ color: 'var(--theme-text-muted)' }}>{t('ui.preferences.lineHeightCompact')}</span>
              <input
                id={`pane-line-height-${paneType}`}
                type="range"
                min="1.3"
                max="2.0"
                step="0.05"
                value={settings.lineHeight}
                onChange={(e) => onUpdate({ lineHeight: Number(e.target.value) })}
                className="flex-1 h-2 rounded-lg appearance-none cursor-pointer"
              />
              <span aria-hidden="true" className="text-xs" style={{ color: 'var(--theme-text-muted)' }}>{t('ui.preferences.lineHeightSpacious')}</span>
            </div>
          </div>

          {/* Red Letter toggle (Bible pane only) */}
          {paneType === 'bible' && (
            <div>
              <label className="flex items-center gap-2 cursor-pointer">
                <input
                  type="checkbox"
                  checked={settings.showRedLetter ?? true}
                  onChange={(e) => onUpdate({ showRedLetter: e.target.checked })}
                  className="w-4 h-4 rounded"
                  style={{ accentColor: 'var(--theme-accent-primary)' }}
                />
                <span className="text-sm" style={{ color: 'var(--theme-text-primary)' }}>
                  {t('ui.preferences.showRedLetter')}
                </span>
              </label>
            </div>
          )}

          {/* Preview */}
          <div>
            {/* Not a <label>: the preview is a rendering, not a form control. */}
            <div
              id={`pane-font-preview-label-${paneType}`}
              className="block text-xs font-medium mb-1"
              style={{ color: 'var(--theme-text-secondary)' }}
            >
              {t('ui.preferences.previewLabel')}
            </div>
            <div
              role="group"
              aria-labelledby={`pane-font-preview-label-${paneType}`}
              className="rounded p-4"
              style={{
                fontFamily: getFontFamilyCSS(settings.fontFamily),
                fontSize: `${effectiveFontSize}px`,
                lineHeight: settings.lineHeight,
                backgroundColor: 'var(--theme-bg-primary)',
                color: 'var(--theme-text-primary)',
                border: '1px solid var(--theme-border-primary)'
              }}
            >
              {paneType === 'bible' && (settings.showRedLetter ?? true) ? (
                <span style={{ color: 'var(--theme-christ)' }}>{sampleText}</span>
              ) : (
                sampleText
              )}
            </div>
          </div>

          {/* Reset button */}
          <div className="flex justify-end">
            <button
              type="button"
              onClick={onReset}
              className="text-xs px-3 py-1.5 rounded transition-colors"
              style={{
                color: 'var(--theme-text-secondary)',
                border: '1px solid var(--theme-border-primary)'
              }}
              onMouseEnter={(e) => {
                e.currentTarget.style.backgroundColor = 'var(--theme-bg-hover)';
              }}
              onMouseLeave={(e) => {
                e.currentTarget.style.backgroundColor = 'transparent';
              }}
            >
              {t('preferencesDialog.resetToDefaults')}
            </button>
          </div>
        </div>
      )}
    </div>
  );
};
