/**
 * "N earlier days unread" for a fixed plan that has fallen behind (task 0222 R3-1/R3-10): one collapsed row above
 * the day's reading, never a nag. Open, it lists the missed days (tick boxes, open links) and three named choices,
 * each with one line saying what it does: catch up gradually, move the dates (confirmed, with the real dates), or
 * stop tracking dates (confirmed). The caller owns what the choices do.
 */
import React, { useState } from 'react';
import { ReadingPlans } from '@bible/core/browser';
import { Checkbox, MessageBox } from '@bible/ui';
import { useI18n } from '../../../contexts/useI18n';
import { rpTextWith } from '../rpText';
import type { ReadingPlanLabelSet } from './useReadingPlanLabels';

/** What `service.reschedulePreview(id)` returns. */
export type ReschedulePreview = Awaited<ReturnType<ReadingPlans.ReadingPlanService['reschedulePreview']>>;

export interface BehindPanelProps {
  enrollment: ReadingPlans.Enrollment;
  plan: ReadingPlans.PlanDefinition;
  today: ReadingPlans.TodayView;
  progress: ReadingPlans.ProgressIndex;
  labels: ReadingPlanLabelSet;
  readingText: (r: ReadingPlans.Reading) => string;
  onToggleReading: (day: number, index: number, done: boolean) => void;
  onOpenReading: (target: { day: number; index: number; reading: ReadingPlans.Reading }) => void;
  onStartCatchUp: () => void;
  onStopCatchUp: () => void;
  loadPreview: () => Promise<ReschedulePreview>;
  /** The reader confirmed the move; `preview` is what they were shown. */
  onMoveDates: (preview: ReschedulePreview) => void;
  onSwitchToFlexible: () => void;
}

const MAX_DAYS_SHOWN = 10;
/** The service never asks for more than this many extra days a day. */
const MAX_EXTRA = 2;

const BehindPanel: React.FC<BehindPanelProps> = ({
  enrollment, plan, today, progress, labels, readingText, onToggleReading, onOpenReading, onStartCatchUp, onStopCatchUp,
  loadPreview, onMoveDates, onSwitchToFlexible,
}) => {
  const { t } = useI18n();
  const tx = (key: string, fallback: string, params: Record<string, unknown> = {}) => rpTextWith(t, key, fallback, params);
  const [preview, setPreview] = useState<ReschedulePreview | null>(null);
  const [confirmFlexible, setConfirmFlexible] = useState(false);
  const [busy, setBusy] = useState(false);

  const n = today.behindBy;
  const pastEnd = today.pastEnd === true;
  const suggestion = pastEnd ? null : ReadingPlans.catchUpSuggestion(n);
  const extra = suggestion ? Math.min(MAX_EXTRA, suggestion.extraPerDay) : 0;
  const days = suggestion ? Math.ceil(n / Math.max(1, extra)) : 0;
  const catchingUp = enrollment.catchUp?.extraPerDay ?? 0;

  const openPreview = async () => {
    setBusy(true);
    try { setPreview(await loadPreview()); } catch { /* the pane shows service errors on its own actions */ } finally { setBusy(false); }
  };

  const missed = today.missedDays.slice(0, MAX_DAYS_SHOWN);
  const choice = (title: string, hint: string, onClick: () => void, testId: string, disabled = false) => (
    <li className="flex flex-col gap-xs">
      <button type="button" className="kth-btn kth-btn--sm self-start" onClick={onClick} disabled={disabled} data-testid={testId}>{title}</button>
      <span className="text-xs kth-text-muted">{hint}</span>
    </li>
  );

  return (
    <details className="kth-card" data-testid="behind-panel">
      <summary className="cursor-pointer text-sm font-medium">
        {tx('readingPlans.home.earlierUnread', n === 1 ? '1 earlier day unread' : `${n} earlier days unread`, { n })}
      </summary>
      <div className="flex flex-col gap-md pt-sm">
        <ul className="m-0 p-0 list-none flex flex-col gap-sm" aria-label={tx('readingPlans.home.earlierList', 'Earlier days unread')}>
          {missed.map((day) => (
            <li key={day} className="flex flex-col gap-xs">
              <span className="text-sm font-medium">{t('readingPlans.home.day', { day })}</span>
              <ul className="m-0 p-0 list-none flex flex-col gap-xs">
                {(plan.days[day - 1]?.readings ?? []).map((r, i) => {
                  const text = readingText(r);
                  const done = progress.get(day)?.has(i) ?? false;
                  return (
                    <li key={i} className="flex items-center gap-sm">
                      <Checkbox checked={done} tone="success" ariaLabel={t('readingPlans.today.markReading', { reading: text })}
                        onChange={(checked) => onToggleReading(day, i, checked)} />
                      <button type="button" className="kth-link text-sm" style={done ? { textDecoration: 'line-through', opacity: 0.7 } : undefined}
                        aria-label={labels.todayCard.openReading(text)} onClick={() => onOpenReading({ day, index: i, reading: r })}>{text}</button>
                    </li>
                  );
                })}
              </ul>
            </li>
          ))}
          {today.missedDays.length > MAX_DAYS_SHOWN ? (
            <li className="text-xs kth-text-muted">{labels.todayCard.missedMore(today.missedDays.length - MAX_DAYS_SHOWN)}</li>
          ) : null}
        </ul>

        <ul className="m-0 p-0 list-none flex flex-col gap-sm" aria-label={tx('readingPlans.behind.choices', 'What would you like to do?')}>
          {!pastEnd && suggestion ? (
            catchingUp > 0 ? (
              <li className="flex flex-wrap items-center gap-sm" data-testid="catch-up-on">
                <span className="text-sm">{tx('readingPlans.behind.gradualOn', `Catching up: ${catchingUp} extra a day`, { n: catchingUp })}</span>
                <button type="button" className="kth-btn kth-btn--sm" onClick={onStopCatchUp}>{tx('readingPlans.behind.stop', 'Stop')}</button>
              </li>
            ) : choice(
              tx('readingPlans.behind.gradual', 'Catch up gradually'),
              tx('readingPlans.behind.gradualHint',
                `Read ${extra} extra ${extra === 1 ? 'day' : 'days'} with each day's reading until you are level, about ${days} ${days === 1 ? 'day' : 'days'}.`,
                { extra, days }),
              onStartCatchUp, 'choice-gradual',
            )
          ) : null}
          {choice(
            tx('readingPlans.behind.move', 'Move the dates'),
            tx('readingPlans.behind.moveHint', 'Start your remaining days again from today. The end date moves later; days you have read stay read.'),
            () => { void openPreview(); }, 'choice-move', busy,
          )}
          {choice(
            tx('readingPlans.behind.stopDates', 'Stop tracking dates'),
            tx('readingPlans.behind.stopDatesHint', 'Switch to a flexible plan: no dates, nothing is ever behind.'),
            () => setConfirmFlexible(true), 'choice-flexible',
          )}
        </ul>
      </div>

      <MessageBox
        open={preview !== null}
        title={tx('readingPlans.behind.moveConfirmTitle', 'Move the dates?')}
        message={preview ? tx(
          'readingPlans.behind.moveConfirmText',
          `Your remaining ${preview.remainingDays} days of reading start again on ${labels.formatDate(preview.restartDate)}. `
          + `The plan used to start on ${labels.formatDate(enrollment.startDate)}; it will start on ${labels.formatDate(preview.newStartDate)}. `
          + `The end date moves from ${labels.formatDate(preview.oldEnd)} to ${labels.formatDate(preview.newEnd)}. Days you have read stay read.`,
          {
            n: preview.remainingDays,
            restart: labels.formatDate(preview.restartDate),
            oldStart: labels.formatDate(enrollment.startDate),
            newStart: labels.formatDate(preview.newStartDate),
            oldEnd: labels.formatDate(preview.oldEnd),
            newEnd: labels.formatDate(preview.newEnd),
          },
        ) : null}
        confirmLabel={tx('readingPlans.behind.move', 'Move the dates')}
        cancelLabel={labels.todayCard.cancel}
        onConfirm={() => { const p = preview; setPreview(null); if (p) onMoveDates(p); }}
        onCancel={() => setPreview(null)}
      />
      <MessageBox
        open={confirmFlexible}
        title={t('readingPlans.settings.switchTitle')}
        message={labels.todayCard.switchConfirmText}
        confirmLabel={labels.todayCard.switchToFlexible}
        cancelLabel={labels.todayCard.cancel}
        onConfirm={() => { setConfirmFlexible(false); onSwitchToFlexible(); }}
        onCancel={() => setConfirmFlexible(false)}
      />
    </details>
  );
};

export default BehindPanel;
