/**
 * The client's view of the site's audio configuration.
 *
 * `null` means the feature is off: the shared `audio` feature flag (`isEnabled('audio')`)
 * is off, or the server sent no `audio` block, and nothing audio-related should render or load.
 */

import { parseAudioSiteConfig } from '@bible/core/browser';
import type { AudioSiteConfig } from '@bible/core/browser';
import { getClientConfig } from '../utils/clientConfig';
import { isEnabled } from '../utils/featureFlags';

export function getAudioConfig(): AudioSiteConfig | null {
  if (!isEnabled('audio')) return null;
  const raw = getClientConfig().audio;
  if (raw === undefined || raw === null || raw === false) return null;
  return parseAudioSiteConfig(raw);
}

export function isAudioEnabled(): boolean {
  return getAudioConfig() !== null;
}
