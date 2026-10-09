/**
 * Settings > Offline tab (the Downloads module's web view, rendered by the generic
 * `preferences:offline` section view). The offline infrastructure it drives
 * (offlineStore, OfflineStorageManager, the asset manager) stays in the host.
 */
import './downloads.scss';
import { useEffect, useState } from 'preact/hooks';
import { useTranslation } from 'react-i18next';
import type { Localizer } from '@bible/core/browser';
import { offlineStore } from '../../stores/offlineStore';
import { moduleStore } from '../../stores/moduleStore';
import { useStore } from '../../hooks/useStore';
import { useLocalizer } from '../../hooks/useLocalizer';
import { offlineStorageManager } from '../../offline/sharedInstances';
import { DownloadsSection } from './DownloadsSection';
import { OfflinePackSection } from './OfflinePackSection';

function formatBytes(bytes: number, localizer: Localizer): string {
  const fixed1 = (n: number) => localizer.formatNumber(n, { minimumFractionDigits: 1, maximumFractionDigits: 1 });
  if (bytes < 1024) return `${localizer.formatNumber(bytes)} B`;
  if (bytes < 1024 * 1024) return `${fixed1(bytes / 1024)} KB`;
  if (bytes < 1024 * 1024 * 1024) return `${fixed1(bytes / (1024 * 1024))} MB`;
  return `${fixed1(bytes / (1024 * 1024 * 1024))} GB`;
}

function OfflineModuleCard({
  abbreviation,
  name,
  sizeBytes,
  isDownloaded,
  progress,
  onDownload,
  onRemove,
  badge,
}: {
  abbreviation: string;
  name: string;
  sizeBytes?: number;
  isDownloaded: boolean;
  progress?: { loaded: number; total: number; status: string; error?: string };
  onDownload: () => void;
  onRemove: () => void;
  badge?: string;
}) {
  const { t } = useTranslation();
  const localizer = useLocalizer();
  const pct = progress && progress.total > 0
    ? Math.round((progress.loaded / progress.total) * 100)
    : 0;

  return (
    <div class="offline-module-card">
      <div class="offline-module-card__info">
        <span class="offline-module-card__name">{name}</span>
        <span class="offline-module-card__meta">
          {abbreviation}
          {sizeBytes ? ` - ${formatBytes(sizeBytes, localizer)}` : ''}
          {badge && <span class="offline-module-card__badge">{badge}</span>}
        </span>
      </div>
      <div class="offline-module-card__actions">
        {isDownloaded && !progress && (
          <>
            <span class="offline-module-card__status offline-module-card__status--downloaded">
              <i class="fa-solid fa-circle-check" />
            </span>
            <button
              class="offline-module-card__btn offline-module-card__btn--remove"
              onClick={onRemove}
              title={t('settings.offline.remove')}
            >
              <i class="fa-solid fa-circle-minus" />
            </button>
          </>
        )}
        {!isDownloaded && !progress && (
          <button
            class="offline-module-card__btn offline-module-card__btn--download"
            onClick={onDownload}
            title={t('settings.offline.download')}
          >
            <i class="fa-solid fa-download" />
          </button>
        )}
        {progress?.status === 'error' && (
          <span class="offline-module-card__error" title={progress.error}>
            <i class="fa-solid fa-circle-exclamation" /> {t('settings.offline.failed')}
          </span>
        )}
      </div>
      {progress?.status === 'downloading' && (
        <div class="offline-module-card__progress">
          <div class="offline-module-card__progress-bar" style={{ width: `${pct}%` }} />
        </div>
      )}
    </div>
  );
}

export function OfflineSettingsView() {
  const { t } = useTranslation();
  const localizer = useLocalizer();
  const offlineEnabled = useStore(offlineStore, () => offlineStore.enabled);
  const downloadedModules = useStore(offlineStore, () => offlineStore.downloadedModules);
  const isOnline = useStore(offlineStore, () => offlineStore.isOnline);
  const storageUsed = useStore(offlineStore, () => offlineStore.storageUsed);
  const activeDownloads = useStore(offlineStore, () => offlineStore.activeDownloads);
  const [semanticAvailable, setSemanticAvailable] = useState(false);
  const [semanticSize, setSemanticSize] = useState(0);
  const storageManager = offlineStorageManager;

  // Fetch storage info and semantic availability when the tab is shown
  useEffect(() => {
    storageManager.getStorageInfo().then(info => {
      offlineStore.updateStorageInfo(info.used, info.quota);
    });
    moduleStore.getSemanticIndexInfo()
      .then(data => {
        setSemanticAvailable(data.available);
        setSemanticSize(data.sizeBytes || 0);
      })
      .catch(() => {});
  }, []);

  const handleRemove = async (abbreviation: string) => {
    await storageManager.removeModule(abbreviation);
  };

  const handleDownloadSemantic = async () => {
    try {
      await storageManager.downloadSemanticIndex();
    } catch (err) {
      console.error('Semantic download failed:', err);
    }
  };

  return (
    <div class="settings-panel__section" data-section="offline">
      <h4 class="settings-panel__section-title">{t('settings.offline.title')}</h4>

      <div class="offline-status">
        <span class={`offline-status__indicator ${isOnline ? 'offline-status__indicator--online' : 'offline-status__indicator--offline'}`} />
        <span>{isOnline ? t('settings.offline.online') : t('settings.offline.offline')}</span>
        {storageUsed > 0 && (
          <span class="offline-status__storage">
            {t('settings.offline.storage')} {formatBytes(storageUsed, localizer)}
          </span>
        )}
      </div>

      <label class="settings-panel__field settings-panel__field--checkbox">
        <input
          type="checkbox"
          checked={offlineEnabled}
          onChange={(e) => offlineStore.setEnabled((e.target as HTMLInputElement).checked)}
        />
        <span>{t('settings.offline.enableOffline')}</span>
      </label>

      {offlineEnabled && (
        <>
          <OfflinePackSection />

          <h4 class="settings-panel__section-title" style={{ marginTop: '16px' }}>{t('settings.offline.semanticSearch')}</h4>
          <div class="offline-modules-list">
            {semanticAvailable ? (
              <OfflineModuleCard
                abbreviation="semantic-index"
                name={t('settings.offline.semanticIndex')}
                sizeBytes={semanticSize || downloadedModules.find(d => d.abbreviation === 'semantic-index')?.sizeBytes}
                isDownloaded={offlineStore.isModuleDownloaded('semantic-index')}
                progress={activeDownloads.get('semantic-index')}
                onDownload={handleDownloadSemantic}
                onRemove={() => handleRemove('semantic-index')}
              />
            ) : (
              <div class="offline-modules-list__empty">
                {t('settings.offline.semanticNotAvailable')}
              </div>
            )}
          </div>
        </>
      )}

      <DownloadsSection />
    </div>
  );
}

export default OfflineSettingsView;
