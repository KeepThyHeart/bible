import type { CacheRule } from '../cacheRules';
import {
  COMMENTARY_CACHE_PATTERN,
  INTERLINEAR_CACHE_PATTERN,
  STUDY_OVERVIEW_CACHE_PATTERN,
} from '../../utils/swCachePatterns';

const DAY = 60 * 60 * 24;

/** Reader-independent chapter content served from `/api/`, cached on purpose. */
export const CONTENT_RULES: CacheRule[] = [
  {
    id: 'commentary-text',
    owner: 'core',
    strategy: 'cache-first',
    pattern: COMMENTARY_CACHE_PATTERN,
    cacheName: 'commentary-text',
    allowApi: true,
    maxEntries: 200,
    maxAgeSeconds: 7 * DAY,
  },
  {
    id: 'chapter-metadata',
    owner: 'core',
    strategy: 'cache-first',
    pattern: INTERLINEAR_CACHE_PATTERN,
    cacheName: 'chapter-metadata',
    allowApi: true,
    maxEntries: 200,
    maxAgeSeconds: 7 * DAY,
  },
  {
    id: 'study-overview',
    owner: 'core',
    strategy: 'cache-first',
    pattern: STUDY_OVERVIEW_CACHE_PATTERN,
    cacheName: 'study-overview',
    allowApi: true,
    maxEntries: 100,
    maxAgeSeconds: 7 * DAY,
  },
];
