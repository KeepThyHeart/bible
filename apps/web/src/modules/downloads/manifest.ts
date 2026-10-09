/**
 * The Downloads feature-module manifest (web): data only, loaded at boot. It owns the
 * Settings "Offline" tab (offline mode, offline packs, downloads and storage). The offline
 * infrastructure it drives (OfflineStorageManager, the asset manager, offlineStore and the
 * auto-download manager) stays in the host: reading, audio and search depend on it.
 * The tab id, order and label key are what the host manifest declared; never rename them.
 */
import type { FeatureModuleManifest, PreferencesSectionContribution } from '@bible/core/browser';

export const DOWNLOADS_MODULE_ID = 'downloads';

export const offlineSettingsSection: PreferencesSectionContribution = {
  id: 'offline',
  title: { key: 'settings.tabs.offline', fallback: 'Offline' },
  icon: { kind: 'builtin', name: 'fa-cloud-arrow-down' },
  order: 70,
};

export const downloadsManifest: FeatureModuleManifest = {
  id: DOWNLOADS_MODULE_ID,
  platforms: ['web'],
  contributes: {
    preferencesSections: [offlineSettingsSection],
  },
};
