/**
 * ReadingPlanTodayCard: one active plan's "today" (task 0073). Header, a checkbox per reading with a time
 * estimate and an Open button, a "mark day read" toggle and, for fixed pacing, a behind banner with a catch-up
 * hint, reschedule and a confirmed switch to flexible. Stateless apart from the inline confirmation.
 */
import { useState } from 'react';
import { ReadingPlans } from '@bible/core/browser';

export interface ReadingPlanTodayCardLabels {
  /** "Day 3 of 365". */
  dayOf: (day: number, count: number) => string;
  percent: (p: number) => string;
  minutes: (n: number) => string;
  open: string;
  markDayRead: string;
  markDayUnread: string;
  completed: string;
  notStarted: string;
  restDay: string;
  behind: (n: number) => string;
  catchUp: (extraPerDay: number, days: number) => string;
  missed: (days: number[]) => string;
  reschedule: string;
  switchToFlexible: string;
  switchConfirmText: string;
  confirm: string;
  cancel: string;
  /** Accessible name of the Open button for one reading. */
  openReading: (reading: string) => string;
  /** Accessible name of the readings list. */
  readings: string;
}

export const DEFAULT_READING_PLAN_TODAY_CARD_LABELS: ReadingPlanTodayCardLabels = {
  dayOf: (d, n) => `Day ${d} of ${n}`,
  percent: (p) => `${p}%`,
  minutes: (n) => `~${n} min`,
  open: 'Open',
  markDayRead: 'Mark day read',
  markDayUnread: 'Mark day unread',
  completed: 'This plan is finished. Well done!',
  notStarted: 'This plan has not started yet.',
  restDay: 'Rest day',
  behind: (n) => (n === 1 ? 'You are 1 day behind' : `You are ${n} days behind`),
  catchUp: (e, d) => `Read ${e} extra ${e === 1 ? 'day' : 'days'} each day for ${d} ${d === 1 ? 'day' : 'days'} to catch up`,
  missed: (days) => `Missed: day ${days.join(', ')}`,
  reschedule: 'Reschedule from today',
  switchToFlexible: 'Switch to flexible',
  switchConfirmText:
    'A flexible plan does not keep track of missed days, so it may take longer than scheduled. Switch?',
  confirm: 'Confirm',
  cancel: 'Cancel',
  openReading: (r) => `Open ${r}`,
  readings: 'Readings',
};

export interface ReadingPlanTodayCardProps {
  view: ReadingPlans.TodayView;
  formatReading: (r: ReadingPlans.Reading) => string;
  trackName?: (trackId: string) => string;
  percent?: number;
  catchUp?: { extraPerDay: number; days: number } | null;
  onToggleReading: (index: number, done: boolean) => void;
  onToggleDay: (done: boolean) => void;
  onOpenReading: (reading: ReadingPlans.Reading) => void;
  onOpenPlan?: () => void;
  onShift?: () => void;
  onSwitchToFlexible?: () => void;
  labels?: Partial<ReadingPlanTodayCardLabels>;
  dir?: 'ltr' | 'rtl';
}

export function ReadingPlanTodayCard({
  view, formatReading, trackName, percent, catchUp, onToggleReading, onToggleDay, onOpenReading, onOpenPlan, onShift,
  onSwitchToFlexible, labels, dir,
}: ReadingPlanTodayCardProps) {
  const L = { ...DEFAULT_READING_PLAN_TODAY_CARD_LABELS, ...labels };
  const [confirming, setConfirming] = useState(false);
  const showBehind = view.behindBy > 0 && !view.completed && !view.notStarted;
  const restOnly = view.day === null && view.restDay && !view.completed && !view.notStarted;

  return (
    <section className="kth-rp-card" aria-label={view.planName} dir={dir}>
      <header className="kth-rp-card__header">
        {onOpenPlan ? (
          <button type="button" className="kth-btn kth-btn--ghost kth-rp-card__title" onClick={onOpenPlan}>{view.planName}</button>
        ) : (
          <h3 className="kth-rp-card__title">{view.planName}</h3>
        )}
        {view.day !== null ? <span className="kth-rp-card__day">{L.dayOf(view.day, view.dayCount)}</span> : null}
        {percent !== undefined ? <span className="kth-rp-card__percent">{L.percent(percent)}</span> : null}
      </header>

      {view.completed ? <p className="kth-rp-card__message">{L.completed}</p> : null}
      {view.notStarted ? <p className="kth-rp-card__message">{L.notStarted}</p> : null}
      {restOnly ? <p className="kth-rp-card__message">{L.restDay}</p> : null}

      {showBehind ? (
        <div className="kth-rp-behind">
          <p className="kth-rp-behind__text" role="status">{L.behind(view.behindBy)}</p>
          {catchUp ? <p className="kth-rp-behind__hint">{L.catchUp(catchUp.extraPerDay, catchUp.days)}</p> : null}
          {view.missedDays.length > 0 ? <p className="kth-rp-behind__missed">{L.missed(view.missedDays)}</p> : null}
          {confirming ? (
            <div className="kth-rp-behind__confirm" role="group" aria-label={L.switchToFlexible}>
              <p className="kth-rp-behind__hint">{L.switchConfirmText}</p>
              <div className="kth-rp-behind__actions">
                <button type="button" className="kth-btn kth-btn--sm kth-btn--primary"
                  onClick={() => { setConfirming(false); onSwitchToFlexible?.(); }}>{L.confirm}</button>
                <button type="button" className="kth-btn kth-btn--sm" onClick={() => setConfirming(false)}>{L.cancel}</button>
              </div>
            </div>
          ) : (
            <div className="kth-rp-behind__actions">
              {onShift ? <button type="button" className="kth-btn kth-btn--sm" onClick={onShift}>{L.reschedule}</button> : null}
              {onSwitchToFlexible ? (
                <button type="button" className="kth-btn kth-btn--sm" onClick={() => setConfirming(true)}>{L.switchToFlexible}</button>
              ) : null}
            </div>
          )}
        </div>
      ) : null}

      {view.day !== null && view.readings.length > 0 ? (
        <>
          <ul className="kth-rp-readings" aria-label={L.readings}>
            {view.readings.map((r) => {
              const ref = formatReading(r.reading);
              const prefix = r.reading.track && trackName ? `${trackName(r.reading.track)}: ` : '';
              return (
                <li key={r.index} className="kth-rp-reading">
                  <label className="kth-rp-reading__label">
                    <input type="checkbox" checked={r.done} onChange={(e) => onToggleReading(r.index, e.target.checked)} />
                    <span className={r.done ? 'kth-rp-reading__text kth-rp-reading__text--done' : 'kth-rp-reading__text'}>
                      {prefix}{ref}
                    </span>
                  </label>
                  <span className="kth-rp-reading__minutes">{L.minutes(ReadingPlans.estimateMinutes(r.verses))}</span>
                  <button type="button" className="kth-btn kth-btn--sm" aria-label={L.openReading(prefix + ref)}
                    onClick={() => onOpenReading(r.reading)}>{L.open}</button>
                </li>
              );
            })}
          </ul>
          <div className="kth-rp-card__footer">
            <button type="button" className="kth-btn kth-btn--sm" onClick={() => onToggleDay(!view.dayDone)}>
              {view.dayDone ? L.markDayUnread : L.markDayRead}
            </button>
          </div>
        </>
      ) : null}
    </section>
  );
}
