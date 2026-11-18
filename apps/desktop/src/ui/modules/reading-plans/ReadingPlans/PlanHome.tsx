/**
 * Home for one followed plan (task 0222): where am I. Name, progress, finish date, at most one notice, and the
 * previous / current / next day cards with ONE primary action: continue reading.
 */
import React, { useMemo, useState } from 'react';
import { ReadingPlans } from '@bible/core/browser';
import { Checkbox, MessageBox, Notice, ProgressBar } from '@bible/ui';
import { useI18n } from '../../../contexts/useI18n';
import type { ReadingPlanLabelSet } from './useReadingPlanLabels';

export interface ReadingTarget { day: number; index: number; reading: ReadingPlans.Reading }

export interface PlanHomeProps {
  detail: ReadingPlans.EnrollmentDetail;
  progress: ReadingPlans.ProgressIndex;
  labels: ReadingPlanLabelSet;
  displayName: string;
  onToggleReading: (day: number, index: number, done: boolean) => void;
  onToggleDay: (day: number, done: boolean) => void;
  onOpenReading: (target: ReadingTarget) => void;
  onOpenSettings: () => void;
  onViewPlan: () => void;
  onShift: () => void;
  onSwitchToFlexible: () => void;
  onResume: () => void;
}

type Kind = 'previous' | 'current' | 'next';

const PlanHome: React.FC<PlanHomeProps> = ({
  detail, progress, labels, displayName, onToggleReading, onToggleDay, onOpenReading, onOpenSettings, onViewPlan,
  onShift, onSwitchToFlexible, onResume,
}) => {
  const { t } = useI18n();
  const [confirmFlexible, setConfirmFlexible] = useState(false);
  const { enrollment, plan, today, stats } = detail;
  const windowDays = useMemo(() => ReadingPlans.currentDayWindow(plan, progress), [plan, progress]);
  const paused = enrollment.status === 'paused';
  const completed = enrollment.status === 'completed' || today.completed;
  const fixed = enrollment.pacing === 'fixed';
  const dayCount = plan.days.length;

  const readingText = (r: ReadingPlans.Reading) => {
    const prefix = r.track ? `${labels.trackName(r.track, plan.tracks?.find((x) => x.id === r.track)?.name)}: ` : '';
    return `${prefix}${labels.formatReading(r)}`;
  };
  const anyTicked = useMemo(() => {
    for (const set of progress.values()) if (set.size > 0) return true;
    return false;
  }, [progress]);

  const continueTarget: ReadingTarget | null = useMemo(() => {
    const day = windowDays.current;
    if (day === null) return null;
    const readings = plan.days[day - 1]?.readings ?? [];
    const done = progress.get(day);
    const index = readings.findIndex((_, i) => !done?.has(i));
    const at = index >= 0 ? index : 0;
    return readings[at] ? { day, index: at, reading: readings[at] } : null;
  }, [windowDays, plan, progress]);

  const readingRow = (day: number, index: number, reading: ReadingPlans.Reading, hero: boolean) => {
    const text = readingText(reading);
    const done = progress.get(day)?.has(index) ?? false;
    return (
      <li key={index} className="flex items-center gap-sm" data-testid="today-reading-row">
        <Checkbox checked={done} tone="success" ariaLabel={t('readingPlans.today.markReading', { reading: text })}
          onChange={(checked) => onToggleReading(day, index, checked)} />
        <button type="button" className={`kth-link${hero ? ' text-base font-medium' : ''}`}
          style={done ? { textDecoration: 'line-through', opacity: 0.7 } : undefined}
          aria-label={labels.todayCard.openReading(text)} onClick={() => onOpenReading({ day, index, reading })}>
          {text}
        </button>
        <span className="kth-text-muted text-xs">
          {labels.todayCard.minutes(ReadingPlans.estimateMinutes(ReadingPlans.countVerses(reading.start, reading.end)))}
        </span>
      </li>
    );
  };

  const dayCard = (day: number | null, kind: Kind) => {
    if (day === null) return null;
    const readings = plan.days[day - 1]?.readings ?? [];
    const hero = kind === 'current';
    const dayDone = ReadingPlans.isDayDone(plan, progress, day);
    const date = fixed ? labels.formatDate(ReadingPlans.dateForDay(enrollment, day)) : null;
    return (
      <li
        key={kind}
        className={hero ? 'kth-card flex flex-col gap-sm' : 'flex flex-col gap-xs px-md py-sm text-sm'}
        style={hero ? { borderInlineStart: '4px solid var(--theme-accent-primary)', backgroundColor: 'var(--theme-bg-secondary)' } : undefined}
        aria-current={hero ? 'step' : undefined}
        data-testid={`plan-day-${kind}`}
      >
        <div className="flex flex-wrap items-baseline gap-sm">
          <span className={hero ? 'text-lg font-semibold' : 'text-sm font-medium'}>{t('readingPlans.home.day', { day })}</span>
          <span className="text-xs kth-text-muted">{t(`readingPlans.home.tag.${kind}`)}</span>
          {date ? <span className="text-xs kth-text-muted">{date}</span> : null}
        </div>
        <ul className="m-0 p-0 list-none flex flex-col gap-xs" aria-label={labels.todayCard.readings}>
          {readings.map((r, i) => readingRow(day, i, r, hero))}
        </ul>
        {hero ? (
          <div className="flex flex-wrap items-center gap-md pt-xs">
            {continueTarget ? (
              <button type="button" className="kth-btn kth-btn--primary" onClick={() => onOpenReading(continueTarget)}>
                {t(anyTicked ? 'readingPlans.home.continue' : 'readingPlans.home.start', { reading: readingText(continueTarget.reading) })}
              </button>
            ) : null}
            <button type="button" className="kth-link text-sm" onClick={() => onToggleDay(day, !dayDone)}>
              {dayDone ? labels.todayCard.markDayUnread : labels.todayCard.markDayRead}
            </button>
          </div>
        ) : null}
      </li>
    );
  };

  const behindBy = completed ? 0 : today.behindBy;
  const aheadBy = completed ? 0 : today.aheadBy;
  const catchUp = !today.pastEnd ? ReadingPlans.catchUpSuggestion(behindBy) : null;

  const notice = () => {
    if (paused) {
      return <Notice tone="info" actions={<button type="button" className="kth-btn kth-btn--sm" onClick={onResume}>{t('readingPlans.action.resume')}</button>}>{t('readingPlans.home.paused')}</Notice>;
    }
    if (completed) return <Notice tone="success">{labels.todayCard.completed}</Notice>;
    if (behindBy > 0) {
      return (
        <Notice
          tone="warning"
          title={t('readingPlans.home.behindTitle', { n: behindBy })}
          actions={(
            <>
              <button type="button" className="kth-btn kth-btn--sm" onClick={onShift}>{labels.todayCard.reschedule}</button>
              <button type="button" className="kth-btn kth-btn--sm" onClick={() => setConfirmFlexible(true)}>{labels.todayCard.switchToFlexible}</button>
            </>
          )}
        >
          {today.pastEnd ? t('readingPlans.today.pastEnd') : catchUp ? labels.todayCard.catchUp(catchUp.extraPerDay, catchUp.days) : null}
        </Notice>
      );
    }
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
  const percentShown = stats.percent > 0 && stats.percent < 10 ? Math.round(stats.percent * 10) / 10 : Math.round(stats.percent);
  const currentDay = windowDays.current ?? today.day;
  const noticeEl = notice();

  return (
    <div className="flex flex-col gap-md" data-testid="plan-home">
      <div className="flex flex-wrap items-baseline gap-sm">
        <h2 className="m-0 text-xl font-semibold me-auto">{displayName}</h2>
        {currentDay !== null && !completed ? <span className="text-sm kth-text-muted">{labels.todayCard.dayOf(currentDay, dayCount)}</span> : null}
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
      <ol className="m-0 p-0 list-none flex flex-col gap-sm" aria-label={t('readingPlans.home.days')}>
        {dayCard(windowDays.previous, 'previous')}
        {dayCard(windowDays.current, 'current')}
        {dayCard(windowDays.next, 'next')}
      </ol>
      <MessageBox
        open={confirmFlexible}
        title={t('readingPlans.settings.switchTitle')}
        message={labels.todayCard.switchConfirmText}
        confirmLabel={labels.todayCard.switchToFlexible}
        cancelLabel={labels.todayCard.cancel}
        onConfirm={() => { setConfirmFlexible(false); onSwitchToFlexible(); }}
        onCancel={() => setConfirmFlexible(false)}
      />
    </div>
  );
};

export default PlanHome;
