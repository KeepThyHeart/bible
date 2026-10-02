/** WeekdayPicker: seven toggle buttons for the days a plan is read on; the last selected day cannot be cleared (task 0073). */
import type { ReadingPlans } from '@bible/core/browser';

type Weekday = ReadingPlans.Weekday;

export interface WeekdayPickerLabels {
  group: string;
}

export const DEFAULT_WEEKDAY_PICKER_LABELS: WeekdayPickerLabels = { group: 'Reading days' };

export const DEFAULT_WEEKDAY_NAMES: string[] = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

export interface WeekdayPickerProps {
  value: Weekday[];
  onChange: (days: Weekday[]) => void;
  /** Seven names, Sunday first. */
  weekdayNames?: string[];
  /** First day shown: 0 = Sunday (default), 1 = Monday. */
  firstDay?: 0 | 1;
  disabled?: boolean;
  labels?: Partial<WeekdayPickerLabels>;
  dir?: 'ltr' | 'rtl';
}

export function WeekdayPicker({ value, onChange, weekdayNames = DEFAULT_WEEKDAY_NAMES, firstDay = 0, disabled, labels, dir }: WeekdayPickerProps) {
  const L = { ...DEFAULT_WEEKDAY_PICKER_LABELS, ...labels };
  const order: Weekday[] = Array.from({ length: 7 }, (_, i) => ((i + firstDay) % 7) as Weekday);
  const toggle = (d: Weekday) => {
    if (value.includes(d)) {
      if (value.length <= 1) return;
      onChange(value.filter((x) => x !== d));
    } else {
      onChange([...value, d].sort((a, b) => a - b) as Weekday[]);
    }
  };
  return (
    <div className="kth-rp-weekdays" role="group" aria-label={L.group} dir={dir}>
      {order.map((d) => (
        <button key={d} type="button" className="kth-rp-weekdays__day" aria-pressed={value.includes(d)} disabled={disabled}
          onClick={() => toggle(d)}>
          {weekdayNames[d] ?? DEFAULT_WEEKDAY_NAMES[d]}
        </button>
      ))}
    </div>
  );
}
