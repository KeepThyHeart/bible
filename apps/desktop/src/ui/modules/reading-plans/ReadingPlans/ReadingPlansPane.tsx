import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { ReadingPlans } from '@bible/core/browser';
import { AppPage, Notice } from '@bible/ui';
import { useI18n } from '../../../contexts/useI18n';
import { getReadingPlanService } from '../readingPlansAPI';
import { openPlanReading } from '../useActiveReadingStore';
import { useReadingPlanStore } from '../useReadingPlanStore';
import { useReadingPlanNavStore, validScheduleUndo } from '../useReadingPlanNavStore';
import { openReadingPlansBeside } from '../openBeside';
import { rpTextWith } from '../rpText';
import { ensureReferenceLocales } from '../../../services/localizedReferenceParser';
import { useReadingPlanLabels } from './useReadingPlanLabels';
import { useReadingPlanData } from './readingPlanData';
import ReadingPlanDetail from './ReadingPlanDetail';
import PlanEditorView from './PlanEditorView';
import AgendaTab from './AgendaTab';
import PlansTab from './PlansTab';
import RescheduleDialog from './RescheduleDialog';
import type { ReschedulePreview } from './RescheduleDialog';
import { SettingsGroupSection } from '../../../components/PreferencesDialog/SettingsGroupSection';
import { usePreferencesStore } from '../../../stores/usePreferencesStore';
import AddPlanView from './AddPlanView';
import PlanSettingsDialog from './PlanSettingsDialog';
import type { PlanSettingsMode } from './PlanSettingsDialog';

/** `APP_WILL_HIDE_EVENT` of `apps/DesktopAppStage` (not imported: the stage imports the app views). */
const APP_WILL_HIDE_EVENT = 'app:will-hide';

type AppTab = 'agenda' | 'plans' | 'settings';

/** Inside the Plans tab: the list, or one of the views it opens. */
type View =
  | { kind: 'home' }
  | { kind: 'add' }
  | { kind: 'editor'; planKey: string | null }
  | { kind: 'plan'; id: string; highlight: { day: number; index: number } | null };

type SettingsTarget = { kind: 'start'; planKey: string } | { kind: 'edit'; id: string } | null;

const EMPTY_PROGRESS: ReadingPlans.ProgressIndex = new Map();
const EMPTY_COMPLETIONS: ReadingPlans.Completion[] = [];
const STATUS_ORDER: Record<ReadingPlans.Enrollment['status'], number> = { active: 0, paused: 1, completed: 2 };
const TAB_PREFIX = 'rp-app';

/**
 * Reading plans app (tasks 0073, 0222): three tabs on the shared `AppPage`. Agenda: how each plan stands and what to
 * read (list, week or month). Plans: the plans followed, adding one (library, editor) and a plan's full view.
 * Settings: the reading-plan settings. One settings dialog serves starting and editing a plan; one Reschedule
 * dialog serves a plan that has fallen behind.
 */
const ReadingPlansPane: React.FC<{ asApp?: boolean }> = ({ asApp = false }) => {
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

  const [appTab, setAppTab] = useState<AppTab>('agenda');
  const [view, setView] = useState<View>({ kind: 'home' });
  const [rescheduleId, setRescheduleId] = useState<string | null>(null);
  const weekStart: 0 | 1 = usePreferencesStore((st) => st.readingPlanWeekStart) === 'sunday' ? 0 : 1;
  const [settings, setSettings] = useState<SettingsTarget>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const focusHeading = useRef(false);

  const ordered = useMemo(
    () => [...data.enrollments].sort((a, b) => STATUS_ORDER[a.status] - STATUS_ORDER[b.status]),
    [data.enrollments],
  );
  const scheduleUndo = useReadingPlanNavStore((s) => s.scheduleUndo);
  const displayName = labels.localizePlanName;
  const error = actionError ?? dataError ?? storeError;

  const go = (next: View) => { setActionError(null); setView(next); };
  const showPlan = (id: string, highlight: { day: number; index: number } | null = null) => {
    setAppTab('plans');
    go({ kind: 'plan', id, highlight });
  };
  const run = useCallback(async (fn: () => Promise<unknown>) => {
    try {
      setActionError(null);
      await fn();
    } catch (err) {
      setActionError(err instanceof Error ? err.message : String(err));
    }
  }, []);

  // Docked in Study, the pane stays mounted while another app is shown: close its dialogs (they are portalled to
  // <body>) and go back to "where am I" when its app is hidden. As an app it is unmounted instead.
  const rootRef = useRef<HTMLDivElement>(null);
  const [epoch, setEpoch] = useState(0);
  useEffect(() => {
    const onHide = () => { setSettings(null); setRescheduleId(null); setView({ kind: 'home' }); setAppTab('agenda'); setEpoch((n) => n + 1); };
    window.addEventListener(APP_WILL_HIDE_EVENT, onHide);
    return () => window.removeEventListener(APP_WILL_HIDE_EVENT, onHide);
  }, []);

  // The reader's "View reading plan": open the plan view on that reading.
  const request = useReadingPlanNavStore((s) => s.request);
  useEffect(() => {
    if (!request || !loaded) return;
    // The request is for the Reading plans app (the reader opens it next). A copy of this pane docked in the
    // Study workspace must leave it alone, or the app would open without it.
    if (rootRef.current?.closest('[data-app]')?.getAttribute('data-app') === 'study') return;
    const r = useReadingPlanNavStore.getState().consume(); // allow-getstate: event handler
    if (r && data.enrollments.some((e) => e.id === r.enrollmentId)) showPlan(r.enrollmentId, { day: r.day, index: r.index });
  }, [request, loaded, data.enrollments]);

  // After a plan was started or removed, the view it came from is gone: hand focus to the page heading (AppPage's h1).
  useEffect(() => {
    if (view.kind !== 'home' || !focusHeading.current) return;
    focusHeading.current = false;
    rootRef.current?.querySelector<HTMLHeadingElement>('h1')?.focus({ preventScroll: true });
  }, [view, appTab]);

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

  const todayDate = service.today();
  const rolloverHour = service.rolloverHour();
  const agendaPlans = ordered
    .filter((e) => data.details.has(e.id))
    .map((e) => ({
      detail: data.details.get(e.id)!,
      completions: data.completions.get(e.id) ?? EMPTY_COMPLETIONS,
      progress: data.progress.get(e.id) ?? EMPTY_PROGRESS,
      displayName: displayName(e.planKey, e.planName),
    }));
  const rescheduling = rescheduleId ? data.details.get(rescheduleId) : undefined;
  const undoTarget = scheduleUndo ? data.enrollments.find((e) => e.id === scheduleUndo.enrollmentId) : undefined;
  const undo = undoTarget ? validScheduleUndo(scheduleUndo, undoTarget, todayDate) : null;

  const undoNotice = undo ? (
    <Notice
      tone="success"
      role="status"
      actions={<button type="button" className="kth-btn kth-btn--sm" onClick={() => {
        void run(async () => {
          await service.updateEnrollment(undo.enrollmentId, { startDate: undo.oldStartDate, catchUp: undo.oldCatchUp });
          useReadingPlanNavStore.getState().setScheduleUndo(null); // allow-getstate: event handler
        });
      }}>{rpTextWith(t, 'readingPlans.behind.undo', 'Undo')}</button>}
    >
      <span data-testid="moved-notice">
        {rpTextWith(t, 'readingPlans.behind.moved',
          `Dates moved. The plan used to start on ${labels.formatDate(undo.oldStartDate)}. You can also change the start date in Plan settings.`,
          { oldStart: labels.formatDate(undo.oldStartDate) })}
      </span>
    </Notice>
  ) : null;

  const agendaTab = () => {
    if (!storeLoaded || !loaded) return <div aria-busy="true" />;
    if (ordered.length === 0) {
      return (
        <div className="flex flex-col items-start gap-sm" data-testid="reading-plans-empty">
          <h2 className="m-0 text-lg font-medium">{t('readingPlans.empty.title')}</h2>
          <p className="m-0 text-sm kth-text-muted">{t('readingPlans.empty.body')}</p>
          <button type="button" className="kth-btn kth-btn--primary" onClick={() => { setAppTab('plans'); go({ kind: 'add' }); }}>
            {t('readingPlans.nav.add')}
          </button>
        </div>
      );
    }
    return (
      <AgendaTab
        plans={agendaPlans}
        labels={labels}
        todayDate={todayDate}
        rolloverHour={rolloverHour}
        weekStart={weekStart}
        onToggleReading={(id, day, index, done) => { void run(() => service.setReadingDone(id, day, index, done)); }}
        onToggleDay={(id, day, done) => { void run(() => service.setDayDone(id, day, done)); }}
        onOpenReading={(id, r) => openPlanReading({ enrollmentId: id, ...r })}
        onViewPlan={(id) => showPlan(id)}
        onReschedule={setRescheduleId}
      />
    );
  };

  const plansTab = () => {
    if (view.kind === 'add') {
      return (
        <AddPlanView
          library={data.library}
          labels={labels}
          onBack={back}
          onEdit={(key) => go({ kind: 'editor', planKey: key })}
          onStart={(key) => setSettings({ kind: 'start', planKey: key })}
          onError={setActionError}
        />
      );
    }
    if (view.kind === 'editor') {
      return (
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
      );
    }
    if (view.kind === 'plan') {
      return (
        <ReadingPlanDetail
          enrollmentId={view.id}
          labels={labels}
          displayName={displayName}
          highlight={view.highlight}
          onBack={back}
          onOpenSettings={() => openSettings(view.id)}
          onError={setActionError}
        />
      );
    }
    if (!storeLoaded || !loaded) return <div aria-busy="true" />;
    return (
      <PlansTab
        rows={ordered.map((e) => ({ enrollment: e, detail: data.details.get(e.id), displayName: displayName(e.planKey, e.planName) }))}
        labels={labels}
        onAdd={() => go({ kind: 'add' })}
        onViewPlan={(id) => go({ kind: 'plan', id, highlight: null })}
        onOpenSettings={openSettings}
      />
    );
  };

  const changeTab = (id: string) => {
    setActionError(null);
    setAppTab(id as AppTab);
    // Coming back to Plans starts from its list.
    if (id === 'plans') setView({ kind: 'home' });
  };

  return (
    <div ref={rootRef} className="h-full w-full" data-testid="reading-plans-pane"
      style={{ backgroundColor: 'var(--theme-bg-primary)', color: 'var(--theme-text-primary)' }}>
      <AppPage
        key={epoch}
        title={t('readingPlans.title')}
        actions={asApp ? (
          <button type="button" className="kth-btn" onClick={() => { void openReadingPlansBeside().catch((err: unknown) => setActionError(err instanceof Error ? err.message : String(err))); }}>
            {rpTextWith(t, 'readingPlans.home.openBeside', 'Open beside the Bible')}
          </button>
        ) : undefined}
        idPrefix={TAB_PREFIX}
        tabsLabel={t('readingPlans.title')}
        tab={appTab}
        onTabChange={changeTab}
        tabs={[
          { id: 'agenda', label: rpTextWith(t, 'readingPlans.tab.agenda', 'Agenda') },
          { id: 'plans', label: rpTextWith(t, 'readingPlans.tab.plans', 'Plans') },
          { id: 'settings', label: rpTextWith(t, 'readingPlans.tab.settings', 'Settings') },
        ]}
      >
        {error ? <Notice tone="error">{t('readingPlans.error', { message: error })}</Notice> : null}
        {undoNotice}
        {appTab === 'agenda' ? agendaTab() : null}
        {appTab === 'plans' ? plansTab() : null}
        {appTab === 'settings' ? <SettingsGroupSection group="readingPlans" /> : null}
      </AppPage>
      {rescheduling ? (
        <RescheduleDialog
          open={rescheduleId !== null}
          onClose={() => setRescheduleId(null)}
          displayName={displayName(rescheduling.enrollment.planKey, rescheduling.enrollment.planName)}
          enrollment={rescheduling.enrollment}
          today={rescheduling.today}
          labels={labels}
          onStartCatchUp={() => { void run(() => service.startCatchUp(rescheduling.enrollment.id)); }}
          onStopCatchUp={() => { void run(() => service.stopCatchUp(rescheduling.enrollment.id)); }}
          loadPreview={() => service.reschedulePreview(rescheduling.enrollment.id)}
          onMoveDates={(preview: ReschedulePreview) => {
            const before = rescheduling.enrollment;
            void run(async () => {
              await service.shiftSchedule(before.id);
              useReadingPlanNavStore.getState().setScheduleUndo({ // allow-getstate: event handler
                enrollmentId: before.id,
                oldStartDate: before.startDate,
                oldCatchUp: before.catchUp ?? null,
                newStartDate: preview.newStartDate,
                pacing: before.pacing,
                readingDays: before.readingDays,
                movedOn: todayDate,
              });
            });
          }}
          onSwitchToFlexible={() => { void run(() => service.switchToFlexible(rescheduling.enrollment.id)); }}
        />
      ) : null}
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
          setAppTab('agenda');
          go({ kind: 'home' });
          void enrollment;
        }}
        onRemoved={() => {
          setSettings(null);
          focusHeading.current = true;
          go({ kind: 'home' });
        }}
      />
    </div>
  );
};

/** The app form of the pane (the Reading plans app's view): the same pane plus the "Open beside the Bible" button. */
export const ReadingPlansApp: React.FC = () => <ReadingPlansPane asApp />;

export default ReadingPlansPane;
