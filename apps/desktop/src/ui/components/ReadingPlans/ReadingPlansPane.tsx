import React, { useCallback, useEffect, useMemo, useState, useSyncExternalStore } from 'react';
import { ReadingPlans } from '@bible/core/browser';
import {
  ReadingPlanBuilderForm, ReadingPlanLibrary, ReadingPlanTodayCard, SettingsForm, WeekdayPicker,
} from '@bible/ui';
import { useI18n } from '../../contexts/useI18n';
import { getReadingPlanService } from '../../services/readingPlansAPI';
import { navigateToVerseInPrimary } from '../../stores/crossStoreBridge';
import { useReadingPlanStore } from '../../stores/useReadingPlanStore';
import { DESKTOP_SETTINGS, getDesktopSettingsStore } from '../../settings/desktopSettings';
import { isEnabled } from '../../settings/featureFlags';
import { ensureReferenceLocales } from '../../services/localizedReferenceParser';
import { useReadingPlanLabels } from './useReadingPlanLabels';
import { useReadingPlanData } from './readingPlanData';
import ReadingPlanDetail from './ReadingPlanDetail';

type Weekday = ReadingPlans.Weekday;
type View =
  | { kind: 'today' }
  | { kind: 'plans' }
  | { kind: 'new' }
  | { kind: 'detail'; id: string; from: 'today' | 'plans' };

const ALL_DAYS: Weekday[] = [0, 1, 2, 3, 4, 5, 6];
const field = 'px-sm py-xs rounded border border-border bg-transparent';
const secondary = { color: 'var(--theme-text-secondary)' } as const;

/** Settings group rendered from the registry (task 0087), exactly like Preferences > Advanced. */
const ReadingPlanSettings: React.FC = () => {
  const { t } = useI18n();
  const store = getDesktopSettingsStore();
  const values = useSyncExternalStore(store.subscribe, store.getSnapshot, store.getSnapshot);
  const fields = useMemo(
    () => DESKTOP_SETTINGS.toFields('readingPlans', { translate: (key) => t(key), isEnabled, values }),
    [t, values],
  );
  return (
    <SettingsForm fields={fields} values={values} idPrefix="rp-pref" onChange={(key, value) => { store.set(key, value); }} />
  );
};

/**
 * Reading plans pane (task 0073): today's readings for every active plan, the plan library and
 * "my plans", a plan detail view, and the plan builder. Simple in-pane navigation, no router.
 */
const ReadingPlansPane: React.FC = () => {
  const { t, locale } = useI18n();
  const labels = useReadingPlanLabels();
  // The builder's passage picker parses in the UI language: make sure that language's reference data is
  // loaded, and re-render the picker once it is (it caches nothing, so a version bump is enough).
  const [, setRefLocaleReady] = useState(0);
  useEffect(() => {
    let cancelled = false;
    void Promise.resolve(ensureReferenceLocales([locale])).catch(() => {}).then(() => { if (!cancelled) setRefLocaleReady((n) => n + 1); });
    return () => { cancelled = true; };
  }, [locale]);
  const service = getReadingPlanService();
  const todays = useReadingPlanStore((s) => s.todays);
  const storeLoaded = useReadingPlanStore((s) => s.loaded);
  const storeError = useReadingPlanStore((s) => s.error);
  const { data, loaded, error: dataError } = useReadingPlanData();
  const [view, setView] = useState<View>({ kind: 'today' });
  const [actionError, setActionError] = useState<string | null>(null);
  const [startKey, setStartKey] = useState<string | null>(null);
  const [startDate, setStartDate] = useState('');
  const [pacing, setPacing] = useState<'flexible' | 'fixed'>('flexible');
  const [readingDays, setReadingDays] = useState<Weekday[]>(ALL_DAYS);
  const [confirmRemove, setConfirmRemove] = useState<string | null>(null);
  const [confirmDelete, setConfirmDelete] = useState<string | null>(null);

  const refreshStore = useReadingPlanStore((s) => s.refresh);
  useEffect(() => { void refreshStore(); }, [refreshStore]);

  const error = actionError ?? dataError ?? storeError;
  const run = useCallback(async (fn: () => Promise<unknown>): Promise<boolean> => {
    try {
      setActionError(null);
      await fn();
      return true;
    } catch (err) {
      setActionError(err instanceof Error ? err.message : String(err));
      return false;
    }
  }, []);

  const displayName = labels.localizePlanName;

  const go = (next: View) => { setActionError(null); setView(next); };

  const beginStart = (key: string) => {
    setStartKey(key);
    setStartDate(service.today());
    setPacing('flexible');
    setReadingDays(ALL_DAYS);
  };

  const confirmStart = async () => {
    if (!startKey) return;
    const ok = await run(() => service.startPlan(startKey, { startDate, pacing, readingDays }));
    if (ok) { setStartKey(null); go({ kind: 'today' }); }
  };

  const shell = { backgroundColor: 'var(--theme-bg-primary)', color: 'var(--theme-text-primary)' } as const;
  const tabClass = (active: boolean) => `kth-btn kth-btn--sm${active ? ' kth-btn--primary' : ''}`;
  const activeKind = view.kind === 'detail' ? view.from : view.kind;

  const renderToday = () => {
    if (!storeLoaded || !loaded) return <div className="p-md" aria-busy="true" />;
    if (todays.length === 0) {
      return (
        <div className="flex flex-col items-center gap-sm text-center p-lg" data-testid="reading-plans-empty">
          <div style={{ fontSize: '1rem', fontWeight: 500 }}>{t('readingPlans.empty.title')}</div>
          <p className="m-0" style={secondary}>{t('readingPlans.empty.body')}</p>
          <button type="button" className="kth-btn kth-btn--primary" onClick={() => go({ kind: 'plans' })}>{t('readingPlans.empty.choose')}</button>
        </div>
      );
    }
    return (
      <div className="flex flex-col gap-md p-md">
        {todays.map((v) => {
          const detail = data.details.get(v.enrollmentId);
          const plan = detail?.plan;
          const name = displayName(v.planKey, v.planName);
          return (
            <ReadingPlanTodayCard
              key={v.enrollmentId}
              view={{ ...v, planName: name }}
              formatReading={labels.formatReading}
              trackName={(id) => labels.trackName(id, plan?.tracks?.find((x) => x.id === id)?.name)}
              percent={detail?.stats.percent}
              catchUp={ReadingPlans.catchUpSuggestion(v.behindBy)}
              labels={labels.todayCard}
              onToggleReading={(index, done) => { if (v.day !== null) void run(() => service.setReadingDone(v.enrollmentId, v.day!, index, done)); }}
              onToggleDay={(done) => { if (v.day !== null) void run(() => service.setDayDone(v.enrollmentId, v.day!, done)); }}
              onOpenReading={(r) => navigateToVerseInPrimary(r.start)}
              onOpenPlan={() => go({ kind: 'detail', id: v.enrollmentId, from: 'today' })}
              onShift={() => void run(() => service.shiftSchedule(v.enrollmentId))}
              onSwitchToFlexible={() => void run(() => service.switchToFlexible(v.enrollmentId))}
            />
          );
        })}
      </div>
    );
  };

  const renderEnrollment = (e: ReadingPlans.Enrollment) => {
    const detail = data.details.get(e.id);
    const name = displayName(e.planKey, e.planName);
    return (
      <li key={e.id} className="flex flex-wrap items-center gap-sm py-xs border-b border-border" data-testid="reading-plans-enrollment">
        <span className="flex-1 min-w-0">
          <span className="font-medium">{name}</span>{' '}
          <span className="text-xs" style={secondary}>
            {t(`readingPlans.status.${e.status}`)}{detail ? ` · ${t('readingPlans.card.percent', { percent: detail.stats.percent })}` : ''}
          </span>
        </span>
        <button type="button" className="kth-btn kth-btn--sm" aria-label={t('readingPlans.action.openNamed', { name })}
          onClick={() => go({ kind: 'detail', id: e.id, from: 'plans' })}>{t('readingPlans.action.openDetail')}</button>
        {e.status !== 'completed' ? (
          <button type="button" className="kth-btn kth-btn--sm" aria-label={t(e.status === 'paused' ? 'readingPlans.action.resumeNamed' : 'readingPlans.action.pauseNamed', { name })}
            onClick={() => void run(() => (e.status === 'paused' ? service.resume(e.id) : service.pause(e.id)))}>
            {e.status === 'paused' ? t('readingPlans.action.resume') : t('readingPlans.action.pause')}
          </button>
        ) : null}
        <button type="button" className="kth-btn kth-btn--sm kth-btn--danger" aria-label={t('readingPlans.action.removeNamed', { name })}
          onClick={() => setConfirmRemove(e.id)}>{t('readingPlans.action.remove')}</button>
        {confirmRemove === e.id ? (
          <div role="group" aria-label={t('readingPlans.action.removeNamed', { name })} className="w-full flex flex-col gap-xs">
            <p className="text-sm m-0">{t('readingPlans.action.removeConfirm', { name })}</p>
            <div className="flex gap-sm">
              <button type="button" className="kth-btn kth-btn--sm kth-btn--danger"
                onClick={() => { setConfirmRemove(null); void run(() => service.removeEnrollment(e.id)); }}>{t('readingPlans.action.confirmRemove')}</button>
              <button type="button" className="kth-btn kth-btn--sm" onClick={() => setConfirmRemove(null)}>{labels.todayCard.cancel}</button>
            </div>
          </div>
        ) : null}
      </li>
    );
  };

  const startSection = () => {
    const plan = data.library.find((p) => p.key === startKey);
    if (!plan) return null;
    const name = labels.stockName(plan);
    return (
      <section className="flex flex-col gap-sm p-md rounded border border-border" aria-label={t('readingPlans.start.title', { name })} data-testid="reading-plans-start">
        <h3 className="text-sm font-semibold m-0">{t('readingPlans.start.title', { name })}</h3>
        <label className="flex items-center gap-sm text-sm">
          {labels.builder.startDate}
          <input type="date" className={field} value={startDate} onChange={(ev) => setStartDate(ev.target.value)} />
        </label>
        <fieldset className="border-0 p-0 m-0 flex flex-col gap-xs text-sm">
          <legend className="font-medium">{labels.builder.schedule}</legend>
          <label className="flex items-center gap-xs">
            <input type="radio" name="rp-pacing" checked={pacing === 'flexible'} onChange={() => setPacing('flexible')} />
            {labels.builder.flexible} <span style={secondary}>{labels.builder.flexibleHint}</span>
          </label>
          <label className="flex items-center gap-xs">
            <input type="radio" name="rp-pacing" checked={pacing === 'fixed'} onChange={() => setPacing('fixed')} />
            {labels.builder.fixed} <span style={secondary}>{labels.builder.fixedHint}</span>
          </label>
        </fieldset>
        <WeekdayPicker value={readingDays} onChange={setReadingDays} weekdayNames={labels.weekdayNames} labels={{ group: labels.weekdayGroup }} />
        <div className="flex gap-sm">
          <button type="button" className="kth-btn kth-btn--primary" disabled={!ReadingPlans.isIsoDate(startDate)} onClick={() => void confirmStart()}>{t('readingPlans.start.begin')}</button>
          <button type="button" className="kth-btn" onClick={() => setStartKey(null)}>{labels.todayCard.cancel}</button>
        </div>
      </section>
    );
  };

  const renderPlans = () => {
    const deleting = data.library.find((p) => p.key === confirmDelete);
    return (
      <div className="flex flex-col gap-md p-md">
        <section aria-label={t('readingPlans.myPlans')}>
          <h2 className="text-base font-semibold mt-0 mb-sm">{t('readingPlans.myPlans')}</h2>
          {data.enrollments.length === 0 ? (
            <p className="m-0 text-sm" style={secondary}>{t('readingPlans.noEnrollments')}</p>
          ) : (
            <ul className="m-0 p-0 list-none">{data.enrollments.map(renderEnrollment)}</ul>
          )}
        </section>

        {startSection()}

        <section aria-label={t('readingPlans.libraryTitle')}>
          <h2 className="text-base font-semibold mt-0 mb-sm">{t('readingPlans.libraryTitle')}</h2>
          <ReadingPlanLibrary
            plans={data.library}
            nameOf={labels.stockName}
            descriptionOf={labels.stockDescription}
            labels={labels.library}
            onStart={beginStart}
            onDelete={(key) => setConfirmDelete(key)}
          />
          {deleting ? (
            <div role="group" aria-label={labels.library.deleteNamed(deleting.name)} className="flex flex-col gap-xs mt-sm">
              <p className="text-sm m-0">{t('readingPlans.library.deleteConfirm', { name: deleting.name })}</p>
              <div className="flex gap-sm">
                <button type="button" className="kth-btn kth-btn--sm kth-btn--danger"
                  onClick={() => { const key = deleting.key; setConfirmDelete(null); void run(() => service.deletePlan(key)); }}>{t('readingPlans.action.confirmDelete')}</button>
                <button type="button" className="kth-btn kth-btn--sm" onClick={() => setConfirmDelete(null)}>{labels.todayCard.cancel}</button>
              </div>
            </div>
          ) : null}
        </section>

        <details>
          <summary className="cursor-pointer font-medium">{t('readingPlans.settings.title')}</summary>
          <div className="mt-sm"><ReadingPlanSettings /></div>
        </details>
      </div>
    );
  };

  const renderNew = () => (
    <div className="p-md">
      <ReadingPlanBuilderForm
        today={service.today()}
        locale={locale}
        bookName={labels.bookName}
        weekdayNames={labels.weekdayNames}
        labels={labels.builder}
        onCancel={() => go({ kind: 'plans' })}
        onCreate={(spec, start) => {
          void (async () => {
            const ok = await run(async () => {
              const plan = await service.createPlan(spec);
              try {
                await service.startPlan(plan.key, start);
              } catch (err) {
                // Do not leave a plan behind that the reader never got to start.
                await service.deletePlan(plan.key).catch(() => {});
                throw err;
              }
            });
            if (ok) go({ kind: 'today' });
          })();
        }}
      />
    </div>
  );

  return (
    <div className="h-full w-full flex flex-col overflow-hidden" data-testid="reading-plans-pane" style={shell}>
      <div className="flex items-center gap-xs px-md py-xs border-b border-border" role="toolbar" aria-label={t('readingPlans.title')}>
        <button type="button" className={tabClass(activeKind === 'today')} aria-pressed={activeKind === 'today'} onClick={() => go({ kind: 'today' })}>{t('readingPlans.nav.today')}</button>
        <button type="button" className={tabClass(activeKind === 'plans')} aria-pressed={activeKind === 'plans'} onClick={() => go({ kind: 'plans' })}>{t('readingPlans.nav.plans')}</button>
        <button type="button" className={tabClass(activeKind === 'new')} aria-pressed={activeKind === 'new'} onClick={() => go({ kind: 'new' })}>{t('readingPlans.nav.new')}</button>
      </div>
      {error ? <p className="m-0 px-md py-xs text-sm" role="alert" style={{ color: 'var(--theme-error, #c0392b)' }}>{t('readingPlans.error', { message: error })}</p> : null}
      <div className="flex-1 min-h-0 overflow-auto">
        {view.kind === 'today' ? renderToday() : null}
        {view.kind === 'plans' ? renderPlans() : null}
        {view.kind === 'new' ? renderNew() : null}
        {view.kind === 'detail' ? (
          <ReadingPlanDetail
            enrollmentId={view.id}
            labels={labels}
            displayName={displayName}
            onBack={() => go({ kind: view.from })}
            onRemoved={() => go({ kind: view.from })}
            onError={setActionError}
          />
        ) : null}
      </div>
    </div>
  );
};

export default ReadingPlansPane;
