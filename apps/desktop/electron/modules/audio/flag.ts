/**
 * The `audio` flag as main sees it, from the same sources as `registerMainModules`: the build's
 * flags (`__BIBLE_BUILD_FLAGS__`, from `VITE_KTH_FLAGS` at build time) and, in unpackaged builds
 * only, `KTH_FLAGS`. The module host and the Piper asset contribution must agree, or a build could
 * serve `kth-audio:` without the assets its speech needs.
 */
import { createFeatureFlags, parseFlagOverrides } from '@bible/core/browser';

declare const __BIBLE_BUILD_FLAGS__: string | undefined;

const BUILD_FLAG_TEXT = typeof __BIBLE_BUILD_FLAGS__ === 'string' ? __BIBLE_BUILD_FLAGS__ : '';

function safeFlags(text: string): Record<string, boolean> {
  try {
    return parseFlagOverrides(text);
  } catch {
    return {};
  }
}

export function isAudioEnabled(
  packaged: boolean,
  env: Record<string, string | undefined> = process.env,
  buildFlagText: string = BUILD_FLAG_TEXT,
): boolean {
  return createFeatureFlags({
    site: safeFlags(buildFlagText),
    overrides: packaged ? {} : safeFlags(env.KTH_FLAGS ?? ''),
  }).isEnabled('audio');
}
