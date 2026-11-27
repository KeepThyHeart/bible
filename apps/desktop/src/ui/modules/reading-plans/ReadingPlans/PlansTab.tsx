/**
 * The Plans tab of the Reading plans app: the plans followed (one row each, with the plan's settings and its full
 * view) and the way to add one (the library and the plan editor open from here).
 */
import React from 'react';
import type { ReadingPlans } from '@bible/core/browser';
import { ProgressBar } from '@bible/ui';
import { useI18n } from '../../../contexts/useI18n';
import { rpTextWith } from '../rpText';
import type { ReadingPlanLabelSet } from './useReadingPlanLabels';
import { shownPercent } from './readingPlanData';

export interface PlansTabRow {
  enrollment: ReadingPlans.Enrollment;
  detail: ReadingPlans.EnrollmentDetail | undefined;
  displayName: string;
}

export interface PlansTabProps {
  rows: readonly PlansTabRow[];
  labels: ReadingPlanLabelSet;
  onAdd: () => void;
  onViewPlan: (enrollmentId: string) => void;
  onOpenSettings: (enrollmentId: string) => void;
}

const PlansTab: React.FC<PlansTabProps> = ({ rows, labels, onAdd, onViewPlan, onOpenSettings }) => {
  const { t } = useI18n();
  const tx = (key: string, fallback: string, params: Record<string, unknown> = {}) => rpTextWith(t, key, fallback, params);

  const status = (r: PlansTabRow) => {
    const e = r.enrollment;
    if (e.status === 'paused') return t('readingPlans.status.paused');
    if (e.status === 'completed' || r.detail?.today.completed) return t('readingPlans.status.completed');
    const pacing = e.pacing === 'fixed' ? t('readingPlans.builder.fixed') : t('readingPlans.builder.flexible');
    return pacing;
  };

  return (
    <div className="flex flex-col gap-md" data-testid="plans-tab">
      <div>
        <button type="button" className="kth-btn kth-btn--primary" onClick={onAdd}>+ {t('readingPlans.nav.add')}</button>
      </div>
      {rows.length === 0 ? (
        <div className="flex flex-col gap-xs" data-testid="reading-plans-empty">
          <h2 className="m-0 text-lg font-medium">{t('readingPlans.empty.title')}</h2>
          <p className="m-0 text-sm kth-text-muted">{t('readingPlans.empty.body')}</p>
        </div>
      ) : (
        <div className="kth-table-wrap">
          <table className="kth-table" data-testid="plans-table">
            <thead>
              <tr>
                <th scope="col" className="kth-table__head">{tx('readingPlans.agenda.col.plan', 'Plan')}</th>
                <th scope="col" className="kth-table__head">{tx('readingPlans.plans.col.schedule', 'Schedule')}</th>
                <th scope="col" className="kth-table__head">{tx('readingPlans.agenda.col.progress', 'Progress')}</th>
                <th scope="col" className="kth-table__head"><span className="sr-only">{tx('readingPlans.plans.col.actions', 'Actions')}</span></th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => {
                const id = r.enrollment.id;
                const pct = r.detail?.stats.percent ?? 0;
                return (
                  <tr key={id} data-testid="plans-row">
                    <th scope="row" className="kth-table__cell">
                      <button type="button" className="kth-link font-medium text-start" onClick={() => onViewPlan(id)}>{r.displayName}</button>
                    </th>
                    <td className="kth-table__cell" data-nowrap="">{status(r)}</td>
                    <td className="kth-table__cell" style={{ minInlineSize: '8rem' }}>
                      <ProgressBar value={pct} label={`${r.displayName}: ${t('readingPlans.today.progress')}`}
                        valueText={labels.todayCard.percent(shownPercent(pct))} />
                    </td>
                    <td className="kth-table__cell" data-nowrap="">
                      <span className="flex gap-xs">
                        <button type="button" className="kth-btn kth-btn--sm" onClick={() => onOpenSettings(id)}
                          aria-label={`${t('readingPlans.home.planSettings')}: ${r.displayName}`}>{t('readingPlans.home.planSettings')}</button>
                        <button type="button" className="kth-btn kth-btn--sm" onClick={() => onViewPlan(id)}
                          aria-label={`${t('readingPlans.home.viewPlan')}: ${r.displayName}`}>{t('readingPlans.home.viewPlan')}</button>
                      </span>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
};

export default PlansTab;
