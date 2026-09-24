/**
 * Pure target-matching + composition for extension verse decorations (task
 * 0036, P0.1a; design doc §10, amended by design amendments A1-A5).
 *
 * No React, no IPC, no Zustand - everything here is a plain function over
 * plain data, so it is fully unit-testable and shared by every surface that
 * paints decorations (design doc §14.3: "the contract for a future surface
 * is exactly: call `ensureRange`, call `getDecorationsForVerse`, feed the
 * result plus your own rendered word sequence to `resolveVerseDecorations`").
 *
 * P0.1a scope: target kinds `'verse'`/`'passage'` only (`'word'`/`'tokens'`
 * are matched starting P0.1b - see A5); appearance kinds `'tint'`/
 * `'underline'`/`'gutter'` only (`'emphasis'`/`'strike'`/`'badge'` compose
 * starting P0.1b). `WordPaint` already carries every field the full P0.1
 * vocabulary needs (amendment A1), so P0.1b/c only add to the `compose`
 * switch below, not to any type or renderer plumbing.
 */

import type { Extensions } from '@bible/core';

type DecorationDto = Extensions.DecorationDto;
type DecorationTarget = Extensions.DecorationTarget;
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

/** True if `target` (verse/passage only, in P0.1a) covers `verseId`. */
function targetCoversVerse(target: DecorationTarget, verseId: number): boolean {
  switch (target.kind) {
    case 'verse':
      return target.verseId === verseId;
    case 'passage':
      return verseId >= target.startVerseId && verseId <= target.endVerseId;
    case 'tokens':
    case 'word':
      // Word/token-level matching lands in P0.1b (amendment A5 / design §4.2).
      // A well-formed target of this kind is accepted by validation but
      // simply resolves to nothing yet, rather than being treated as an error.
      return false;
    default:
      return false;
  }
}

export interface ResolveVerseDecorationsInput {
  verseId: number;
  /** Number of rendered words in this verse (from `extractWordsWithFormatting`). Every word is painted for a verse/passage-scoped decoration. */
  wordCount: number;
  layers: LayerDecorations[];
  surface: Surface;
  resolveColor: ThemeColorResolver;
}

export function resolveVerseDecorations(input: ResolveVerseDecorationsInput): ResolvedVerse {
  const { verseId, wordCount, layers, surface, resolveColor } = input;

  // --- Collect (design doc §10.3 step 1) ----------------------------------
  const perWord: Candidate[][] = Array.from({ length: wordCount }, () => []);
  const gutterCandidates: { layerSeq: number; layerKey: string; appearance: Extract<Extensions.DecorationAppearance, { kind: 'gutter' }> }[] = [];

  for (const layer of layers) {
    if (!layer.surfaces.includes(surface)) continue;
    layer.decorations.forEach((d, decorationIndex) => {
      const targets = Array.isArray(d.target) ? d.target : [d.target];
      const covers = targets.some((t) => targetCoversVerse(t, verseId));
      if (!covers) return;
      const sourceKey = `${layer.layerKey}#${decorationIndex}`;
      if (d.appearance.kind === 'gutter') {
        // Gutter marks are never in Reading mode, even if the layer opted in
        // (amendment A4) - and are collected separately, never re-sorted by
        // `order` (design doc §10.3 step 5).
        if (surface !== 'reading') {
          gutterCandidates.push({ layerSeq: layer.layerSeq, layerKey: layer.layerKey, appearance: d.appearance });
        }
        return;
      }
      const candidate: Candidate = {
        layerSeq: layer.layerSeq,
        order: d.order ?? 0,
        decorationIndex,
        sourceKey,
        appearance: d.appearance,
        hoverContent: d.hoverContent,
      };
      for (let i = 0; i < wordCount; i++) perWord[i].push(candidate);
    });
  }

  // --- Sort + cap + compose (design doc §10.3 steps 2-4) ------------------
  const words = new Map<number, WordPaint>();
  for (let i = 0; i < wordCount; i++) {
    const candidates = perWord[i];
    if (candidates.length === 0) continue;
    candidates.sort(candidateSort);
    const capped = candidates.slice(0, MAX_CONTRIBUTIONS_PER_WORD);
    const paint = compose(capped, resolveColor);
    if (paint) words.set(i, paint);
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

  return { words, gutter, gutterOverflow };
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
