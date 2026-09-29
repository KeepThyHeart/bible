/**
 * MarkStylePicker: choose how a keyword mark looks (colour slot x underline x symbol, plus bold and a subtle fill).
 * Colour, line and symbol are three APG radio groups (roving tabindex, arrow keys move and select). The colour
 * swatches always show the current line and symbol, so colour is never the only cue. Controlled: `value` in,
 * `onChange` out. Colours come from the `--kth-mark-N-rgb` tokens.
 */
import { useRef } from 'react';
import type { CSSProperties, KeyboardEvent, ReactNode } from 'react';
import { MARK_COLOR_KEYS, MARK_LINES, MARK_SYMBOLS } from '@bible/core/browser';
import type { MarkColorKey, MarkLine, MarkStyle, MarkSymbol } from '@bible/core/browser';
import {
  DEFAULT_MARK_COLOR_NAMES, DEFAULT_MARK_LINE_NAMES, DEFAULT_MARK_SYMBOL_NAMES, markColorStyle, swatchClass,
} from './markStyle';

export interface MarkStylePickerLabels {
  colorGroup: string;
  lineGroup: string;
  symbolGroup: string;
  colors: Record<MarkColorKey, string>;
  lines: Record<MarkLine, string>;
  symbols: Record<MarkSymbol, string>;
  noSymbol: string;
  bold: string;
  fill: string;
}

export const DEFAULT_MARK_STYLE_PICKER_LABELS: MarkStylePickerLabels = {
  colorGroup: 'Colour',
  lineGroup: 'Underline',
  symbolGroup: 'Symbol',
  colors: DEFAULT_MARK_COLOR_NAMES,
  lines: DEFAULT_MARK_LINE_NAMES,
  symbols: DEFAULT_MARK_SYMBOL_NAMES,
  noSymbol: 'No symbol',
  bold: 'Bold',
  fill: 'Background tint',
};

export interface MarkStylePickerProps {
  /** Prefix for ids (optional). */
  id?: string;
  value: MarkStyle;
  onChange: (value: MarkStyle) => void;
  labels?: Partial<Omit<MarkStylePickerLabels, 'colors' | 'lines' | 'symbols'>> & {
    colors?: Partial<Record<MarkColorKey, string>>;
    lines?: Partial<Record<MarkLine, string>>;
    symbols?: Partial<Record<MarkSymbol, string>>;
  };
  dir?: 'ltr' | 'rtl';
  disabled?: boolean;
}

const LINE_CLASS: Record<MarkLine, string> = {
  solid: 'kth-mark-choice__line',
  dashed: 'kth-mark-choice__line kth-mark-choice__line--dashed',
  dotted: 'kth-mark-choice__line kth-mark-choice__line--dotted',
  thick: 'kth-mark-choice__line kth-mark-choice__line--thick',
  none: 'kth-mark-choice__line kth-mark-choice__line--none',
};

interface Option {
  key: string;
  label: string;
  selected: boolean;
  className: string;
  style?: CSSProperties;
  content: ReactNode;
  onSelect: () => void;
}

/** One APG radio group over `options`; the checked option (or the first) holds the tab stop. */
function RadioGroup({ label, options, dir, disabled, id }: {
  label: string; options: Option[]; dir?: 'ltr' | 'rtl'; disabled?: boolean; id?: string;
}) {
  const refs = useRef<Array<HTMLButtonElement | null>>([]);
  const checked = options.findIndex((o) => o.selected);
  const tabStop = checked >= 0 ? checked : 0;

  const onKeyDown = (e: KeyboardEvent<HTMLDivElement>) => {
    if (disabled || options.length === 0) return;
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
      case 'End': next = options.length - 1; break;
      default: return;
    }
    e.preventDefault();
    next = (next + options.length) % options.length;
    refs.current[next]?.focus();
    options[next].onSelect();
  };

  return (
    <div id={id} role="radiogroup" aria-label={label} className="kth-mark-picker__group" dir={dir} onKeyDown={onKeyDown}>
      {options.map((o, i) => (
        <button
          key={o.key}
          ref={(el) => {
            refs.current[i] = el;
          }}
          type="button"
          role="radio"
          aria-checked={o.selected}
          aria-label={o.label}
          title={o.label}
          className={o.className}
          style={o.style}
          tabIndex={i === tabStop ? 0 : -1}
          disabled={disabled}
          onClick={o.onSelect}
        >
          {o.content}
        </button>
      ))}
    </div>
  );
}

export function MarkStylePicker({ id, value, onChange, labels, dir, disabled }: MarkStylePickerProps) {
  const L = {
    ...DEFAULT_MARK_STYLE_PICKER_LABELS,
    ...labels,
    colors: { ...DEFAULT_MARK_COLOR_NAMES, ...labels?.colors },
    lines: { ...DEFAULT_MARK_LINE_NAMES, ...labels?.lines },
    symbols: { ...DEFAULT_MARK_SYMBOL_NAMES, ...labels?.symbols },
  };
  const set = (patch: Partial<MarkStyle>) => onChange({ ...value, ...patch });
  const setSymbol = (symbol: MarkSymbol | undefined) => {
    const { symbol: _old, ...rest } = value;
    onChange(symbol === undefined ? rest : { ...rest, symbol });
  };

  const colorOptions: Option[] = MARK_COLOR_KEYS.map((c) => ({
    key: c,
    label: L.colors[c],
    selected: value.color === c,
    className: swatchClass(value),
    style: markColorStyle(c),
    content: value.symbol ? <span aria-hidden="true">{value.symbol}</span> : null,
    onSelect: () => set({ color: c }),
  }));
  const lineOptions: Option[] = MARK_LINES.map((l) => ({
    key: l,
    label: L.lines[l],
    selected: value.line === l,
    className: 'kth-mark-choice',
    content: <span aria-hidden="true" className={LINE_CLASS[l]} />,
    onSelect: () => set({ line: l }),
  }));
  const symbolOptions: Option[] = [
    { key: 'none', label: L.noSymbol, selected: value.symbol === undefined, className: 'kth-mark-choice',
      content: <span aria-hidden="true">{'∅'}</span>, onSelect: () => setSymbol(undefined) },
    ...MARK_SYMBOLS.map((s): Option => ({
      key: s, label: L.symbols[s], selected: value.symbol === s, className: 'kth-mark-choice',
      content: <span aria-hidden="true">{s}</span>, onSelect: () => setSymbol(s),
    })),
  ];

  return (
    <div id={id} className="kth-mark-picker" dir={dir}>
      <RadioGroup label={L.colorGroup} options={colorOptions} dir={dir} disabled={disabled} />
      <RadioGroup label={L.lineGroup} options={lineOptions} dir={dir} disabled={disabled} />
      <RadioGroup label={L.symbolGroup} options={symbolOptions} dir={dir} disabled={disabled} />
      <div className="kth-mark-picker__toggles">
        <label className="kth-mark-editor__check">
          <input type="checkbox" checked={value.bold === true} disabled={disabled}
            onChange={(e) => onChange(e.currentTarget.checked ? { ...value, bold: true } : omit(value, 'bold'))} />
          {L.bold}
        </label>
        <label className="kth-mark-editor__check">
          <input type="checkbox" checked={value.fill === 'subtle'} disabled={disabled}
            onChange={(e) => onChange(e.currentTarget.checked ? { ...value, fill: 'subtle' } : omit(value, 'fill'))} />
          {L.fill}
        </label>
      </div>
    </div>
  );
}

function omit(style: MarkStyle, key: 'bold' | 'fill'): MarkStyle {
  const { [key]: _drop, ...rest } = style;
  return rest as MarkStyle;
}
