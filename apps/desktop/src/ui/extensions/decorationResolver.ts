/**
 * Pure target-matching + composition for extension verse decorations (task
 * 0036, P0.1a/P0.1b; design doc §10, amended by design amendments A1-A5).
 *
 * No React, no IPC, no Zustand - everything here is a plain function over
 * plain data, so it is fully unit-testable and shared by every surface that
 * paints decorations (design doc §14.3: "the contract for a future surface
 * is exactly: call `ensureRange`, call `getDecorationsForVerse`, feed the
 * result plus your own rendered word sequence to `resolveVerseDecorations`").
 *
 * P0.1a shipped target kinds `'verse'`/`'passage'` and appearance kinds
 * `'tint'`/`'underline'`/`'gutter'` (`compose()` already handled `'emphasis'`/
 * `'strike'`/`'badge'` too - only `collect()`'s target matching was P0.1a-
 * scoped). P0.1b adds `'word'` (§4.2) and `'tokens'` (§4.3, resolved directly
 * per amendment A5 - no offset fallback, no `plainStart`/`plainEnd`) target
 * matching, below.
 */

import type { Extensions } from '@bible/core';
import type { WordInfo } from '../utils/wordIndexing';

type DecorationDto = Extensions.DecorationDto;
type DecorationTarget = Extensions.DecorationTarget;
type WordDecorationTarget = Extract<DecorationTarget, { kind: 'word' }>;
type LocalizedString = Extensions.LocalizedString;
type Surface = 'standard' | 'study' | 'reading';

// Design doc §9 - per-word/per-verse caps.
const MAX_UNDERLINES_PER_WORD = 3;
const MAX_BADGES_PER_WORD = 4;
const MAX_GUTTER_MARKS = 3;
const MAX_CONTRIBUTIONS_PER_WORD = 8;
const UNDERLINE_OFFSET_STEP_PX = 2;

/** One layer's raw decorations, as fed to the resolver. */
export interface LayerDecorations {
  /** `${extensionId}::${decoratorId}` (pull) or `${extensionId}::group:${groupId}` (push). */
  layerKey: string;
  extensionId: string;
  /** Registration order (design doc §10.1). */
  layerSeq: number;
  /** Default `['standard', 'study']` - matches `VerseDecoratorDescriptor.surfaces`'s own default (amendment A4). */
  surfaces: Surface[];
  decorations: DecorationDto[];
}

/** Everything one rendered word needs painted onto it (amendment A1/A2). */
export interface WordPaint {
  tint?: { color: string };
  /** Up to 3, in priority order, each with a stacking `offset` in px. */
  underlines: { color: string; style: 'solid' | 'dashed' | 'dotted'; thickness: 'thin' | 'medium' | 'thick'; offset: number }[];
  strike?: { color: string };
  bold: boolean;
  /** Up to 4, in priority order. */
  badges: { label: string; color: string }[];
  /** Which decorations painted this word, as `${layerKey}#${decorationIndex}` - used for the continuous-wash `spaceInsideSpan` rule. */
  sourceKeys: string[];
}

export interface GutterMark {
  layerKey: string;
  icon: string;
  color?: string;
  tooltip?: LocalizedString;
}

export interface ResolvedVerse {
  /** By rendered word index. Words with no decoration are simply absent. */
  words: Map<number, WordPaint>;
  /** Collected per verse across layers in `layerSeq` order (not re-sorted by `order` - design doc §10.3 step 5). Capped at 3 + overflow count. */
  gutter: GutterMark[];
  /** How many gutter marks were dropped past the cap of 3. */
  gutterOverflow: number;
}

/** Resolves a `ThemeColorKeyRef` (or an intensity) to a CSS colour string. Renderer-supplied - see `themeColorResolver.ts`. */
export type ThemeColorResolver = (colorKey: string, alpha?: number) => string;

interface Candidate {
  layerSeq: number;
  order: number;
  decorationIndex: number;
  sourceKey: string;
  appearance: Extensions.DecorationAppearance;
  hoverContent: Extensions.HoverContentDto | undefined;
}

function candidateSort(a: Candidate, b: Candidate): number {
  if (a.order !== b.order) return b.order - a.order; // order desc
  if (a.layerSeq !== b.layerSeq) return a.layerSeq - b.layerSeq; // layerSeq asc
  return a.decorationIndex - b.decorationIndex; // array position asc
}

/** True for a `'verse'`/`'passage'` target that covers `verseId`. Gutter marks only ever match this shape (design doc §3.3: "Verse and passage targets only"). */
function targetCoversVerseWide(target: DecorationTarget, verseId: number): boolean {
  switch (target.kind) {
    case 'verse':
      return target.verseId === verseId;
    case 'passage':
      return verseId >= target.startVerseId && verseId <= target.endVerseId;
    default:
      return false;
  }
}

/** NFC-normalizes, and lowercases unless `matchCase` (design doc §4.2). */
function normalizeWordText(text: string, matchCase: boolean | undefined): string {
  const n = text.normalize('NFC');
  return matchCase ? n : n.toLowerCase();
}

/**
 * How many rendered `words` match `text` under the target's own case rule -
 * exported so callers can precompute the cumulative prior-match count a
 * passage-scoped, `occurrence`-bearing `'word'` target needs for verses
 * earlier in its scope (§4.2: "occurrence 3 of 'faith' in Hebrews 11 means
 * the third in the passage, not the third in some verse"). `resolveVerseDecorations`
 * itself only ever sees one verse's `words`, so cross-verse accumulation is
 * necessarily the caller's job - see `priorWordMatchCounts` below and
 * `useResolvedVerseDecorations.ts`.
 */
export function countWordTextMatches(
  text: string,
  matchCase: boolean | undefined,
  words: Pick<WordInfo, 'text'>[],
): number {
  const norm = normalizeWordText(text, matchCase);
  let count = 0;
  for (const w of words) if (normalizeWordText(w.text, matchCase) === norm) count++;
  return count;
}

/**
 * Rendered word indexes a `'word'` target selects in THIS verse (design doc
 * §4.2). `priorMatchCount` is the number of matches already counted in
 * earlier verses of the target's scope (0 for verse scope, or the first verse
 * of a passage scope) - `occurrence` is 1-based and global to the scope, so a
 * local match at position `j` (1-based) has global occurrence
 * `priorMatchCount + j`.
 */
function matchWordTargetIndexes(
  target: WordDecorationTarget,
  words: Pick<WordInfo, 'text'>[],
  priorMatchCount: number,
): number[] {
  const norm = normalizeWordText(target.text, target.matchCase);
  const localMatches: number[] = [];
  for (let i = 0; i < words.length; i++) {
    if (normalizeWordText(words[i].text, target.matchCase) === norm) localMatches.push(i);
  }
  if (target.occurrence === undefined) return localMatches; // every match, unqualified
  const globalOccurrence = target.occurrence;
  const j = localMatches.findIndex((_, localIndex) => priorMatchCount + localIndex + 1 === globalOccurrence);
  return j === -1 ? [] : [localMatches[j]];
}

function wordTargetInScope(target: WordDecorationTarget, verseId: number): boolean {
  return 'verseId' in target.scope
    ? target.scope.verseId === verseId
    : verseId >= target.scope.startVerseId && verseId <= target.scope.endVerseId;
}

export interface ResolveVerseDecorationsInput {
  verseId: number;
  /** Number of rendered words in this verse (from `extractWordsWithFormatting`). Every word is painted for a verse/passage-scoped decoration. Ignored when `words` is given - `words.length` wins. */
  wordCount: number;
  /**
   * The rendered word sequence's text (P0.1b) - needed to match `kind: 'word'`
   * targets. Omit for gutter-only calls (`useVerseGutterMarks`) or any caller
   * that doesn't need word-level matching; `'word'` targets then simply match
   * nothing, same as P0.1a's behaviour for every target kind this file didn't
   * yet resolve.
   */
  words?: Pick<WordInfo, 'text'>[];
  layers: LayerDecorations[];
  surface: Surface;
  resolveColor: ThemeColorResolver;
  /**
   * For an `occurrence`-bearing, passage-scoped `'word'` target: how many
   * matches were already counted in earlier verses of its scope, keyed
   * `${layerKey}#${decorationIndex}:${targetIndex}` (`targetIndex` is the
   * position within `DecorationDto.target` when it's an array; `0` when it's
   * a single target). Missing entries default to 0 - correct for verse scope,
   * and for the first verse of a passage. See `countWordTextMatches`.
   */
  priorWordMatchCounts?: Map<string, number>;
}

export function resolveVerseDecorations(input: ResolveVerseDecorationsInput): ResolvedVerse {
  const { verseId, words, layers, surface, resolveColor, priorWordMatchCounts } = input;
  const wordCount = words ? words.length : input.wordCount;

  // --- Collect (design doc §10.3 step 1) ----------------------------------
  const perWord: Candidate[][] = Array.from({ length: wordCount }, () => []);
  const gutterCandidates: { layerSeq: number; layerKey: string; appearance: Extract<Extensions.DecorationAppearance, { kind: 'gutter' }> }[] = [];

  for (const layer of layers) {
    if (!layer.surfaces.includes(surface)) continue;
    layer.decorations.forEach((d, decorationIndex) => {
      const targets = Array.isArray(d.target) ? d.target : [d.target];
      const sourceKey = `${layer.layerKey}#${decorationIndex}`;

      if (d.appearance.kind === 'gutter') {
        // Gutter marks are never in Reading mode, even if the layer opted in
        // (amendment A4) - and are collected separately, never re-sorted by
        // `order` (design doc §10.3 step 5). Gutter only ever matches a
        // verse/passage target (design doc §3.3).
        const covers = targets.some((t) => targetCoversVerseWide(t, verseId));
        if (covers && surface !== 'reading') {
          gutterCandidates.push({ layerSeq: layer.layerSeq, layerKey: layer.layerKey, appearance: d.appearance });
        }
        return;
      }

      // Union every target this decoration carries (design doc §3.4 allows
      // `target` to be an array). A `'verse'`/`'passage'` match paints every
      // word; `'tokens'`/`'word'` match specific rendered indexes (P0.1b).
      let verseWide = false;
      const matchedIndexes = new Set<number>();
      targets.forEach((t, targetIndex) => {
        switch (t.kind) {
          case 'verse':
          case 'passage':
            if (targetCoversVerseWide(t, verseId)) verseWide = true;
            break;
          case 'tokens': {
            if (t.verseId !== verseId) break;
            const end = t.endTokenIndex ?? t.startTokenIndex;
            // Amendment A5: rendered indexes map directly, no offset fallback.
            // Out of range (or a reversed range) -> drop this target, not fatal
            // to the decoration as a whole.
            if (t.startTokenIndex < 0 || end < t.startTokenIndex) break;
            if (t.startTokenIndex >= wordCount || end >= wordCount) break;
            for (let i = t.startTokenIndex; i <= end; i++) matchedIndexes.add(i);
            break;
          }
          case 'word': {
            if (!words) break;
            if (!wordTargetInScope(t, verseId)) break;
            const prior = priorWordMatchCounts?.get(`${sourceKey}:${targetIndex}`) ?? 0;
            for (const i of matchWordTargetIndexes(t, words, prior)) matchedIndexes.add(i);
            break;
          }
        }
      });
      if (!verseWide && matchedIndexes.size === 0) return;

      const candidate: Candidate = {
        layerSeq: layer.layerSeq,
        order: d.order ?? 0,
        decorationIndex,
        sourceKey,
        appearance: d.appearance,
        hoverContent: d.hoverContent,
      };
      if (verseWide) {
        for (let i = 0; i < wordCount; i++) perWord[i].push(candidate);
      } else {
        for (const i of matchedIndexes) perWord[i].push(candidate);
      }
    });
  }

  // --- Sort + cap + compose (design doc §10.3 steps 2-4) ------------------
  const wordPaints = new Map<number, WordPaint>();
  for (let i = 0; i < wordCount; i++) {
    const candidates = perWord[i];
    if (candidates.length === 0) continue;
    candidates.sort(candidateSort);
    const capped = candidates.slice(0, MAX_CONTRIBUTIONS_PER_WORD);
    const paint = compose(capped, resolveColor);
    if (paint) wordPaints.set(i, paint);
  }

  // --- Gutter (design doc §10.3 step 5) ------------------------------------
  gutterCandidates.sort((a, b) => a.layerSeq - b.layerSeq);
  const gutter: GutterMark[] = gutterCandidates.slice(0, MAX_GUTTER_MARKS).map((c) => ({
    layerKey: c.layerKey,
    icon: c.appearance.icon,
    ...(c.appearance.color !== undefined ? { color: resolveColor(c.appearance.color) } : {}),
    ...(c.appearance.tooltip !== undefined ? { tooltip: c.appearance.tooltip } : {}),
  }));
  const gutterOverflow = Math.max(0, gutterCandidates.length - MAX_GUTTER_MARKS);

  return { words: wordPaints, gutter, gutterOverflow };
}

function compose(candidates: Candidate[], resolveColor: ThemeColorResolver): WordPaint | null {
  const paint: WordPaint = { underlines: [], bold: false, badges: [], sourceKeys: [] };
  let hasAnything = false;

  for (const c of candidates) {
    const a = c.appearance;
    switch (a.kind) {
      case 'tint':
        if (!paint.tint) {
          const intensity = a.intensity ?? 'normal';
          const alpha = intensity === 'subtle' ? 0.18 : intensity === 'strong' ? 0.5 : 0.32;
          paint.tint = { color: resolveColor(a.color, alpha) };
          paint.sourceKeys.push(c.sourceKey);
          hasAnything = true;
        }
        break;
      case 'underline':
        if (paint.underlines.length < MAX_UNDERLINES_PER_WORD) {
          paint.underlines.push({
            color: resolveColor(a.color, 1),
            style: a.style ?? 'solid',
            thickness: a.thickness ?? 'medium',
            offset: paint.underlines.length * UNDERLINE_OFFSET_STEP_PX,
          });
          paint.sourceKeys.push(c.sourceKey);
          hasAnything = true;
        }
        break;
      case 'strike':
        if (!paint.strike) {
          paint.strike = { color: resolveColor(a.color ?? 'text', 1) };
          paint.sourceKeys.push(c.sourceKey);
          hasAnything = true;
        }
        break;
      case 'emphasis':
        if (!paint.bold) {
          paint.bold = true;
          paint.sourceKeys.push(c.sourceKey);
          hasAnything = true;
        }
        break;
      case 'badge':
        if (paint.badges.length < MAX_BADGES_PER_WORD) {
          paint.badges.push({ label: a.label, color: resolveColor(a.color ?? 'accent', 1) });
          paint.sourceKeys.push(c.sourceKey);
          hasAnything = true;
        }
        break;
      // 'gutter' never reaches here - filtered out during collect.
    }
  }

  return hasAnything ? paint : null;
}

/**
 * Pure: `WordPaint` -> the inline custom properties + classes
 * `wordRenderAttrs` sets on a `.word` span (amendment A2). No DOM, no React
 * - both the HTML-string renderer and the JSX renderer call this the same
 * way.
 */
export interface WordPaintStyle {
  classes: string[];
  vars: Record<string, string>;
}

export function buildWordPaintStyle(paint: WordPaint): WordPaintStyle {
  const classes: string[] = ['ext-deco'];
  const vars: Record<string, string> = {};

  const images: string[] = [];
  const positions: string[] = [];
  const sizes: string[] = [];

  // Layer order: underlines first (drawn under), then strike, then tint on
  // top - matches amendment A2's "first listed paints on top" read bottom-up
  // for `background-image`'s layering (later entries paint UNDER earlier
  // ones in CSS `background-image` list syntax, so tint - meant to sit over
  // the underlines/strike - is listed FIRST).
  if (paint.tint) {
    images.push(`linear-gradient(${paint.tint.color}, ${paint.tint.color})`);
    positions.push('0 0');
    sizes.push('100% 100%');
  }
  if (paint.strike) {
    images.push(`linear-gradient(${paint.strike.color}, ${paint.strike.color})`);
    positions.push('0 55%');
    sizes.push('100% 2px');
  }
  for (const u of paint.underlines) {
    const thicknessPx = u.thickness === 'thin' ? 1 : u.thickness === 'thick' ? 3 : 2;
    let image: string;
    if (u.style === 'dashed') {
      image = `repeating-linear-gradient(90deg, ${u.color} 0 4px, transparent 4px 7px)`;
    } else if (u.style === 'dotted') {
      image = `repeating-linear-gradient(90deg, ${u.color} 0 2px, transparent 2px 4px)`;
    } else {
      image = `linear-gradient(${u.color}, ${u.color})`;
    }
    images.push(image);
    positions.push(`0 calc(100% - ${u.offset}px)`);
    sizes.push(`100% ${thicknessPx}px`);
  }

  if (images.length > 0) {
    vars['--ext-bg-image'] = images.join(', ');
    vars['--ext-bg-position'] = positions.join(', ');
    vars['--ext-bg-size'] = sizes.join(', ');
  }

  if (paint.bold) classes.push('ext-bold');

  if (paint.badges.length > 0) {
    classes.push('ext-badge');
    const label = paint.badges.map((b) => b.label).join(' · ');
    vars['--ext-badge'] = `"${label.replace(/"/g, '\\"')}"`;
    vars['--ext-badge-color'] = paint.badges[0].color;
  }

  return { classes, vars };
}
