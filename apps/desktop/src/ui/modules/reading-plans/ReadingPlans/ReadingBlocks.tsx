/**
 * The reader's "start of reading" and "end of reading" blocks (task 0196, reworked in task 0222 R3-6). The start
 * block is a slim header before the first verse of the reading the user opened from a plan. The end block follows
 * the last verse of any of today's readings: one primary button that marks it read and goes on to the next due
 * reading (or just marks it, for the last one, and then says the day is done), a passage checkbox that stays after
 * ticking (unticking is the undo), View reading plan. It never marks anything by itself.
 * Separate from the chapter links the reader shows at the end of a chapter.
 */
import React, { useRef, useState } from 'react';
import { Checkbox } from '@bible/ui';
import type { ReadingPlans } from '@bible/core/browser';
import { useI18n } from '../../../contexts/useI18n';
import { getReadingPlanService } from '../readingPlansAPI';
import { rpTextWith } from '../rpText';
import { markReadingFromReader, openPlanReading, type ActiveReadingInfo } from '../useActiveReadingStore';
import { useReadingPlanLabels } from './useReadingPlanLabels';
import { viewPlanReading } from '../useReadingPlanNavStore';

interface BlockProps {
  info: ActiveReadingInfo;
  /** Inside a Reading-mode paragraph: use spans only (block-displayed). */
  inParagraph: boolean;
}

/** Everything the end block shows about one reading of today (or the active read-ahead reading). */
export interface EndBlockModel {
  enrollmentId: string;
  planKey: string;
  planName: string;
  day: number;
  index: number;
  reading: ReadingPlans.Reading;
  done: boolean;
  /** `nextDueReading`: where "continue" goes; null when this is the day's last due reading. */
  next: ReadingPlans.PlanReadingRef | null;
  /** The plan day after this one (for "Read ahead"), or null at the plan's end. */
  nextDay: number | null;
  /** "chapter n of count" for the chapter on screen, when the reading spans several. */
  chapter: { n: number; count: number } | null;
}

interface EndBlockProps {
  model: EndBlockModel;
  inParagraph: boolean;
}

const base: React.CSSProperties = {
  display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: '0.5rem', textAlign: 'start', textIndent: 0, userSelect: 'none',
  fontSize: '0.8125rem', lineHeight: 1.4, padding: '0.375rem 0.75rem', margin: '0.75rem 0',
  borderInlineStart: '3px solid var(--theme-accent-primary, #3b82f6)', borderRadius: 4,
  backgroundColor: 'var(--theme-bg-secondary)', color: 'var(--theme-text-secondary)', fontFamily: 'var(--ui-font-family, system-ui, sans-serif)',
};

export const StartOfReadingBlock: React.FC<BlockProps> = ({ info, inParagraph }) => {
  const { t } = useI18n();
  const labels = useReadingPlanLabels();
  const Root = inParagraph ? 'span' : 'div';
  const plan = labels.localizePlanName(info.planKey, info.planName);
  const text = info.readingCount > 1
    ? t('readingPlans.reader.startPassage', { plan, day: info.day, n: info.index + 1, count: info.readingCount })
    : t('readingPlans.reader.start', { plan, day: info.day });
  return (
    <Root style={base} role="note" data-testid="reading-plan-start-block">
      <span>{text}</span>
    </Root>
  );
};

export const EndOfReadingBlock: React.FC<EndBlockProps> = ({ model, inParagraph }) => {
  const { t } = useI18n();
  const labels = useReadingPlanLabels();
  const tx = (key: string, fallback: string, params: Record<string, unknown> = {}) => rpTextWith(t, key, fallback, params);
  const [failed, setFailed] = useState(false);
  const Root = inParagraph ? 'span' : 'div';
  const { next, done } = model;
  const passage = labels.formatReading(model.reading);
  const rootRef = useRef<HTMLElement | null>(null);
  const ref = { enrollmentId: model.enrollmentId, day: model.day, index: model.index };
  const run = (p: Promise<void>) => { setFailed(false); void p.catch(() => setFailed(true)); };
  // The button disappears once the reading is ticked. Hand focus to the checkbox first: focus dropping to <body>
  // makes the reader take it back and scroll the chapter to its top.
  const focusBox = () => rootRef.current?.querySelector<HTMLInputElement>('input[type="checkbox"]')?.focus({ preventScroll: true });
  const markOnly = () => { focusBox(); run(markReadingFromReader(ref, true)); };
  const markAndContinue = () => {
    focusBox();
    run(markReadingFromReader(ref, true).then(() => {
      if (next) openPlanReading({ enrollmentId: model.enrollmentId, day: next.day, index: next.index, reading: next.reading });
    }));
  };
  const readAhead = () => run((async () => {
    const detail = await getReadingPlanService().detail(model.enrollmentId);
    const reading = detail.plan.days[(model.nextDay ?? 1) - 1]?.readings[0];
    if (reading && model.nextDay) openPlanReading({ enrollmentId: model.enrollmentId, day: model.nextDay, index: 0, reading });
  })());
  const nextText = next ? labels.formatReading(next.reading) : '';
  const chapterText = model.chapter && model.chapter.count > 1
    ? tx('readingPlans.reader.chapterOf', 'chapter {n} of {count}', { n: model.chapter.n, count: model.chapter.count }) : '';
  return (
    <Root ref={rootRef as React.Ref<never>} style={{ ...base, padding: '0.625rem 0.875rem', gap: '0.375rem 0.75rem', color: 'var(--theme-text-primary)' }} role="note" data-testid="reading-plan-end-block">
      <span style={{ fontWeight: 600 }}>{t('readingPlans.reader.end')}{chapterText ? ` (${chapterText})` : ''}</span>
      {done ? (
        <span style={{ color: 'var(--theme-success, #2e7d32)' }}>{t('readingPlans.reader.markedRead')}</span>
      ) : next ? (
        <button type="button" className="kth-btn kth-btn--sm kth-btn--primary" onClick={markAndContinue}>
          {tx('readingPlans.reader.markContinue', 'Mark read and continue: {reading}', { reading: nextText })}
        </button>
      ) : (
        <button type="button" className="kth-btn kth-btn--sm kth-btn--primary" onClick={markOnly}>
          {tx('readingPlans.reader.markRead', 'Mark as read')}
        </button>
      )}
      <Checkbox
        tone="success"
        checked={done}
        onChange={(checked) => run(markReadingFromReader(ref, checked))}
        label={(
          <>
            <span aria-hidden="true">{passage}</span>
            <span className="kth-visually-hidden">{t('readingPlans.today.markReading', { reading: passage })}</span>
          </>
        )}
      />
      <span style={{ display: 'inline-flex', flexWrap: 'wrap', gap: '0.5rem 0.75rem', alignItems: 'center', marginInlineStart: 'auto' }}>
        {failed ? <span role="alert" style={{ color: 'var(--theme-error, #c0392b)' }}>{t('readingPlans.reader.failed')}</span> : null}
        <button type="button" className="kth-link"
          onClick={() => viewPlanReading({ enrollmentId: model.enrollmentId, day: model.day, index: model.index })}>
          {t('readingPlans.reader.viewPlan')}
        </button>
        {done && next ? (
          <button type="button" className="kth-btn kth-btn--sm kth-btn--primary" aria-label={tx('readingPlans.reader.nextNamed', 'Next reading: {reading}', { reading: nextText })}
            onClick={() => openPlanReading({ enrollmentId: model.enrollmentId, day: next.day, index: next.index, reading: next.reading })}>
            {tx('readingPlans.reader.nextShort', 'Next: {reading}', { reading: nextText })}
          </button>
        ) : null}
        {!next && done ? <span style={{ fontWeight: 600 }}>{tx('readingPlans.reader.dayDone', 'Day {day} done', { day: model.day })}</span> : null}
        {!next && done && model.nextDay ? (
          <button type="button" className="kth-link" onClick={readAhead}>
            {tx('readingPlans.reader.readAhead', 'Read ahead: Day {day}', { day: model.nextDay })}
          </button>
        ) : null}
      </span>
    </Root>
  );
};
