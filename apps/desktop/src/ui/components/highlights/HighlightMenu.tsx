import React, { useState } from 'react';
import { createPortal } from 'react-dom';
import { HighlightColor, UnderlineStyle, MarkupType } from '@bible/core';
import { useI18n } from '../../contexts/useI18n';
import { useFocusTrap } from '../../hooks/useFocusTrap';
import { onRadioGroupKeyDown } from '../../utils/radioGroupKeys';
import { UnderlineSwatch } from './UnderlineSwatch';
import PointerMenu from '../shared/PointerMenu';

interface HighlightMenuProps {
  position: { x: number; y: number };
  onSelectHighlight: (
    color: HighlightColor,
    markupType: MarkupType,
    underlineStyle?: UnderlineStyle,
    underlineColor?: HighlightColor
  ) => void;
  onCancel: () => void;
}

export const HighlightMenu: React.FC<HighlightMenuProps> = ({
  position,
  onSelectHighlight,
  onCancel
}) => {
  const { t } = useI18n();
  const [selectedMarkupType, setSelectedMarkupType] = useState<MarkupType>('highlight');
  const [selectedUnderlineStyle, setSelectedUnderlineStyle] = useState<UnderlineStyle>('solid');
  const [selectedUnderlineColor, setSelectedUnderlineColor] = useState<HighlightColor>('yellow');
  // 'both' needs the highlight colour AND the underline choices before anything is applied.
  const [selectedHighlightColor, setSelectedHighlightColor] = useState<HighlightColor>('yellow');
  const trapRef = useFocusTrap<HTMLDivElement>(true);

  const colors: HighlightColor[] = ['yellow', 'green', 'blue', 'red', 'purple', 'orange'];
  const underlineStyles: UnderlineStyle[] = ['solid', 'wavy', 'dotted', 'dashed'];

  const handleColorSelect = (color: HighlightColor) => {
    if (selectedMarkupType === 'both') {
      setSelectedHighlightColor(color);
      return;
    }
    onSelectHighlight(
      color,
      selectedMarkupType,
      selectedMarkupType !== 'highlight' ? selectedUnderlineStyle : undefined,
      selectedMarkupType !== 'highlight' ? selectedUnderlineColor : undefined
    );
  };

  const colorName = (color: HighlightColor) =>
    t(`highlightMenu.color.${color}`);
  const styleName = (style: UnderlineStyle) =>
    t(`highlightMenu.style.${style}`);

  const markupOptions: Array<{ type: MarkupType; label: string }> = [
    { type: 'highlight', label: t('highlightMenu.markupHighlight') },
    { type: 'underline', label: t('highlightMenu.markupUnderline') },
    { type: 'both', label: t('highlightMenu.markupBoth') },
  ];

  /*
    Portalled to `<body>`: dockview's root sets `contain: layout`, which makes
    it the containing block for `position: fixed` descendants, so both this
    menu and its full-screen backdrop were laid out against the pane rather
    than the window - the menu opened offset from the cursor and the backdrop
    covered only part of the app. Same root cause as VerseContextMenu.
  */
  const menu = (
    <>
      {/* Backdrop to capture outside clicks */}
      <div
        className="fixed inset-0 z-40"
        aria-hidden="true"
        onClick={onCancel}
      />

      {/* Menu */}
      <PointerMenu
        ref={trapRef}
        x={position.x}
        y={position.y}
        estimatedWidth={280}
        edgePadding={16}
        zIndex={50}
        role="dialog"
        aria-modal="true"
        aria-label={t('highlightMenu.label')}
        className="bg-surface-elevated rounded-lg shadow-lg p-4 border border-border-secondary"
        onKeyDown={(e) => {
          if (e.key === 'Escape') {
            e.stopPropagation();
            onCancel();
          }
        }}
      >
        {/* Markup Type Selection */}
        <div className="mb-4">
          <div id="markup-type-heading" className="text-sm font-semibold mb-2 text-text-primary">
            {t('highlightMenu.markupTypeHeading')}
          </div>
          {/*
            These three are mutually exclusive, so they are radios rather than
            three independent toggles - the difference is audible.
          */}
          <div className="flex gap-2" role="radiogroup" aria-labelledby="markup-type-heading" onKeyDown={onRadioGroupKeyDown}>
            {markupOptions.map(({ type, label }) => (
              <button
                key={type}
                type="button"
                role="radio"
                aria-checked={selectedMarkupType === type}
                tabIndex={selectedMarkupType === type ? 0 : -1}
                className={`px-3 py-1 text-sm rounded cursor-pointer ${
                  selectedMarkupType === type
                    ? 'bg-accent text-text-on-accent'
                    : 'bg-control text-text-primary'
                }`}
                onClick={() => setSelectedMarkupType(type)}
              >
                {label}
              </button>
            ))}
          </div>
        </div>

        {/* Color Selection */}
        {selectedMarkupType !== 'underline' && (
          <div className="mb-4">
            <div id="highlight-color-heading" className="text-sm font-semibold mb-2 text-text-primary">
              {selectedMarkupType === 'both'
                ? t('highlightMenu.highlightColorHeading')
                : t('highlightMenu.colorHeading')}
            </div>
            <div className="grid grid-cols-3 gap-2" role="group" aria-labelledby="highlight-color-heading">
              {colors.map(color => (
                <button
                  key={color}
                  type="button"
                  className={`w-12 h-12 rounded border-2 highlight-${color} hover:border-accent transition-colors cursor-pointer`}
                  style={{
                    borderColor: selectedMarkupType === 'both' && selectedHighlightColor === color
                      ? 'var(--theme-accent-primary)'
                      : 'var(--theme-border-secondary)'
                  }}
                  onClick={() => handleColorSelect(color)}
                  {...(selectedMarkupType === 'both' ? { 'aria-pressed': selectedHighlightColor === color } : {})}
                  /* The swatch carries no text - colour alone is not a name. */
                  title={colorName(color)}
                  aria-label={t('highlightMenu.applyHighlightColor', { color: colorName(color), })}
                />
              ))}
            </div>
          </div>
        )}

        {/* Underline Style (shown when underline or both is selected) */}
        {(selectedMarkupType === 'underline' || selectedMarkupType === 'both') && (
          <>
            <div className="mb-4 pt-4 border-t border-border-secondary">
              <div id="underline-style-heading" className="text-sm font-semibold mb-2 text-text-primary">
                {t('highlightMenu.underlineStyleHeading')}
              </div>
              <div className="flex gap-2" role="radiogroup" aria-labelledby="underline-style-heading" onKeyDown={onRadioGroupKeyDown}>
                {underlineStyles.map(style => (
                  <button
                    key={style}
                    type="button"
                    role="radio"
                    aria-checked={selectedUnderlineStyle === style}
                    tabIndex={selectedUnderlineStyle === style ? 0 : -1}
                    className={`px-3 py-1 text-sm rounded cursor-pointer ${
                      selectedUnderlineStyle === style
                        ? 'bg-accent text-text-on-accent'
                        : 'bg-control text-text-primary'
                    }`}
                    onClick={() => setSelectedUnderlineStyle(style)}
                  >
                    {styleName(style)}
                  </button>
                ))}
              </div>
            </div>

            {/* Underline Color (shown when underline or both is selected) */}
            <div className="mb-0 pt-4 border-t border-border-secondary">
              <div id="underline-color-heading" className="text-sm font-semibold mb-2 text-text-primary">
                {t('highlightMenu.underlineColorHeading')}
              </div>
              <div className="grid grid-cols-3 gap-2" role="radiogroup" aria-labelledby="underline-color-heading" onKeyDown={onRadioGroupKeyDown}>
                {colors.map(color => (
                  <button
                    key={`underline-${color}`}
                    type="button"
                    role="radio"
                    aria-checked={selectedUnderlineColor === color}
                    tabIndex={selectedUnderlineColor === color ? 0 : -1}
                    className={`w-10 h-10 rounded border-2 flex items-center justify-center cursor-pointer ${
                      selectedUnderlineColor === color
                        ? 'border-accent'
                        : 'border-border-secondary'
                    } hover:border-accent transition-colors`}
                    onClick={() => setSelectedUnderlineColor(color)}
                    title={t('highlightMenu.underlineInColor', { color: colorName(color), })}
                    aria-label={t('highlightMenu.underlineInColor', { color: colorName(color), })}
                  >
                    {/* A bold line in this swatch's colour, in the style
                        chosen above - no sample glyph. See UnderlineSwatch. */}
                    <UnderlineSwatch style={selectedUnderlineStyle} color={color} />
                  </button>
                ))}
              </div>
            </div>
          </>
        )}

        {/* Apply button: underline-only and both need an explicit apply (pinned so it is never scrolled out of reach). */}
        {selectedMarkupType !== 'highlight' && (
          <div className="sticky bottom-0 -mb-4 mt-4 pt-4 pb-4 border-t border-border-secondary bg-surface-elevated">
            <button
              type="button"
              className="w-full px-4 py-2 text-sm font-medium text-text-on-accent bg-accent rounded hover:bg-accent-hover transition-colors cursor-pointer"
              onClick={() => onSelectHighlight(
                selectedMarkupType === 'both' ? selectedHighlightColor : selectedUnderlineColor,
                selectedMarkupType,
                selectedUnderlineStyle,
                selectedUnderlineColor
              )}
            >
              {selectedMarkupType === 'both' ? t('highlightMenu.apply') : t('highlightMenu.applyUnderline')}
            </button>
          </div>
        )}
      </PointerMenu>
    </>
  );

  return typeof document === 'undefined' ? menu : createPortal(menu, document.body);
};
