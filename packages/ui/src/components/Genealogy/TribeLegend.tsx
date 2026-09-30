/** TribeLegend: the four mothers of the tribes and the gold line to Christ, with their colours. */
import { cx } from './util';

export interface TribeLegendLabels {
  title: string;
  leah: string;
  rachel: string;
  bilhah: string;
  zilpah: string;
  christ: string;
}

export const DEFAULT_TRIBE_LEGEND_LABELS: TribeLegendLabels = {
  title: 'Legend',
  leah: 'Sons of Leah',
  rachel: 'Sons of Rachel',
  bilhah: 'Sons of Bilhah',
  zilpah: 'Sons of Zilpah',
  christ: 'Line to Christ',
};

export interface TribeLegendProps {
  labels?: Partial<TribeLegendLabels>;
  /** Include the gold "line to Christ" entry (default true). */
  showChrist?: boolean;
}

const MOTHERS = ['leah', 'rachel', 'bilhah', 'zilpah'] as const;

export function TribeLegend({ labels: overrides, showChrist = true }: TribeLegendProps) {
  const labels = { ...DEFAULT_TRIBE_LEGEND_LABELS, ...overrides };
  return (
    <section className="kth-genealogy-legend kth-genealogy-legend--tribes" aria-label={labels.title}>
      <ul className="kth-genealogy-legend__list">
        {MOTHERS.map((m) => (
          <li key={m} className="kth-genealogy-legend__item">
            <span className={cx('kth-genealogy-swatch', `kth-genealogy-color-${m}`)} aria-hidden="true" />
            {labels[m]}
          </li>
        ))}
        {showChrist && (
          <li className="kth-genealogy-legend__item">
            <span className="kth-genealogy-swatch kth-genealogy-swatch--christ" aria-hidden="true" />
            {labels.christ}
          </li>
        )}
      </ul>
    </section>
  );
}
