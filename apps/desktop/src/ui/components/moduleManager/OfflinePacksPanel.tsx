/**
 * "Offline packs" tab of the Module Manager (task 0075): the shared `PackBuilder` wired to the desktop
 * module store. Selection lives in component state (nothing is persisted), `planPack` re-runs on every
 * change, and Start runs a `PackRun` through the existing module install path.
 *
 * CANCEL: modules install one at a time (PackRun concurrency 1) and a module install in flight cannot
 * always be aborted, so the Cancel button is labelled "Stop after this module" and never starts the
 * next module. See `desktopPackInstallers.ts`.
 *
 * Desktop ignores site-config feature flags; this tab is always available.
 *
 * Licence: GPL-3.0-or-later.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { PackBuilder } from '@bible/ui';
import type { PackBuilderLabels, PackBuilderRow } from '@bible/ui';
import { PackRun, packKey, planPack } from '@bible/core/browser';
import type { IPackInstaller, IPackSource, PackOffer, PackPlan, PackPreset, PackRunSnapshot, PlanWarning } from '@bible/core/browser';
import { useI18n } from '../../contexts/useI18n';
import { useModuleStore } from '../../stores/useModuleStore';
import { createDesktopPackSource } from '../../services/desktopPackSource';
import type { PackStarterPack } from '../../services/desktopPackSource';
import { createDesktopPackInstallers } from '../../services/desktopPackInstallers';
import { useTd } from './moduleManagerI18n';

export interface OfflinePacksPanelProps {
  /** Test seam; defaults to a source over the module store. */
  source?: IPackSource;
  /** Test seam; defaults to installers over the module store. */
  installers?: { module: IPackInstaller };
}

const MB = 1024 * 1024;
const GB = 1024 * MB;

const GROUP_DEFAULTS: { id: string; key: string; fallback: string }[] = [
  { id: 'bible', key: 'moduleManager.packs.groupBible', fallback: 'Bibles' },
  { id: 'commentary', key: 'moduleManager.packs.groupCommentary', fallback: 'Commentaries' },
  { id: 'dictionary', key: 'moduleManager.packs.groupDictionary', fallback: 'Dictionaries' },
  { id: 'crossref', key: 'moduleManager.packs.groupCrossref', fallback: 'Cross-references' },
  { id: 'topical', key: 'moduleManager.packs.groupTopical', fallback: 'Topical indexes' },
  { id: 'other', key: 'moduleManager.packs.groupOther', fallback: 'Other' },
];

export function OfflinePacksPanel({ source: sourceProp, installers: installersProp }: OfflinePacksPanelProps) {
  const td = useTd();
  const { locale, localizer } = useI18n();
  const availableModules = useModuleStore((s) => s.availableModules);
  const installedModules = useModuleStore((s) => s.installedModules);
  const activeDownloads = useModuleStore((s) => s.activeDownloads);

  const source = useMemo<IPackSource>(
    () =>
      sourceProp ??
      createDesktopPackSource({
        getAvailable: () => useModuleStore.getState().availableModules,
        getInstalled: () => useModuleStore.getState().installedModules,
        getActiveDownloads: () => useModuleStore.getState().activeDownloads,
        getStarterPacks: async (): Promise<PackStarterPack[]> => {
          try {
            const r = await window.electron?.moduleManager?.getStarterPacks?.(locale);
            return r && r.ok ? (r.value as PackStarterPack[]) : [];
          } catch {
            return [];
          }
        },
      }),
    [sourceProp, locale],
  );

  const installers = useMemo(
    () =>
      installersProp ??
      createDesktopPackInstallers({
        installModule: (id, catalogId) => useModuleStore.getState().installModule(id, catalogId),
        getActiveDownloads: async () => {
          await useModuleStore.getState().loadActiveDownloads();
          return useModuleStore.getState().activeDownloads;
        },
        cancelDownload: (q) => useModuleStore.getState().cancelDownload(q),
        getLastError: () => useModuleStore.getState().error,
      }),
    [installersProp],
  );

  const [offers, setOffers] = useState<PackOffer[]>([]);
  const [presets, setPresets] = useState<PackPreset[]>([]);
  const [freeBytes, setFreeBytes] = useState<number | null>(null);
  const [selected, setSelected] = useState<ReadonlySet<string>>(new Set());
  const [snapshot, setSnapshot] = useState<PackRunSnapshot | undefined>(undefined);
  const runRef = useRef<PackRun | null>(null);

  // Reload when the source changes or the store's catalog, installed set or downloads change.
  useEffect(() => {
    let live = true;
    void Promise.all([source.listOffers(), source.listPresets(), source.freeBytes()]).then(([o, p, f]) => {
      if (!live) return;
      setOffers(o);
      setPresets(p);
      setFreeBytes(f);
    });
    return () => {
      live = false;
    };
  }, [source, availableModules, installedModules, activeDownloads]);

  const items = useMemo(() => offers.filter((o) => selected.has(o.key)).map((o) => o.ref), [offers, selected]);
  const plan: PackPlan = useMemo(() => planPack({ items, offers, freeBytes, concurrency: 1 }), [items, offers, freeBytes]);

  const fmt = useCallback(
    (n: number): string => {
      if (!Number.isFinite(n) || n <= 0) return '0 MB';
      if (n >= GB) return `${localizer.formatNumber(n / GB, { minimumFractionDigits: 1, maximumFractionDigits: 1 })} GB`;
      return `${localizer.formatNumber(Math.max(1, Math.round(n / MB)))} MB`;
    },
    [localizer],
  );

  const rows: PackBuilderRow[] = useMemo(() => {
    const active = new Map((snapshot?.active ?? []).map((a) => [a.key, a]));
    const errors = new Map((snapshot?.errors ?? []).map((e) => [e.key, e.message]));
    const inPlan = new Set(plan.steps.map((s) => s.key));
    return offers.map((o) => {
      const a = active.get(o.key);
      const err = errors.get(o.key);
      const row: PackBuilderRow = {
        key: o.key,
        title: o.title,
        detail: [o.language, o.version].filter(Boolean).join(' - '),
        group: o.group,
        sizeBytes: o.downloadBytes,
        status: err ? 'error' : a ? 'installing' : o.status,
        selected: selected.has(o.key) || inPlan.has(o.key),
      };
      if (a) row.progress = { loaded: a.loaded, total: a.total };
      if (err) row.error = err;
      return row;
    });
  }, [offers, selected, plan, snapshot]);

  const warnings = useMemo(() => {
    const title = (key: string): string => offers.find((o) => o.key === key)?.title ?? key;
    const text = (w: PlanWarning): string | null => {
      switch (w.code) {
        case 'dependency-added':
          return td('moduleManager.packs.warnDependency', '{name} was added because {for} needs it.', { name: title(w.key), for: title(w.for) });
        case 'missing-dependency':
          return td('moduleManager.packs.warnMissing', '{name} needs {requires}, which is not available.', { name: title(w.key), requires: title(w.requires) });
        case 'unavailable':
          return td('moduleManager.packs.warnUnavailable', '{name} is not available and was skipped.', { name: title(w.key) });
        case 'cycle':
          return td('moduleManager.packs.warnCycle', 'These modules depend on each other: {names}.', { names: w.keys.map(title).join(', ') });
        case 'over-quota':
        case 'quota-unknown':
        case 'not-readable-offline':
          return null; // shown by the storage summary, or not applicable on desktop
      }
    };
    return plan.warnings.map(text).filter((s): s is string => s !== null);
  }, [plan, offers, td]);

  const onToggle = useCallback((key: string, on: boolean) => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (on) next.add(key);
      else next.delete(key);
      return next;
    });
  }, []);

  const onPreset = useCallback(
    (id: string) => {
      const preset = presets.find((p) => p.id === id);
      if (!preset) return;
      const known = new Set(offers.map((o) => o.key));
      setSelected((prev) => {
        const next = new Set(prev);
        for (const ref of preset.items) if (known.has(packKey(ref))) next.add(packKey(ref));
        return next;
      });
    },
    [presets, offers],
  );

  const onStart = useCallback(() => {
    if (plan.steps.length === 0 || runRef.current) return;
    const run = new PackRun(plan, installers, { concurrency: 1 });
    runRef.current = run;
    setSnapshot(run.getSnapshot());
    run.subscribe(() => setSnapshot(run.getSnapshot()));
    void run.start().then(() => {
      runRef.current = null;
      // The store refreshes its own installed list per module; make sure the final state shows.
      if (!installersProp) void useModuleStore.getState().loadInstalledModules();
    });
  }, [plan, installers, installersProp]);

  const onCancel = useCallback(() => runRef.current?.cancel(), []);

  useEffect(() => () => runRef.current?.cancel(), []);

  const labels: PackBuilderLabels = {
    title: td('moduleManager.packs.title', 'Offline packs'),
    presetsHeading: td('moduleManager.packs.presetsHeading', 'Start from'),
    groupsHeading: td('moduleManager.packs.groupsHeading', 'Content'),
    empty: td('moduleManager.packs.empty', 'No modules are available. Refresh the catalog first.'),
    statusAbsent: td('moduleManager.packs.statusAbsent', 'Not installed'),
    statusInstalled: td('moduleManager.packs.statusInstalled', 'Installed'),
    statusUpdate: td('moduleManager.packs.statusUpdate', 'Update available'),
    statusInstalling: td('moduleManager.packs.statusInstalling', 'Installing'),
    statusError: td('moduleManager.packs.statusError', 'Failed'),
    start: td('moduleManager.packs.start', 'Install selected'),
    cancel: td('moduleManager.packs.cancel', 'Stop after this module'),
    summaryDownload: td('moduleManager.packs.summaryDownload', 'Download: {size}'),
    summaryStored: td('moduleManager.packs.summaryStored', 'Disk space: {size}'),
    summaryFree: td('moduleManager.packs.summaryFree', 'Free: {size}'),
    summaryFreeUnknown: td('moduleManager.packs.summaryFreeUnknown', 'Free space unknown'),
    fitFits: td('moduleManager.packs.fitFits', 'Fits'),
    fitTight: td('moduleManager.packs.fitTight', 'Tight on space'),
    fitNo: td('moduleManager.packs.fitNo', 'Not enough space: {size} short'),
    fitUnknown: td('moduleManager.packs.fitUnknown', 'Space not checked'),
    storageBarLabel: td('moduleManager.packs.storageBarLabel', 'Disk space used by this pack'),
    runProgressLabel: td('moduleManager.packs.runProgressLabel', 'Pack progress'),
    runCount: td('moduleManager.packs.runCount', '{done} of {total}'),
    runBytes: td('moduleManager.packs.runBytes', '{loaded} of {total}'),
    runRunning: td('moduleManager.packs.runRunning', 'Installing one module at a time'),
    runDone: td('moduleManager.packs.runDone', 'Everything is installed.'),
    runPartial: td('moduleManager.packs.runPartial', 'Some modules could not be installed.'),
    runFailed: td('moduleManager.packs.runFailed', 'Nothing could be installed.'),
    runCancelled: td('moduleManager.packs.runCancelled', 'Stopped. Modules already installed were kept.'),
  };

  return (
    <div className="module-manager-packs">
      <PackBuilder
        groups={GROUP_DEFAULTS.map((g) => ({ id: g.id, label: td(g.key, g.fallback) }))}
        rows={rows}
        presets={presets.map((p) => ({ id: p.id, label: p.name }))}
        onPreset={onPreset}
        onToggle={onToggle}
        summary={{
          downloadBytes: plan.downloadBytes,
          newStoredBytes: plan.newStoredBytes,
          freeBytes,
          fit: plan.fit,
          shortfallBytes: plan.shortfallBytes,
        }}
        warnings={warnings}
        run={
          snapshot
            ? { state: snapshot.state, done: snapshot.done, total: snapshot.total, loadedBytes: snapshot.loadedBytes, totalBytes: snapshot.totalBytes }
            : undefined
        }
        onStart={onStart}
        onCancel={onCancel}
        labels={labels}
        formatBytes={fmt}
      />
    </div>
  );
}
