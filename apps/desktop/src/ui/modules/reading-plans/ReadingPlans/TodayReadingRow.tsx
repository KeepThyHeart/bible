/**
 * The New Tab page row (slot `newTabRows`, task 0222 R3-4): "Today's reading: Genesis 4-6", one button per plan with an
 * unticked reading (at most two). Renders nothing when no plan has one. Opens the reading in the reader.
 */
import React, { useEffect } from 'react';
import { ReadingPlans } from '@bible/core/browser';
import { useI18n } from '../../../contexts/useI18n';
import { rpTextWith } from '../rpText';
import { openPlanReading } from '../useActiveReadingStore';
import { useReadingPlanStore } from '../useReadingPlanStore';
import { useReadingPlanLabels } from './useReadingPlanLabels';

export const MAX_TODAY_ROWS = 2;

const TodayReadingRow: React.FC<{ onDone: () => void }> = ({ onDone }) => {
  const { t } = useI18n();
  const labels = useReadingPlanLabels();
  const todays = useReadingPlanStore((s) => s.todays);
  const ensureLoaded = useReadingPlanStore((s) => s.ensureLoaded);
  useEffect(() => { void ensureLoaded(); }, [ensureLoaded]);

  const rows = todays
    .map((view) => ({ view, first: ReadingPlans.dueReadings(view)[0] }))
    .filter((r): r is { view: ReadingPlans.TodayView; first: ReadingPlans.PlanReadingRef } => !!r.first)
    .slice(0, MAX_TODAY_ROWS);
  if (rows.length === 0) return null;

  return (
    <div className="flex flex-col gap-xs" data-testid="new-tab-today-reading">
      {rows.map(({ view, first }) => {
        const reading = labels.formatReading(first.reading);
        return (
          <button
            key={view.enrollmentId}
            type="button"
            className="kth-btn"
            title={labels.localizePlanName(view.planKey, view.planName)}
            onClick={() => {
              openPlanReading({ enrollmentId: view.enrollmentId, day: first.day, index: first.index, reading: first.reading });
              onDone();
            }}
          >
            {rpTextWith(t, 'readingPlans.newTab.today', "Today's reading: {reading}", { reading })}
          </button>
        );
      })}
    </div>
  );
};

export default TodayReadingRow;
