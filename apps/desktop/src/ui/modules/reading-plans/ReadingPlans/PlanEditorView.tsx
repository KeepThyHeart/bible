/**
 * The custom plan editor (task 0222, R6): a drill-in view to make or edit a hand-made reading plan. The plan is
 * its list of days; each day holds passages. "Fill automatically" generates days into the same list.
 */
import React, { useEffect, useMemo, useRef, useState } from 'react';
import { ReadingPlans } from '@bible/core/browser';
import { Dialog, MessageBox, Notice, ReadingPlanAutoFillForm, ReadingPlanDayEditor } from '@bible/ui';
import type { ReadingPlanAutoFillFormLabels, ReadingPlanDayEditorLabels } from '@bible/ui';
import { useI18n } from '../../../contexts/useI18n';
import { getReadingPlanService } from '../readingPlansAPI';
import type { ReadingPlanLabelSet } from './useReadingPlanLabels';

export interface PlanEditorViewProps {
  /** null = a new plan; else the `user:` plan key to edit. */
  planKey: string | null;
  labels: ReadingPlanLabelSet;
  /** Back / cancel (after any discard confirmation). */
  onClose: () => void;
  onSaved: (plan: ReadingPlans.PlanDefinition, isNew: boolean) => void;
  onError: (message: string | null) => void;
}

const message = (err: unknown) => (err instanceof Error ? err.message : String(err));

const PlanEditorView: React.FC<PlanEditorViewProps> = ({ planKey, labels, onClose, onSaved, onError }) => {
  const { t, locale } = useI18n();
  const service = getReadingPlanService();
  const [loaded, setLoaded] = useState(planKey === null);
  const [name, setName] = useState('');
  const [days, setDays] = useState<ReadingPlans.PlanDay[]>(planKey === null ? [{ readings: [] }] : []);
  const [followed, setFollowed] = useState(false);
  const [dirty, setDirty] = useState(false);
  const [fillOpen, setFillOpen] = useState(false);
  const [discardOpen, setDiscardOpen] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  // The control that opened the editor is gone: take focus (never leave it on <body>).
  const headingRef = useRef<HTMLHeadingElement>(null);
  useEffect(() => { headingRef.current?.focus({ preventScroll: true }); }, []);

  useEffect(() => {
    if (planKey === null) return undefined;
    let cancelled = false;
    void (async () => {
      try {
        const [plan, enrollments] = await Promise.all([service.getPlan(planKey), service.enrollments()]);
        if (cancelled) return;
        if (!plan) { onError(t('readingPlans.error', { message: planKey })); return; }
        setName(plan.name);
        setDays(plan.days.map((d) => ({ readings: d.readings.map((r) => ({ ...r })) })));
        setFollowed(enrollments.some((e) => e.planKey === planKey || e.planKey.startsWith(`${planKey}@`)));
        setLoaded(true);
      } catch (err) {
        if (!cancelled) onError(message(err));
      }
    })();
    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [planKey, service]);

  const changeDays = (next: ReadingPlans.PlanDay[]) => { setDays(next); setDirty(true); setProblem(null); };

  const dayLabels = useMemo<Partial<ReadingPlanDayEditorLabels>>(() => ({
    list: t('readingPlans.editor.daysTitle'),
    day: (day) => t('readingPlans.editor.day', { day }),
    addPassage: (day) => t('readingPlans.editor.addPassage', { day }),
    addPassageButton: t('readingPlans.builder.addPassage'),
    addPassagePlaceholder: t('readingPlans.editor.addPassagePlaceholder'),
    addPassageSuggestions: t('readingPlans.builder.addPassageSuggestions'),
    addPassageInvalid: t('readingPlans.builder.addPassageInvalid'),
    addPassageCount: t('readingPlans.builder.addPassageCount', { count: '{count}' }),
    removePassage: (passage, day) => t('readingPlans.editor.removePassage', { passage, day }),
    moveUp: (day) => t('readingPlans.editor.moveUp', { day }),
    moveDown: (day) => t('readingPlans.editor.moveDown', { day }),
    removeDay: (day) => t('readingPlans.editor.removeDay', { day }),
    addDay: t('readingPlans.editor.addDay'),
    emptyDay: t('readingPlans.editor.emptyDay'),
    empty: t('readingPlans.editor.empty'),
  }), [t]);

  const fillLabels = useMemo<Partial<ReadingPlanAutoFillFormLabels>>(() => ({
    intro: t('readingPlans.autofill.intro'),
    whatToRead: t('readingPlans.builder.whatToRead'),
    wholeBible: t('readingPlans.builder.wholeBible'),
    oldTestament: t('readingPlans.builder.oldTestament'),
    newTestament: t('readingPlans.builder.newTestament'),
    gospels: t('readingPlans.builder.gospels'),
    clear: t('readingPlans.builder.clear'),
    books: t('readingPlans.builder.books'),
    chooseBooks: t('readingPlans.autofill.chooseBooks'),
    addPassage: t('readingPlans.builder.addPassage'),
    removePassage: (label) => t('readingPlans.builder.removePassage', { label }),
    passages: t('readingPlans.builder.passages'),
    addPassagePlaceholder: t('readingPlans.builder.addPassagePlaceholder'),
    addPassageSuggestions: t('readingPlans.builder.addPassageSuggestions'),
    addPassageInvalid: t('readingPlans.builder.addPassageInvalid'),
    addPassageCount: t('readingPlans.builder.addPassageCount', { count: '{count}' }),
    order: t('readingPlans.builder.order'),
    orderCanonical: t('readingPlans.builder.orderCanonical'),
    orderAsListed: t('readingPlans.builder.orderAsListed'),
    orderChronological: t('readingPlans.builder.orderChronological'),
    pace: t('readingPlans.builder.pace'),
    paceDays: t('readingPlans.builder.paceDays'),
    paceEndDate: t('readingPlans.builder.paceEndDate'),
    paceChapters: t('readingPlans.builder.paceChapters'),
    paceVerses: t('readingPlans.builder.paceVerses'),
    split: t('readingPlans.builder.split'),
    splitChapter: t('readingPlans.builder.splitChapter'),
    splitVerse: t('readingPlans.builder.splitVerse'),
    preview: t('readingPlans.builder.preview'),
    chooseSomething: t('readingPlans.builder.chooseSomething'),
    errorEmptyScope: t('readingPlans.builder.error.emptyScope'),
    errorInvalidRange: t('readingPlans.builder.error.invalidRange'),
    errorInvalidPace: t('readingPlans.builder.error.invalidPace'),
    errorTooManyDays: t('readingPlans.builder.error.tooManyDays'),
    errorTooManyReadings: t('readingPlans.builder.error.tooManyReadings'),
    previewSummary: (d, minutes) => t('readingPlans.builder.previewSummary', { days: d, minutes }),
    previewDay: (day, readings) => t('readingPlans.builder.previewDay', { day, readings }),
    noteSplit: t('readingPlans.autofill.noteSplit'),
    noteFewerDays: (d) => t('readingPlans.autofill.noteFewerDays', { days: d }),
    replace: t('readingPlans.autofill.replace'),
    append: (afterDay) => t('readingPlans.autofill.append', { day: afterDay }),
    apply: t('readingPlans.autofill.apply'),
    cancel: t('readingPlans.card.cancel'),
  }), [t]);

  const totalReadings = days.reduce((n, d) => n + d.readings.length, 0);
  const totalVerses = days.reduce((n, d) => n + d.readings.reduce((m, r) => m + ReadingPlans.readingVerseCount(r), 0), 0);
  const minutes = days.length > 0 ? ReadingPlans.estimateMinutes(totalVerses / days.length) : 0;

  const leave = () => { if (dirty) setDiscardOpen(true); else onClose(); };

  const save = async () => {
    if (saving) return;
    if (days.length === 0) { setProblem(t('readingPlans.editor.errorNoDays')); return; }
    const empty = days.flatMap((d, i) => (d.readings.length === 0 ? [i + 1] : []));
    if (empty.length > 0) { setProblem(t('readingPlans.editor.errorEmptyDays', { days: empty.join(', ') })); return; }
    setProblem(null);
    setSaving(true);
    try {
      onError(null);
      const plan = await service.savePlan({
        ...(planKey !== null ? { key: planKey } : {}),
        name: name.trim() || t('readingPlans.builder.namePlaceholder'),
        days,
      });
      setDirty(false);
      onSaved(plan, planKey === null);
    } catch (err) {
      onError(message(err));
    } finally {
      setSaving(false);
    }
  };

  // Days the user has really written: trailing empty days (the blank day 1 of a new plan) do not count.
  const authoredDays = useMemo(() => {
    let n = days.length;
    while (n > 0 && days[n - 1].readings.length === 0) n--;
    return n;
  }, [days]);
  const [pendingReplace, setPendingReplace] = useState<ReadingPlans.PlanDay[] | null>(null);
  const applyFill = (filled: ReadingPlans.PlanDay[], mode: 'replace' | 'append') => {
    if (mode === 'replace' && authoredDays > 0) { setPendingReplace(filled); return; } // ask first: it removes hand-made days
    changeDays(mode === 'replace' ? filled : [...days.slice(0, authoredDays), ...filled]);
    setFillOpen(false);
  };

  return (
    <div className="flex flex-col gap-md" data-testid="plan-editor" aria-busy={loaded ? undefined : 'true'}>
      <div className="flex items-center gap-sm">
        <button type="button" className="kth-back" onClick={leave}>
          <span className="kth-back__icon" aria-hidden="true">{'‹'}</span>
          {t('readingPlans.nav.back')}
        </button>
        <h2 ref={headingRef} tabIndex={-1} className="text-lg font-semibold m-0">{t(planKey === null ? 'readingPlans.editor.newTitle' : 'readingPlans.editor.editTitle')}</h2>
      </div>

      {loaded ? (
        <>
          {followed ? <Notice tone="info">{t('readingPlans.editor.followedNote')}</Notice> : null}

          <div className="kth-field">
            <label htmlFor="plan-editor-name">{t('readingPlans.builder.name')}</label>
            <input id="plan-editor-name" className="kth-input" value={name} maxLength={200}
              placeholder={t('readingPlans.builder.namePlaceholder')}
              onChange={(ev) => { setName(ev.target.value); setDirty(true); }} />
          </div>

          <section className="flex flex-col gap-xs">
            <div className="flex items-center gap-sm">
              <h3 className="text-sm font-semibold m-0 flex-1">{t('readingPlans.editor.daysTitle')}</h3>
              <button type="button" className="kth-btn" onClick={() => setFillOpen(true)}>{t('readingPlans.editor.autoFill')}</button>
            </div>
            <p className="kth-text-muted text-xs m-0">{t('readingPlans.editor.daysHint')}</p>
            <ReadingPlanDayEditor days={days} onChange={changeDays} locale={locale} bookName={labels.bookName} labels={dayLabels} />
          </section>

          <div className="sticky bottom-0 flex flex-col gap-sm py-sm" style={{ backgroundColor: 'var(--theme-bg-primary)', borderBlockStart: '1px solid var(--theme-border, currentColor)' }}>
            {problem ? <Notice tone="error" role="alert">{problem}</Notice> : null}
            <div className="flex flex-wrap items-center gap-sm">
              <span className="kth-text-muted text-sm flex-1">
                {days.length > 0 ? t('readingPlans.editor.summary', { days: days.length, readings: totalReadings, minutes }) : null}
              </span>
              <button type="button" className="kth-btn" onClick={leave}>{t('readingPlans.card.cancel')}</button>
              <button type="button" className="kth-btn kth-btn--primary" disabled={saving} onClick={() => void save()}>{t('readingPlans.editor.save')}</button>
            </div>
          </div>
        </>
      ) : null}

      <Dialog open={fillOpen} onClose={() => setFillOpen(false)} title={t('readingPlans.autofill.title')} size="lg">
        <ReadingPlanAutoFillForm today={service.today()} existingDays={authoredDays} onApply={applyFill}
          onCancel={() => setFillOpen(false)} locale={locale} bookName={labels.bookName} labels={fillLabels} />
      </Dialog>

      <MessageBox open={pendingReplace !== null} title={t('readingPlans.editor.replaceTitle')} tone="danger"
        message={t('readingPlans.editor.replaceBody', { count: authoredDays })}
        confirmLabel={t('readingPlans.autofill.replace')} cancelLabel={t('readingPlans.card.cancel')}
        onConfirm={() => { if (pendingReplace) changeDays(pendingReplace); setPendingReplace(null); setFillOpen(false); }}
        onCancel={() => setPendingReplace(null)} />

      <MessageBox open={discardOpen} title={t('readingPlans.editor.discardTitle')} message={t('readingPlans.editor.discardBody')}
        confirmLabel={t('readingPlans.editor.discard')} cancelLabel={t('readingPlans.editor.keepEditing')} tone="danger"
        onConfirm={() => { setDiscardOpen(false); onClose(); }} onCancel={() => setDiscardOpen(false)} />
    </div>
  );
};

export default PlanEditorView;
