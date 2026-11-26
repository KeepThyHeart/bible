/**
 * ReadingPlanWeekStrip: the current calendar week of one plan as seven small cells (task 0222 R3-11): the
 * weekday, a glyph for read / unread / rest / future, and a ring on today. No streak, no counting; the glyph
 * and a full aria-label per cell carry the state. Stateless; the days come from `weekStrip()` in core.
 */
import type { ReadingPlans } from '@bible/core/browser';

export interface ReadingPlanWeekStripLabels {
  /** Accessible name of the strip. */
  strip: string;
  read: string;
  unread: string;
  rest: string;
  future: string;
  today: string;
}

export const DEFAULT_READING_PLAN_WEEK_STRIP_LABELS: ReadingPlanWeekStripLabels = {
  strip: 'This week',
  read: 'read',
  unread: 'not read',
  rest: 'rest day',
  future: 'coming up',
  today: 'today',
};

const GLYPH: Record<ReadingPlans.WeekStripDay['state'], string> = { read: '✓', unread: '○', rest: '–', future: '·' };

export interface ReadingPlanWeekStripProps {
  days: readonly ReadingPlans.WeekStripDay[];
  /** Short weekday names, Sunday first (index = `weekday`). */
  weekdayNames: readonly string[];
  /** Localizes an ISO date for the aria-label. Default: the ISO string. */
  formatDate?: (iso: string) => string;
  labels?: Partial<ReadingPlanWeekStripLabels>;
  dir?: 'ltr' | 'rtl';
}

export function ReadingPlanWeekStrip({ days, weekdayNames, formatDate, labels, dir }: ReadingPlanWeekStripProps) {
  const l = { ...DEFAULT_READING_PLAN_WEEK_STRIP_LABELS, ...labels };
  return (
    <ul
      className="m-0 p-0 list-none flex gap-xs"
      aria-label={l.strip}
      dir={dir}
      data-testid="week-strip"
    >
      {days.map((d) => {
        const name = weekdayNames[d.weekday] ?? String(d.weekday);
        const state = l[d.state];
        const label = `${name} ${formatDate ? formatDate(d.date) : d.date}: ${state}${d.today ? `, ${l.today}` : ''}`;
        return (
          <li
            key={d.date}
            aria-label={label}
            title={label}
            data-state={d.state}
            data-today={d.today ? 'true' : undefined}
            className="flex flex-col items-center flex-1 text-xs"
            style={{
              minInlineSize: 0,
              padding: '0.25rem 0',
              borderRadius: 'var(--theme-radius-md, 6px)',
              outline: d.today ? '2px solid var(--theme-accent-primary)' : undefined,
              outlineOffset: d.today ? '-2px' : undefined,
              opacity: d.state === 'future' || d.state === 'rest' ? 0.6 : 1,
              // Today still to read: tinted cell, so the day left to do stands out.
              backgroundColor: d.today && d.state === 'unread' ? 'var(--theme-accent-bg, rgba(59,130,246,0.14))' : undefined,
            }}
          >
            <span className="kth-text-muted" aria-hidden="true">{name}</span>
            <span
              aria-hidden="true"
              className="text-base"
              style={{
                color: d.state === 'read' ? 'var(--theme-success, var(--theme-accent-primary))'
                  : d.today && d.state === 'unread' ? 'var(--theme-accent-primary)' : undefined,
                fontWeight: d.today && d.state === 'unread' ? 700 : undefined,
              }}
            >
              {GLYPH[d.state]}
            </span>
          </li>
        );
      })}
    </ul>
  );
}
