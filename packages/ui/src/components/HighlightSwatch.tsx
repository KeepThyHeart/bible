/**
 * HighlightSwatch: the six-colour highlight palette as an APG radio group (roving tabindex, selection follows
 * focus). The palette and the stored-colour helpers come from `@bible/core/browser`, so a stored value may be
 * a palette name or a `#RRGGBB` hex; a custom hex selects nothing. Colours are never taken from attributes:
 * the fill is `colorValue(color)`, which defaults to the palette hex.
 *
 * Desktop adoption note: `colorValue={(c) => `rgb(var(--theme-highlight-${c}-rgb))`}` keeps the theme-tinted look.
 */
import { useEffect, useRef, useState } from 'react';
import type { KeyboardEvent } from 'react';
import { HIGHLIGHT_COLOR_HEX, HIGHLIGHT_COLOR_NAMES, markupColorName } from '@bible/core/browser';
import type { HighlightColor } from '@bible/core/browser';

export interface HighlightSwatchValue {
  color: HighlightColor;
  /** `HIGHLIGHT_COLOR_HEX[color]`. */
  hex: string;
}

export interface HighlightSwatchLabels {
  /** Accessible name of the group. */
  group: string;
  /** Accessible name and tooltip per colour. */
  colors: Record<HighlightColor, string>;
}

export const DEFAULT_HIGHLIGHT_SWATCH_LABELS: HighlightSwatchLabels = {
  group: 'Highlight colour',
  colors: { yellow: 'Yellow', green: 'Green', blue: 'Blue', red: 'Red', purple: 'Purple', orange: 'Orange' },
};

export interface HighlightSwatchProps {
  /** Prefix for the group id (optional). */
  id?: string;
  /** A palette name or a stored hex (matched via `markupColorName`); a custom hex selects none. */
  value?: string | null;
  onChange?: (value: HighlightSwatchValue) => void;
  /** Which colours to show, in order (default: the six palette colours). */
  colors?: readonly HighlightColor[];
  /** CSS fill per colour (default: the palette hex). */
  colorValue?: (color: HighlightColor) => string;
  labels?: { group?: string; colors?: Partial<Record<HighlightColor, string>> };
  size?: 'sm' | 'md';
  dir?: 'ltr' | 'rtl';
  disabled?: boolean;
}

const defaultColorValue = (c: HighlightColor) => HIGHLIGHT_COLOR_HEX[c];

export function HighlightSwatch({
  id,
  value,
  onChange,
  colors = HIGHLIGHT_COLOR_NAMES,
  colorValue = defaultColorValue,
  labels,
  size = 'md',
  dir,
  disabled,
}: HighlightSwatchProps) {
  const names: Record<HighlightColor, string> = { ...DEFAULT_HIGHLIGHT_SWATCH_LABELS.colors, ...labels?.colors };
  const groupLabel = labels?.group ?? DEFAULT_HIGHLIGHT_SWATCH_LABELS.group;

  // Selection follows `value`, and also moves on its own when the parent does not feed the change back.
  const [selected, setSelected] = useState<HighlightColor | undefined>(() => markupColorName(value));
  useEffect(() => setSelected(markupColorName(value)), [value]);

  const refs = useRef<Array<HTMLButtonElement | null>>([]);
  const checkedIndex = selected === undefined ? -1 : colors.indexOf(selected);
  const tabStop = checkedIndex >= 0 ? checkedIndex : 0;

  const select = (color: HighlightColor) => {
    setSelected(color);
    onChange?.({ color, hex: HIGHLIGHT_COLOR_HEX[color] });
  };

  const onKeyDown = (e: KeyboardEvent<HTMLDivElement>) => {
    if (disabled || colors.length === 0) return;
    const rtl = (dir ?? (e.currentTarget.closest('[dir]')?.getAttribute('dir') ?? 'ltr')) === 'rtl';
    const from = refs.current.findIndex((b) => b === document.activeElement);
    const at = from >= 0 ? from : tabStop;
    let next: number;
    switch (e.key) {
      case 'ArrowRight': next = rtl ? at - 1 : at + 1; break;
      case 'ArrowLeft': next = rtl ? at + 1 : at - 1; break;
      case 'ArrowDown': next = at + 1; break;
      case 'ArrowUp': next = at - 1; break;
      case 'Home': next = 0; break;
      case 'End': next = colors.length - 1; break;
      default: return;
    }
    e.preventDefault();
    next = (next + colors.length) % colors.length;
    refs.current[next]?.focus();
    select(colors[next]);
  };

  return (
    <div id={id} role="radiogroup" aria-label={groupLabel} className="kth-swatch-group" dir={dir} onKeyDown={onKeyDown}>
      {colors.map((c, i) => (
        <button
          key={c}
          ref={(el) => {
            refs.current[i] = el;
          }}
          type="button"
          role="radio"
          aria-checked={c === selected}
          aria-label={names[c]}
          title={names[c]}
          className={size === 'sm' ? 'kth-swatch kth-swatch--sm' : 'kth-swatch'}
          tabIndex={i === tabStop ? 0 : -1}
          style={{ backgroundColor: colorValue(c) }}
          disabled={disabled}
          onClick={() => select(c)}
        />
      ))}
    </div>
  );
}
