/**
 * One followed plan on the Today view (task 0196): name, day N of M, progress bar and ahead / behind chip;
 * today's readings (the reference is a link that opens it in the reader, the checkbox marks it read, and
 * the two never share a click); a Previous / Next strip around today's readings; and one collapsed
 * "N overdue readings" row that expands to the readings left unread on missed days.
 */
import React, { useMemo, useState } from 'react';
import { ReadingPlans } from '@bible/core/browser';
import { useI18n } from '../../../contexts/useI18n';
import type { ReadingPlanLabelSet } from './useReadingPlanLabels';

export interface ReadingTarget { day: number; index: number; reading: ReadingPlans.Reading }

interface Props {
  view: ReadingPlans.TodayView;
  plan: ReadingPlans.PlanDefinition | undefined;
  progress: ReadingPlans.ProgressIndex;
  percent: number | undefined;
  displayName: string;
  labels: ReadingPlanLabelSet;
  onToggleReading: (day: number, index: number, done: boolean) => void;
  onToggleDay: (day: number, done: boolean) => void;
  onOpenReading: (target: ReadingTarget) => void;
  onOpenPlan: () => void;
  onShift: () => void;
  onSwitchToFlexible: () => void;
}

const secondary = { color: 'var(--theme-text-secondary)' } as const;
const linkClass = 'bg-transparent border-0 p-0 text-start cursor-pointer text-accent hover:underline';

const TodayPlanCard: React.FC<Props> = ({
  view, plan, progress, percent, displayName, labels, onToggleReading, onToggleDay, onOpenReading, onOpenPlan, onShift, onSwitchToFlexible,
}) => {
  const { t } = useI18n();
  const [overdueOpen, setOverdueOpen] = useState(false);
  const [confirmingFlexible, setConfirmingFlexible] = useState(false);
  const day = view.day;
  const readingText = (r: ReadingPlans.Reading) => {
    const prefix = r.track ? `${labels.trackName(r.track, plan?.tracks?.find((x) => x.id === r.track)?.name)}: ` : '';
    return `${prefix}${labels.formatReading(r)}`;
  };
  const neighbours = useMemo(
    () => (plan && day !== null ? ReadingPlans.readingNeighbours(plan, day) : { previous: null, next: null }),
    [plan, day],
  );
  const overdue = useMemo(
    () => (plan && view.pacing === 'fixed' ? ReadingPlans.overdueReadings(plan, progress, view.missedDays.filter((d) => d !== day)) : []),
    [plan, progress, view.pacing, view.missedDays, day],
  );
  const catchUp = ReadingPlans.catchUpSuggestion(view.behindBy);
  const restOnly = day === null && view.restDay && !view.completed && !view.notStarted;
  const pct = Math.max(0, Math.min(100, percent ?? 0));

  const readingRow = (target: ReadingTarget, done: boolean, key: string, lead?: string) => {
    const text = readingText(target.reading);
    return (
      <li key={key} className="flex items-center gap-sm" data-testid="today-reading-row">
        <input type="checkbox" checked={done} aria-label={t('readingPlans.today.markReading', { reading: text })}
          onChange={(ev) => onToggleReading(target.day, target.index, ev.target.checked)} />
        {lead ? <span className="text-xs" style={secondary}>{lead}</span> : null}
        <button type="button" className={linkClass} style={done ? { textDecoration: 'line-through', opacity: 0.7 } : undefined}
          aria-label={labels.todayCard.openReading(text)} onClick={() => onOpenReading(target)}>
          {text}
        </button>
        <span className="text-xs" style={secondary}>{labels.todayCard.minutes(ReadingPlans.estimateMinutes(ReadingPlans.countVerses(target.reading.start, target.reading.end)))}</span>
      </li>
    );
  };

  const stepButton = (ref: ReadingPlans.PlanReadingRef | null, kind: 'previous' | 'next') => {
    if (!ref) return <span />;
    const text = readingText(ref.reading);
    return (
      <button type="button" className={`${linkClass} text-sm`} onClick={() => onOpenReading(ref)}
        aria-label={t(kind === 'previous' ? 'readingPlans.today.previousNamed' : 'readingPlans.today.nextNamed', { reading: text, day: ref.day })}>
        {kind === 'previous' ? '‹ ' : ''}
        <span style={secondary}>{t(kind === 'previous' ? 'readingPlans.today.previous' : 'readingPlans.today.next', { day: ref.day })} </span>
        {text}{kind === 'next' ? ' ›' : ''}
      </button>
    );
  };

  return (
    <section className="flex flex-col gap-sm p-md rounded border border-border" aria-label={displayName} data-testid="today-plan-card">
      <header className="flex flex-wrap items-baseline gap-sm">
        <button type="button" className={`${linkClass} text-base font-semibold`} onClick={onOpenPlan}>{displayName}</button>
        {day !== null ? <span className="text-sm" style={secondary}>{labels.todayCard.dayOf(day, view.dayCount)}</span> : null}
        {view.behindBy > 0 && !view.completed ? (
          <span className="text-xs px-xs rounded" data-testid="behind-chip" style={{ backgroundColor: 'var(--theme-warning-bg, #fdecc8)', color: 'var(--theme-warning-text, #7a4b00)' }}>
            {t('readingPlans.today.behindChip', { n: view.behindBy })}
          </span>
        ) : null}
        {view.aheadBy > 0 && !view.completed ? (
          <span className="text-xs px-xs rounded" data-testid="ahead-chip" style={{ backgroundColor: 'var(--theme-bg-secondary)', ...secondary }}>
            {t('readingPlans.today.aheadChip', { n: view.aheadBy })}
          </span>
        ) : null}
      </header>
      <div className="flex items-center gap-sm">
        <div className="flex-1 h-1.5 rounded overflow-hidden" style={{ backgroundColor: 'var(--theme-bg-secondary)' }}
          role="progressbar" aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.round(pct)} aria-label={t('readingPlans.today.progress')}>
          <div style={{ width: `${pct}%`, height: '100%', backgroundColor: 'var(--theme-accent, #3b82f6)' }} />
        </div>
        <span className="text-xs" style={secondary}>{labels.todayCard.percent(Math.round(pct))}</span>
      </div>

      {view.completed ? <p className="m-0 text-sm" style={secondary}>{labels.todayCard.completed}</p> : null}
      {view.notStarted ? <p className="m-0 text-sm" style={secondary}>{labels.todayCard.notStarted}</p> : null}
      {restOnly ? <p className="m-0 text-sm" style={secondary}>{labels.todayCard.restDay}</p> : null}

      {day !== null && view.readings.length > 0 ? (
        <>
          <ul className="m-0 p-0 list-none flex flex-col gap-xs" aria-label={labels.todayCard.readings}>
            {view.readings.map((r) => readingRow({ day, index: r.index, reading: r.reading }, r.done, `t${r.index}`))}
          </ul>
          <div className="flex justify-between gap-sm" data-testid="today-strip" aria-label={t('readingPlans.today.strip')} role="group">
            {stepButton(neighbours.previous && overdue.some((o) => o.day === neighbours.previous!.day && o.index === neighbours.previous!.index) ? null : neighbours.previous, 'previous')}
            {stepButton(neighbours.next, 'next')}
          </div>
          <div>
            <button type="button" className="kth-btn kth-btn--sm" onClick={() => onToggleDay(day, !view.dayDone)}>
              {view.dayDone ? labels.todayCard.markDayUnread : labels.todayCard.markDayRead}
            </button>
          </div>
        </>
      ) : null}

      {overdue.length > 0 ? (
        <div data-testid="overdue-group">
          <button type="button" className="kth-btn kth-btn--sm kth-btn--ghost" aria-expanded={overdueOpen} onClick={() => setOverdueOpen((o) => !o)}>
            {overdueOpen ? '▾' : '▸'} {t('readingPlans.today.overdue', { count: overdue.length })}
          </button>
          {overdueOpen ? (
            <ul className="m-0 mt-xs p-0 list-none flex flex-col gap-xs">
              {overdue.map((o) => readingRow(o, false, `o${o.day}-${o.index}`, t('readingPlans.today.overdueDay', { day: o.day })))}
            </ul>
          ) : null}
        </div>
      ) : null}

      {view.behindBy > 0 && !view.completed ? (
        <div className="flex flex-col gap-xs">
          {catchUp ? <p className="m-0 text-xs" style={secondary}>{labels.todayCard.catchUp(catchUp.extraPerDay, catchUp.days)}</p> : null}
          {confirmingFlexible ? (
            <div role="group" aria-label={labels.todayCard.switchToFlexible} className="flex flex-col gap-xs">
              <p className="m-0 text-xs">{labels.todayCard.switchConfirmText}</p>
              <div className="flex gap-sm">
                <button type="button" className="kth-btn kth-btn--sm kth-btn--primary" onClick={() => { setConfirmingFlexible(false); onSwitchToFlexible(); }}>{labels.todayCard.confirm}</button>
                <button type="button" className="kth-btn kth-btn--sm" onClick={() => setConfirmingFlexible(false)}>{labels.todayCard.cancel}</button>
              </div>
            </div>
          ) : (
            <div className="flex gap-sm">
              <button type="button" className="kth-btn kth-btn--sm" onClick={onShift}>{labels.todayCard.reschedule}</button>
              <button type="button" className="kth-btn kth-btn--sm" onClick={() => setConfirmingFlexible(true)}>{labels.todayCard.switchToFlexible}</button>
            </div>
          )}
        </div>
      ) : null}
    </section>
  );
};

export default TodayPlanCard;
