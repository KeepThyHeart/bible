/**
 * "Today's reading" bar for the Bible pane (task 0073). When an active plan's current day has an
 * unticked reading that overlaps the chapter on screen, a slim bar offers to mark it read. Shows
 * nothing when there are no plans, so a reader without plans pays one IPC call on mount.
 */
import React, { useEffect, useMemo, useState } from 'react';
import { ReadingPlans } from '@bible/core/browser';
import { useI18n } from '../../../contexts/useI18n';
import { getReadingPlanService } from '../readingPlansAPI';
import { useReadingPlanStore } from '../useReadingPlanStore';
import { useReadingPlanLabels } from './useReadingPlanLabels';

interface Props {
  currentBook: number;
  currentChapter: number;
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
      if (view.day === null || view.dayDone) return [];
      const hits = view.readings.filter((r) => !r.done && readingOverlapsChapter(r.reading, currentBook, currentChapter));
      return hits.length > 0 ? [{ view, hits }] : [];
    });
  }, [todays, currentBook, currentChapter]);

  const key = `${currentBook}:${currentChapter}`;
  if (matches.length === 0 || dismissed.has(key)) return null;

  const service = getReadingPlanService();
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
            {t('readingPlans.bar.label', {
              plan: labels.localizePlanName(view.planKey, view.planName),
              reading: hits.map((h) => labels.formatReading(h.reading)).join('; '),
            })}
          </span>
          <button
            type="button"
            className="kth-btn kth-btn--sm"
            onClick={() => {
              void (async () => {
                for (const h of hits) await service.setReadingDone(view.enrollmentId, view.day!, h.index, true, 'reader');
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
