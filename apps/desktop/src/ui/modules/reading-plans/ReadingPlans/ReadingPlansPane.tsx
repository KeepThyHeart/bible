import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { ReadingPlans } from '@bible/core/browser';
import { Notice, Tabs, tabPanelProps } from '@bible/ui';
import { useI18n } from '../../../contexts/useI18n';
import { getReadingPlanService } from '../readingPlansAPI';
import { openPlanReading } from '../useActiveReadingStore';
import { useReadingPlanStore } from '../useReadingPlanStore';
import { useReadingPlanNavStore } from '../useReadingPlanNavStore';
import { ensureReferenceLocales } from '../../../services/localizedReferenceParser';
import { useReadingPlanLabels } from './useReadingPlanLabels';
import { useReadingPlanData } from './readingPlanData';
import ReadingPlanDetail from './ReadingPlanDetail';
import PlanEditorView from './PlanEditorView';
import PlanHome from './PlanHome';
import AddPlanView from './AddPlanView';
import PlanSettingsDialog from './PlanSettingsDialog';
import type { PlanSettingsMode } from './PlanSettingsDialog';

type View =
  | { kind: 'home' }
  | { kind: 'add' }
  | { kind: 'editor'; planKey: string | null }
  | { kind: 'plan'; id: string; highlight: { day: number; index: number } | null };

type SettingsTarget = { kind: 'start'; planKey: string } | { kind: 'edit'; id: string } | null;

const EMPTY_PROGRESS: ReadingPlans.ProgressIndex = new Map();
const STATUS_ORDER: Record<ReadingPlans.Enrollment['status'], number> = { active: 0, paused: 1, completed: 2 };
const TAB_PREFIX = 'rp-plans';

/**
 * Reading plans app (tasks 0073, 0222): Home for the selected plan, tabs when several are followed, and drill-in
 * views (add a plan, plan editor, full plan). One settings dialog serves starting and editing a plan.
 */
const ReadingPlansPane: React.FC = () => {
  const { t, locale } = useI18n();
  const labels = useReadingPlanLabels();
  // The editor's passage picker parses in the UI language: load that language's reference data first.
  const [, setRefLocaleReady] = useState(0);
  useEffect(() => {
    let cancelled = false;
    void Promise.resolve(ensureReferenceLocales([locale])).catch(() => {}).then(() => { if (!cancelled) setRefLocaleReady((n) => n + 1); });
    return () => { cancelled = true; };
  }, [locale]);
  const service = getReadingPlanService();
  const storeLoaded = useReadingPlanStore((s) => s.loaded);
  const storeError = useReadingPlanStore((s) => s.error);
  const refreshStore = useReadingPlanStore((s) => s.refresh);
  useEffect(() => { void refreshStore(); }, [refreshStore]);
  const { data, loaded, error: dataError } = useReadingPlanData();

  const [view, setView] = useState<View>({ kind: 'home' });
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [settings, setSettings] = useState<SettingsTarget>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const headingRef = useRef<HTMLHeadingElement>(null);
  const focusHeading = useRef(false);

  const ordered = useMemo(
    () => [...data.enrollments].sort((a, b) => STATUS_ORDER[a.status] - STATUS_ORDER[b.status]),
    [data.enrollments],
  );
  const selected = ordered.find((e) => e.id === selectedId) ?? ordered[0] ?? null;
  const displayName = labels.localizePlanName;
  const error = actionError ?? dataError ?? storeError;

  const go = (next: View) => { setActionError(null); setView(next); };
  const run = useCallback(async (fn: () => Promise<unknown>) => {
    try {
      setActionError(null);
      await fn();
    } catch (err) {
      setActionError(err instanceof Error ? err.message : String(err));
    }
  }, []);

  // The reader's "View reading plan": open the plan view on that reading.
  const request = useReadingPlanNavStore((s) => s.request);
  useEffect(() => {
    if (!request || !loaded) return;
    const r = useReadingPlanNavStore.getState().consume(); // allow-getstate: event handler
    if (r && data.enrollments.some((e) => e.id === r.enrollmentId)) {
      setSelectedId(r.enrollmentId);
      setActionError(null);
      setView({ kind: 'plan', id: r.enrollmentId, highlight: { day: r.day, index: r.index } });
    }
  }, [request, loaded, data.enrollments]);

  // After a plan was started the Add view is gone: hand focus to the pane heading.
  useEffect(() => {
    if (view.kind !== 'home' || !focusHeading.current) return;
    focusHeading.current = false;
    headingRef.current?.focus({ preventScroll: true });
  }, [view]);

  const settingsMode: PlanSettingsMode | null = (() => {
    if (!settings) return null;
    if (settings.kind === 'start') {
      const plan = data.library.find((p) => p.key === settings.planKey);
      return plan ? { kind: 'start', plan } : null;
    }
    const detail = data.details.get(settings.id);
    return detail ? { kind: 'edit', detail } : null;
  })();

  const openSettings = (id: string) => setSettings({ kind: 'edit', id });
  const back = () => go(view.kind === 'editor' ? { kind: 'add' } : { kind: 'home' });

  const tabLabel = (e: ReadingPlans.Enrollment) => {
    const name = displayName(e.planKey, e.planName);
    if (e.status === 'paused') return t('readingPlans.nav.tabPaused', { name });
    if (e.status === 'completed') return t('readingPlans.nav.tabCompleted', { name });
    return name;
  };

  const renderHome = () => {
    if (!storeLoaded || !loaded) return <div aria-busy="true" />;
    if (ordered.length === 0) {
      return (
        <div className="flex flex-col items-center gap-sm text-center p-lg" data-testid="reading-plans-empty">
          <h2 className="m-0 text-lg font-medium">{t('readingPlans.empty.title')}</h2>
          <p className="m-0 text-sm" style={{ color: 'var(--theme-text-secondary)' }}>{t('readingPlans.empty.body')}</p>
          <button type="button" className="kth-btn kth-btn--primary" onClick={() => go({ kind: 'add' })}>{t('readingPlans.nav.add')}</button>
        </div>
      );
    }
    const detail = selected ? data.details.get(selected.id) : undefined;
    return (
      <div className="flex flex-col gap-md">
        {ordered.length >= 2 ? (
          <Tabs
            idPrefix={TAB_PREFIX}
            label={t('readingPlans.nav.plansTabs')}
            value={selected?.id ?? ''}
            onChange={setSelectedId}
            tabs={ordered.map((e) => ({ id: e.id, label: tabLabel(e) }))}
          />
        ) : null}
        {selected && detail ? (
          <div {...(ordered.length >= 2 ? tabPanelProps(TAB_PREFIX, selected.id) : {})}>
            <PlanHome
              detail={detail}
              progress={data.progress.get(selected.id) ?? EMPTY_PROGRESS}
              labels={labels}
              displayName={displayName(selected.planKey, selected.planName)}
              onToggleReading={(day, index, done) => { void run(() => service.setReadingDone(selected.id, day, index, done)); }}
              onToggleDay={(day, done) => { void run(() => service.setDayDone(selected.id, day, done)); }}
              onOpenReading={(r) => openPlanReading({ enrollmentId: selected.id, ...r })}
              onOpenSettings={() => openSettings(selected.id)}
              onViewPlan={() => go({ kind: 'plan', id: selected.id, highlight: null })}
              onShift={() => { void run(() => service.shiftSchedule(selected.id)); }}
              onSwitchToFlexible={() => { void run(() => service.switchToFlexible(selected.id)); }}
              onResume={() => { void run(() => service.resume(selected.id)); }}
            />
          </div>
        ) : null}
      </div>
    );
  };

  const showAddButton = view.kind === 'home' && loaded && ordered.length > 0;

  return (
    <div className="h-full w-full overflow-auto" data-testid="reading-plans-pane"
      style={{ backgroundColor: 'var(--theme-bg-primary)', color: 'var(--theme-text-primary)' }}>
      <div className="flex flex-col gap-md p-md" style={{ maxInlineSize: '46rem', marginInline: 'auto' }}>
        <div className="flex items-center gap-sm">
          {/* The app stage focuses the first h1[tabindex=-1] when the app opens. */}
          <h1 ref={headingRef} tabIndex={-1} className="m-0 text-2xl font-semibold me-auto">{t('readingPlans.title')}</h1>
          {showAddButton ? (
            <button type="button" className="kth-btn" onClick={() => go({ kind: 'add' })}>+ {t('readingPlans.nav.add')}</button>
          ) : null}
        </div>
        {error ? <Notice tone="error">{t('readingPlans.error', { message: error })}</Notice> : null}
        {view.kind === 'home' ? renderHome() : null}
        {view.kind === 'add' ? (
          <AddPlanView
            library={data.library}
            labels={labels}
            onBack={back}
            onEdit={(key) => go({ kind: 'editor', planKey: key })}
            onStart={(key) => setSettings({ kind: 'start', planKey: key })}
            onError={setActionError}
          />
        ) : null}
        {view.kind === 'editor' ? (
          <PlanEditorView
            planKey={view.planKey}
            labels={labels}
            onClose={back}
            onSaved={(plan, isNew) => {
              go({ kind: 'add' });
              if (isNew) setSettings({ kind: 'start', planKey: plan.key });
            }}
            onError={setActionError}
          />
        ) : null}
        {view.kind === 'plan' ? (
          <ReadingPlanDetail
            enrollmentId={view.id}
            labels={labels}
            displayName={displayName}
            highlight={view.highlight}
            onBack={back}
            onOpenSettings={() => openSettings(view.id)}
            onError={setActionError}
          />
        ) : null}
      </div>
      <PlanSettingsDialog
        mode={settingsMode}
        open={settingsMode !== null}
        onClose={() => setSettings(null)}
        labels={labels}
        displayName={displayName}
        onError={setActionError}
        onStarted={(enrollment) => {
          focusHeading.current = true;
          setSettings(null);
          setSelectedId(enrollment.id);
          go({ kind: 'home' });
        }}
        onRemoved={() => {
          setSettings(null);
          setSelectedId(null);
          focusHeading.current = true;
          go({ kind: 'home' });
        }}
      />
    </div>
  );
};

export default ReadingPlansPane;
