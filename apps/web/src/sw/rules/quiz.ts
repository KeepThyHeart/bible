import type { CacheRule } from '../cacheRules';

const DAY = 60 * 60 * 24;

/**
 * The quiz catalog (installed modules and chapter coverage) and the questions
 * for a passage. Both are static for a module version and the same for every
 * reader, so they are cached for offline use, for one day only so that an
 * updated module shows up soon (the rule system has no network-first strategy). Quiz progress is never sent to
 * the server, so nothing user-specific is cached here.
 */
export const QUIZ_RULES: CacheRule[] = [
  {
    id: 'quiz-catalog',
    owner: 'quiz',
    strategy: 'cache-first',
    pattern: /(^|\/)api\/quiz(\?|$)/,
    cacheName: 'quiz-catalog',
    allowApi: true,
    maxEntries: 1,
    maxAgeSeconds: 1 * DAY,
  },
  {
    id: 'quiz-questions',
    owner: 'quiz',
    strategy: 'cache-first',
    pattern: /(^|\/)api\/quiz\/questions(\?|$)/,
    cacheName: 'quiz-questions',
    allowApi: true,
    maxEntries: 100,
    maxAgeSeconds: 1 * DAY,
  },
];
