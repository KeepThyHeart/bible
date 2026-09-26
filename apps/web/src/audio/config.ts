/**
 * The client's view of the site's audio configuration.
 *
 * `null` means the feature is off (the server sends no `audio` block unless the
 * operator enabled it), and nothing audio-related should render or load.
 */

import { parseAudioSiteConfig } from '@bible/core/browser';
import type { AudioSiteConfig } from '@bible/core/browser';
import { getClientConfig } from '../utils/clientConfig';

export function getAudioConfig(): AudioSiteConfig | null {
  const raw = getClientConfig().audio;
  if (raw === undefined || raw === null || raw === false) return null;
  return parseAudioSiteConfig(raw);
}

export function isAudioEnabled(): boolean {
  return getAudioConfig() !== null;
}
