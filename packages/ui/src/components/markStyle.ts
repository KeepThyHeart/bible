/** Shared helpers for the keyword-mark components (0065): colour custom property and default English names. */
import type { CSSProperties } from 'react';
import type { MarkColorKey, MarkLine, MarkStyle, MarkSymbol } from '@bible/core/browser';

/** CSS colour for a mark colour key, e.g. `rgb(var(--kth-mark-3-rgb))`. */
export function markCssColor(key: MarkColorKey): string {
  return `rgb(var(--kth-mark-${key.slice(5)}-rgb))`;
}

/** Inline style that hands the colour to the `.kth-mark-*` classes as `--mark-color`. */
export function markColorStyle(key: MarkColorKey): CSSProperties {
  return { ['--mark-color' as string]: markCssColor(key) } as CSSProperties;
}

export const DEFAULT_MARK_COLOR_NAMES: Record<MarkColorKey, string> = {
  'mark.1': 'Blue', 'mark.2': 'Vermilion', 'mark.3': 'Green', 'mark.4': 'Pink',
  'mark.5': 'Gold', 'mark.6': 'Sky blue', 'mark.7': 'Purple', 'mark.8': 'Grey',
};

export const DEFAULT_MARK_LINE_NAMES: Record<MarkLine, string> = {
  solid: 'Solid underline', dashed: 'Dashed underline', dotted: 'Dotted underline',
  thick: 'Thick underline', none: 'No underline',
};

export const DEFAULT_MARK_SYMBOL_NAMES: Record<MarkSymbol, string> = {
  '●': 'Filled circle', '○': 'Open circle', '■': 'Filled square', '□': 'Open square',
  '▲': 'Filled triangle', '△': 'Open triangle',
};

/** Class list for a swatch showing a style (colour, line, bold, fill). */
export function swatchClass(style: Pick<MarkStyle, 'line' | 'bold' | 'fill'>, extra = ''): string {
  return ['kth-mark-swatch', `kth-mark-swatch--line-${style.line}`, style.bold ? 'kth-mark-swatch--bold' : '', style.fill ? 'kth-mark-swatch--fill' : '', extra]
    .filter(Boolean).join(' ');
}
