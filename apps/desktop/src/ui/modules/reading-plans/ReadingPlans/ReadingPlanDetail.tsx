/**
 * One reading-plan enrollment in detail (task 0073, table task 0196): stats, the full table of days and
 * passages (check, uncheck and open each), this enrollment's schedule settings, calendar export, pause/resume and remove.
 */
import React, { useCallback, useEffect, useRef, useState } from 'react';
import { ReadingPlans } from '@bible/core/browser';
import { WeekdayPicker } from '@bible/ui';
import { useI18n } from '../../../contexts/useI18n';
import { getReadingPlanService } from '../readingPlansAPI';
import { openPlanReading } from '../useActiveReadingStore';
import { usePreferencesStore } from '../../../stores/usePreferencesStore';
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
  const [progress, setProgress] = useState<ReadingPlans.ProgressIndex>(new Map());
  const [filter, setFilter] = useState<'all' | 'unread'>('all');
  const todayRowRef = useRef<HTMLTableRowElement | null>(null);
  const tableBoxRef = useRef<HTMLDivElement | null>(null);
  const scrolled = useRef(false);
  const [confirming, setConfirming] = useState<'flexible' | 'remove' | null>(null);
  const [alarm, setAlarm] = useState('');

  const load = useCallback(async () => {
    try {
      const [d, completions] = await Promise.all([service.detail(enrollmentId), service.completions(enrollmentId)]);
      setProgress(ReadingPlans.indexCompletions(completions, enrollmentId));
      setDetail(d);
    } catch (err) {
      onError(err instanceof Error ? err.message : String(err));
    }
  }, [service, enrollmentId, onError]);

  useEffect(() => {
    void load();
    return service.subscribe((e) => { if (e.type === 'changed') void load(); });
  }, [service, load]);

  // Bring today's row into view once, when the table first has data.
  useEffect(() => {
    if (!detail || scrolled.current) return;
    scrolled.current = true;
    // Scroll the table's own box (not the whole pane) so the plan's stats stay in view above it.
    const box = tableBoxRef.current;
    const row = todayRowRef.current;
    if (box && row) box.scrollTop = Math.max(0, row.offsetTop - box.clientHeight / 2 + row.offsetHeight / 2);
  }, [detail]);

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

      <section className="flex flex-col gap-xs" aria-label={t('readingPlans.table.title')}>
        <div className="flex items-center gap-sm">
          <h3 className="text-sm font-semibold m-0 flex-1">{t('readingPlans.table.title')}</h3>
          <div role="group" aria-label={t('readingPlans.table.filter')} className="flex gap-xs">
            {(['all', 'unread'] as const).map((f) => (
              <button key={f} type="button" className={`kth-btn kth-btn--sm${filter === f ? ' kth-btn--primary' : ''}`} aria-pressed={filter === f}
                onClick={() => setFilter(f)}>{t(`readingPlans.table.filter.${f}`)}</button>
            ))}
          </div>
        </div>
        <div ref={tableBoxRef} className="overflow-auto rounded border border-border relative" style={{ maxHeight: '28rem' }}>
          <table className="w-full text-sm" style={{ borderCollapse: 'collapse' }} data-testid="reading-plan-table">
            <thead className="sticky top-0" style={{ backgroundColor: 'var(--theme-bg-secondary)' }}>
              <tr>
                <th scope="col" className="text-start p-xs">{t('readingPlans.table.day')}</th>
                {e.pacing === 'fixed' ? <th scope="col" className="text-start p-xs">{t('readingPlans.table.date')}</th> : null}
                <th scope="col" className="text-start p-xs">{t('readingPlans.table.readings')}</th>
              </tr>
            </thead>
            <tbody>
              {plan.days.map((d, i) => {
                const day = i + 1;
                const done = progress.get(day);
                const allDone = ReadingPlans.isDayDone(plan, progress, day);
                if (filter === 'unread' && allDone) return null;
                const isToday = day === detail.today.day;
                const status = statuses[i];
                return (
                  <tr key={day} ref={isToday ? todayRowRef : undefined} data-testid="plan-table-row" data-day={day}
                    data-today={isToday ? 'true' : undefined} aria-current={isToday ? 'date' : undefined}
                    className="border-t border-border align-top"
                    style={isToday ? { backgroundColor: 'var(--theme-accent-bg, rgba(59,130,246,0.14))' } : status === 'missed' ? { backgroundColor: 'var(--theme-warning-bg, rgba(250,180,40,0.14))' } : undefined}>
                    <th scope="row" className="text-start p-xs font-medium whitespace-nowrap">
                      {day}{isToday ? <span className="text-xs ms-xs" style={{ color: 'var(--theme-accent)' }}>{t('readingPlans.table.today')}</span> : null}
                    </th>
                    {e.pacing === 'fixed' ? <td className="p-xs whitespace-nowrap">{labels.formatDate(ReadingPlans.dateForDay(e, day))}</td> : null}
                    <td className="p-xs">
                      <ul className="m-0 p-0 list-none flex flex-col gap-xs">
                        {d.readings.map((r, j) => {
                          const checked = done?.has(j) ?? false;
                          const text = readingText(r);
                          return (
                            <li key={j} className="flex items-center gap-sm">
                              <input type="checkbox" checked={checked} aria-label={t('readingPlans.table.markReading', { reading: text, day })}
                                onChange={(ev) => void run(() => service.setReadingDone(e.id, day, j, ev.target.checked))} />
                              <button type="button" className="bg-transparent border-0 p-0 text-start cursor-pointer text-accent hover:underline"
                                style={checked ? { opacity: 0.7 } : undefined} aria-label={labels.todayCard.openReading(text)}
                                onClick={() => openPlanReading({ enrollmentId: e.id, day, index: j, reading: r })}>{text}</button>
                            </li>
                          );
                        })}
                      </ul>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </section>

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
