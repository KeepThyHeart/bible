import React, { useRef, useLayoutEffect, useState, useCallback, useEffect } from 'react';
import { createPortal } from 'react-dom';
import { HighlightColor, UnderlineStyle } from '@bible/core';
import { useI18n } from '../../contexts/useI18n';
import { useHighlightStore } from '../../stores/useHighlightStore';
import { markupStyleKey, type MarkupStyle } from '../../services/recentMarkupStyles';

interface SelectionState {
  startVerseId: number;
  startWordIndex: number;
  endVerseId?: number;
  endWordIndex?: number;
}

interface FloatingAnnotationToolbarProps {
  /** Callback when user clicks a highlight color swatch */
  onHighlight: (color: HighlightColor) => void;
  /** Callback when user clicks underline toggle */
  onUnderline: () => void;
  /** Callback when user clicks remove formatting */
  onRemoveFormatting: () => void;
  /** Callback when toolbar should be dismissed */
  onDismiss: () => void;
  /**
   * Escalate to the full highlight menu for this same selection. Given the
   * toolbar's own viewport position, so the menu opens where the toolbar was.
   */
  onMore: (position: { x: number; y: number }) => void;
  /** Re-apply a remembered style from the "Recent" row, in one click. */
  onApplyStyle: (style: MarkupStyle) => void;
  /** The current text selection state (word indices and verse IDs) */
  selection: SelectionState;
  /** Whether the selected text already has a highlight/underline (to show remove button) */
  hasExistingMarkup?: boolean;
}

/** Quick-access highlight colors for the floating toolbar */
const TOOLBAR_COLORS: { color: HighlightColor; labelKey: string; cssClass: string }[] = [
  { color: 'yellow', labelKey: 'ui.floatingAnnotation.highlightYellow', cssClass: 'highlight-yellow' },
  { color: 'blue', labelKey: 'ui.floatingAnnotation.highlightBlue', cssClass: 'highlight-blue' },
  { color: 'green', labelKey: 'ui.floatingAnnotation.highlightGreen', cssClass: 'highlight-green' },
  { color: 'red', labelKey: 'ui.floatingAnnotation.highlightPink', cssClass: 'highlight-red' },
];

/**
 * Classes that make a sample of text look like the style will look once
 * applied - the same classes `HighlightRenderer` puts on a real word, so the
 * preview cannot drift from what a click produces.
 *
 * A colour swatch alone cannot distinguish "red highlight" from "wavy red
 * underline", which is exactly the distinction the Recent row exists to keep.
 */
function previewClassName(style: MarkupStyle): string {
  const classes = ['word'];
  if (style.markupType !== 'underline') classes.push(`highlight-${style.color}`);
  if (style.markupType !== 'highlight') {
    const underlineStyle: UnderlineStyle = style.underlineStyle ?? 'solid';
    classes.push(`underline-${underlineStyle}`);
    classes.push(`underline-color-${style.underlineColor ?? style.color}`);
  }
  return classes.join(' ');
}

/**
 * Floating annotation toolbar that appears near text selection.
 *
 * Shows color swatches for quick highlight, an underline toggle, and a remove
 * formatting button.
 *
 * **It is portalled to `<body>`, and that is load-bearing.** dockview's root
 * (`.dv-dockview`) sets `contain: layout`, which makes it the containing block
 * for every `position: fixed` descendant. Rendered in place, the toolbar's
 * viewport coordinates were therefore measured against the viewport but
 * *applied* relative to the dockview root, so it landed lower and further right
 * than computed by exactly the dockview root's offset - which, for a toolbar
 * asked to sit one toolbar-height above the selection, put it straight on top
 * of the text it was pointing at.
 */
export const FloatingAnnotationToolbar: React.FC<FloatingAnnotationToolbarProps> = ({
  onHighlight,
  onUnderline,
  onRemoveFormatting,
  onDismiss,
  onMore,
  onApplyStyle,
  selection: _selection,
  hasExistingMarkup = false,
}) => {
  const { t } = useI18n();
  // Suppress unused variable warning for selection (kept in API for future use)
  void _selection;

  /*
    Read from the store rather than taken as props. The toolbar's props all
    arrive from BiblePane by way of BiblePaneOverlays, and the recents are not
    that pane's concern - they are one preference shared by every Bible panel
    and every detached window in this renderer.
  */
  const recentStyles = useHighlightStore(state => state.recentMarkupStyles);
  const clearRecentStyles = useHighlightStore(state => state.clearRecentMarkupStyles);

  const toolbarRef = useRef<HTMLDivElement>(null);
  const [position, setPosition] = useState<{ top: number; left: number }>({ top: 0, left: 0 });
  const [visible, setVisible] = useState(false);

  /**
   * Place the toolbar against the selection without covering it.
   *
   * Below by preference, flipping above only when there is no room below - the
   * text just selected is what the reader is looking at, and a toolbar sitting
   * on the line above is the thing most likely to hide the start of it.
   *
   * Alignment is to the selection's *leading edge*, not its centre. A centred
   * toolbar is wider than most phrase selections, so it overhung the left of
   * the selection and, near the left edge of a pane, of the passage itself.
   *
   * The first and last client rects are used rather than the bounding box: a
   * selection that wraps has a bounding box as wide as the paragraph, whose
   * left edge belongs to no line the user actually selected.
   */
  useLayoutEffect(() => {
    const selection = window.getSelection();
    if (!selection || selection.rangeCount === 0 || selection.isCollapsed) {
      onDismiss();
      return;
    }

    const toolbar = toolbarRef.current;
    if (!toolbar) return;

    const range = selection.getRangeAt(0);
    const bounding = range.getBoundingClientRect();
    // jsdom (and only jsdom) can be missing Range layout methods entirely.
    const rects = typeof range.getClientRects === 'function'
      ? Array.from(range.getClientRects()).filter(r => r.width > 0 && r.height > 0)
      : [];
    const firstLine = rects[0] ?? bounding;
    const lastLine = rects[rects.length - 1] ?? bounding;

    const toolbarRect = toolbar.getBoundingClientRect();
    const padding = 8;
    const gap = 8; // clear air between the toolbar and the selected text

    const below = lastLine.bottom + gap;
    const above = firstLine.top - toolbarRect.height - gap;

    // Below unless it would fall off the bottom AND there is room above.
    const fitsBelow = below + toolbarRect.height <= window.innerHeight - padding;
    const fitsAbove = above >= padding;
    const anchor = fitsBelow || !fitsAbove ? lastLine : firstLine;
    let top = fitsBelow || !fitsAbove ? below : above;

    // Neither fits (a selection taller than the viewport): clamp, and accept
    // that it overlaps rather than leaving it off-screen.
    top = Math.max(padding, Math.min(top, window.innerHeight - toolbarRect.height - padding));

    let left = anchor.left;
    left = Math.max(padding, Math.min(left, window.innerWidth - toolbarRect.width - padding));

    setPosition({ top, left });
    setVisible(true);
  }, [onDismiss]);

  /**
   * Dismiss on Escape key press.
   */
  const handleKeyDown = useCallback((e: KeyboardEvent) => {
    if (e.key === 'Escape') {
      onDismiss();
    }
  }, [onDismiss]);

  /**
   * Dismiss when clicking outside the toolbar.
   */
  const handleClickOutside = useCallback((e: MouseEvent) => {
    if (toolbarRef.current && !toolbarRef.current.contains(e.target as Node)) {
      onDismiss();
    }
  }, [onDismiss]);

  /**
   * Dismiss when selection changes to empty.
   */
  const handleSelectionChange = useCallback(() => {
    const selection = window.getSelection();
    if (!selection || selection.isCollapsed) {
      onDismiss();
    }
  }, [onDismiss]);

  useEffect(() => {
    document.addEventListener('keydown', handleKeyDown);
    // Use mousedown so we catch clicks that will clear the selection
    document.addEventListener('mousedown', handleClickOutside);
    document.addEventListener('selectionchange', handleSelectionChange);

    return () => {
      document.removeEventListener('keydown', handleKeyDown);
      document.removeEventListener('mousedown', handleClickOutside);
      document.removeEventListener('selectionchange', handleSelectionChange);
    };
  }, [handleKeyDown, handleClickOutside, handleSelectionChange]);

  const colorName = (color: HighlightColor): string => t(`highlightMenu.color.${color}`);
  const styleName = (style: UnderlineStyle): string => t(`highlightMenu.style.${style}`);

  /** Spoken description of a remembered style - the swatch itself has no text. */
  const recentLabel = (style: MarkupStyle): string => {
    const underline = styleName(style.underlineStyle ?? 'solid');
    if (style.markupType === 'highlight') {
      return t('ui.floatingAnnotation.applyRecentHighlight', { color: colorName(style.color) });
    }
    if (style.markupType === 'underline') {
      return t('ui.floatingAnnotation.applyRecentUnderline', {
        style: underline,
        color: colorName(style.underlineColor ?? style.color),
      });
    }
    return t('ui.floatingAnnotation.applyRecentBoth', {
      color: colorName(style.color),
      style: underline,
      underlineColor: colorName(style.underlineColor ?? style.color),
    });
  };

  const toolbar = (
    <div
      ref={toolbarRef}
      className="floating-annotation-toolbar"
      style={{
        position: 'fixed',
        top: `${position.top}px`,
        left: `${position.left}px`,
        zIndex: 10000,
        opacity: visible ? 1 : 0,
        pointerEvents: visible ? 'auto' : 'none',
        transition: 'opacity 0.08s ease-in',
      }}
      // Prevent toolbar clicks from clearing selection
      onMouseDown={(e) => e.preventDefault()}
    >
      <div className="floating-toolbar-row">
        {/* Highlight color swatches */}
        <div className="floating-toolbar-section">
          {TOOLBAR_COLORS.map(({ color, labelKey, cssClass }) => (
            <button
              key={color}
              className={`floating-toolbar-swatch ${cssClass}`}
              onClick={() => onHighlight(color)}
              title={t(labelKey)}
              aria-label={t(labelKey)}
            />
          ))}
        </div>

        {/* Separator */}
        <div className="floating-toolbar-separator" />

        {/* Underline toggle */}
        <button
          className="floating-toolbar-btn"
          onClick={onUnderline}
          title={t('ui.floatingAnnotation.toggleUnderlineShortcut')}
          aria-label={t('ui.floatingAnnotation.toggleUnderline')}
        >
          <svg className="w-4 h-4" viewBox="0 0 24 24" fill="currentColor">
            <path d="M12 17c3.31 0 6-2.69 6-6V3h-2.5v8c0 1.93-1.57 3.5-3.5 3.5S8.5 12.93 8.5 11V3H6v8c0 3.31 2.69 6 6 6zm-7 2v2h14v-2H5z"/>
          </svg>
        </button>

        {/* Remove formatting (only shown if text has existing markup) */}
        {hasExistingMarkup && (
          <>
            <div className="floating-toolbar-separator" />
            <button
              className="floating-toolbar-btn floating-toolbar-btn-remove"
              onClick={onRemoveFormatting}
              title={t('ui.floatingAnnotation.removeFormatting')}
              aria-label={t('ui.floatingAnnotation.removeFormatting')}
            >
              <svg className="w-4 h-4" viewBox="0 0 24 24" fill="currentColor">
                <path d="M3.27 5L2 6.27l6.97 6.97L6.5 19h3l1.57-3.66L16.73 21 18 19.73 3.27 5zM6 5v.18L8.82 8h2.4l-.72 1.68 2.1 2.1L14.21 8H20V5H6z"/>
              </svg>
            </button>
          </>
        )}

        {/*
          The escape hatch from four colours to all of them. The quick row is a
          guess at what most readers want; "More" hands the *same* selection to
          the full menu, where the other two colours, the markup type and the
          four underline styles live.
        */}
        <div className="floating-toolbar-separator" />
        <button
          className="floating-toolbar-btn"
          onClick={() => onMore({ x: position.left, y: position.top })}
          title={t('ui.floatingAnnotation.moreOptions')}
          aria-label={t('ui.floatingAnnotation.moreOptions')}
        >
          <svg className="w-4 h-4" viewBox="0 0 24 24" fill="currentColor">
            <path d="M6 10c-1.1 0-2 .9-2 2s.9 2 2 2 2-.9 2-2-.9-2-2-2zm12 0c-1.1 0-2 .9-2 2s.9 2 2 2 2-.9 2-2-.9-2-2-2zm-6 0c-1.1 0-2 .9-2 2s.9 2 2 2 2-.9 2-2-.9-2-2-2z"/>
          </svg>
        </button>
      </div>

      {/*
        Recently applied styles, most recent first. Absent until something has
        been applied - an empty row would just be a second band of chrome over
        the text the reader is looking at.
      */}
      {recentStyles.length > 0 && (
        <div
          className="floating-toolbar-row floating-toolbar-recent-row"
          role="group"
          aria-label={t('ui.floatingAnnotation.recentHeading')}
        >
          {recentStyles.map(style => (
            <button
              key={markupStyleKey(style)}
              type="button"
              className="floating-toolbar-recent"
              data-recent-style={markupStyleKey(style)}
              onClick={() => onApplyStyle(style)}
              title={recentLabel(style)}
              aria-label={recentLabel(style)}
            >
              <span aria-hidden="true" className={previewClassName(style)}>Aa</span>
            </button>
          ))}

          <div className="floating-toolbar-separator" />
          <button
            type="button"
            className="floating-toolbar-btn floating-toolbar-btn-clear-recent"
            onClick={clearRecentStyles}
            title={t('ui.floatingAnnotation.clearRecent')}
            aria-label={t('ui.floatingAnnotation.clearRecent')}
          >
            <svg className="w-4 h-4" viewBox="0 0 24 24" fill="currentColor">
              <path d="M19 6.41 17.59 5 12 10.59 6.41 5 5 6.41 10.59 12 5 17.59 6.41 19 12 13.41 17.59 19 19 17.59 13.41 12z"/>
            </svg>
          </button>
        </div>
      )}
    </div>
  );

  // See the component comment: rendered in place, `position: fixed` would be
  // resolved against dockview's `contain: layout` root instead of the viewport.
  return typeof document === 'undefined' ? toolbar : createPortal(toolbar, document.body);
};
