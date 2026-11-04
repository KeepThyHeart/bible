/**
 * Microphone permission policy (pure; main.ts feeds it Electron's session handlers).
 * Only the app's own main window may use the microphone, audio only, and only with `recite` on.
 */
import { createFeatureFlags, parseFlagOverrides } from '@bible/core/browser';

export interface MediaRequestInfo {
  /** Electron permission name. */
  permission: string;
  /** `details.mediaTypes` of a request ('audio' | 'video'); undefined for a check. */
  mediaTypes?: readonly string[];
  /** The requesting frame's url, when known. */
  requestingUrl?: string;
  /** `details.mediaType` of a permission check. */
  mediaType?: string;
  isMainFrame?: boolean;
}

export interface MediaPolicyDeps {
  enabled(): boolean;
  /** Is this web contents the app's main window? */
  isMainContents(wc: unknown): boolean;
  /** Origin of the app page: file:// when packaged, the dev server url in dev. */
  isOwnUrl(url: string): boolean;
}

export function mediaAllowed(wc: unknown, info: MediaRequestInfo, d: MediaPolicyDeps): boolean {
  if (!d.enabled() || info.permission !== 'media') return false;
  if (!d.isMainContents(wc)) return false;
  if (info.isMainFrame === false) return false;
  if (info.requestingUrl !== undefined && !d.isOwnUrl(info.requestingUrl)) return false;
  if (info.mediaTypes) return info.mediaTypes.length > 0 && info.mediaTypes.every((t) => t === 'audio');
  return info.mediaType === 'audio';
}

/** Handlers for `session.setPermissionRequestHandler` / `setPermissionCheckHandler`. */
export function createPermissionHandlers(d: MediaPolicyDeps, fallback: boolean = false) {
  return {
    request(wc: unknown, permission: string, callback: (granted: boolean) => void, details: Record<string, any> = {}): void {
      const mediaTypes = details.mediaTypes as string[] | undefined;
      callback(
        permission === 'media'
          ? mediaAllowed(wc, { permission, mediaTypes: mediaTypes ?? [], requestingUrl: details.requestingUrl, isMainFrame: details.isMainFrame }, d)
          : fallback,
      );
    },
    check(wc: unknown, permission: string, requestingOrigin: string, details: Record<string, any> = {}): boolean {
      if (permission !== 'media') return fallback;
      return mediaAllowed(wc, { permission, mediaType: details.mediaType, requestingUrl: details.requestingUrl ?? requestingOrigin, isMainFrame: details.isMainFrame }, d);
    },
  };
}

/** The `recite` flag as main sees it: `KTH_FLAGS` in dev builds, the default (off) when packaged. */
export function isReciteEnabled(packaged: boolean, env: Record<string, string | undefined> = process.env): boolean {
  return createFeatureFlags({ overrides: packaged ? {} : parseFlagOverrides(env.KTH_FLAGS) }).isEnabled('recite');
}

/** Dev/demo only: Chromium switches that replace the microphone with a WAV file. */
export function fakeMicSwitches(packaged: boolean, env: Record<string, string | undefined> = process.env): Array<[string, string?]> {
  const wav = env.KTH_FAKE_MIC_WAV;
  if (packaged || !wav) return [];
  return [
    ['use-fake-ui-for-media-stream'],
    ['use-fake-device-for-media-stream'],
    ['use-file-for-fake-audio-capture', wav],
  ];
}
