/**
 * "Today's reading" bar for the Bible pane (task 0073, reworked in task 0222 R3-2). When an active plan's reading of
 * today (the same set Home shows: `todaysReadings`) is not yet ticked and overlaps the chapter on screen without
 * ending in it, a slim bar offers to mark it read. A reading that ends in this chapter gets the end-of-reading
 * block instead (after the verse, or at the chapter's end in Study and Parallel), so the bar only covers the start
 * and middle of a multi-chapter reading. Shows nothing when there are no plans, so a reader without plans pays one
 * IPC call on mount.
 */
import React, { useEffect, useMemo, useState } from 'react';
import { ReadingPlans } from '@bible/core/browser';
import { useI18n } from '../../../contexts/useI18n';
import { getReadingPlanService } from '../readingPlansAPI';
import { useReadingPlanStore } from '../useReadingPlanStore';
import { rpTextWith } from '../rpText';
import { useReadingPlanLabels } from './useReadingPlanLabels';

interface Props {
  currentBook: number;
  currentChapter: number;
  displayMode?: string;
}

/** Chapters whose bar was dismissed this session, as `book:chapter`. */
const dismissed = new Set<string>();

/** True when the reading shares at least one verse with the chapter. */
export function readingOverlapsChapter(r: ReadingPlans.Reading, book: number, chapter: number): boolean {
  const first = ReadingPlans.vid(book, chapter, 1);
  const last = ReadingPlans.vid(book, chapter, 999);
  return r.start <= last && r.end >= first;
}

const ReadingPlanBar: React.FC<Props> = ({ currentBook, currentChapter }) => {
  const { t } = useI18n();
  const labels = useReadingPlanLabels();
  const todays = useReadingPlanStore((s) => s.todays);
  const ensureLoaded = useReadingPlanStore((s) => s.ensureLoaded);
  const [, bump] = useState(0);

  useEffect(() => { void ensureLoaded(); }, [ensureLoaded]);

  const matches = useMemo(() => {
    if (!(currentBook > 0 && currentChapter > 0)) return [];
    return todays.flatMap((view) => {
      const hits = ReadingPlans.todaysReadings(view).filter((r) => !r.done
        && readingOverlapsChapter(r.reading, currentBook, currentChapter)
        && !ReadingPlans.endsInChapter(r.reading, currentBook, currentChapter));
      return hits.length > 0 ? [{ view, hits }] : [];
    });
  }, [todays, currentBook, currentChapter]);

  const key = `${currentBook}:${currentChapter}`;
  if (matches.length === 0 || dismissed.has(key)) return null;

  const service = getReadingPlanService();
  const barText = (view: ReadingPlans.TodayView, hits: ReadingPlans.TodayReadingRef[]): string => {
    const plan = labels.localizePlanName(view.planKey, view.planName);
    const one = hits.length === 1 ? ReadingPlans.chapterOf(hits[0].reading, currentBook, currentChapter) : null;
    if (one && one.count > 1) {
      return rpTextWith(t, 'readingPlans.bar.labelChapter', "Today's reading ({plan}): {reading} · chapter {n} of {count}",
        { plan, reading: labels.formatReading(hits[0].reading), n: one.n, count: one.count });
    }
    return t('readingPlans.bar.label', { plan, reading: hits.map((h) => labels.formatReading(h.reading)).join('; ') });
  };
  return (
    <div className="flex flex-col" data-testid="reading-plan-bar">
      {matches.map(({ view, hits }) => (
        <div
          key={view.enrollmentId}
          className="flex items-center gap-sm px-md py-xs text-sm border-b border-border"
          style={{ backgroundColor: 'var(--theme-bg-secondary)', color: 'var(--theme-text-primary)' }}
          role="status"
        >
          <span className="flex-1 min-w-0 truncate">
            {barText(view, hits)}
          </span>
          <button
            type="button"
            className="kth-btn kth-btn--sm"
            onClick={() => {
              void (async () => {
                for (const h of hits) await service.setReadingDone(view.enrollmentId, h.day, h.index, true, 'reader');
              })().catch(() => {});
            }}
          >
            {t('readingPlans.bar.markRead')}
          </button>
          <button
            type="button"
            className="kth-btn kth-btn--sm kth-btn--ghost"
            aria-label={t('readingPlans.bar.dismiss')}
            onClick={() => { dismissed.add(key); bump((n) => n + 1); }}
          >
            ×
          </button>
        </div>
      ))}
    </div>
  );
};

/** Tests only. */
export function resetReadingPlanBarForTests(): void {
  dismissed.clear();
}

export default ReadingPlanBar;
