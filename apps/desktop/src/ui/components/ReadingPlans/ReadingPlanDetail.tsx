/**
 * One reading-plan enrollment in detail (task 0073): stats, the day grid with a day's readings,
 * this enrollment's schedule settings, calendar export, pause/resume and remove.
 */
import React, { useCallback, useEffect, useState } from 'react';
import { ReadingPlans } from '@bible/core/browser';
import { ReadingPlanDayGrid, WeekdayPicker } from '@bible/ui';
import { useI18n } from '../../contexts/useI18n';
import { getReadingPlanService } from '../../services/readingPlansAPI';
import { navigateToVerseInPrimary } from '../../stores/crossStoreBridge';
import { usePreferencesStore } from '../../stores/usePreferencesStore';
import type { ReadingPlanLabelSet } from './useReadingPlanLabels';

type Weekday = ReadingPlans.Weekday;

interface Props {
  enrollmentId: string;
  labels: ReadingPlanLabelSet;
  /** Display name of the plan (localized for stock plans). */
  displayName: (planKey: string, fallback: string) => string;
  onBack: () => void;
  onRemoved: () => void;
  onError: (message: string | null) => void;
}

const field = 'px-sm py-xs rounded border border-border bg-transparent';

const ReadingPlanDetail: React.FC<Props> = ({ enrollmentId, labels, displayName, onBack, onRemoved, onError }) => {
  const { t } = useI18n();
  const showStreak = usePreferencesStore((s) => s.readingPlanShowStreak);
  const service = getReadingPlanService();
  const [detail, setDetail] = useState<ReadingPlans.EnrollmentDetail | null>(null);
  const [selectedDay, setSelectedDay] = useState<number | undefined>(undefined);
  const [ticked, setTicked] = useState<number[]>([]);
  const [confirming, setConfirming] = useState<'flexible' | 'remove' | null>(null);
  const [alarm, setAlarm] = useState('');

  const load = useCallback(async () => {
    try {
      setDetail(await service.detail(enrollmentId));
    } catch (err) {
      onError(err instanceof Error ? err.message : String(err));
    }
  }, [service, enrollmentId, onError]);

  useEffect(() => {
    void load();
    return service.subscribe((e) => { if (e.type === 'changed') void load(); });
  }, [service, load]);

  useEffect(() => {
    if (selectedDay === undefined) { setTicked([]); return; }
    let cancelled = false;
    service.dayProgress(enrollmentId, selectedDay)
      .then((p) => { if (!cancelled) setTicked(p); })
      .catch(() => {});
    return () => { cancelled = true; };
    // `detail` changes whenever progress does.
  }, [service, enrollmentId, selectedDay, detail]);

  const run = useCallback(async (fn: () => Promise<unknown>) => {
    try {
      onError(null);
      await fn();
    } catch (err) {
      onError(err instanceof Error ? err.message : String(err));
    }
  }, [onError]);

  if (!detail) return <div className="p-md" aria-busy="true" />;
  const { enrollment: e, plan, stats, statuses } = detail;
  const name = displayName(e.planKey, e.planName);
  const dayReadings = selectedDay !== undefined ? plan.days[selectedDay - 1]?.readings ?? [] : [];
  const readingText = (r: ReadingPlans.Reading) => {
    const prefix = r.track ? `${labels.trackName(r.track, plan.tracks?.find((x) => x.id === r.track)?.name)}: ` : '';
    return `${prefix}${labels.formatReading(r)}`;
  };

  const exportIcs = async () => {
    const completions = await service.completions(e.id);
    const ics = ReadingPlans.planToIcs(plan, e, completions, {
      formatReading: labels.formatReading,
      today: service.today(),
      title: name,
      ...(alarm ? { alarmTime: alarm } : {}),
    });
    const blob = new Blob([ics], { type: 'text/calendar;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `${name.replace(/[^\p{L}\p{N}]+/gu, '-').replace(/^-|-$/g, '') || 'reading-plan'}.ics`;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  };

  const setPacing = (pacing: 'flexible' | 'fixed') => {
    if (pacing === e.pacing) return;
    if (pacing === 'flexible') { setConfirming('flexible'); return; }
    void run(async () => {
      await service.updateEnrollment(e.id, { pacing: 'fixed' });
      await service.shiftSchedule(e.id); // the first unread day lands on today
    });
  };

  const statusText = t(`readingPlans.status.${e.status}`);

  return (
    <div className="flex flex-col gap-md p-md" data-testid="reading-plan-detail">
      <div className="flex items-center gap-sm">
        <button type="button" className="kth-btn kth-btn--sm" onClick={onBack}>{t('readingPlans.nav.back')}</button>
        <h2 className="text-lg font-semibold m-0">{name}</h2>
        <span className="text-xs" style={{ color: 'var(--theme-text-secondary)' }}>{statusText}</span>
      </div>

      <ul className="m-0 p-0 list-none flex flex-col gap-xs text-sm" aria-label={t('readingPlans.detail.stats')}>
        <li>{t('readingPlans.detail.daysRead', { done: stats.daysDone, total: stats.dayCount })}</li>
        <li>{t('readingPlans.detail.percent', { percent: stats.percent })}</li>
        {stats.estimatedFinish ? <li>{t('readingPlans.detail.estimatedFinish', { date: labels.formatDate(stats.estimatedFinish) })}</li> : null}
        {e.pacing === 'fixed' && stats.scheduledFinish && stats.scheduledFinish !== stats.estimatedFinish ? (
          <li>{t('readingPlans.detail.scheduledFinish', { date: labels.formatDate(stats.scheduledFinish) })}</li>
        ) : null}
        {showStreak ? <li>{t('readingPlans.detail.streak', { count: stats.streak })}</li> : null}
      </ul>

      <ReadingPlanDayGrid statuses={statuses} selectedDay={selectedDay} onSelectDay={setSelectedDay} labels={labels.dayGrid} />

      {selectedDay !== undefined ? (
        <section aria-label={t('readingPlans.detail.dayReadings', { day: selectedDay })} className="flex flex-col gap-xs">
          <h3 className="text-sm font-semibold m-0">{t('readingPlans.detail.dayReadings', { day: selectedDay })}</h3>
          <ul className="m-0 p-0 list-none flex flex-col gap-xs">
            {dayReadings.map((r, i) => (
              <li key={i} className="flex items-center gap-sm">
                <label className="flex items-center gap-xs flex-1">
                  <input type="checkbox" checked={ticked.includes(i)}
                    onChange={(ev) => void run(async () => {
                      await service.setReadingDone(e.id, selectedDay, i, ev.target.checked);
                      setTicked(await service.dayProgress(e.id, selectedDay));
                    })} />
                  {readingText(r)}
                </label>
                <button type="button" className="kth-btn kth-btn--sm" aria-label={labels.todayCard.openReading(readingText(r))}
                  onClick={() => navigateToVerseInPrimary(r.start)}>{labels.todayCard.open}</button>
              </li>
            ))}
          </ul>
        </section>
      ) : (
        <p className="text-sm m-0" style={{ color: 'var(--theme-text-secondary)' }}>{t('readingPlans.detail.selectDay')}</p>
      )}

      <section className="flex flex-col gap-sm" aria-label={t('readingPlans.detail.settings')}>
        <h3 className="text-sm font-semibold m-0">{t('readingPlans.detail.settings')}</h3>
        <label className="flex items-center gap-sm text-sm">
          {t('readingPlans.detail.schedule')}
          <select className={field} value={e.pacing} onChange={(ev) => setPacing(ev.target.value as 'flexible' | 'fixed')}>
            <option value="flexible">{labels.builder.flexible}</option>
            <option value="fixed">{labels.builder.fixed}</option>
          </select>
        </label>
        {confirming === 'flexible' ? (
          <div role="group" aria-label={labels.todayCard.switchToFlexible} className="flex flex-col gap-xs">
            <p className="text-sm m-0">{labels.todayCard.switchConfirmText}</p>
            <div className="flex gap-sm">
              <button type="button" className="kth-btn kth-btn--sm kth-btn--primary"
                onClick={() => { setConfirming(null); void run(() => service.switchToFlexible(e.id)); }}>{labels.todayCard.confirm}</button>
              <button type="button" className="kth-btn kth-btn--sm" onClick={() => setConfirming(null)}>{labels.todayCard.cancel}</button>
            </div>
          </div>
        ) : null}
        <WeekdayPicker value={e.readingDays} weekdayNames={labels.weekdayNames} labels={{ group: labels.weekdayGroup }}
          onChange={(days: Weekday[]) => void run(() => service.updateEnrollment(e.id, { readingDays: days }))} />
        {e.pacing === 'fixed' ? (
          <label className="flex items-center gap-sm text-sm">
            {labels.builder.startDate}
            <input type="date" className={field} value={e.startDate}
              onChange={(ev) => { if (ReadingPlans.isIsoDate(ev.target.value)) void run(() => service.updateEnrollment(e.id, { startDate: ev.target.value })); }} />
          </label>
        ) : null}
        {service.reminders.available ? (
          <label className="flex items-center gap-sm text-sm">
            {t('readingPlans.detail.reminderTime')}
            <input type="time" className={field} value={e.reminder?.time ?? ''}
              onChange={(ev) => void run(() => service.updateEnrollment(e.id, { reminder: ev.target.value ? { time: ev.target.value } : null }))} />
          </label>
        ) : null}
      </section>

      <section className="flex flex-wrap items-center gap-sm" aria-label={t('readingPlans.detail.actions')}>
        <label className="flex items-center gap-xs text-sm">
          {t('readingPlans.detail.alarmTime')}
          <input type="time" className={field} value={alarm} onChange={(ev) => setAlarm(ev.target.value)} />
        </label>
        <button type="button" className="kth-btn kth-btn--sm" onClick={() => void run(exportIcs)}>{t('readingPlans.detail.exportIcs')}</button>
        {e.status !== 'completed' ? (
          <button type="button" className="kth-btn kth-btn--sm"
            onClick={() => void run(() => (e.status === 'paused' ? service.resume(e.id) : service.pause(e.id)))}>
            {e.status === 'paused' ? t('readingPlans.action.resume') : t('readingPlans.action.pause')}
          </button>
        ) : null}
        <button type="button" className="kth-btn kth-btn--sm kth-btn--danger" onClick={() => setConfirming('remove')}>{t('readingPlans.action.remove')}</button>
      </section>
      {confirming === 'remove' ? (
        <div role="group" aria-label={t('readingPlans.action.remove')} className="flex flex-col gap-xs">
          <p className="text-sm m-0">{t('readingPlans.action.removeConfirm', { name })}</p>
          <div className="flex gap-sm">
            <button type="button" className="kth-btn kth-btn--sm kth-btn--danger"
              onClick={() => { setConfirming(null); void run(async () => { await service.removeEnrollment(e.id); onRemoved(); }); }}>{t('readingPlans.action.remove')}</button>
            <button type="button" className="kth-btn kth-btn--sm" onClick={() => setConfirming(null)}>{labels.todayCard.cancel}</button>
          </div>
        </div>
      ) : null}
    </div>
  );
};

export default ReadingPlanDetail;
