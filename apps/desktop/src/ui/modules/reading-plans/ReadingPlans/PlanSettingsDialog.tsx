/**
 * The ONE plan settings dialog (task 0222): starts a plan (start mode) and edits a followed plan (edit mode).
 * Edit mode applies nothing until Save.
 */
import React, { useEffect, useMemo, useState, useSyncExternalStore } from 'react';
import { ReadingPlans } from '@bible/core/browser';
import { Dialog, MessageBox, Radio, SettingsForm, WeekdayPicker } from '@bible/ui';
import { useI18n } from '../../../contexts/useI18n';
import { getReadingPlanService } from '../readingPlansAPI';
import { DESKTOP_SETTINGS, getDesktopSettingsStore } from '../../../settings/desktopSettings';
import { isEnabled } from '../../../settings/featureFlags';
import { rpTextWith } from '../rpText';
import type { ReadingPlanLabelSet } from './useReadingPlanLabels';

type Weekday = ReadingPlans.Weekday;
type Pacing = ReadingPlans.Pacing;

const ALL_DAYS: Weekday[] = [0, 1, 2, 3, 4, 5, 6];

export type PlanSettingsMode =
  | { kind: 'start'; plan: ReadingPlans.PlanSummary }
  | { kind: 'edit'; detail: ReadingPlans.EnrollmentDetail };

export interface PlanSettingsDialogProps {
  mode: PlanSettingsMode | null;
  open: boolean;
  onClose: () => void;
  onStarted: (enrollment: ReadingPlans.Enrollment) => void;
  onRemoved: () => void;
  labels: ReadingPlanLabelSet;
  displayName: (planKey: string, fallback: string) => string;
  onError: (message: string | null) => void;
}

/** Settings group rendered from the registry (task 0087), exactly like Preferences > Advanced. */
export const ReadingPlanSettings: React.FC = () => {
  const { t } = useI18n();
  const store = getDesktopSettingsStore();
  const values = useSyncExternalStore(store.subscribe, store.getSnapshot, store.getSnapshot);
  const fields = useMemo(
    () => DESKTOP_SETTINGS.toFields('readingPlans', { translate: (key) => t(key), isEnabled, values }),
    [t, values],
  );
  return (
    <SettingsForm fields={fields} values={values} idPrefix="rp-pref" onChange={(key, value) => { store.set(key, value); }} />
  );
};

type StartAt = 'day1' | 'dayN' | 'calendar';

/** The plan day matching today's calendar day for a 365/366-day plan (day of the year, capped at the plan's length). */
export function calendarDayFor(iso: string, dayCount: number): number {
  const ms = ReadingPlans.parseIsoDate(iso);
  if (ms === null) return 1;
  const d = new Date(ms);
  const dayOfYear = Math.floor((ms - Date.UTC(d.getUTCFullYear(), 0, 0)) / 86_400_000);
  return Math.min(Math.max(dayOfYear, 1), dayCount);
}

const sameDays = (a: Weekday[], b: Weekday[]) => a.length === b.length && a.every((d, i) => d === b[i]);

const PlanSettingsDialog: React.FC<PlanSettingsDialogProps> = ({
  mode, open, onClose, onStarted, onRemoved, labels, displayName, onError,
}) => {
  const { t } = useI18n();
  const service = getReadingPlanService();
  const edit = mode?.kind === 'edit' ? mode.detail.enrollment : null;
  const [readingDays, setReadingDays] = useState<Weekday[]>(ALL_DAYS);
  const [pacing, setPacing] = useState<Pacing>('flexible');
  const [startDate, setStartDate] = useState('');
  const [reminder, setReminder] = useState('');
  const [startAt, setStartAt] = useState<StartAt>('day1');
  const [startDayText, setStartDayText] = useState('2');
  const [busy, setBusy] = useState(false);
  const [confirmRemove, setConfirmRemove] = useState(false);
  const [confirmFlexible, setConfirmFlexible] = useState(false);

  // Reset the form whenever the dialog opens (or is pointed at another plan).
  const identity = mode ? (mode.kind === 'start' ? `s:${mode.plan.key}` : `e:${mode.detail.enrollment.id}`) : '';
  useEffect(() => {
    if (!open || !mode) return;
    if (mode.kind === 'start') {
      setReadingDays(ALL_DAYS);
      setPacing('flexible');
      setStartDate(service.today());
      setReminder('');
      setStartAt('day1');
      setStartDayText('2');
    } else {
      const e = mode.detail.enrollment;
      setReadingDays([...e.readingDays]);
      setPacing(e.pacing);
      setStartDate(e.startDate);
      setReminder(e.reminder?.time ?? '');
    }
    setConfirmRemove(false);
    setConfirmFlexible(false);
    setBusy(false);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, identity]);

  if (!mode) return null;
  const name = mode.kind === 'start'
    ? labels.stockName(mode.plan)
    : displayName(mode.detail.enrollment.planKey, mode.detail.enrollment.planName);
  const dateValid = ReadingPlans.isIsoDate(startDate);
  const startPlanInfo = mode.kind === 'start' ? mode.plan : null;
  const dayCount = startPlanInfo?.dayCount ?? 0;
  // "Today's calendar day" only suits a plan laid out over a year that is read every day of the week.
  const calendarOffered = !!startPlanInfo && (dayCount === 365 || dayCount === 366) && readingDays.length === 7;
  const calendarDay = calendarOffered ? calendarDayFor(service.today(), dayCount) : 1;
  const effectiveStartAt: StartAt = startAt === 'calendar' && !calendarOffered ? 'day1' : startAt;
  const typedDay = Number(startDayText);
  const dayNValid = Number.isInteger(typedDay) && typedDay >= 2 && typedDay <= dayCount;
  const startDay = effectiveStartAt === 'calendar' ? calendarDay : effectiveStartAt === 'dayN' ? (dayNValid ? typedDay : 0) : 1;
  const partWay = mode.kind === 'start' && effectiveStartAt !== 'day1';
  // Part-way, the chosen day is today: there is no start date to ask for.
  const showDate = (mode.kind === 'start' && !partWay) || (mode.kind === 'edit' && pacing === 'fixed');
  const needsDate = (showDate && !dateValid) || (partWay && startDay === 0);

  const attempt = async (fn: () => Promise<void>): Promise<boolean> => {
    setBusy(true);
    try {
      onError(null);
      await fn();
      return true;
    } catch (err) {
      onError(err instanceof Error ? err.message : String(err));
      return false;
    } finally {
      setBusy(false);
    }
  };

  const start = async () => {
    if (mode.kind !== 'start') return;
    let created: ReadingPlans.Enrollment | null = null;
    const ok = await attempt(async () => {
      created = await service.startPlan(mode.plan.key, {
        pacing, readingDays,
        ...(partWay ? { startDay } : { startDate }),
      });
    });
    if (ok && created) onStarted(created);
  };

  /** Apply the edits; `switchFlexible` = the reader confirmed fixed -> flexible. */
  const applyEdits = async (switchFlexible: boolean) => {
    if (!edit) return;
    const ok = await attempt(async () => {
      const patch: ReadingPlans.EnrollmentPatch = {};
      if (!sameDays(readingDays, edit.readingDays)) patch.readingDays = readingDays;
      if (reminder !== (edit.reminder?.time ?? '')) patch.reminder = reminder ? { time: reminder } : null;
      if (switchFlexible) {
        await service.switchToFlexible(edit.id);
      } else if (pacing === 'fixed') {
        const dateChanged = startDate !== edit.startDate;
        if (edit.pacing === 'flexible') patch.pacing = 'fixed';
        if (dateChanged && dateValid) patch.startDate = startDate;
        if (Object.keys(patch).length > 0) await service.updateEnrollment(edit.id, patch);
        if (edit.pacing === 'flexible' && !dateChanged) await service.shiftSchedule(edit.id); // first unread day lands on today
        return;
      }
      if (Object.keys(patch).length > 0) await service.updateEnrollment(edit.id, patch);
    });
    if (ok) onClose();
  };

  const save = () => {
    if (edit && edit.pacing === 'fixed' && pacing === 'flexible') { setConfirmFlexible(true); return; }
    void applyEdits(false);
  };

  const togglePause = async () => {
    if (!edit) return;
    const ok = await attempt(async () => { await (edit.status === 'paused' ? service.resume(edit.id) : service.pause(edit.id)); });
    if (ok) onClose();
  };

  const remove = async () => {
    if (!edit) return;
    setConfirmRemove(false);
    const ok = await attempt(async () => { await service.removeEnrollment(edit.id); });
    if (ok) onRemoved();
  };

  const primary = mode.kind === 'start'
    ? <button type="button" className="kth-btn kth-btn--primary" disabled={busy || needsDate} onClick={() => void start()}>{t('readingPlans.settings.startButton', { name })}</button>
    : <button type="button" className="kth-btn kth-btn--primary" disabled={busy || needsDate} onClick={save}>{t('readingPlans.settings.save')}</button>;

  return (
    <>
      <Dialog
        open={open}
        onClose={onClose}
        size="md"
        title={t('readingPlans.settings.title')}
        subtitle={name}
        footer={(
          <>
            <button type="button" className="kth-btn" onClick={onClose}>{labels.todayCard.cancel}</button>
            {primary}
          </>
        )}
      >
        <div className="flex flex-col gap-md" data-testid="plan-settings">
          <WeekdayPicker
            value={readingDays}
            onChange={setReadingDays}
            weekdayNames={labels.weekdayNames}
            legend={t('readingPlans.settings.weekdaysQuestion')}
            labels={{ group: labels.weekdayGroup }}
          />
          <fieldset className="kth-fieldset">
            <legend>{labels.schedule.schedule}</legend>
            <Radio name="rp-pacing" checked={pacing === 'flexible'} onChange={() => setPacing('flexible')}
              label={labels.schedule.flexible} hint={labels.schedule.flexibleHint} />
            <Radio name="rp-pacing" checked={pacing === 'fixed'} onChange={() => setPacing('fixed')}
              label={labels.schedule.fixed} hint={labels.schedule.fixedHint} />
          </fieldset>
          {startPlanInfo && dayCount > 1 ? (
            <fieldset className="kth-fieldset" data-testid="start-at">
              <legend>{rpTextWith(t, 'readingPlans.settings.startAt', 'Start at')}</legend>
              <Radio name="rp-start-at" checked={effectiveStartAt === 'day1'} onChange={() => setStartAt('day1')}
                label={rpTextWith(t, 'readingPlans.settings.startDay1', 'Day 1')} />
              <div className="flex items-center gap-sm">
                <Radio name="rp-start-at" checked={effectiveStartAt === 'dayN'} onChange={() => setStartAt('dayN')}
                  label={rpTextWith(t, 'readingPlans.settings.startDayN', 'Day')} />
                <input type="number" className="kth-input" style={{ inlineSize: '5rem' }} min={2} max={dayCount} value={startDayText}
                  aria-label={rpTextWith(t, 'readingPlans.settings.startDayNumber', 'Start day number')}
                  onFocus={() => setStartAt('dayN')} onChange={(ev) => { setStartDayText(ev.target.value); setStartAt('dayN'); }} />
              </div>
              {effectiveStartAt === 'dayN' && !dayNValid ? (
                <div className="kth-text-muted text-xs" role="status">
                  {rpTextWith(t, 'readingPlans.settings.startDayRange', 'Choose a day from 2 to {max}.', { max: dayCount })}
                </div>
              ) : null}
              {calendarOffered ? (
                <Radio name="rp-start-at" checked={effectiveStartAt === 'calendar'} onChange={() => setStartAt('calendar')}
                  label={rpTextWith(t, 'readingPlans.settings.startCalendar', "Today's calendar day (Day {day})", { day: calendarDay })} />
              ) : null}
            </fieldset>
          ) : null}
          {showDate ? (
            <div className="kth-field">
              <label htmlFor="rp-start-date">{labels.schedule.startDate}</label>
              <input id="rp-start-date" type="date" className="kth-input" style={{ inlineSize: 'auto', maxInlineSize: '14rem' }} value={startDate} onChange={(ev) => setStartDate(ev.target.value)} />
            </div>
          ) : null}
          {edit && service.reminders.available ? (
            <div className="kth-field">
              <label htmlFor="rp-reminder">{t('readingPlans.detail.reminderTime')}</label>
              <input id="rp-reminder" type="time" className="kth-input" style={{ inlineSize: 'auto', maxInlineSize: '14rem' }} value={reminder} onChange={(ev) => setReminder(ev.target.value)} />
            </div>
          ) : null}
          {edit ? (
            <>
              <section className="flex flex-col gap-sm pt-md border-t border-border" aria-label={t('readingPlans.settings.planActions')}>
                <h3 className="m-0 text-sm font-semibold">{t('readingPlans.settings.planActions')}</h3>
                <div className="flex flex-wrap gap-sm">
                  {edit.status !== 'completed' ? (
                    <button type="button" className="kth-btn" disabled={busy} onClick={() => void togglePause()}>
                      {edit.status === 'paused' ? t('readingPlans.settings.resume') : t('readingPlans.settings.pause')}
                    </button>
                  ) : null}
                  <button type="button" className="kth-btn kth-btn--danger" disabled={busy} onClick={() => setConfirmRemove(true)}>{t('readingPlans.settings.remove')}</button>
                </div>
              </section>
              <details className="pt-md border-t border-border">
                <summary className="cursor-pointer font-medium">{t('readingPlans.settings.allPlans')}</summary>
                <div className="mt-sm"><ReadingPlanSettings /></div>
              </details>
            </>
          ) : null}
        </div>
      </Dialog>
      <MessageBox
        open={open && confirmRemove}
        tone="danger"
        title={t('readingPlans.settings.removeTitle')}
        message={t('readingPlans.action.removeConfirm', { name })}
        confirmLabel={t('readingPlans.action.confirmRemove')}
        cancelLabel={labels.todayCard.cancel}
        onConfirm={() => void remove()}
        onCancel={() => setConfirmRemove(false)}
        busy={busy}
      />
      <MessageBox
        open={open && confirmFlexible}
        title={t('readingPlans.settings.switchTitle')}
        message={labels.todayCard.switchConfirmText}
        confirmLabel={labels.todayCard.switchToFlexible}
        cancelLabel={labels.todayCard.cancel}
        onConfirm={() => { setConfirmFlexible(false); void applyEdits(true); }}
        onCancel={() => setConfirmFlexible(false)}
        busy={busy}
      />
    </>
  );
};

export default PlanSettingsDialog;
