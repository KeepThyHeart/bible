/** ReadingPlanDayGrid: one small button per plan day, coloured by status, with a legend (task 0073). */
import type { ReadingPlans } from '@bible/core/browser';

export interface ReadingPlanDayGridLabels {
  /** "Day 5, read". */
  dayStatus: (day: number, status: ReadingPlans.DayStatus) => string;
  status: Record<ReadingPlans.DayStatus, string>;
  grid: string;
  legend: string;
}

export const DEFAULT_READING_PLAN_DAY_GRID_LABELS: ReadingPlanDayGridLabels = {
  dayStatus: (d, s) => `Day ${d}, ${DEFAULT_READING_PLAN_DAY_GRID_LABELS.status[s]}`,
  status: { done: 'read', partial: 'partly read', missed: 'missed', current: 'today', upcoming: 'upcoming' },
  grid: 'Plan days',
  legend: 'Legend',
};

const ORDER: ReadingPlans.DayStatus[] = ['done', 'partial', 'missed', 'current', 'upcoming'];
const DAY_CLASS: Record<ReadingPlans.DayStatus, string> = {
  done: 'kth-rp-grid__day kth-rp-grid__day--done',
  partial: 'kth-rp-grid__day kth-rp-grid__day--partial',
  missed: 'kth-rp-grid__day kth-rp-grid__day--missed',
  current: 'kth-rp-grid__day kth-rp-grid__day--current',
  upcoming: 'kth-rp-grid__day kth-rp-grid__day--upcoming',
};
const KEY_CLASS: Record<ReadingPlans.DayStatus, string> = {
  done: 'kth-rp-grid__key kth-rp-grid__key--done',
  partial: 'kth-rp-grid__key kth-rp-grid__key--partial',
  missed: 'kth-rp-grid__key kth-rp-grid__key--missed',
  current: 'kth-rp-grid__key kth-rp-grid__key--current',
  upcoming: 'kth-rp-grid__key kth-rp-grid__key--upcoming',
};

export interface ReadingPlanDayGridProps {
  statuses: ReadingPlans.DayStatus[];
  selectedDay?: number;
  onSelectDay: (day: number) => void;
  labels?: Partial<ReadingPlanDayGridLabels>;
  dir?: 'ltr' | 'rtl';
}

export function ReadingPlanDayGrid({ statuses, selectedDay, onSelectDay, labels, dir }: ReadingPlanDayGridProps) {
  const L = { ...DEFAULT_READING_PLAN_DAY_GRID_LABELS, ...labels };
  const names = { ...DEFAULT_READING_PLAN_DAY_GRID_LABELS.status, ...labels?.status };
  const dayLabel = labels?.dayStatus ?? ((d: number, s: ReadingPlans.DayStatus) => `Day ${d}, ${names[s]}`);
  return (
    <div className="kth-rp-grid" dir={dir}>
      <div className="kth-rp-grid__days" role="group" aria-label={L.grid}>
        {statuses.map((s, i) => (
          <button key={i} type="button" className={DAY_CLASS[s]} aria-label={dayLabel(i + 1, s)}
            aria-pressed={selectedDay === i + 1} onClick={() => onSelectDay(i + 1)}>
            {i + 1}
          </button>
        ))}
      </div>
      <ul className="kth-rp-grid__legend" aria-label={L.legend}>
        {ORDER.map((s) => (
          <li key={s} className="kth-rp-grid__legend-item">
            <span className={KEY_CLASS[s]} aria-hidden="true" />
            {names[s]}
          </li>
        ))}
      </ul>
    </div>
  );
}
