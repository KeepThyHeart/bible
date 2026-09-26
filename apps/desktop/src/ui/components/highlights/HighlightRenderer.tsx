import React, { useMemo, useRef } from 'react';
import { UserTextMarkup, markupColorName } from '@bible/core';
import { useHighlightStore } from '../../stores/useHighlightStore';
import { useFindStore } from '../../stores/useFindStore';
import { extractWordsWithFormatting, WordInfo } from '../../utils/wordIndexing';
import { sanitizeHtml } from '../../utils/sanitize';
import { buildWordPaintStyle, type WordPaint, type ResolvedHover } from '../../extensions/decorationResolver';
import { useResolvedVerseDecorations } from '../../extensions/useResolvedVerseDecorations';

// Constant empty array to prevent unnecessary re-renders
const EMPTY_HIGHLIGHTS: UserTextMarkup[] = [];

/**
 * Everything a single `<span class="word">` needs in order to be painted.
 *
 * Produced by {@link wordRenderAttrs} and consumed by both renderers: the
 * HTML-string path below (Standard/Reading/Study plain text) and the JSX
 * path in `study/InterlinearDisplay.tsx`. There is deliberately one resolver
 * - a second, diverging copy of this class/style logic is exactly how Study
 * mode ended up unhighlightable in the first place, and (task 0036, P0.1a,
 * amendment A1) it is also now the ONE paint path for extension decorations
 * and find-in-page: there is no post-render DOM layer anywhere in this app
 * that edits a word span after `dangerouslySetInnerHTML`/React have painted
 * it.
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
   * the same markup (a user highlight OR an extension decoration - amendment
   * A1's `spaceInsideSpan` extension) continues onto the next word (KAN-10: a
   * continuous wash across a phrase rather than a striped one).
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
  /**
   * `sourceKeys` of the NEXT word's resolved extension paint, if any -
   * mirrors `nextWordIndex`'s role for user highlights, extended to
   * extension decorations (amendment A1: "extend the KAN-10 `spaceInsideSpan`
   * rule so it is also true when the next word shares a `sourceKeys` entry
   * with this one"). A tinted phrase then reads as one wash, like a user
   * highlight.
   */
  nextWordSourceKeys?: string[];
  /**
   * Find-in-page state for this word (task 0036, P0.1a, amendment A1). Moved
   * into the renderer from an imperative `classList` effect
   * (`useBibleKeyboard.ts`'s old `useBibleFind` DOM pass), so a find match
   * survives a verse re-render caused by a decoration arriving or a
   * highlight being edited.
   */
  find?: 'match' | 'current';
}

/**
 * Resolve the classes, inline styles and markup ids for one word.
 *
 * @param verseId Verse being rendered
 * @param wordIndex 0-based index into the verse's English word sequence
 * @param highlights Markup already filtered to this verse
 * @param context Formatting facts about the word itself
 * @param paint Resolved extension decoration paint for this word, if any (amendment A2)
 */
export function wordRenderAttrs(
  verseId: number,
  wordIndex: number,
  highlights: UserTextMarkup[],
  context: WordRenderContext,
  paint?: WordPaint,
): WordRenderAttrs {
  const classes: string[] = ['word'];
  if (context.isChristWords) classes.push('christ-words');
  if (context.isDivineName) classes.push('divine-name');
  if (context.find === 'match' || context.find === 'current') classes.push('find-match');
  if (context.find === 'current') classes.push('find-match-current');

  const wordHighlights = findHighlightsForWord(wordIndex, verseId, highlights);

  const style: React.CSSProperties = {};
  let hasStyle = false;
  const paintSourceKeys = paint?.sourceKeys ?? [];

  if (paint) {
    const built = buildWordPaintStyle(paint);
    classes.push(...built.classes);
    Object.assign(style, built.vars as unknown as React.CSSProperties);
    if (Object.keys(built.vars).length > 0 || built.classes.length > 1) hasStyle = true;
  }

  if (wordHighlights.length === 0 && !paint) {
    return { className: classes.join(' '), spaceInsideSpan: false };
  }

  const markupIds: number[] = [];

  if (wordHighlights.length > 0) {
    classes.push('highlighted');

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
  }

  // KAN-10, extended by amendment A1: include the trailing space inside the
  // span when the NEXT word carries one of the same USER markups, OR shares
  // an extension decoration `sourceKey` with this word - either way the wash
  // reads as one continuous phrase rather than a striped one.
  let spaceInsideSpan = false;
  if (context.hasTrailingSpace && context.nextWordIndex !== null) {
    const nextWordHighlights = findHighlightsForWord(context.nextWordIndex, verseId, highlights);
    const userContinues = wordHighlights.some((h) =>
      nextWordHighlights.some((nh) => nh.markupId === h.markupId),
    );
    const nextSourceKeys = context.nextWordSourceKeys ?? [];
    const extContinues =
      paintSourceKeys.length > 0 && nextSourceKeys.length > 0 && paintSourceKeys.some((k) => nextSourceKeys.includes(k));
    spaceInsideSpan = userContinues || extContinues;
  }

  return {
    className: classes.join(' '),
    style: hasStyle ? style : undefined,
    markupIds: markupIds.length > 0 ? markupIds.join(',') : undefined,
    spaceInsideSpan,
  };
}

/**
 * Serialise {@link WordRenderAttrs.style} back to a CSS declaration string for
 * the HTML-string renderer. Handles both camelCase React style properties AND
 * `--ext-*` custom properties (passed through unchanged - amendment A2).
 */
function styleToCssText(style: React.CSSProperties): string {
  return Object.entries(style)
    .map(([property, value]) => {
      const cssProp = property.startsWith('--')
        ? property
        : property.replace(/[A-Z]/g, (c) => `-${c.toLowerCase()}`);
      return `${cssProp}:${String(value)}`;
    })
    .join(';');
}

/**
 * HTML-escape a string for safe use inside a `style="…"` attribute value
 * (amendment A2). Badge labels can contain `"` (the validated character set
 * allows it via other punctuation combinations is not the case here, but
 * `--ext-badge`'s value is a quoted CSS string, so its own `"` was already
 * escaped by `buildWordPaintStyle`; this guards the attribute boundary
 * itself against the surrounding HTML).
 */
function escapeForAttribute(value: string): string {
  return value.replace(/&/g, '&amp;').replace(/"/g, '&quot;');
}

/**
 * Apply highlights AND extension decorations AND find-in-page state to a
 * verse's already-extracted words, producing the HTML string
 * `HighlightedVerse` injects via `dangerouslySetInnerHTML` (task 0036,
 * P0.1a, amendment A1 - renamed from `applyHighlightsToVerse`, which used to
 * call `extractWordsWithFormatting` itself; callers now do that once and
 * share the result with the decoration resolver).
 *
 * @param verseId - Verse ID being rendered
 * @param words - Already-extracted words (`extractWordsWithFormatting(verseHTML)`)
 * @param highlights - Array of highlights that may apply to this verse
 * @param resolved - Resolved extension decorations for this verse, if any
 * @param find - This verse's find-in-page match state, if any
 * @returns HTML string with highlight/decoration/find markup applied
 */
export function renderVerseWords(
  verseId: number,
  words: WordInfo[],
  highlights: UserTextMarkup[],
  resolved?: { words: Map<number, WordPaint> } | null,
  find?: VerseFindState,
): string {
  // Filter highlights that affect this verse
  const applicableHighlights = highlights.filter((h) => h.coversVerse(verseId));

  // Render each word with appropriate highlight and formatting classes
  const renderedWords = words.map((wordInfo, index) => {
    const attrs = wordRenderAttrs(
      verseId,
      index,
      applicableHighlights,
      {
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
        nextWordIndex: index + 1 < words.length ? index + 1 : null,
        nextWordSourceKeys: resolved?.words.get(index + 1)?.sourceKeys,
        find: findStateForWord(find, index),
      },
      resolved?.words.get(index),
    );

    // Use displayText (includes punctuation) for rendering, not text (clean for indexing)
    const wordContent = wordInfo.displayText;
    const styleAttr = attrs.style
      ? ` style="${escapeForAttribute(styleToCssText(attrs.style))}"`
      : '';
    const markupAttr = attrs.markupIds !== undefined ? ` data-markup-id="${attrs.markupIds}"` : '';

    const trailingSpace = wordInfo.hasTrailingSpace && !attrs.spaceInsideSpan ? ' ' : '';
    const innerTrailingSpace = attrs.spaceInsideSpan ? ' ' : '';
    return `<span class="${attrs.className}" data-word-index="${index}"${markupAttr}${styleAttr}>${wordContent}${innerTrailingSpace}</span>${trailingSpace}`;
  });

  // Join words without additional spaces (spaces are now included appropriately)
  return renderedWords.join('');
}

/** Per-verse find-in-page match state, computed once and reused for every word (amendment A1). */
export interface VerseFindState {
  matchWordIndexes: Set<number>;
  currentWordIndex: number | null;
}

function findStateForWord(find: VerseFindState | undefined, wordIndex: number): 'match' | 'current' | undefined {
  if (!find) return undefined;
  if (find.currentWordIndex === wordIndex) return 'current';
  if (find.matchWordIndexes.has(wordIndex)) return 'match';
  return undefined;
}

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
  return useMemo(() => {
    if (!isVisible || matches.length === 0) return undefined;
    const matchWordIndexes = new Set<number>();
    let currentWordIndex: number | null = null;
    matches.forEach((m, i) => {
      if (m.verseId !== verseId) return;
      matchWordIndexes.add(m.wordIndex);
      if (i === currentMatchIndex) currentWordIndex = m.wordIndex;
    });
    if (matchWordIndexes.size === 0) return undefined;
    return { matchWordIndexes, currentWordIndex };
  }, [isVisible, matches, currentMatchIndex, verseId]);
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
