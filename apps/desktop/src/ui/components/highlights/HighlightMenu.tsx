import React, { useState, useRef, useLayoutEffect } from 'react';
import { createPortal } from 'react-dom';
import { HighlightColor, UnderlineStyle, MarkupType } from '@bible/core';
import { useI18n } from '../../contexts/useI18n';
import { useFocusTrap } from '../../hooks/useFocusTrap';
import { UnderlineSwatch } from './UnderlineSwatch';

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
  const [adjustedPosition, setAdjustedPosition] = useState(position);
  const menuRef = useRef<HTMLDivElement>(null);
  // The menu needs the node for viewport clamping *and* for the focus trap, so
  // one callback ref feeds both.
  const trapRef = useFocusTrap<HTMLDivElement>(true);
  const mergeMenuRef = React.useCallback(
    (node: HTMLDivElement | null) => {
      (menuRef as React.MutableRefObject<HTMLDivElement | null>).current = node;
      (trapRef as React.MutableRefObject<HTMLDivElement | null>).current = node;
    },
    [trapRef],
  );

  const colors: HighlightColor[] = ['yellow', 'green', 'blue', 'red', 'purple', 'orange'];
  const underlineStyles: UnderlineStyle[] = ['solid', 'wavy', 'dotted', 'dashed'];

  // Adjust position after menu renders to ensure it stays on screen
  useLayoutEffect(() => {
    if (menuRef.current) {
      const menu = menuRef.current;
      const rect = menu.getBoundingClientRect();
      const viewportWidth = window.innerWidth;
      const viewportHeight = window.innerHeight;
      const padding = 16;

      let newX = position.x;
      let newY = position.y;

      // Adjust horizontal position if menu goes off right edge
      if (position.x + rect.width > viewportWidth - padding) {
        newX = Math.max(padding, viewportWidth - rect.width - padding);
      }

      // Adjust vertical position if menu goes off bottom edge
      if (position.y + rect.height > viewportHeight - padding) {
        // Position above the click point if there's more room above
        if (position.y > viewportHeight / 2) {
          newY = Math.max(padding, position.y - rect.height - 10);
        } else {
          newY = Math.max(padding, viewportHeight - rect.height - padding);
        }
      }

      if (newX !== position.x || newY !== position.y) {
        setAdjustedPosition({ x: newX, y: newY });
      }
    }
  }, [position, selectedMarkupType]); // Re-check when markup type changes since menu height varies

  const handleColorSelect = (color: HighlightColor) => {
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
      <div
        ref={mergeMenuRef}
        role="dialog"
        aria-modal="true"
        aria-label={t('highlightMenu.label')}
        className="fixed z-50 bg-surface-elevated rounded-lg shadow-lg p-4 border border-border-secondary"
        style={{
          left: `${adjustedPosition.x}px`,
          top: `${adjustedPosition.y}px`,
          maxHeight: 'calc(100vh - 32px)',
          overflowY: 'auto'
        }}
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
          <div className="flex gap-2" role="radiogroup" aria-labelledby="markup-type-heading">
            {markupOptions.map(({ type, label }) => (
              <button
                key={type}
                type="button"
                role="radio"
                aria-checked={selectedMarkupType === type}
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
                    borderColor: 'var(--theme-border-secondary)'
                  }}
                  onClick={() => handleColorSelect(color)}
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
              <div className="flex gap-2" role="radiogroup" aria-labelledby="underline-style-heading">
                {underlineStyles.map(style => (
                  <button
                    key={style}
                    type="button"
                    role="radio"
                    aria-checked={selectedUnderlineStyle === style}
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
              <div className="grid grid-cols-3 gap-2" role="radiogroup" aria-labelledby="underline-color-heading">
                {colors.map(color => (
                  <button
                    key={`underline-${color}`}
                    type="button"
                    role="radio"
                    aria-checked={selectedUnderlineColor === color}
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

        {/* Apply button for underline-only mode */}
        {selectedMarkupType === 'underline' && (
          <div className="mt-4 pt-4 border-t border-border-secondary">
            <button
              type="button"
              className="w-full px-4 py-2 text-sm font-medium text-text-on-accent bg-accent rounded hover:bg-accent-hover transition-colors cursor-pointer"
              onClick={() => onSelectHighlight(
                selectedUnderlineColor,
                'underline',
                selectedUnderlineStyle,
                selectedUnderlineColor
              )}
            >
              {t('highlightMenu.applyUnderline')}
            </button>
          </div>
        )}
      </div>
    </>
  );

  return typeof document === 'undefined' ? menu : createPortal(menu, document.body);
};
