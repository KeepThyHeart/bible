/**
 * "Reschedule" for a fixed plan that has fallen behind: a small guided dialog. Step one names the three choices,
 * each with one line saying what it does (catch up gradually, move the dates, stop tracking dates); "Move the dates"
 * goes on to a second step with the real dates before anything changes, and "Stop tracking dates" asks first.
 * The caller owns what the choices do.
 */
import React, { useEffect, useState } from 'react';
import { ReadingPlans } from '@bible/core/browser';
import { Dialog, MessageBox } from '@bible/ui';
import { useI18n } from '../../../contexts/useI18n';
import { rpTextWith } from '../rpText';
import type { ReadingPlanLabelSet } from './useReadingPlanLabels';

/** What `service.reschedulePreview(id)` returns. */
export type ReschedulePreview = Awaited<ReturnType<ReadingPlans.ReadingPlanService['reschedulePreview']>>;

export interface RescheduleDialogProps {
  open: boolean;
  onClose: () => void;
  displayName: string;
  enrollment: ReadingPlans.Enrollment;
  today: ReadingPlans.TodayView;
  labels: ReadingPlanLabelSet;
  onStartCatchUp: () => void;
  onStopCatchUp: () => void;
  loadPreview: () => Promise<ReschedulePreview>;
  /** The reader confirmed the move; `preview` is what they were shown. */
  onMoveDates: (preview: ReschedulePreview) => void;
  onSwitchToFlexible: () => void;
}

/** The service never asks for more than this many extra days a day. */
const MAX_EXTRA = 2;

const RescheduleDialog: React.FC<RescheduleDialogProps> = ({
  open, onClose, displayName, enrollment, today, labels, onStartCatchUp, onStopCatchUp, loadPreview, onMoveDates,
  onSwitchToFlexible,
}) => {
  const { t } = useI18n();
  const tx = (key: string, fallback: string, params: Record<string, unknown> = {}) => rpTextWith(t, key, fallback, params);
  const [preview, setPreview] = useState<ReschedulePreview | null>(null);
  const [confirmFlexible, setConfirmFlexible] = useState(false);
  const [busy, setBusy] = useState(false);
  useEffect(() => { if (!open) { setPreview(null); setConfirmFlexible(false); } }, [open]);

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

  const choice = (title: string, hint: string, onClick: () => void, testId: string, disabled = false) => (
    <li className="flex flex-col gap-xs">
      <button type="button" className="kth-btn self-start" onClick={onClick} disabled={disabled} data-testid={testId}>{title}</button>
      <span className="text-sm kth-text-muted">{hint}</span>
    </li>
  );

  const moveLabel = tx('readingPlans.behind.move', 'Move the dates');
  const title = preview
    ? tx('readingPlans.behind.moveConfirmTitle', 'Move the dates?')
    : tx('readingPlans.reschedule.title', `Reschedule ${displayName}`, { name: displayName });

  const body = preview ? (
    <p className="m-0 text-sm" data-testid="move-preview">
      {tx(
        'readingPlans.behind.moveConfirmText',
        `Your remaining ${preview.remainingDays} days of reading start again on ${labels.formatDate(preview.restartDate)}. `
        + `The start date moves from ${labels.formatDate(enrollment.startDate)} to ${labels.formatDate(preview.newStartDate)} and the end date from ${labels.formatDate(preview.oldEnd)} to ${labels.formatDate(preview.newEnd)}. `
        + 'Days you have read stay read. You can undo this right after.',
        {
          n: preview.remainingDays,
          restart: labels.formatDate(preview.restartDate),
          oldStart: labels.formatDate(enrollment.startDate),
          newStart: labels.formatDate(preview.newStartDate),
          oldEnd: labels.formatDate(preview.oldEnd),
          newEnd: labels.formatDate(preview.newEnd),
        },
      )}
    </p>
  ) : (
    <div className="flex flex-col gap-md">
      <p className="m-0 text-sm">
        {tx('readingPlans.home.behindTitle', n === 1 ? 'You are 1 day behind schedule' : `You are ${n} days behind schedule`, { n })}
      </p>
      <ul className="m-0 p-0 list-none flex flex-col gap-md" aria-label={tx('readingPlans.behind.choices', 'What would you like to do?')}>
        {suggestion ? (
          catchingUp > 0 ? (
            <li className="flex flex-wrap items-center gap-sm" data-testid="catch-up-on">
              <span className="text-sm">{tx('readingPlans.behind.gradualOn', `Catching up: ${catchingUp} extra a day`, { n: catchingUp })}</span>
              <button type="button" className="kth-btn kth-btn--sm" onClick={() => { onStopCatchUp(); onClose(); }}>{tx('readingPlans.behind.stop', 'Stop')}</button>
            </li>
          ) : choice(
            tx('readingPlans.behind.gradual', 'Catch up gradually'),
            tx('readingPlans.behind.gradualHint',
              `Read ${extra} extra ${extra === 1 ? 'day' : 'days'} with each day's reading until you are level, about ${days} ${days === 1 ? 'day' : 'days'}.`,
              { extra, days }),
            () => { onStartCatchUp(); onClose(); }, 'choice-gradual',
          )
        ) : null}
        {choice(
          moveLabel,
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
  );

  const footer = preview ? (
    <>
      <button type="button" className="kth-btn" onClick={() => setPreview(null)}>{t('readingPlans.nav.back')}</button>
      <button type="button" className="kth-btn kth-btn--primary" data-testid="confirm-move"
        onClick={() => { const p = preview; setPreview(null); onMoveDates(p); onClose(); }}>{moveLabel}</button>
    </>
  ) : (
    <button type="button" className="kth-btn" onClick={onClose}>{labels.todayCard.cancel}</button>
  );

  return (
    <>
      <Dialog open={open && !confirmFlexible} onClose={onClose} title={title} footer={footer} size="sm">
        {body}
      </Dialog>
      <MessageBox
        open={open && confirmFlexible}
        title={t('readingPlans.settings.switchTitle')}
        message={labels.todayCard.switchConfirmText}
        confirmLabel={labels.todayCard.switchToFlexible}
        cancelLabel={labels.todayCard.cancel}
        onConfirm={() => { setConfirmFlexible(false); onSwitchToFlexible(); onClose(); }}
        onCancel={() => setConfirmFlexible(false)}
      />
    </>
  );
};

export default RescheduleDialog;
