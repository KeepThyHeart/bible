import type { RenderingGroup } from '@bible/core/browser';
import { fillTemplate, mergeWordStudyLabels } from './wordStudyLabels';
import type { WordStudyLabels } from './wordStudyLabels';

export interface RenderingChartProps {
  groups: RenderingGroup[];
  /** Heading, e.g. "How it is rendered" or "Forms found". */
  title: string;
  selectedKey?: string;
  /** Called with the key, or undefined to clear (clicking the selected bar). */
  onSelect: (key: string | undefined) => void;
  /** Rows shown before the "other" rollup. Default 12. */
  maxRows?: number;
  mode?: 'head' | 'phrase';
  /** The head/phrase toggle is shown only when this is given. */
  onModeChange?: (mode: 'head' | 'phrase') => void;
  labels?: Partial<WordStudyLabels>;
}

function pct(share: number): string {
  const p = share * 100;
  return `${p >= 10 || p === 0 ? Math.round(p) : Math.round(p * 10) / 10}%`;
}

export function RenderingChart({ groups, title, selectedKey, onSelect, maxRows = 12, mode = 'head', onModeChange, labels }: RenderingChartProps) {
  const l = mergeWordStudyLabels(labels);
  const shown = groups.slice(0, maxRows);
  const rest = groups.slice(maxRows);
  const restCount = rest.reduce((n, g) => n + g.count, 0);
  const restShare = rest.reduce((n, g) => n + g.share, 0);
  const maxShare = Math.max(0.0001, ...groups.map((g) => g.share));
  return (
    <section className="kth-ws-chart" aria-label={title}>
      <div className="kth-ws-section-head">
        <h3 className="kth-ws-section-title">{title}</h3>
        {onModeChange && (
          <div className="kth-ws-chart__modes" role="group" aria-label={l.modeGroup}>
            <button type="button" className={mode === 'head' ? 'kth-btn kth-btn--sm kth-btn--primary' : 'kth-btn kth-btn--sm'} aria-pressed={mode === 'head'} onClick={() => onModeChange('head')}>{l.modeHead}</button>
            <button type="button" className={mode === 'phrase' ? 'kth-btn kth-btn--sm kth-btn--primary' : 'kth-btn kth-btn--sm'} aria-pressed={mode === 'phrase'} onClick={() => onModeChange('phrase')}>{l.modePhrase}</button>
          </div>
        )}
      </div>
      <ul className="kth-ws-chart__list">
        {shown.map((g) => {
          const selected = g.key === selectedKey;
          return (
            <li key={g.key} className="kth-ws-chart__item">
              <button
                type="button"
                className={selected ? 'kth-ws-chart__row kth-ws-chart__row--selected' : 'kth-ws-chart__row'}
                aria-pressed={selected}
                onClick={() => onSelect(selected ? undefined : g.key)}
              >
                <span className="kth-ws-chart__label">{g.label}</span>
                <span className="kth-ws-chart__track" aria-hidden="true">
                  <span className="kth-ws-chart__bar" style={{ inlineSize: `${(g.share / maxShare) * 100}%` }} />
                </span>
                <span className="kth-ws-chart__count">{g.count} <span className="kth-ws-chart__share">({pct(g.share)})</span></span>
              </button>
            </li>
          );
        })}
        {rest.length > 0 && (
          <li className="kth-ws-chart__item">
            <div className="kth-ws-chart__row kth-ws-chart__row--other">
              <span className="kth-ws-chart__label">{fillTemplate(l.other, { count: rest.length })}</span>
              <span className="kth-ws-chart__track" aria-hidden="true">
                <span className="kth-ws-chart__bar" style={{ inlineSize: `${(restShare / maxShare) * 100}%` }} />
              </span>
              <span className="kth-ws-chart__count">{restCount} <span className="kth-ws-chart__share">({pct(restShare)})</span></span>
            </div>
          </li>
        )}
      </ul>
    </section>
  );
}
