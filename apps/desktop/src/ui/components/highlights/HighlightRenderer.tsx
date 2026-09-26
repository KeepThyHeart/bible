import React, { useMemo, useRef } from 'react';
import type { UserTextMarkup } from '@bible/core';
import {
  extractWordsWithFormatting,
  renderVerseWords,
  computeVerseFindState,
  type VerseFindState,
  type ResolvedHover,
} from '@bible/core/browser';
import { useHighlightStore } from '../../stores/useHighlightStore';
import { useFindStore } from '../../stores/useFindStore';
import { sanitizeHtml } from '../../utils/sanitize';
import { useResolvedVerseDecorations } from '../../extensions/useResolvedVerseDecorations';

/*
 * The pure half of this file (`wordRenderAttrs`, `renderVerseWords`,
 * `getVerseHighlightInfo`, ...) lives in `@bible/core/browser` (Annotations/
 * WordRendering.ts) so the web client can share it. What stays here is React:
 * the store-reading find hook and the `HighlightedVerse` component.
 */

// Constant empty array to prevent unnecessary re-renders
const EMPTY_HIGHLIGHTS: UserTextMarkup[] = [];

/**
 * Subscribe to `useFindStore` and compute this verse's own match state
 * (amendment A1). A plain `useMemo` over the store's matches array - cheap
 * for the typical case (a handful of matches), and it is what lets find
 * marks be ordinary render output instead of an imperative DOM pass.
 */
function useVerseFindState(verseId: number): VerseFindState | undefined {
  const isVisible = useFindStore((s) => s.isVisible);
  const matches = useFindStore((s) => s.matches);
  const currentMatchIndex = useFindStore((s) => s.currentMatchIndex);
  return useMemo(
    () => computeVerseFindState(verseId, isVisible, matches, currentMatchIndex),
    [isVisible, matches, currentMatchIndex, verseId],
  );
}

interface HighlightedVerseProps {
  verseId: number;
  verseHTML: string;
  moduleId: number;
  /** Optional React node to render inline at the end of the verse text */
  suffix?: React.ReactNode;
  /**
   * Which reading surface this is rendered on. `undefined` (Parallel view,
   * or any caller that hasn't opted in) means NO extension decorations -
   * amendment A1's `useResolvedVerseDecorations` returns `null` for an
   * undefined surface, which is the mechanism by which Parallel view stays
   * decoration-free without every other caller having to know it exists.
   */
  surface?: 'standard' | 'reading' | 'study';
  onWordMouseDown?: (verseId: number, wordIndex: number, event: React.MouseEvent) => void;
  onWordMouseMove?: (verseId: number, wordIndex: number, event: React.MouseEvent) => void;
  onWordMouseUp?: (verseId: number, wordIndex: number, event: React.MouseEvent) => void;
  /**
   * Fires once per word entered (task 0036, P0.1c; design doc §11.2) - wired
   * via `onMouseOver`/`onMouseOut` rather than `onMouseEnter`/`onMouseLeave`
   * (which don't bubble, so they can't use the same event-delegation pattern
   * as `onWordMouseDown`/`Move`/`Up`), with a guard so sweeping across a
   * word's own text nodes doesn't re-fire. Carries this word's already-
   * resolved static hover content (`WordPaint.hovers`), if any, so the
   * caller's hover trigger doesn't need to re-derive it.
   */
  onWordMouseEnter?: (
    verseId: number,
    wordIndex: number,
    wordText: string,
    hovers: ResolvedHover[] | undefined,
    event: React.MouseEvent,
  ) => void;
  onWordMouseLeave?: (verseId: number, wordIndex: number, event: React.MouseEvent) => void;
}

/**
 * Renders a verse with highlights, extension decorations and find-in-page
 * marks applied. Verse text never waits on any of them: the first render has
 * no decorations and no find state, and this component re-renders (from its
 * own store subscriptions) as soon as either arrives - it never blocks or
 * delays the initial paint (task 0036, P0.1a).
 */
export const HighlightedVerse: React.FC<HighlightedVerseProps> = ({
  verseId,
  verseHTML,
  moduleId,
  suffix,
  surface,
  onWordMouseDown,
  onWordMouseMove,
  onWordMouseUp,
  onWordMouseEnter,
  onWordMouseLeave
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

  // Extracted once and shared with the decoration resolver (amendment A1).
  const words = useMemo(() => extractWordsWithFormatting(verseHTML), [verseHTML]);

  const resolved = useResolvedVerseDecorations(verseId, moduleId, surface, words);
  const find = useVerseFindState(verseId);

  // Apply highlights to HTML (memoized)
  const renderedHTML = useMemo(
    () => renderVerseWords(verseId, words, highlights, resolved, find),
    [verseId, words, highlights, resolved, find]
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

  // Task 0036, P0.1c: word hover, via onMouseOver/onMouseOut (bubbling
  // delegation, unlike mouseenter/mouseleave) with a "did the word actually
  // change" guard - see the `onWordMouseEnter` doc comment above.
  const lastHoveredWordIndexRef = useRef<number | null>(null);

  const handleMouseOver = (event: React.MouseEvent) => {
    if (!onWordMouseEnter) return;
    const target = event.target as HTMLElement;
    if (!target.classList.contains('word')) return;
    const wordIndex = parseInt(target.getAttribute('data-word-index') || '0', 10);
    if (lastHoveredWordIndexRef.current === wordIndex) return;
    lastHoveredWordIndexRef.current = wordIndex;
    onWordMouseEnter(verseId, wordIndex, words[wordIndex]?.text ?? '', resolved?.words.get(wordIndex)?.hovers, event);
  };

  const handleMouseOut = (event: React.MouseEvent) => {
    const target = event.target as HTMLElement;
    if (!target.classList.contains('word')) return;
    const wordIndex = parseInt(target.getAttribute('data-word-index') || '0', 10);
    if (lastHoveredWordIndexRef.current !== wordIndex) return;
    const related = event.relatedTarget as HTMLElement | null;
    if (related?.classList?.contains('word') && related.getAttribute('data-word-index') === String(wordIndex)) {
      return; // still inside the same word (e.g. a child text node boundary)
    }
    lastHoveredWordIndexRef.current = null;
    onWordMouseLeave?.(verseId, wordIndex, event);
  };

  return (
    <span
      className="verse-content"
      data-verse-id={verseId}
      onMouseDown={(e) => handleMouseEvent('down', e)}
      onMouseMove={(e) => handleMouseEvent('move', e)}
      onMouseUp={(e) => handleMouseEvent('up', e)}
      onMouseOver={handleMouseOver}
      onMouseOut={handleMouseOut}
    >
      <span dangerouslySetInnerHTML={{ __html: sanitizeHtml(renderedHTML) }} />
      {suffix}
    </span>
  );
};
