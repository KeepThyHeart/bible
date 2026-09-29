/**
 * Desktop feature flags (task 0087): `isEnabled('audio')` from the renderer.
 *
 * The desktop app has no site config, so flags are their declared defaults plus a dev
 * override: `localStorage['kth.flags'] = 'audio,-pwa'` (or a JSON object) in a
 * development build. Overrides are ignored in production builds.
 */
import { createFeatureFlags, parseFlagOverrides, type FeatureFlags } from '@bible/core/browser';

function devOverrides(): Record<string, boolean> {
  if (!import.meta.env.DEV) return {};
  try {
    return parseFlagOverrides(window.localStorage.getItem('kth.flags'));
  } catch {
    return {};
  }
}

export const featureFlags: FeatureFlags = createFeatureFlags({ overrides: devOverrides });
export const isEnabled: FeatureFlags['isEnabled'] = (name) => featureFlags.isEnabled(name);
