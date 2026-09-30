import type { CacheRule } from '../cacheRules';
import { ASSET_RULES } from './assets';
import { AUDIO_RULES } from './audio';
import { CONTENT_RULES } from './content';
import { DATA_RULES } from './data';
import { NETWORK_ONLY_RULES } from './network';
import { TIMELINE_RULES } from './timeline';

/**
 * Every cache rule, in precedence order (first match wins). Network-only rules
 * come first so they cannot be overridden by a broad caching rule below.
 *
 * To add a rule: create `rules/<feature>.ts` exporting a `CacheRule[]` and
 * spread it in here. Nothing else changes; see
 * `docs/features/service-worker-cache-rules.md`.
 */
export const CACHE_RULES: CacheRule[] = [
  ...NETWORK_ONLY_RULES,
  ...ASSET_RULES,
  ...CONTENT_RULES,
  ...DATA_RULES,
  ...AUDIO_RULES,
  ...TIMELINE_RULES,
];
