/**
 * The reader's "start of reading" and "end of reading" blocks (task 0196). Shown around the verses of a
 * reading the user opened from a reading plan: a slim header before the first verse, and a block after the
 * last verse with Mark as read / Marked as read - undo and the way on to the next reading.
 * Separate from the chapter links the reader shows at the end of a chapter.
 */
import React, { useState } from 'react';
import { useI18n } from '../../../contexts/useI18n';
import { openPlanReading, useActiveReadingStore, type ActiveReadingInfo } from '../useActiveReadingStore';
import { useReadingPlanLabels } from './useReadingPlanLabels';

interface BlockProps {
  info: ActiveReadingInfo;
  /** Inside a Reading-mode paragraph: use spans only (block-displayed). */
  inParagraph: boolean;
}

const base: React.CSSProperties = {
  display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: '0.5rem', textAlign: 'start', textIndent: 0,
  fontSize: '0.8125rem', lineHeight: 1.4, padding: '0.375rem 0.75rem', margin: '0.75rem 0',
  borderInlineStart: '3px solid var(--theme-accent, #3b82f6)', borderRadius: 4,
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
    <Root style={base} role="note" data-testid="reading-plan-start-block" aria-label={text}>
      <span>{text}</span>
    </Root>
  );
};

export const EndOfReadingBlock: React.FC<BlockProps> = ({ info, inParagraph }) => {
  const { t } = useI18n();
  const labels = useReadingPlanLabels();
  const setDone = useActiveReadingStore((s) => s.setDone);
  const [failed, setFailed] = useState(false);
  const Root = inParagraph ? 'span' : 'div';
  const next = info.next;
  const nextText = next ? labels.formatReading(next.reading) : '';
  const toggle = () => { setFailed(false); void setDone(!info.done).catch(() => setFailed(true)); };
  return (
    <Root style={{ ...base, justifyContent: 'space-between', color: 'var(--theme-text-primary)' }} role="note" data-testid="reading-plan-end-block">
      <span style={{ fontWeight: 600 }}>
        {t('readingPlans.reader.end')}
        {info.done ? <span style={{ fontWeight: 400, marginInlineStart: '0.5rem', color: 'var(--theme-text-secondary)' }}>{t('readingPlans.reader.markedRead')}</span> : null}
      </span>
      <span style={{ display: 'inline-flex', flexWrap: 'wrap', gap: '0.5rem', alignItems: 'center' }}>
        {failed ? <span role="alert" style={{ color: 'var(--theme-error, #c0392b)' }}>{t('readingPlans.reader.failed')}</span> : null}
        <button type="button" className={`kth-btn kth-btn--sm${info.done ? '' : ' kth-btn--primary'}`} onClick={toggle}>
          {info.done ? t('readingPlans.reader.undo') : t('readingPlans.reader.markRead')}
        </button>
        {next ? (
          <button type="button" className="kth-btn kth-btn--sm" aria-label={t('readingPlans.reader.nextNamed', { reading: nextText })}
            onClick={() => openPlanReading({ enrollmentId: info.enrollmentId, day: next.day, index: next.index, reading: next.reading })}>
            {t('readingPlans.reader.next')}
          </button>
        ) : <span style={{ color: 'var(--theme-text-secondary)' }}>{t('readingPlans.reader.lastReading')}</span>}
      </span>
    </Root>
  );
};
