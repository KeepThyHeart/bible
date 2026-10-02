import type { SemanticRangeData } from '@bible/core/browser';
import { fillTemplate, mergeWordStudyLabels } from './wordStudyLabels';
import type { WordStudyLabels } from './wordStudyLabels';

export interface SemanticRangeSummaryProps {
  data: SemanticRangeData;
  /** The renderings the lexicon itself lists ("Strong's lists: ..."). */
  lexiconRenderings?: string[];
  labels?: Partial<WordStudyLabels>;
}

export function SemanticRangeSummary({ data, lexiconRenderings, labels }: SemanticRangeSummaryProps) {
  const l = mergeWordStudyLabels(labels);
  return (
    <section className="kth-ws-semantic" aria-label={l.semanticTitle}>
      <div className="kth-ws-section-head">
        <h3 className="kth-ws-section-title">{l.semanticTitle}</h3>
        <span className="kth-ws-semantic__source">{data.sourceLabel}</span>
      </div>
      <ul className="kth-ws-semantic__list">
        {data.senses.map((s) => (
          <li key={s.label} className="kth-ws-semantic__sense">
            <span className="kth-ws-semantic__label">{s.label}</span>
            {s.share !== undefined && (
              <span className="kth-ws-chart__track" aria-hidden="true">
                <span className="kth-ws-chart__bar" style={{ inlineSize: `${Math.round(s.share * 100)}%` }} />
              </span>
            )}
            {s.share !== undefined && <span className="kth-ws-semantic__share">{Math.round(s.share * 100)}%</span>}
            {s.detail && <span className="kth-ws-semantic__detail">{s.detail}</span>}
          </li>
        ))}
      </ul>
      {data.domains && data.domains.length > 0 && (
        <ul className="kth-ws-semantic__domains">
          {data.domains.map((d) => (
            <li key={d.code} className="kth-ws-chip" title={d.code}>{d.label}</li>
          ))}
        </ul>
      )}
      {lexiconRenderings && lexiconRenderings.length > 0 && (
        <p className="kth-ws-semantic__lexicon">{fillTemplate(l.lexiconRenderings, { list: lexiconRenderings.join(', ') })}</p>
      )}
    </section>
  );
}
