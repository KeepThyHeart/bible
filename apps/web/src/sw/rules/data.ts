import type { CacheRule } from '../cacheRules';

const YEAR = 60 * 60 * 24 * 365;

/** Large, filename-versioned static data under `/data/`. Not API routes. */
export const DATA_RULES: CacheRule[] = [
  {
    // Self-hosted embedding model for browser-side semantic search: large and
    // immutable, so it downloads once and then works offline.
    id: 'embedding-model',
    owner: 'semantic-search',
    strategy: 'cache-first-range',
    pattern: /^\/(?:.*\/)?data\/models\/.+/i,
    cacheName: 'embedding-model',
    statuses: [0, 200],
    maxEntries: 20,
    maxAgeSeconds: YEAR,
    keepOnReset: true,
  },
  {
    // Semantic index (int8 vectors + metadata).
    id: 'semantic-index',
    owner: 'semantic-search',
    strategy: 'cache-first',
    pattern: /\/data\/semantic_[^/?]+(\?|$)/i,
    cacheName: 'semantic-index',
    statuses: [0, 200],
    maxEntries: 10,
    maxAgeSeconds: YEAR,
    keepOnReset: true,
  },
];
