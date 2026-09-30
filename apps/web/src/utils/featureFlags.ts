/**
 * Web feature flags (task 0087): `isEnabled('audio')`.
 *
 * Sources, in order: a dev override, then the server's resolved `features` map in
 * `/api/config` (site config over each flag's default), then the flag's declared default.
 * A server that predates the `features` map still works: its older individual keys
 * (`showTagGraph`, `pwaEnabled`, `offlineDownloads`, `offlineAutoDownload`) are read
 * for the flags they correspond to.
 *
 * The dev override is `localStorage['kth.flags'] = 'audio,-pwa'` (or a JSON object) and
 * is honoured in development builds only.
 *
 * Feature code that loads lazily should use `lazyFeature(featureFlags, 'audio', () =>
 * import('./initAudio'))` from `@bible/core/browser`.
 */
import { createFeatureFlags, parseFlagOverrides, type FeatureFlagName } from '@bible/core/browser';
import { getClientConfig } from './clientConfig';

function siteFlags(): Record<string, unknown> {
  const cfg = getClientConfig();
  const legacy: Record<string, unknown> = {};
  if (typeof cfg.showTagGraph === 'boolean') legacy.tagGraph = cfg.showTagGraph;
  if (typeof cfg.pwaEnabled === 'boolean') legacy.pwa = cfg.pwaEnabled;
  if (typeof cfg.offlineDownloads === 'boolean') legacy.offlineDownloads = cfg.offlineDownloads;
  if (typeof cfg.offlineAutoDownload === 'boolean') legacy.offlineAutoDownload = cfg.offlineAutoDownload;
  const features = cfg.features;
  return { ...legacy, ...(features && typeof features === 'object' ? (features as Record<string, unknown>) : {}) };
}

function devOverrides(): Record<string, boolean> {
  if (!import.meta.env.DEV) return {};
  try {
    return parseFlagOverrides(localStorage.getItem('kth.flags'));
  } catch {
    return {};
  }
}

export const featureFlags = createFeatureFlags({ site: siteFlags, overrides: devOverrides });

export function isEnabled(name: FeatureFlagName): boolean {
  return featureFlags.isEnabled(name);
}

/** The genealogy explorer: the `genealogy` flag, which itself requires `tagGraph`. */
export function isGenealogyEnabled(): boolean {
  return featureFlags.isEnabled('genealogy');
}
