/** KeyLegend: what the lines, outlines, dots and badges of the tree mean. Shown on demand by the explorer's Key button. */

export interface KeyLegendLabels {
  title: string;
  christLine: string;
  parentLine: string;
  spouseLine: string;
  legalLine: string;
  gapLine: string;
  sameLine: string;
  onLine: string;
  oneText: string;
  disputedNode: string;
  badge: string;
  male: string;
  female: string;
}

export const DEFAULT_KEY_LEGEND_LABELS: KeyLegendLabels = {
  title: 'Key',
  christLine: 'Line to Christ',
  parentLine: 'Parent and child',
  spouseLine: 'Husband and wife',
  legalLine: 'Legal father (by marriage or law)',
  gapLine: 'Generations the text skips',
  sameLine: 'Possibly the same person',
  onLine: 'Gold dot: on the line to Christ',
  oneText: 'Dashed outline: named in one text only',
  disputedNode: 'Dotted outline: disputed',
  badge: '+N: more people not shown here',
  male: 'Square corners: man',
  female: 'Round ends: woman',
};

function Swatch({ cls, double }: { cls: string; double?: boolean }) {
  return (
    <svg className="kth-genealogy-key__swatch" width="36" height="10" viewBox="0 0 36 10" aria-hidden="true">
      {double ? (
        <g className={cls}><path d="M2 3H34" /><path d="M2 7H34" /></g>
      ) : (
        <path className={cls} d="M2 5H34" />
      )}
    </svg>
  );
}

export function KeyLegend({ labels: overrides }: { labels?: Partial<KeyLegendLabels> }) {
  const l = { ...DEFAULT_KEY_LEGEND_LABELS, ...overrides };
  const edges: Array<[string, string, boolean?]> = [
    ['kth-genealogy-edge kth-genealogy-edge--christ', l.christLine],
    ['kth-genealogy-edge', l.parentLine],
    ['kth-genealogy-edge kth-genealogy-edge--spouse', l.spouseLine],
    ['kth-genealogy-edge', l.legalLine, true],
    ['kth-genealogy-edge kth-genealogy-edge--gap', l.gapLine],
    ['kth-genealogy-edge kth-genealogy-edge--same_as', l.sameLine],
  ];
  return (
    <section className="kth-genealogy-legend kth-genealogy-key" aria-label={l.title}>
      <ul className="kth-genealogy-legend__list">
        {edges.map(([cls, text, double]) => (
          <li key={text} className="kth-genealogy-legend__item"><Swatch cls={cls} double={double} />{text}</li>
        ))}
        <li className="kth-genealogy-legend__item">{l.onLine}</li>
        <li className="kth-genealogy-legend__item">{l.oneText}</li>
        <li className="kth-genealogy-legend__item">{l.disputedNode}</li>
        <li className="kth-genealogy-legend__item">{l.badge}</li>
        <li className="kth-genealogy-legend__item">{l.male}; {l.female}</li>
      </ul>
    </section>
  );
}
