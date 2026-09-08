/**
 * Renderer-side accessor for the build-time application configuration.
 *
 * The authoritative copy is resolved in `electron/config/appConfig.ts` and
 * handed across the preload bridge as `window.electron.appConfig`. When the
 * bridge is unavailable (unit tests under jsdom, a window whose preload has
 * not finished, `vite preview`) we fall back to the same module's build-time
 * resolution, which the renderer bundle also receives defines for.
 */

import {
  APP_CONFIG,
  buildIssueReportUrl,
  isIssueReportingConfigured,
  isModuleCatalogConfigured,
  isDocsSiteConfigured,
  type AppConfig,
} from '../../../electron/config/appConfig';

export type { AppConfig };
export {
  buildIssueReportUrl,
  isIssueReportingConfigured,
  isModuleCatalogConfigured,
  isDocsSiteConfigured,
};

interface WindowWithConfig {
  electron?: { appConfig?: AppConfig };
}

/** The app config for this renderer. */
export function getAppConfig(): AppConfig {
  if (typeof window === 'undefined') return APP_CONFIG;
  const bridged = (window as unknown as WindowWithConfig).electron?.appConfig;
  return bridged ?? APP_CONFIG;
}

/** Convenience accessor - the user-visible product name. */
export function getProductName(): string {
  return getAppConfig().productName;
}

/**
 * Where "Report an Issue" should navigate, or `undefined` when the maintainer
 * has not configured a target (in which case the command is not registered at
 * all - see `commands/appCommands.ts`).
 */
export function getIssueReportUrl(): string | undefined {
  return buildIssueReportUrl(getAppConfig());
}

/**
 * The configured documentation site, or `undefined` when this build has none.
 *
 * The Help panel omits the link entirely in that case: an entry that opens
 * nothing is worse than no entry.
 */
export function getDocsUrl(): string | undefined {
  const url = getAppConfig().docsUrl;
  return url === '' ? undefined : url;
}

/** The build's "about this app" blurb, or `undefined` when unset. */
export function getAboutText(): string | undefined {
  const text = getAppConfig().aboutText;
  return text === '' ? undefined : text;
}

/** The configured default module catalog URL, or `undefined` when unset. */
export function getModuleCatalogUrl(): string | undefined {
  const url = getAppConfig().moduleCatalogUrl;
  return url === '' ? undefined : url;
}
