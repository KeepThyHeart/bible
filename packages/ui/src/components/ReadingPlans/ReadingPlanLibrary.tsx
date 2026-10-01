/** ReadingPlanLibrary: the list of plans a reader can start (task 0073). */
import { ReadingPlans } from '@bible/core/browser';

export interface ReadingPlanLibraryLabels {
  empty: string;
  /** "365 days · about 12 min a day". */
  summary: (days: number, minutesPerDay: number) => string;
  tracks: (n: number) => string;
  start: string;
  preview: string;
  delete: string;
  startNamed: (name: string) => string;
  previewNamed: (name: string) => string;
  deleteNamed: (name: string) => string;
  list: string;
}

export const DEFAULT_READING_PLAN_LIBRARY_LABELS: ReadingPlanLibraryLabels = {
  empty: 'No reading plans yet.',
  summary: (d, m) => `${d} ${d === 1 ? 'day' : 'days'} · about ${m} min a day`,
  tracks: (n) => `${n} tracks`,
  start: 'Start',
  preview: 'Preview',
  delete: 'Delete',
  startNamed: (n) => `Start ${n}`,
  previewNamed: (n) => `Preview ${n}`,
  deleteNamed: (n) => `Delete ${n}`,
  list: 'Reading plans',
};

export interface ReadingPlanLibraryProps {
  plans: ReadingPlans.PlanSummary[];
  nameOf?: (p: ReadingPlans.PlanSummary) => string;
  descriptionOf?: (p: ReadingPlans.PlanSummary) => string | undefined;
  onStart: (key: string) => void;
  onDelete?: (key: string) => void;
  onPreview?: (key: string) => void;
  labels?: Partial<ReadingPlanLibraryLabels>;
  dir?: 'ltr' | 'rtl';
}

export function ReadingPlanLibrary({ plans, nameOf, descriptionOf, onStart, onDelete, onPreview, labels, dir }: ReadingPlanLibraryProps) {
  const L = { ...DEFAULT_READING_PLAN_LIBRARY_LABELS, ...labels };
  if (plans.length === 0) return <p className="kth-rp-library__empty" dir={dir}>{L.empty}</p>;
  return (
    <ul className="kth-rp-library" aria-label={L.list} dir={dir}>
      {plans.map((p) => {
        const name = nameOf ? nameOf(p) : p.name;
        const description = descriptionOf ? descriptionOf(p) : p.description;
        const perDay = ReadingPlans.estimateMinutes(p.verseCount / Math.max(1, p.dayCount));
        return (
          <li key={p.key} className="kth-rp-library__item">
            <div className="kth-rp-library__body">
              <h3 className="kth-rp-library__name">{name}</h3>
              {description ? <p className="kth-rp-library__description">{description}</p> : null}
              <p className="kth-rp-library__meta">
                {L.summary(p.dayCount, perDay)}
                {p.trackCount > 1 ? ` · ${L.tracks(p.trackCount)}` : ''}
              </p>
            </div>
            <div className="kth-rp-library__actions">
              {onPreview ? (
                <button type="button" className="kth-btn kth-btn--sm" aria-label={L.previewNamed(name)} onClick={() => onPreview(p.key)}>{L.preview}</button>
              ) : null}
              {onDelete && p.source === 'user' ? (
                <button type="button" className="kth-btn kth-btn--sm kth-btn--danger" aria-label={L.deleteNamed(name)} onClick={() => onDelete(p.key)}>{L.delete}</button>
              ) : null}
              <button type="button" className="kth-btn kth-btn--sm kth-btn--primary" aria-label={L.startNamed(name)} onClick={() => onStart(p.key)}>{L.start}</button>
            </div>
          </li>
        );
      })}
    </ul>
  );
}
