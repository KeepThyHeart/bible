import type { CacheRule } from '../cacheRules';

/**
 * Routes that are explicitly never cached. They win over any broader rule
 * because this list comes first in `rules/index.ts`. `cacheRuleFor` also hard-
 * refuses `NEVER_CACHE_PATHS`, so these entries document the policy and keep it
 * true if a later rule is written carelessly.
 */
export const NETWORK_ONLY_RULES: CacheRule[] = [
  {
    // Account sync: per-user, must always reflect the server (task 0063).
    id: 'api-sync',
    owner: 'accounts',
    strategy: 'network-only',
    pattern: /(^|\/)api\/sync(\/|\?|$)/,
  },
  {
    id: 'api-auth',
    owner: 'accounts',
    strategy: 'network-only',
    pattern: /(^|\/)api\/(auth|login|logout)(\/|\?|$)/,
  },
];
