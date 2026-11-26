/**
 * Home for one followed plan (task 0222): where am I. Name, progress, finish date, then the hero: today's focus day
 * (`focusDay(today)`, the same "today" as the Today tab and the reader bar) with ONE primary action, the previous
 * day as one muted line and the week strip. A fixed plan that has fallen behind gets one collapsed row
 * (`BehindPanel`) with three named choices, never a banner.
 */
import React, { useMemo } from 'react';
import { ReadingPlans } from '@bible/core/browser';
import { Checkbox, Notice, ProgressBar, ReadingPlanWeekStrip } from '@bible/ui';
import { useI18n } from '../../../contexts/useI18n';
import { rpTextWith } from '../rpText';
import type { ScheduleUndo } from '../useReadingPlanNavStore';
import type { ReadingPlanLabelSet } from './useReadingPlanLabels';
import { shownPercent } from './readingPlanData';
import BehindPanel from './BehindPanel';
import type { ReschedulePreview } from './BehindPanel';

export interface ReadingTarget { day: number; index: number; reading: ReadingPlans.Reading }

export interface PlanHomeProps {
  detail: ReadingPlans.EnrollmentDetail;
  progress: ReadingPlans.ProgressIndex;
  labels: ReadingPlanLabelSet;
  displayName: string;
  /** "Move the dates" can be undone: the undo that still applies to this plan, if any. */
  scheduleUndo?: ScheduleUndo | null;
  onToggleReading: (day: number, index: number, done: boolean) => void;
  onToggleDay: (day: number, done: boolean) => void;
  onOpenReading: (target: ReadingTarget) => void;
  onOpenSettings: () => void;
  onViewPlan: () => void;
  onStartCatchUp: () => void;
  onStopCatchUp: () => void;
  loadPreview: () => Promise<ReschedulePreview>;
  onMoveDates: (preview: ReschedulePreview) => void;
  onUndoMove: (undo: ScheduleUndo) => void;
  onSwitchToFlexible: () => void;
  onResume: () => void;
}

/** One reading of the hero day or of a catch-up day, with its tick state. */
interface Row { day: number; index: number; reading: ReadingPlans.Reading; done: boolean }

function rowsOf(plan: ReadingPlans.PlanDefinition, progress: ReadingPlans.ProgressIndex, day: number): Row[] {
  return (plan.days[day - 1]?.readings ?? []).map((reading, index) => ({ day, index, reading, done: progress.get(day)?.has(index) ?? false }));
}

const PlanHome: React.FC<PlanHomeProps> = ({
  detail, progress, labels, displayName, scheduleUndo = null, onToggleReading, onToggleDay, onOpenReading, onOpenSettings, onViewPlan,
  onStartCatchUp, onStopCatchUp, loadPreview, onMoveDates, onUndoMove, onSwitchToFlexible, onResume,
}) => {
  const { t } = useI18n();
  const tx = (key: string, fallback: string, params: Record<string, unknown> = {}) => rpTextWith(t, key, fallback, params);
  const { enrollment, plan, today, stats } = detail;
  const paused = enrollment.status === 'paused';
  const completed = enrollment.status === 'completed' || today.completed;
  const fixed = enrollment.pacing === 'fixed';
  const dayCount = plan.days.length;

  const readingText = (r: ReadingPlans.Reading) => {
    const prefix = r.track ? `${labels.trackName(r.track, plan.tracks?.find((x) => x.id === r.track)?.name)}: ` : '';
    return `${prefix}${labels.formatReading(r)}`;
  };

  const focus = completed ? null : ReadingPlans.focusDay(today);
  const heroRows = useMemo(() => (focus === null ? [] : rowsOf(plan, progress, focus)), [plan, progress, focus]);
  const extraDays = completed ? [] : (today.catchUp?.days ?? []);
  const anyTicked = ReadingPlans.todaysReadings(today).some((r) => r.done);

  // The primary action: the first reading still due today, else read ahead on the first unread day.
  const { continueTarget, readAhead } = useMemo(() => {
    if (completed) return { continueTarget: null, readAhead: false };
    const due = ReadingPlans.dueReadings(today)[0];
    if (due) return { continueTarget: due as ReadingTarget, readAhead: false };
    const next = ReadingPlans.firstUnreadDay(plan, progress);
    const rows = next === null ? heroRows : rowsOf(plan, progress, next);
    const row = rows.find((r) => !r.done) ?? rows[0];
    return { continueTarget: row ? { day: row.day, index: row.index, reading: row.reading } : null, readAhead: true };
  }, [completed, today, plan, progress, heroRows]);

  const readingRow = (r: Row, hero: boolean) => {
    const text = readingText(r.reading);
    return (
      <li key={`${r.day}:${r.index}`} className="flex items-center gap-sm" data-testid="today-reading-row">
        <Checkbox checked={r.done} tone="success" ariaLabel={t('readingPlans.today.markReading', { reading: text })}
          onChange={(checked) => onToggleReading(r.day, r.index, checked)} />
        <button type="button" className={`kth-link${hero ? ' text-base font-medium' : ''}`}
          style={r.done ? { textDecoration: 'line-through', opacity: 0.7 } : undefined}
          aria-label={labels.todayCard.openReading(text)} onClick={() => onOpenReading({ day: r.day, index: r.index, reading: r.reading })}>
          {text}
        </button>
        <span className="kth-text-muted text-xs">
          {labels.todayCard.minutes(ReadingPlans.estimateMinutes(ReadingPlans.countVerses(r.reading.start, r.reading.end)))}
        </span>
      </li>
    );
  };

  const hero = () => {
    if (focus === null) return null;
    const dayDone = ReadingPlans.isDayDone(plan, progress, focus);
    const kind = today.focusKind ?? 'current';
    const date = fixed ? labels.formatDate(ReadingPlans.dateForDay(enrollment, focus)) : null;
    const tagText = kind === 'today' ? tx('readingPlans.home.tag.today', 'Today')
      : kind === 'nextUnread' ? tx('readingPlans.home.tag.nextUnread', 'Next unread')
        : kind === 'upcoming' ? tx('readingPlans.home.tag.upcoming', 'Next')
          : t('readingPlans.home.tag.current');
    return (
      <section
        className="kth-card flex flex-col gap-sm"
        style={{ borderInlineStart: '4px solid var(--theme-accent-primary)', backgroundColor: 'var(--theme-bg-secondary)' }}
        aria-current="step"
        aria-label={t('readingPlans.home.day', { day: focus })}
        data-testid="plan-day-current"
        data-focus-kind={kind}
      >
        <div className="flex flex-wrap items-baseline gap-sm">
          {date ? (
            <span className="text-lg font-semibold" data-testid="hero-title">
              {tx('readingPlans.home.heroDate', `${tagText} \u00B7 ${date} \u00B7 Day ${focus}`, { tag: tagText, date, day: focus })}
            </span>
          ) : (
            <>
              <span className="text-lg font-semibold" data-testid="hero-title">{t('readingPlans.home.day', { day: focus })}</span>
              <span className="text-xs kth-text-muted">{tagText}</span>
            </>
          )}
        </div>
        <ul className="m-0 p-0 list-none flex flex-col gap-xs" aria-label={labels.todayCard.readings}>
          {heroRows.map((r) => readingRow(r, true))}
        </ul>
        {extraDays.length > 0 ? (
          <div className="flex flex-col gap-xs" data-testid="catch-up-extras">
            <span className="text-sm font-medium">
              {tx('readingPlans.home.catchingUp', `Catching up: ${extraDays.map((c) => `Day ${c.day}`).join(', ')}`,
                { days: extraDays.map((c) => t('readingPlans.home.day', { day: c.day })).join(', ') })}
            </span>
            <ul className="m-0 p-0 list-none flex flex-col gap-xs">
              {extraDays.flatMap((c) => rowsOf(plan, progress, c.day)).map((r) => readingRow(r, false))}
            </ul>
          </div>
        ) : null}
        <div className="flex flex-wrap items-center gap-md pt-xs">
          {continueTarget ? (
            <button type="button" className="kth-btn kth-btn--primary" onClick={() => onOpenReading(continueTarget)}>
              {readAhead
                ? tx('readingPlans.home.readAhead', `Read ahead: ${readingText(continueTarget.reading)}`, { reading: readingText(continueTarget.reading) })
                : t(anyTicked ? 'readingPlans.home.continue' : 'readingPlans.home.start', { reading: readingText(continueTarget.reading) })}
            </button>
          ) : null}
          <button type="button" className="kth-link text-sm" onClick={() => onToggleDay(focus, !dayDone)}>
            {dayDone ? labels.todayCard.markDayUnread : labels.todayCard.markDayRead}
          </button>
        </div>
      </section>
    );
  };

  const previousLine = () => {
    if (focus === null || focus <= 1) return null;
    const day = focus - 1;
    const readings = (plan.days[day - 1]?.readings ?? []).map(readingText).join(', ');
    const state = ReadingPlans.isDayDone(plan, progress, day) ? labels.weekStrip.read : labels.weekStrip.unread;
    return (
      <p className="m-0 text-xs kth-text-muted" data-testid="plan-day-previous">
        {tx('readingPlans.home.previousLine', `Day ${day} \u00B7 ${readings} \u00B7 ${state}`, { day, readings, state })}
      </p>
    );
  };

  const behindBy = completed || paused ? 0 : today.behindBy;
  const aheadBy = completed ? 0 : today.aheadBy;

  const notice = () => {
    if (paused) {
      return <Notice tone="info" actions={<button type="button" className="kth-btn kth-btn--sm" onClick={onResume}>{t('readingPlans.action.resume')}</button>}>{t('readingPlans.home.paused')}</Notice>;
    }
    if (completed) return <Notice tone="success">{labels.todayCard.completed}</Notice>;
    if (behindBy > 0) return null; // the behind row below
    if (today.notStarted) return <Notice tone="info">{t('readingPlans.home.startsOn', { date: labels.formatDate(enrollment.startDate) })}</Notice>;
    if (today.restDay) return <Notice tone="info">{t('readingPlans.home.restDay')}</Notice>;
    return null;
  };

  const finish = () => {
    const est = stats.estimatedFinish;
    const sched = stats.scheduledFinish;
    if (stats.finishBasis === 'pace' && est) {
      return (
        <p className="m-0 text-sm kth-text-muted">
          <span title={t('readingPlans.detail.estimatedFinishHint')}>{t('readingPlans.detail.estimatedFinish', { date: labels.formatDate(est) })}</span>
          {fixed && sched && sched !== est ? <> · <span>{t('readingPlans.detail.scheduledFinish', { date: labels.formatDate(sched) })}</span></> : null}
        </p>
      );
    }
    if (stats.finishBasis === 'schedule' && sched) {
      return (
        <p className="m-0 text-sm kth-text-muted" title={fixed ? undefined : t('readingPlans.detail.scheduledFinishHint')}>
          {t('readingPlans.detail.scheduledFinish', { date: labels.formatDate(sched) })}
        </p>
      );
    }
    return null;
  };

  // One decimal while the plan is young, so the first days do not read as 0%.
  const percentShown = shownPercent(stats.percent);
  const noticeEl = notice();
  const week = detail.week ?? [];

  return (
    <div className="flex flex-col gap-md" data-testid="plan-home">
      <div className="flex flex-wrap items-baseline gap-sm">
        <h2 className="m-0 text-xl font-semibold me-auto">{displayName}</h2>
        {focus !== null ? <span className="text-sm kth-text-muted">{labels.todayCard.dayOf(focus, dayCount)}</span> : null}
        {aheadBy > 0 ? <span className="kth-badge" data-testid="ahead-chip">{t('readingPlans.today.aheadChip', { n: aheadBy })}</span> : null}
        {paused ? <span className="kth-badge">{t('readingPlans.status.paused')}</span> : null}
        {completed ? <span className="kth-badge">{t('readingPlans.status.completed')}</span> : null}
        <span className="flex gap-xs">
          <button type="button" className="kth-btn kth-btn--sm" onClick={onOpenSettings}>{t('readingPlans.home.planSettings')}</button>
          <button type="button" className="kth-btn kth-btn--sm" onClick={onViewPlan}>{t('readingPlans.home.viewPlan')}</button>
        </span>
      </div>
      <div className="flex flex-col gap-xs">
        <ProgressBar value={stats.percent} label={t('readingPlans.today.progress')} valueText={labels.todayCard.percent(percentShown)} />
        {finish()}
      </div>
      {noticeEl}
      {scheduleUndo ? (
        <Notice
          tone="success"
          role="status"
          actions={<button type="button" className="kth-btn kth-btn--sm" onClick={() => onUndoMove(scheduleUndo)}>{tx('readingPlans.behind.undo', 'Undo')}</button>}
        >
          <span data-testid="moved-notice">
            {tx('readingPlans.behind.moved',
              `Dates moved. The plan used to start on ${labels.formatDate(scheduleUndo.oldStartDate)}. You can also change the start date in Plan settings.`,
              { oldStart: labels.formatDate(scheduleUndo.oldStartDate) })}
          </span>
        </Notice>
      ) : null}
      {behindBy > 0 ? (
        <BehindPanel
          enrollment={enrollment} plan={plan} today={today} progress={progress} labels={labels} readingText={readingText}
          onToggleReading={onToggleReading} onOpenReading={onOpenReading}
          onStartCatchUp={onStartCatchUp} onStopCatchUp={onStopCatchUp}
          loadPreview={loadPreview} onMoveDates={onMoveDates} onSwitchToFlexible={onSwitchToFlexible}
        />
      ) : null}
      {hero()}
      {previousLine()}
      {!completed && week.length > 0 ? (
        <ReadingPlanWeekStrip days={week} weekdayNames={labels.weekdayNames} formatDate={labels.formatDate} labels={labels.weekStrip} />
      ) : null}
    </div>
  );
};

export default PlanHome;
