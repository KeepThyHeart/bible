/**
 * The Today tab of the Reading plans app (task 0222 R3-5), shown when two or more plans are active: one compact card
 * per active plan with what is due today (tick boxes, open links) and one Continue button. Uses the same
 * `todaysReadings(view)` / `dueReadings(view)` as Home and the reader bar, so they never disagree.
 */
import React from 'react';
import { ReadingPlans } from '@bible/core/browser';
import { Checkbox } from '@bible/ui';
import { useI18n } from '../../../contexts/useI18n';
import { rpTextWith } from '../rpText';
import type { ReadingPlanLabelSet } from './useReadingPlanLabels';

export interface TodayTabItem {
  detail: ReadingPlans.EnrollmentDetail;
  displayName: string;
}

export interface TodayTabProps {
  items: TodayTabItem[];
  labels: ReadingPlanLabelSet;
  onToggleReading: (enrollmentId: string, day: number, index: number, done: boolean) => void;
  onOpenReading: (enrollmentId: string, target: { day: number; index: number; reading: ReadingPlans.Reading }) => void;
  /** Open this plan's own tab. */
  onSelectPlan: (enrollmentId: string) => void;
}

const TodayTab: React.FC<TodayTabProps> = ({ items, labels, onToggleReading, onOpenReading, onSelectPlan }) => {
  const { t } = useI18n();
  const tx = (key: string, fallback: string, params: Record<string, unknown> = {}) => rpTextWith(t, key, fallback, params);

  const text = (plan: ReadingPlans.PlanDefinition, r: ReadingPlans.Reading) => {
    const prefix = r.track ? `${labels.trackName(r.track, plan.tracks?.find((x) => x.id === r.track)?.name)}: ` : '';
    return `${prefix}${labels.formatReading(r)}`;
  };

  return (
    <div className="flex flex-col gap-md" data-testid="today-tab">
      {items.map(({ detail, displayName }) => {
        const { enrollment, plan, today } = detail;
        const rows = ReadingPlans.todaysReadings(today);
        const due = ReadingPlans.dueReadings(today);
        const target = due[0];
        const focus = ReadingPlans.focusDay(today);
        const kind = today.focusKind;
        const tag = kind === 'today' ? tx('readingPlans.home.tag.today', 'Today')
          : kind === 'nextUnread' ? tx('readingPlans.home.tag.nextUnread', 'Next unread')
            : kind === 'upcoming' ? tx('readingPlans.home.tag.upcoming', 'Next')
              : t('readingPlans.home.tag.current');
        const anyTicked = rows.some((r) => r.done);
        return (
          <section key={enrollment.id} className="kth-card flex flex-col gap-sm" aria-label={displayName} data-testid="today-card">
            <div className="flex flex-wrap items-baseline gap-sm">
              <button type="button" className="kth-link text-base font-semibold me-auto" onClick={() => onSelectPlan(enrollment.id)}>{displayName}</button>
              {focus !== null ? <span className="text-xs kth-text-muted">{`${tag} · ${t('readingPlans.home.day', { day: focus })}`}</span> : null}
            </div>
            {rows.length > 0 ? (
              <ul className="m-0 p-0 list-none flex flex-col gap-xs" aria-label={labels.todayCard.readings}>
                {rows.map((r, i) => {
                  const label = text(plan, r.reading);
                  const extra = r.day !== focus;
                  const firstExtra = extra && (i === 0 || rows[i - 1].day === focus);
                  const extraDays = [...new Set(rows.filter((x) => x.day !== focus).map((x) => x.day))];
                  return (
                    <React.Fragment key={`${r.day}:${r.index}`}>
                    {firstExtra ? (
                      <li className="text-xs font-medium kth-text-muted" data-testid="today-catching-up">
                        {tx('readingPlans.home.catchingUp', `Catching up: ${extraDays.map((d) => `Day ${d}`).join(', ')}`,
                          { days: extraDays.map((d) => t('readingPlans.home.day', { day: d })).join(', ') })}
                      </li>
                    ) : null}
                    <li className="flex items-center gap-sm">
                      <Checkbox checked={r.done} tone="success" ariaLabel={t('readingPlans.today.markReading', { reading: label })}
                        onChange={(checked) => onToggleReading(enrollment.id, r.day, r.index, checked)} />
                      <button type="button" className="kth-link" style={r.done ? { textDecoration: 'line-through', opacity: 0.7 } : undefined}
                        aria-label={labels.todayCard.openReading(label)}
                        onClick={() => onOpenReading(enrollment.id, { day: r.day, index: r.index, reading: r.reading })}>{label}</button>
                    </li>
                    </React.Fragment>
                  );
                })}
              </ul>
            ) : (
              <p className="m-0 text-sm kth-text-muted">
                {today.restDay ? t('readingPlans.home.restDay') : today.notStarted
                  ? t('readingPlans.home.startsOn', { date: labels.formatDate(enrollment.startDate) }) : labels.todayCard.completed}
              </p>
            )}
            {target ? (
              <div>
                <button type="button" className="kth-btn kth-btn--primary kth-btn--sm"
                  onClick={() => onOpenReading(enrollment.id, target)}>
                  {t(anyTicked ? 'readingPlans.home.continue' : 'readingPlans.home.start', { reading: text(plan, target.reading) })}
                </button>
              </div>
            ) : rows.length > 0 ? (
              <p className="m-0 text-sm kth-text-muted">{tx('readingPlans.today.allDone', 'All done for today.')}</p>
            ) : null}
          </section>
        );
      })}
    </div>
  );
};

export default TodayTab;
