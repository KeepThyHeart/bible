/**
 * Settings > Offline > "Downloads & storage": every large optional download (speech engine
 * and voices, data files) with its size, status and Download / Remove, from the shared asset
 * manager. Downloaded assets are a re-downloadable device cache, never user content.
 */

import { useSyncExternalStore } from 'preact/compat';
import { useEffect } from 'preact/hooks';
import { useTranslation } from 'react-i18next';
import { AssetList } from '@bible/ui';
import type { AssetListRow } from '@bible/ui';
import type { AssetEntry, IAssetManager } from '@bible/core/browser';
import { getAssetManager, refreshAssetCatalog } from '../../assets/webAssets';
import { formatBytes } from '../../audio/audioStorage';

const KIND_LABEL_KEYS: Record<string, string> = {
  'tts-runtime': 'settings.downloads.kind.ttsRuntime',
  'tts-voice': 'settings.downloads.kind.ttsVoice',
};

export interface DownloadsSectionProps {
  /** Test seam; default the shared web manager. */
  manager?: IAssetManager;
  /** Test seam; default refreshes the shared catalog. */
  refresh?: () => Promise<void>;
}

export function DownloadsSection({ manager, refresh = refreshAssetCatalog }: DownloadsSectionProps) {
  const { t } = useTranslation();
  const assets = manager ?? getAssetManager();
  const snapshot = useSyncExternalStore((cb) => assets.subscribe(cb), () => assets.getSnapshot());

  useEffect(() => { void refresh(); }, []);

  const errorText = (e: AssetEntry['error']): string | undefined =>
    !e || e.code === 'aborted' ? undefined : t(`assets.error.${e.code}`, { defaultValue: e.message });

  const rows: AssetListRow[] = snapshot.entries.map((e) => {
    const detail = [
      KIND_LABEL_KEYS[e.kind] ? t(KIND_LABEL_KEYS[e.kind]) : e.kind,
      e.license,
      e.status === 'installed' && !e.verified ? t('settings.downloads.unverified') : null,
    ].filter(Boolean).join(' · ');
    return {
      id: e.id,
      title: e.title,
      detail,
      status: e.status,
      sizeBytes: e.size || e.storedBytes,
      storedBytes: e.storedBytes,
      progress: e.progress ? { loaded: e.progress.loaded, total: e.progress.total } : undefined,
      error: errorText(e.error),
    };
  });

  const labels = {
    download: t('settings.downloads.download'),
    update: t('settings.downloads.update'),
    retry: t('settings.downloads.retry'),
    cancel: t('settings.downloads.cancel'),
    remove: t('settings.downloads.remove'),
    queued: t('settings.downloads.queued'),
    downloading: t('settings.downloads.downloading'),
    installed: t('settings.downloads.installed'),
    total: t('settings.downloads.total'),
    empty: t('settings.downloads.empty'),
  };

  return (
    <div class="settings-panel__section downloads-section" data-section="downloads">
      <h4 class="settings-panel__section-title" style={{ marginTop: '16px' }}>{t('settings.downloads.title')}</h4>
      <AssetList
        rows={rows}
        storedBytes={snapshot.storedBytes}
        labels={labels}
        formatBytes={formatBytes}
        onInstall={(id) => { void assets.install(id, { pinned: true }).catch(() => { /* the failure lands in the entry */ }); }}
        onCancel={(id) => assets.cancel(id)}
        onRemove={(id) => { void assets.remove(id).catch(() => {}); }}
      />
    </div>
  );
}
