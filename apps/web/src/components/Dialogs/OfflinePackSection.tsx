/**
 * Settings > Offline > "Offline packs": pick modules, voices and data files, see what they cost on
 * this device and download them in one run (task 0075). The selection lives in component state only:
 * the web app never persists pack specs (no localStorage / IndexedDB) until accounts exist.
 * Downloaded items are the asset stores' re-downloadable device cache. Cancelling keeps partial
 * downloads; starting a new plan resumes them.
 */

import { useEffect, useMemo, useState } from 'preact/hooks';
import { useTranslation } from 'react-i18next';
import { PackBuilder } from '@bible/ui';
import type { PackBuilderLabels, PackBuilderRow, PackBuilderStatus } from '@bible/ui';
import { PackRun, planPack } from '@bible/core/browser';
import type { IPackInstaller, IPackSource, PackItemKind, PackOffer, PackPreset, PackRunSnapshot, PlanWarning } from '@bible/core/browser';
import { useLocalizer } from '../../hooks/useLocalizer';
import { formatBytesLocalized } from '../../offline/formatBytes';
import { getAssetManager } from '../../assets/webAssets';
import { pinModuleAsset } from '../../offline/moduleAssets';
import { createWebPackSource } from '../../offline/webPackSource';
import { createWebPackInstallers } from '../../offline/webPackInstallers';

export interface OfflinePackSectionProps {
  /** Test seam; default the web pack source. */
  source?: IPackSource;
  /** Test seam; default the web installers. */
  installers?: Partial<Record<PackItemKind, IPackInstaller>>;
  /** Without the offline app shell (PWA, task 0085) a pack only helps while a tab is already open. */
  showShellNotice?: boolean;
  /** Test seam; default `offlineStorageManager.removeModule` (asset + legacy file + offlineStore entry). */
  removeModule?: (abbreviation: string) => Promise<void>;
  /** Test seam; default the main asset manager's `remove`. */
  removeAsset?: (id: string) => Promise<void>;
  /** Test seam; default `pinModuleAsset`. */
  pinModule?: (abbreviation: string) => Promise<void>;
  /** Test seam; default the main asset manager's pinned `install` of the installed version. */
  pinAsset?: (id: string) => Promise<void>;
}

const defaultRemoveModule = async (abbr: string): Promise<void> => {
  const { offlineStorageManager } = await import('../../offline/sharedInstances');
  await offlineStorageManager.removeModule(abbr);
};
const defaultRemoveAsset = async (id: string): Promise<void> => {
  await getAssetManager().remove(id);
};
const defaultPinAsset = async (id: string): Promise<void> => {
  await getAssetManager().install(id, { pinned: true });
};

const GROUPS = ['bible', 'commentary', 'dictionary', 'crossref', 'topical', 'other', 'speech', 'data'] as const;

function mkRows(
  offers: readonly PackOffer[],
  selected: ReadonlySet<string>,
  run: PackRunSnapshot | null,
  disabledReason: string,
  errorText: (code: string, message: string) => string,
): PackBuilderRow[] {
  // A runtime that only exists as another offer's dependency is planned automatically, not listed.
  const dependencyOnly = new Set(offers.flatMap((o) => (o.requires ?? []).map((r) => `${r.kind}:${r.id.toLowerCase()}`)));
  const running = run?.state === 'running';
  return offers
    .filter((o) => !dependencyOnly.has(o.key))
    .map((o) => {
      const active = run?.active.find((a) => a.key === o.key);
      const err = run?.errors.find((e) => e.key === o.key);
      let status: PackBuilderStatus = o.status;
      if (active) status = 'installing';
      else if (err) status = 'error';
      const row: PackBuilderRow = {
        key: o.key,
        title: o.title,
        group: o.group,
        sizeBytes: o.downloadBytes,
        status,
        selected: selected.has(o.key),
      };
      // The module version is a content hash on web: not shown.
      const detail = o.language ?? '';
      if (detail) row.detail = detail;
      if (!o.offlineReadable) {
        row.disabled = true;
        row.disabledReason = disabledReason;
      }
      if (active) row.progress = { loaded: active.loaded, total: active.total };
      if (err && !running) row.error = errorText(err.code, err.message);
      return row;
    });
}

export function OfflinePackSection({
  source,
  installers,
  showShellNotice = true,
  removeModule = defaultRemoveModule,
  removeAsset = defaultRemoveAsset,
  pinModule = pinModuleAsset,
  pinAsset = defaultPinAsset,
}: OfflinePackSectionProps) {
  const { t } = useTranslation();
  const localizer = useLocalizer();
  const formatBytes = (n: number): string => formatBytesLocalized(n, localizer);
  const tt = (key: string, defaultValue: string): string => t(`settings.offline.pack.${key}`, { defaultValue });

  const src = useMemo(() => source ?? createWebPackSource(), [source]);
  const [offers, setOffers] = useState<PackOffer[]>([]);
  const [presets, setPresets] = useState<PackPreset[]>([]);
  const [freeBytes, setFreeBytes] = useState<number | null>(null);
  const [selected, setSelected] = useState<ReadonlySet<string>>(new Set());
  const [run, setRun] = useState<PackRun | null>(null);
  const [snap, setSnap] = useState<PackRunSnapshot | null>(null);
  const [loadFailed, setLoadFailed] = useState(false);

  const load = async (signal?: AbortSignal): Promise<void> => {
    try {
      const [o, p, f] = await Promise.all([src.listOffers(signal), src.listPresets(), src.freeBytes()]);
      if (signal?.aborted) return;
      setOffers(o);
      setPresets(p);
      setFreeBytes(f);
      setLoadFailed(false);
    } catch {
      if (!signal?.aborted) setLoadFailed(true);
    }
  };

  useEffect(() => {
    const ctl = new AbortController();
    void load(ctl.signal);
    return () => ctl.abort();
  }, [src]);

  useEffect(() => {
    if (!run) return;
    setSnap(run.getSnapshot());
    return run.subscribe(() => setSnap(run.getSnapshot()));
  }, [run]);

  const plan = useMemo(() => {
    const items = offers.filter((o) => selected.has(o.key) && o.offlineReadable).map((o) => o.ref);
    return planPack({ items, offers, freeBytes });
  }, [offers, selected, freeBytes]);

  const titleOf = (key: string): string => offers.find((o) => o.key === key)?.title ?? key.replace(/^\w+:/, '');
  const warningText = (w: PlanWarning): string => {
    switch (w.code) {
      case 'unavailable':
        return tt('warn.unavailable', '{name} is no longer offered.').replace('{name}', titleOf(w.key));
      case 'not-readable-offline':
        return tt('warn.notReadable', '{name} cannot be read offline in the web app yet.').replace('{name}', titleOf(w.key));
      case 'dependency-added':
        return tt('warn.dependencyAdded', '{name} was added because {for} needs it.').replace('{name}', titleOf(w.key)).replace('{for}', titleOf(w.for));
      case 'missing-dependency':
        return tt('warn.missingDependency', '{name} needs {requires}, which is not offered.').replace('{name}', titleOf(w.key)).replace('{requires}', titleOf(w.requires));
      case 'cycle':
        return tt('warn.cycle', 'Some items depend on each other; they will be installed in a fixed order.');
      case 'over-quota':
        return tt('warn.overQuota', 'About {size} more space is needed.').replace('{size}', formatBytes(w.shortfallBytes));
      case 'quota-unknown':
        return ''; // the summary already says that free space is unknown
    }
  };
  const errorText = (code: string, message: string): string => t(`assets.error.${code}`, { defaultValue: message });

  const rows = mkRows(offers, selected, snap, tt('notReadable', 'No offline reader for this type in the web app yet.'), errorText);

  const labels: PackBuilderLabels = {
    title: tt('title', 'Offline packs'),
    presetsHeading: tt('presets', 'Starter packs'),
    groupsHeading: tt('groups', 'Contents'),
    empty: loadFailed ? tt('loadFailed', 'The list of packs could not be loaded.') : tt('empty', 'Nothing is available to download.'),
    statusAbsent: tt('status.absent', 'Not downloaded'),
    statusInstalled: tt('status.installed', 'On this device'),
    statusUpdate: tt('status.update', 'Update available'),
    statusInstalling: tt('status.installing', 'Downloading'),
    statusError: tt('status.error', 'Failed'),
    start: tt('start', 'Download selected'),
    cancel: tt('cancel', 'Cancel'),
    summaryDownload: tt('summary.download', 'Download: {size}'),
    summaryStored: tt('summary.stored', 'Stored: {size}'),
    summaryFree: tt('summary.free', 'Free: {size}'),
    summaryFreeUnknown: tt('summary.freeUnknown', 'Free space unknown'),
    fitFits: tt('fit.fits', 'Fits on this device'),
    fitTight: tt('fit.tight', 'Fits, but storage is nearly full'),
    fitNo: tt('fit.no', 'Not enough space: {size} short'),
    fitUnknown: tt('fit.unknown', 'Cannot tell if it fits'),
    storageBarLabel: tt('storageBar', 'Storage use'),
    runProgressLabel: tt('runProgress', 'Download progress'),
    runCount: tt('run.count', '{done} of {total} items'),
    runBytes: tt('run.bytes', '{loaded} of {total}'),
    runRunning: tt('run.running', 'Downloading...'),
    runDone: tt('run.done', 'Done. Everything is on this device.'),
    runPartial: tt('run.partial', 'Some items were not downloaded.'),
    runFailed: tt('run.failed', 'The download failed.'),
    runCancelled: tt('run.cancelled', 'Cancelled. Partial downloads are kept and resume next time.'),
    remove: tt('remove', 'Remove'),
    keepHint: tt('keepHint', 'Selecting an item on this device keeps it here; it is never cleaned up automatically.'),
  };

  const onToggle = (key: string, on: boolean): void => {
    const next = new Set(selected);
    if (on) next.add(key);
    else next.delete(key);
    setSelected(next);
  };

  const onPreset = (id: string): void => {
    const p = presets.find((x) => x.id === id);
    if (!p) return;
    const known = new Map(offers.map((o) => [o.key, o]));
    const next = new Set(selected);
    for (const r of p.items) {
      const k = `${r.kind}:${r.id.toLowerCase()}`;
      if (known.get(k)?.offlineReadable) next.add(k);
    }
    setSelected(next);
  };

  const onRemove = (key: string): void => {
    const o = offers.find((x) => x.key === key);
    if (!o) return;
    const next = new Set(selected);
    next.delete(key);
    setSelected(next);
    void (o.ref.kind === 'module' ? removeModule(o.ref.id) : removeAsset(o.ref.id)).catch(() => {}).then(() => load());
  };

  /** Choosing an item that is already on the device keeps it: pin it so automatic cleanup skips it. */
  const pinPresent = (): void => {
    for (const key of plan.present) {
      if (!selected.has(key)) continue;
      const o = offers.find((x) => x.key === key);
      if (!o) continue;
      void (o.ref.kind === 'module' ? pinModule(o.ref.id) : pinAsset(o.ref.id)).catch(() => {});
    }
  };

  const onStart = (): void => {
    pinPresent();
    if (plan.steps.length === 0) return;
    try {
      // Called from the click: persistent storage needs a user gesture in some browsers.
      void navigator.storage?.persist?.().catch(() => {});
    } catch { /* not available */ }
    const r = new PackRun(plan, installers ?? createWebPackInstallers(), { concurrency: 2 });
    setRun(r);
    void r.start().then(() => load());
  };

  const builderRun = snap ? { state: snap.state, done: snap.done, total: snap.total, loadedBytes: snap.loadedBytes, totalBytes: snap.totalBytes } : undefined;

  return (
    <div class="settings-panel__section offline-pack-section" data-section="offline-pack">
      <PackBuilder
        headingLevel={4}
        notice={showShellNotice ? tt('shellNotice', 'Until the offline app shell is available, downloaded packs only help while a tab of this site is already open.') : undefined}
        onRemove={onRemove}
        groups={GROUPS.map((g) => ({ id: g, label: tt(`group.${g}`, { bible: 'Bibles', commentary: 'Commentaries', dictionary: 'Dictionaries', crossref: 'Cross-references', topical: 'Topical', other: 'Other modules', speech: 'Speech voices', data: 'Data files' }[g]) }))}
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
        warnings={plan.warnings.map(warningText).filter(Boolean)}
        run={builderRun}
        onStart={onStart}
        onCancel={() => run?.cancel()}
        labels={labels}
        formatBytes={formatBytes}
      />
    </div>
  );
}
