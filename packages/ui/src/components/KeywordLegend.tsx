/**
 * KeywordLegend: the panel for keyword marks (0065). A master on/off toggle (pressed button), a real list of
 * marks (swatch with line and symbol, label, count; the label button hides/shows the mark; prev/next step
 * through occurrences), optional suggestions with an Add button each, and a live region that announces the
 * `announcement` string the parent computes after stepping. The component keeps no state of its own.
 */
import type { MarkColorKey, MarkLine, MarkSymbol } from '@bible/core/browser';
import { markColorStyle, swatchClass } from './markStyle';

export interface LegendRow {
  id: string;
  label: string;
  color: MarkColorKey;
  line: MarkLine;
  symbol?: MarkSymbol;
  bold?: boolean;
  fill?: 'subtle';
  count: number;
  /** Turned off for this view only. */
  hidden: boolean;
  /** Matched by surface form without an interlinear anchor. */
  approximate?: boolean;
  /** Owning set, shown when the legend mixes several sets. */
  setName?: string;
}

export interface LegendSuggestion {
  key: string;
  label: string;
  count: number;
}

export interface KeywordLegendLabels {
  title: string;
  toggle: string;
  empty: string;
  /** e.g. "3 occurrences". */
  count: (n: number) => string;
  show: (label: string) => string;
  hide: (label: string) => string;
  next: (label: string) => string;
  prev: (label: string) => string;
  edit: (label: string) => string;
  approximate: string;
  approximateHint: string;
  add: string;
  manageSets: string;
  suggestions: string;
  addSuggestion: (label: string) => string;
}

export const DEFAULT_KEYWORD_LEGEND_LABELS: KeywordLegendLabels = {
  title: 'Keyword marks',
  toggle: 'Keyword marks',
  empty: 'No keywords match in this chapter.',
  count: (n) => (n === 1 ? '1 occurrence' : `${n} occurrences`),
  show: (l) => `Show ${l}`,
  hide: (l) => `Hide ${l}`,
  next: (l) => `Next ${l}`,
  prev: (l) => `Previous ${l}`,
  edit: (l) => `Edit ${l}`,
  approximate: 'approx.',
  approximateHint: 'Approximate: matched by word form, not by original-language word',
  add: 'Add keyword',
  manageSets: 'Manage sets',
  suggestions: 'Suggested keywords',
  addSuggestion: (l) => `Add ${l}`,
};

export interface KeywordLegendProps {
  enabled: boolean;
  onToggleEnabled: () => void;
  rows: LegendRow[];
  onToggleRow: (id: string) => void;
  onStep: (id: string, dir: 'next' | 'prev') => void;
  onAdd?: () => void;
  onEdit?: (id: string) => void;
  onManageSets?: () => void;
  suggestions?: LegendSuggestion[];
  onAcceptSuggestion?: (key: string) => void;
  /** Shown as a note, e.g. "Strong's marks need an interlinear translation." */
  interlinearNote?: string | null;
  /** Result of the last step ("Verse 5, 2 of 4"); announced politely. */
  announcement?: string;
  labels?: Partial<KeywordLegendLabels>;
  dir?: 'ltr' | 'rtl';
}

export function KeywordLegend({
  enabled, onToggleEnabled, rows, onToggleRow, onStep, onAdd, onEdit, onManageSets,
  suggestions, onAcceptSuggestion, interlinearNote, announcement, labels, dir,
}: KeywordLegendProps) {
  const L = { ...DEFAULT_KEYWORD_LEGEND_LABELS, ...labels };
  const off = !enabled;
  return (
    <section className="kth-legend" aria-label={L.title} dir={dir}>
      <div className="kth-legend__head">
        <h2 className="kth-legend__heading">{L.title}</h2>
        <button type="button" className="kth-btn kth-btn--sm" aria-pressed={enabled} onClick={onToggleEnabled}>
          {L.toggle}
        </button>
      </div>

      {rows.length === 0 ? (
        // While marks are off there are no rows to show, which is not the same as "nothing matches".
        off ? null : <p className="kth-legend__note">{L.empty}</p>
      ) : (
        <ul className="kth-legend__list">
          {rows.map((r) => (
            <li key={r.id} className="kth-legend__row">
              <span aria-hidden="true" className={swatchClass(r, 'kth-mark-swatch--static')} style={markColorStyle(r.color)}>
                {r.symbol ?? ''}
              </span>
              <button
                type="button"
                className="kth-btn kth-btn--ghost kth-legend__label"
                aria-pressed={!r.hidden}
                aria-label={r.hidden ? L.show(r.label) : L.hide(r.label)}
                disabled={off}
                onClick={() => onToggleRow(r.id)}
              >
                <span className={r.hidden ? 'kth-legend__label--hidden' : undefined}>{r.label}</span>
                {r.setName ? <span className="kth-legend__set"> ({r.setName})</span> : null}
              </button>
              {r.approximate ? (
                <span className="kth-legend__approx" title={L.approximateHint}>
                  {L.approximate}
                  <span className="kth-visually-hidden"> {L.approximateHint}</span>
                </span>
              ) : null}
              <span className="kth-legend__count" aria-label={L.count(r.count)}>{r.count}</span>
              <button type="button" className="kth-btn kth-btn--sm" aria-label={L.prev(r.label)} disabled={off || r.hidden || r.count === 0}
                onClick={() => onStep(r.id, 'prev')}>
                <span aria-hidden="true">{dir === 'rtl' ? '›' : '‹'}</span>
              </button>
              <button type="button" className="kth-btn kth-btn--sm" aria-label={L.next(r.label)} disabled={off || r.hidden || r.count === 0}
                onClick={() => onStep(r.id, 'next')}>
                <span aria-hidden="true">{dir === 'rtl' ? '‹' : '›'}</span>
              </button>
              {onEdit ? (
                <button type="button" className="kth-btn kth-btn--sm" aria-label={L.edit(r.label)} onClick={() => onEdit(r.id)}>
                  <span aria-hidden="true">{'✎'}</span>
                </button>
              ) : null}
            </li>
          ))}
        </ul>
      )}

      {interlinearNote ? <p className="kth-legend__note" role="note">{interlinearNote}</p> : null}

      {suggestions && suggestions.length > 0 ? (
        <div>
          <h3 className="kth-legend__heading">{L.suggestions}</h3>
          <ul className="kth-legend__list">
            {suggestions.map((s) => (
              <li key={s.key} className="kth-legend__row">
                <span className="kth-legend__label">{s.label}</span>
                <span className="kth-legend__count" aria-label={L.count(s.count)}>{s.count}</span>
                <button type="button" className="kth-btn kth-btn--sm" aria-label={L.addSuggestion(s.label)}
                  onClick={() => onAcceptSuggestion?.(s.key)}>
                  {L.add}
                </button>
              </li>
            ))}
          </ul>
        </div>
      ) : null}

      {onAdd || onManageSets ? (
        <div className="kth-legend__footer">
          {onAdd ? <button type="button" className="kth-btn kth-btn--sm" onClick={onAdd}>{L.add}</button> : null}
          {onManageSets ? <button type="button" className="kth-btn kth-btn--sm" onClick={onManageSets}>{L.manageSets}</button> : null}
        </div>
      ) : null}

      <div role="status" aria-live="polite" className="kth-visually-hidden">{announcement ?? ''}</div>
    </section>
  );
}
