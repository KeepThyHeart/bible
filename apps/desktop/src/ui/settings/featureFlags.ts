/**
 * Desktop feature flags (task 0087): `isEnabled('audio')` from the renderer.
 *
 * The desktop app has no site config, so flags are their declared defaults plus a dev
 * override: `localStorage['kth.flags'] = 'audio,-pwa'` (or a JSON object) in a
 * development build. Overrides are ignored in production builds.
 * A build can also bake flags in with `VITE_KTH_FLAGS=localUserDb,accounts` (demo and e2e builds, task 0150);
 * unset in release builds, so production is unchanged.
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

function buildFlags(): Record<string, boolean> {
  try {
    return parseFlagOverrides((import.meta.env as { VITE_KTH_FLAGS?: string }).VITE_KTH_FLAGS ?? '');
  } catch {
    return {};
  }
}

export const featureFlags: FeatureFlags = createFeatureFlags({ site: buildFlags(), overrides: devOverrides });
export const isEnabled: FeatureFlags['isEnabled'] = (name) => featureFlags.isEnabled(name);
