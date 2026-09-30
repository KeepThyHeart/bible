import type { CacheRule } from '../cacheRules';

const DAY = 60 * 60 * 24;

/**
 * The installed timeline module as one JSON document. Static for a module
 * version and the same for every reader, so it is cached for offline use.
 */
export const TIMELINE_RULES: CacheRule[] = [
  {
    id: 'timeline-dataset',
    owner: 'timeline',
    strategy: 'cache-first',
    pattern: /(^|\/)api\/timeline(\?|$)/,
    cacheName: 'timeline-dataset',
    allowApi: true,
    maxEntries: 1,
    maxAgeSeconds: 7 * DAY,
  },
];
