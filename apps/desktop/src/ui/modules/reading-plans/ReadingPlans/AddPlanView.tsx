/** Add reading plan (task 0222): make your own, or start / edit / delete one from the list. */
import React, { useEffect, useRef, useState } from 'react';
import { ReadingPlans } from '@bible/core/browser';
import { MessageBox, ReadingPlanLibrary } from '@bible/ui';
import { useI18n } from '../../../contexts/useI18n';
import { saveTextFile } from '../../../utils/saveTextFile';
import { getReadingPlanService } from '../readingPlansAPI';
import type { ReadingPlanLabelSet } from './useReadingPlanLabels';

export interface AddPlanViewProps {
  library: ReadingPlans.PlanSummary[];
  labels: ReadingPlanLabelSet;
  onBack: () => void;
  /** Open the editor (null = a new plan). */
  onEdit: (key: string | null) => void;
  onStart: (key: string) => void;
  onError: (message: string | null) => void;
}

const AddPlanView: React.FC<AddPlanViewProps> = ({ library, labels, onBack, onEdit, onStart, onError }) => {
  const { t } = useI18n();
  const headingRef = useRef<HTMLHeadingElement>(null);
  const [deleting, setDeleting] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);
  const own = library.filter((p) => p.source === 'user');
  const stock = library.filter((p) => p.source !== 'user');
  const target = library.find((p) => p.key === deleting) ?? null;

  useEffect(() => { headingRef.current?.focus({ preventScroll: true }); }, []);

  const confirmDelete = async () => {
    if (!target) return;
    setBusy(true);
    try {
      onError(null);
      await getReadingPlanService().deletePlan(target.key);
      setDeleting(null);
      // The row (and the button that opened the box) is gone: keep focus on something real.
      requestAnimationFrame(() => headingRef.current?.focus({ preventScroll: true }));
    } catch (err) {
      onError(err instanceof Error ? err.message : String(err));
      setDeleting(null);
    } finally {
      setBusy(false);
    }
  };

  const exportPlan = async (key: string) => {
    try {
      onError(null);
      const plan = await getReadingPlanService().getPlan(key);
      if (!plan) return;
      await saveTextFile(ReadingPlans.planFileName(plan.name), ReadingPlans.serializePlanFile(plan), 'application/json');
    } catch (err) {
      onError(err instanceof Error ? err.message : String(err));
    }
  };

  const importFile = async (file: File | undefined) => {
    if (!file) return;
    try {
      onError(null);
      if (file.size > ReadingPlans.MAX_PLAN_FILE_BYTES) throw new Error('This file is too large to be a reading plan.');
      const saved = await getReadingPlanService().savePlan(ReadingPlans.parsePlanFile(await file.text()));
      onStart(saved.key);
    } catch (err) {
      onError(err instanceof Error ? err.message : String(err));
    }
  };

  const libraryLabels = {
    ...labels.library,
    export: t('readingPlans.library.export'),
    exportNamed: (name: string) => t('readingPlans.library.exportNamed', { name }),
  };

  return (
    <div className="flex flex-col gap-md" data-testid="add-plan-view">
      <div>
        <button type="button" className="kth-back" onClick={onBack}>
          <span className="kth-back__icon" aria-hidden="true">{'‹'}</span>
          {t('readingPlans.nav.back')}
        </button>
      </div>
      <h2 ref={headingRef} tabIndex={-1} className="m-0 text-xl font-semibold">{t('readingPlans.add.title')}</h2>
      <section className="kth-card flex flex-col gap-sm" aria-label={t('readingPlans.add.customTitle')}>
        <h3 className="m-0 text-base font-semibold">{t('readingPlans.add.customTitle')}</h3>
        <p className="m-0 text-sm" style={{ color: 'var(--theme-text-secondary)' }}>{t('readingPlans.add.customBody')}</p>
        <div><button type="button" className="kth-btn" onClick={() => onEdit(null)}>{t('readingPlans.add.customButton')}</button></div>
        <div>
          <button type="button" className="kth-btn" onClick={() => fileRef.current?.click()}>{t('readingPlans.add.importButton')}</button>
          <input
            ref={fileRef}
            type="file"
            accept=".json,.readingplan.json,application/json"
            hidden
            data-testid="import-plan-input"
            onChange={(e) => { const f = e.target.files?.[0]; e.target.value = ''; void importFile(f); }}
          />
        </div>
      </section>
      {own.length > 0 ? (
        <section className="flex flex-col gap-sm" aria-label={t('readingPlans.add.yourPlans')}>
          <h3 className="m-0 text-base font-semibold">{t('readingPlans.add.yourPlans')}</h3>
          <ReadingPlanLibrary
            plans={own}
            nameOf={labels.stockName}
            descriptionOf={labels.stockDescription}
            labels={libraryLabels}
            onStart={onStart}
            onExport={(key) => { void exportPlan(key); }}
            onEdit={(key) => onEdit(key)}
            onDelete={(key) => setDeleting(key)}
          />
        </section>
      ) : null}
      <section className="flex flex-col gap-sm" aria-label={t('readingPlans.add.stockPlans')}>
        <h3 className="m-0 text-base font-semibold">{t('readingPlans.add.stockPlans')}</h3>
        <ReadingPlanLibrary
          plans={stock}
          nameOf={labels.stockName}
          descriptionOf={labels.stockDescription}
          labels={labels.library}
          onStart={onStart}
        />
      </section>
      <MessageBox
        open={target !== null}
        tone="danger"
        title={t('readingPlans.add.deleteTitle')}
        message={target ? `${t('readingPlans.library.deleteConfirm', { name: labels.stockName(target) })} ${t('readingPlans.add.deleteBody')}` : null}
        confirmLabel={t('readingPlans.action.confirmDelete')}
        cancelLabel={labels.todayCard.cancel}
        onConfirm={() => void confirmDelete()}
        onCancel={() => setDeleting(null)}
        busy={busy}
      />
    </div>
  );
};

export default AddPlanView;
