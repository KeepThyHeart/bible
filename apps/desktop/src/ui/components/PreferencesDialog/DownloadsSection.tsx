/**
 * DownloadsSection.tsx
 *
 * "Downloads & storage" tab of the Preferences dialog (task 0090): one list of
 * everything downloadable (voices, runtimes, packs) with sizes, progress and
 * Download / Cancel / Remove. Rows come from the main-process AssetManager
 * (`assets:list`); the semantic-search pack is not an asset, so it is merged in
 * as an adapter row that is removed through `featurePackAPI` and installed in
 * the Module Manager.
 *
 * Polls `assets:list` every 500 ms only while a job is queued or running.
 */

import React, { useCallback, useEffect, useRef, useState } from 'react';
import { AssetList } from '@bible/ui';
import type { AssetListRow } from '@bible/ui';
import type { AssetEntry, AssetListSnapshot } from '@bible/core/browser';
import { useI18n } from '../../contexts/useI18n';
import { assetsAPI, featurePackAPI } from '../../services/electronAPI';

const POLL_MS = 500;
const FEATURE_PACK_ROW_ID = 'feature-pack:semantic_search';

interface FeaturePackStatusLite {
  installed: boolean;
  manifest: { name: string; installedSizeBytes: number } | null;
}

function formatBytes(n: number): string {
  if (!Number.isFinite(n) || n <= 0) return '0 B';
  const units = ['B', 'KB', 'MB', 'GB'];
  let v = n;
  let i = 0;
  while (v >= 1024 && i < units.length - 1) { v /= 1024; i++; }
  return `${i === 0 ? v : v.toFixed(1)} ${units[i]}`;
}

export const DownloadsSection: React.FC = () => {
  const { t } = useI18n();
  const [snapshot, setSnapshot] = useState<AssetListSnapshot | null>(null);
  const [pack, setPack] = useState<FeaturePackStatusLite | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const tRef = useRef(t);
  tRef.current = t;

  const load = useCallback(async () => {
    try {
      setSnapshot(await assetsAPI.list());
      setLoadError(null);
    } catch (err) {
      setLoadError((err as Error).message);
    }
  }, []);

  const loadPack = useCallback(async () => {
    try {
      setPack((await featurePackAPI.getStatus()) as FeaturePackStatusLite);
    } catch {
      setPack(null);
    }
  }, []);

  useEffect(() => {
    let cancelled = false;
    void load().then(async () => {
      // Re-read the catalogs once per visit (as web does), so assets offered by a catalog added
      // since startup show up without a restart. The cached list above is shown meanwhile.
      try {
        const fresh = await assetsAPI.refresh();
        if (!cancelled) setSnapshot(fresh);
      } catch { /* keep the cached list */ }
    });
    void loadPack();
    return () => { cancelled = true; };
  }, [load, loadPack]);

  const active = snapshot?.active ?? 0;
  useEffect(() => {
    if (active <= 0) return undefined;
    const timer = setInterval(() => { void load(); }, POLL_MS);
    return () => clearInterval(timer);
  }, [active, load]);

  const errorText = useCallback((e: NonNullable<AssetEntry['error']>): string | undefined => {
    if (e.code === 'aborted') return undefined;
    const key = `assets.error.${e.code}`;
    const text = tRef.current(key);
    return text === key ? e.message : text;
  }, []);

  const rows: AssetListRow[] = (snapshot?.entries ?? []).map((e) => {
    const p = e.progress;
    return {
      id: e.id,
      title: e.title,
      detail: [e.kind, e.license, (e.status !== 'installed' || e.verified) ? null : t('downloads.unverified')].filter(Boolean).join(' · '),
      status: e.status,
      sizeBytes: e.size,
      storedBytes: e.storedBytes,
      progress: p ? { loaded: p.loaded, total: p.total } : undefined,
      error: e.error ? errorText(e.error) : undefined,
    };
  });

  let storedBytes = snapshot?.storedBytes ?? 0;
  if (pack?.installed && pack.manifest) {
    rows.push({
      id: FEATURE_PACK_ROW_ID,
      title: pack.manifest.name,
      detail: t('downloads.managedInModuleManager'),
      status: 'installed',
      sizeBytes: pack.manifest.installedSizeBytes,
      storedBytes: pack.manifest.installedSizeBytes,
      canInstall: false,
      canRemove: true,
    });
    storedBytes += pack.manifest.installedSizeBytes;
  }

  const run = async (fn: () => Promise<unknown>) => {
    try {
      await fn();
    } catch (err) {
      setLoadError((err as Error).message);
    }
    await load();
  };

  const handleRemove = (id: string) => {
    if (id === FEATURE_PACK_ROW_ID) {
      void run(async () => {
        await featurePackAPI.uninstall();
        await loadPack();
      });
      return;
    }
    void run(() => assetsAPI.remove(id));
  };

  return (
    <div className="space-y-4" data-testid="downloads-section">
      <p className="text-xs" style={{ color: 'var(--theme-text-secondary)' }}>
        {t('downloads.description')}
      </p>
      {loadError && (
        <p className="text-sm" style={{ color: 'var(--theme-text-secondary)' }} data-testid="downloads-load-error">
          {loadError}
        </p>
      )}
      <AssetList
        rows={rows}
        storedBytes={storedBytes}
        formatBytes={formatBytes}
        labels={{
          download: t('downloads.download'),
          update: t('downloads.update'),
          retry: t('downloads.retry'),
          cancel: t('downloads.cancel'),
          remove: t('downloads.remove'),
          queued: t('downloads.queued'),
          downloading: t('downloads.downloading'),
          installed: t('downloads.installed'),
          total: t('downloads.total'),
          empty: t('downloads.empty'),
        }}
        onInstall={(id) => void run(() => assetsAPI.install(id))}
        onCancel={(id) => void run(() => assetsAPI.cancel(id))}
        onRemove={handleRemove}
      />
    </div>
  );
};

export default DownloadsSection;
