/**
 * Desktop feature flags (task 0087): `isEnabled('audio')` from the renderer.
 *
 * The desktop app has no site config, so flags are their declared defaults plus a dev
 * override: `localStorage['kth.flags'] = 'audio,-pwa'` (or a JSON object) in a
 * development build, or `KTH_FLAGS=chapterNotes` when starting an unpackaged build. Ignored in a packaged install.
 */
import { createFeatureFlags, parseFlagOverrides, type FeatureFlags } from '@bible/core/browser';

function devOverrides(): Record<string, boolean> {
  try {
    if (!import.meta.env.DEV) {
      // Not a dev renderer: only an unpackaged run (main reports KTH_FLAGS when `!app.isPackaged`).
      const text = (window as unknown as { electron?: { devFlagOverrides?: string } }).electron?.devFlagOverrides;
      return text ? parseFlagOverrides(text) : {};
    }
    return parseFlagOverrides(window.localStorage.getItem('kth.flags'));
  } catch {
    return {};
  }
}

export const featureFlags: FeatureFlags = createFeatureFlags({ overrides: devOverrides });
export const isEnabled: FeatureFlags['isEnabled'] = (name) => featureFlags.isEnabled(name);
