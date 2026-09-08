import React, { useMemo } from 'react';
import { UserTextMarkup, markupColorName } from '@bible/core';
import { useHighlightStore } from '../../stores/useHighlightStore';
import { extractWordsWithFormatting } from '../../utils/wordIndexing';
import { sanitizeHtml } from '../../utils/sanitize';

// Constant empty array to prevent unnecessary re-renders
const EMPTY_HIGHLIGHTS: UserTextMarkup[] = [];

/**
 * Everything a single `<span class="word">` needs in order to be painted.
 *
 * Produced by {@link highlightAttrsForWord} and consumed by both renderers:
 * the HTML-string path below (Standard/Reading/Study plain text) and the JSX
 * path in `study/InterlinearDisplay.tsx`. There is deliberately one resolver -
 * a second, diverging copy of this class/style logic is exactly how Study mode
 * ended up unhighlightable in the first place.
 */
export interface WordRenderAttrs {
  /** Space-joined class list; always starts with `word`. */
  className: string;
  /**
   * Colours the stylesheet cannot express, plus the decoration properties that
   * have to be re-stated when a highlight and an underline land on the same
   * word. Undefined when the word needs no inline style at all.
   */
  style?: React.CSSProperties;
  /** Comma-joined markup ids, or undefined when the word carries no markup. */
  markupIds?: string;
  /**
   * True when this word's trailing space belongs *inside* the span, because
   * the same markup continues onto the next word (KAN-10: a continuous wash
   * across a phrase rather than a striped one).
   */
  spaceInsideSpan: boolean;
}

/** Options describing the word itself, independent of any markup on it. */
export interface WordRenderContext {
  /** Word is inside a `<span class="christ-words">` (red-letter). */
  isChristWords: boolean;
  /** Word is inside a `<span class="divine-name">` (small caps). */
  isDivineName?: boolean;
  /** Source text had whitespace after this word. */
  hasTrailingSpace: boolean;
  /**
   * Index of the word that visually follows this one, or null when this is the
   * last word of its run. Used only to decide `spaceInsideSpan`; the interlinear
   * renderer passes null at cell boundaries because a wash cannot meaningfully
   * bridge two stacked columns.
   */
  nextWordIndex: number | null;
}

/**
 * Resolve the classes, inline styles and markup ids for one word.
 *
 * @param verseId Verse being rendered
 * @param wordIndex 0-based index into the verse's English word sequence
 * @param highlights Markup already filtered to this verse
 * @param context Formatting facts about the word itself
 */
export function highlightAttrsForWord(
  verseId: number,
  wordIndex: number,
  highlights: UserTextMarkup[],
  context: WordRenderContext
): WordRenderAttrs {
  const classes: string[] = ['word'];
  if (context.isChristWords) classes.push('christ-words');
  if (context.isDivineName) classes.push('divine-name');

  const wordHighlights = findHighlightsForWord(wordIndex, verseId, highlights);

  if (wordHighlights.length === 0) {
    return { className: classes.join(' '), spaceInsideSpan: false };
  }

  classes.push('highlighted');

  const markupIds: number[] = [];

  // Track resolved styles across all markups for the inline style fallback.
  // `highlight.color` is canonical hex `#RRGGBB` for anything written
  // since Module Format v2, while highlights.css is keyed by the six palette
  // *names* (`.highlight-yellow`). Class names therefore come from
  // getColorName()/markupColorName(), and a colour outside the palette -
  // which has no rule to key off at all - is painted inline instead.
  let resolvedBgHex: string | null = null;
  let resolvedBgName: string | undefined;
  let resolvedUnderlineStyle: string | null = null;
  let resolvedUnderlineHex: string | null = null;
  let resolvedUnderlineName: string | undefined;

  // Apply styles from all highlights (allowing highlight color + underline to coexist)
  for (const highlight of wordHighlights) {
    if (highlight.markupId != null) markupIds.push(highlight.markupId);

    if (highlight.hasHighlight()) {
      resolvedBgName = highlight.getColorName();
      resolvedBgHex = highlight.getColorHex();
      if (resolvedBgName) classes.push(`highlight-${resolvedBgName}`);
    }

    if (highlight.hasUnderline()) {
      resolvedUnderlineStyle = highlight.getUnderlineStyle();
      resolvedUnderlineHex = highlight.getUnderlineColor();
      resolvedUnderlineName = markupColorName(resolvedUnderlineHex);
      classes.push(`underline-${resolvedUnderlineStyle}`);
      if (resolvedUnderlineName) classes.push(`underline-color-${resolvedUnderlineName}`);
    }
  }

  const style: React.CSSProperties = {};
  let hasStyle = false;

  // Custom colours have no stylesheet rule, so they only exist inline.
  if (resolvedBgHex && !resolvedBgName) {
    style.backgroundColor = resolvedBgHex;
    hasStyle = true;
  }
  if (resolvedUnderlineHex && !resolvedUnderlineName) {
    style.textDecorationColor = resolvedUnderlineHex;
    hasStyle = true;
  }

  // Highlight + underline on the same word: guarantee the decoration survives
  // the background wash. The palette colours themselves stay on the classes so
  // they remain theme-aware.
  if (resolvedBgHex && resolvedUnderlineStyle) {
    style.textDecorationLine = 'underline';
    style.textDecorationStyle = resolvedUnderlineStyle as React.CSSProperties['textDecorationStyle'];
    style.textDecorationThickness = '2px';
    style.textDecorationSkipInk = 'none';
    hasStyle = true;
  }

  // KAN-10: include the trailing space inside the span when the NEXT word
  // carries one of the same markups, so the wash reads as one continuous
  // phrase and still stops at the phrase's end.
  let spaceInsideSpan = false;
  if (context.hasTrailingSpace && context.nextWordIndex !== null) {
    const nextWordHighlights = findHighlightsForWord(context.nextWordIndex, verseId, highlights);
    spaceInsideSpan = wordHighlights.some(h =>
      nextWordHighlights.some(nh => nh.markupId === h.markupId)
    );
  }

  return {
    className: classes.join(' '),
    style: hasStyle ? style : undefined,
    markupIds: markupIds.join(','),
    spaceInsideSpan,
  };
}

/**
 * Serialise {@link WordRenderAttrs.style} back to a CSS declaration string for
 * the HTML-string renderer. Only the camelCase properties this module actually
 * sets are handled; anything else would be a programming error here.
 */
function styleToCssText(style: React.CSSProperties): string {
  return Object.entries(style)
    .map(([property, value]) => `${property.replace(/[A-Z]/g, c => `-${c.toLowerCase()}`)}:${String(value)}`)
    .join(';');
}

/**
 * Apply highlights to verse HTML
 *
 * @param verseId - Verse ID being rendered
 * @param verseHTML - Original HTML content of verse
 * @param highlights - Array of highlights that may apply to this verse
 * @returns HTML string with highlight markup applied
 */
export function applyHighlightsToVerse(
  verseId: number,
  verseHTML: string,
  highlights: UserTextMarkup[]
): string {
  // Extract words with formatting metadata (including christ-words)
  const wordsInfo = extractWordsWithFormatting(verseHTML);

  // Filter highlights that affect this verse
  const applicableHighlights = highlights.filter(h => h.coversVerse(verseId));

  // Render each word with appropriate highlight and formatting classes
  const renderedWords = wordsInfo.map((wordInfo, index) => {
    const attrs = highlightAttrsForWord(verseId, index, applicableHighlights, {
      isChristWords: wordInfo.isChristWords,
      // isDivineName has to be forwarded for the same reason isChristWords
      // does: this path does NOT re-emit the incoming HTML, it rebuilds the
      // verse from flattened words, so the source `<span class="divine-name">`
      // wrapper is gone by the time these spans are written. Without the class
      // here, the Tetragrammaton's small-caps treatment is silently dropped in
      // every mode that renders through HighlightedVerse - which is all of
      // them: Standard, Reading, and Study.
      isDivineName: wordInfo.isDivineName,
      hasTrailingSpace: wordInfo.hasTrailingSpace,
      nextWordIndex: index + 1 < wordsInfo.length ? index + 1 : null,
    });

    // Use displayText (includes punctuation) for rendering, not text (clean for indexing)
    const wordContent = wordInfo.displayText;
    const styleAttr = attrs.style ? ` style="${styleToCssText(attrs.style)}"` : '';

    if (attrs.markupIds === undefined) {
      // No highlight - plain word (but may still have christ-words class)
      const trailingSpace = wordInfo.hasTrailingSpace ? ' ' : '';
      return `<span class="${attrs.className}" data-word-index="${index}">${wordContent}</span>${trailingSpace}`;
    }

    if (attrs.spaceInsideSpan) {
      // Include space inside span for continuous highlight
      return `<span class="${attrs.className}" data-word-index="${index}" data-markup-id="${attrs.markupIds}"${styleAttr}>${wordContent} </span>`;
    }

    // Last word in highlight range or no trailing space - keep space outside
    const trailingSpace = wordInfo.hasTrailingSpace ? ' ' : '';
    return `<span class="${attrs.className}" data-word-index="${index}" data-markup-id="${attrs.markupIds}"${styleAttr}>${wordContent}</span>${trailingSpace}`;
  });

  // Join words without additional spaces (spaces are now included appropriately)
  return renderedWords.join('');
}

/**
 * Find ALL highlights that cover a specific word index in a verse
 * This allows combining multiple highlights (e.g., highlight color + underline)
 *
 * @param wordIndex - Word index (0-based)
 * @param verseId - Verse ID
 * @param highlights - Array of highlights
 * @returns Array of highlights that cover this word
 */
function findHighlightsForWord(
  wordIndex: number,
  verseId: number,
  highlights: UserTextMarkup[]
): UserTextMarkup[] {
  const matchingHighlights: UserTextMarkup[] = [];

  for (const highlight of highlights) {
    const range = highlight.getWordRangeForVerse(verseId);

    if (!range) continue;

    const start = range.start ?? 0;
    const end = range.end ?? Infinity;

    const afterStart = wordIndex >= start;
    const beforeEnd = end === null || wordIndex <= end;
    if (afterStart && beforeEnd) {
      matchingHighlights.push(highlight);
    }
  }

  return matchingHighlights;
}

/**
 * Determine if a verse is highlighted and get word range
 *
 * @param verseId - Verse ID to check
 * @param highlight - Highlight object
 * @returns Object with highlighted flag and word range (if applicable)
 */
export function getVerseHighlightInfo(
  verseId: number,
  highlight: UserTextMarkup
): { highlighted: boolean; wordStart?: number; wordEnd?: number | null } {
  const start = highlight.verseIdStart;
  const end = highlight.verseIdEnd || start;

  // Check if verse is in range
  if (verseId < start || verseId > end) {
    return { highlighted: false };
  }

  // Single verse or first & last are same
  if (start === end) {
    return {
      highlighted: true,
      wordStart: highlight.textStart ?? 0,
      wordEnd: highlight.textEnd ?? null
    };
  }

  // First verse
  if (verseId === start) {
    return {
      highlighted: true,
      wordStart: highlight.textStart ?? 0,
      wordEnd: null  // To end of verse
    };
  }

  // Last verse
  if (verseId === end) {
    return {
      highlighted: true,
      wordStart: 0,
      wordEnd: highlight.textEnd ?? null
    };
  }

  // Middle verse (fully highlighted)
  return {
    highlighted: true,
    wordStart: 0,
    wordEnd: null  // Entire verse
  };
}

interface HighlightedVerseProps {
  verseId: number;
  verseHTML: string;
  moduleId: number;
  /** Optional React node to render inline at the end of the verse text */
  suffix?: React.ReactNode;
  onWordMouseDown?: (verseId: number, wordIndex: number, event: React.MouseEvent) => void;
  onWordMouseMove?: (verseId: number, wordIndex: number, event: React.MouseEvent) => void;
  onWordMouseUp?: (verseId: number, wordIndex: number, event: React.MouseEvent) => void;
}

/**
 * Renders a verse with highlights applied
 */
export const HighlightedVerse: React.FC<HighlightedVerseProps> = ({
  verseId,
  verseHTML,
  moduleId,
  suffix,
  onWordMouseDown,
  onWordMouseMove,
  onWordMouseUp
}) => {
  // Get all highlights for this module (stable reference from Map)
  const moduleHighlights = useHighlightStore(state =>
    state.highlightsByModule.get(moduleId) || EMPTY_HIGHLIGHTS
  );

  // Filter to only highlights for this verse (memoized to prevent infinite loops)
  const highlights = useMemo(
    () => moduleHighlights.filter(h => h.coversVerse(verseId)),
    [moduleHighlights, verseId]
  );

  // Apply highlights to HTML (memoized)
  const renderedHTML = useMemo(
    () => applyHighlightsToVerse(verseId, verseHTML, highlights),
    [verseId, verseHTML, highlights]
  );

  // Handle mouse events on words
  const handleMouseEvent = (
    eventType: 'down' | 'move' | 'up',
    event: React.MouseEvent
  ) => {
    const target = event.target as HTMLElement;

    // Find word element
    if (!target.classList.contains('word')) return;

    const wordIndex = parseInt(target.getAttribute('data-word-index') || '0', 10);

    if (eventType === 'down' && onWordMouseDown) {
      onWordMouseDown(verseId, wordIndex, event);
    } else if (eventType === 'move' && onWordMouseMove) {
      onWordMouseMove(verseId, wordIndex, event);
    } else if (eventType === 'up' && onWordMouseUp) {
      onWordMouseUp(verseId, wordIndex, event);
    }
  };

  return (
    <span
      className="verse-content"
      data-verse-id={verseId}
      onMouseDown={(e) => handleMouseEvent('down', e)}
      onMouseMove={(e) => handleMouseEvent('move', e)}
      onMouseUp={(e) => handleMouseEvent('up', e)}
    >
      <span dangerouslySetInnerHTML={{ __html: sanitizeHtml(renderedHTML) }} />
      {suffix}
    </span>
  );
};
