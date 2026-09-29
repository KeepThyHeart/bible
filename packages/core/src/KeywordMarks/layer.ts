/**
 * Adapter: a match result becomes a `LayerDecorations` layer that goes through
 * the existing `resolveVerseDecorations` / `wordRenderAttrs` path, so keyword
 * marks compose with highlights, find marks and extension decorations.
 */
import type { DecorationDto, DecorationTarget } from '../Extensions/ExtensionApiDtos';
import type { LayerDecorations } from '../Annotations/DecorationResolver';
import type { KeywordMark, KeywordSet, MarkColorKey, MarkSymbol, MatchResult } from './types';

export const KEYWORD_LAYER_KEY = 'core::keywords';
/** Above default extension decorations (0), below anything an extension explicitly raises. */
export const KEYWORD_LAYER_ORDER = 50;

const MAX_TARGETS_PER_DECORATION = 64;

const DEFAULT_SYMBOL_FOR_COLOR: Record<MarkColorKey, MarkSymbol> = {
  'mark.1': '✚', 'mark.2': '◆', 'mark.3': '▲', 'mark.4': '■',
  'mark.5': '★', 'mark.6': '●', 'mark.7': '†', 'mark.8': '?',
};

export interface LayerOptions {
  /** Always add a symbol badge (colour is never the only cue). Default true. */
  colorSafe?: boolean;
  /** Ids of marks currently hidden in the legend. */
  hiddenMarkIds?: ReadonlySet<string>;
  /** Called to build hover text; default `label (n)`. */
  hoverText?: (mark: KeywordMark, count: number) => string;
}

/** The mark's symbol, or a colour-slot default when colour-safe mode needs one. */
export function effectiveSymbol(mark: KeywordMark, colorSafe: boolean): MarkSymbol | undefined {
  return mark.style.symbol ?? (colorSafe ? DEFAULT_SYMBOL_FOR_COLOR[mark.style.color] : undefined);
}

function chunk<T>(list: T[], n: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < list.length; i += n) out.push(list.slice(i, i + n));
  return out;
}

export function toDecorationLayer(result: MatchResult, sets: KeywordSet[], opts: LayerOptions = {}): LayerDecorations {
  const colorSafe = opts.colorSafe ?? true;
  const marks = new Map<string, KeywordMark>();
  for (const s of sets) for (const m of s.marks) if (!marks.has(m.id)) marks.set(m.id, m);

  type Bucket = { tokens: DecorationTarget[]; badgeTokens: DecorationTarget[]; loose: DecorationTarget[] };
  const buckets = new Map<string, Bucket>();
  const verses = [...result.byVerse.keys()].sort((a, b) => a - b);
  for (const verseId of verses) {
    for (const hit of result.byVerse.get(verseId) ?? []) {
      if (opts.hiddenMarkIds?.has(hit.markId)) continue;
      if (!marks.has(hit.markId)) continue;
      const b = buckets.get(hit.markId) ?? { tokens: [], badgeTokens: [], loose: [] };
      const target: DecorationTarget = { kind: 'tokens', verseId, startTokenIndex: hit.start, endTokenIndex: hit.end };
      (hit.loose ? b.loose : b.tokens).push(target);
      b.badgeTokens.push({ kind: 'tokens', verseId, startTokenIndex: hit.end });
      buckets.set(hit.markId, b);
    }
  }

  const decorations: DecorationDto[] = [];
  for (const [markId, b] of buckets) {
    const mark = marks.get(markId)!;
    const count = result.counts.get(markId)?.hits ?? 0;
    const hover = { kind: 'text' as const, text: (opts.hoverText ?? ((m, n) => `${m.label} (${n})`))(mark, count) };
    const { style } = mark;
    const push = (targets: DecorationTarget[], appearance: DecorationDto['appearance'], withHover: boolean): void => {
      for (const part of chunk(targets, MAX_TARGETS_PER_DECORATION)) {
        decorations.push({
          target: part, appearance, order: KEYWORD_LAYER_ORDER,
          ...(withHover ? { hoverContent: hover } : {}),
          data: { markId },
        });
      }
    };
    const all = [...b.tokens, ...b.loose];
    if (style.line !== 'none') {
      const thick = style.line === 'thick';
      const line = style.line === 'dashed' ? 'dashed' : style.line === 'dotted' ? 'dotted' : 'solid';
      push(b.tokens, { kind: 'underline', color: style.color, style: line, thickness: thick ? 'thick' : 'medium' }, true);
      // Approximate (surface-only) connective hits are always dotted.
      push(b.loose, { kind: 'underline', color: style.color, style: 'dotted', thickness: 'medium' }, true);
    }
    if (style.fill) push(all, { kind: 'tint', color: style.color, intensity: 'subtle' }, style.line === 'none');
    if (style.bold) push(all, { kind: 'emphasis' }, false);
    const symbol = effectiveSymbol(mark, colorSafe);
    if (symbol) push(b.badgeTokens, { kind: 'badge', label: symbol, color: style.color }, style.line === 'none' && !style.fill);
  }
  return {
    layerKey: KEYWORD_LAYER_KEY,
    extensionId: 'core',
    layerSeq: 0,
    surfaces: ['standard', 'study', 'reading'],
    decorations,
  };
}
