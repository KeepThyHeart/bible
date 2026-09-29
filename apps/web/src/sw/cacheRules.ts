/**
 * The service worker's cache-rule registry: pure data and pure functions.
 *
 * A feature that wants something cached (or explicitly *not* cached) adds one
 * `CacheRule` to `rules/`; it never edits `sw.ts`. This module deliberately
 * imports nothing from workbox, so the same file is used by the worker (to
 * build strategies), by the page (to know which caches survive "Reset app
 * cache") and by the unit tests (to prove the safety rules). See
 * `docs/features/service-worker-cache-rules.md`.
 *
 * Matching is done against `url.pathname + url.search`, not the full href. A
 * workbox RegExp route is matched against `url.href`, where a trailing `$`
 * silently never matches a request that carries a query string; the rules
 * here are matched against a string whose end is the end of the query, and
 * `validateRules` refuses the patterns that would misbehave.
 */

export type CacheStrategy =
  /** Never stored, never answered from cache. Registered to *prevent* caching by a broader rule. */
  | 'network-only'
  /** Answer from the cache when present, else fetch and store. */
  | 'cache-first'
  /**
   * `cache-first`, but a `Range` request is answered from a cached full (200)
   * response by slicing it (audio and video seeking). A miss goes to the
   * network and is not stored, because the network answers a range with a 206
   * that the Cache API refuses: the cache is populated by a full fetch, e.g. an
   * explicit download of a pack, not by playback.
   */
  | 'cache-first-range';

export interface CacheRule {
  /** Unique kebab-case id. */
  id: string;
  /** Who owns the rule (feature or task name); documentation only. */
  owner?: string;
  strategy: CacheStrategy;
  /** Tested against `pathname + search` of same-origin GET requests. */
  pattern: RegExp;
  /**
   * Cache Storage name, without the version. Required for the two caching
   * strategies. The name actually used is `resolveCacheName(rule)`.
   */
  cacheName?: string;
  /**
   * Bump to abandon everything stored under the old name: the old cache is
   * deleted the next time a worker activates. Default 1.
   */
  version?: number;
  /** Response statuses that may be stored. Default `[200]`. Never store 401/403. */
  statuses?: number[];
  maxEntries?: number;
  maxAgeSeconds?: number;
  /**
   * The pattern matches API routes. Required whenever it can match `/api/`:
   * API responses are auth-gated and user-specific by default, and caching one
   * must be a visible, reviewed decision, never a side effect of a loose regex.
   */
  allowApi?: boolean;
  /**
   * Large, immutable content (models, media packs). "Reset app cache" keeps
   * these unless the user asks for a full reset, because re-downloading them to
   * fix a stale shell would be its own problem.
   */
  keepOnReset?: boolean;
}

/**
 * Paths that must never be cached by any rule, whatever a pattern says. A rule
 * that matches one of these probes fails validation, and `findRule` refuses to
 * return a cache rule for them at run time.
 */
export const NEVER_CACHE_PATHS: readonly string[] = [
  '/api/sync',
  '/api/sync/push',
  '/api/sync/pull?since=0',
  '/api/auth',
  '/api/auth/login',
  '/api/login',
  '/api/logout',
  '/api/user-data',
  '/api/account',
];

/** Cache Storage entries the page owns that are not ours to delete or manage. */
export const EXTERNAL_CACHES: readonly string[] = [
  // Written by @huggingface/transformers from the search worker: the ~130 MB model.
  'transformers-cache',
];

/** Cache Storage name for a rule, e.g. `commentary-text-v1`. */
export function resolveCacheName(rule: Pick<CacheRule, 'cacheName' | 'version'>): string {
  return `${rule.cacheName}-v${rule.version ?? 1}`;
}

/** True when the path is under an `api` segment (`/api/x`, `/base/api/x`). */
export function isApiPath(pathname: string): boolean {
  return /(^|\/)api(\/|$)/.test(pathname);
}

function requestString(url: Pick<URL, 'pathname' | 'search'>): string {
  return url.pathname + url.search;
}

function patternMentionsApi(pattern: RegExp): boolean {
  return pattern.source.replace(/\\\//g, '/').includes('api/');
}

/** `/api/sync`, `/base/api/sync/push`, ... : the probe's path as a whole segment run. */
function neverCached(url: Pick<URL, 'pathname'>): boolean {
  return NEVER_CACHE_PATHS.some(probe => {
    const path = probe.split('?')[0].replace(/^\//, '');
    return new RegExp(`(^|/)${path}(/|$)`).test(url.pathname);
  });
}

/**
 * The first rule (in list order) whose pattern matches, or undefined. A hit on
 * a `network-only` rule is returned as-is so a caller can tell "deliberately
 * not cached" from "no rule". Precedence is list order, so put narrow rules
 * before broad ones.
 */
export function findRule(rules: readonly CacheRule[], url: Pick<URL, 'pathname' | 'search'>): CacheRule | undefined {
  const target = requestString(url);
  for (const rule of rules) {
    if (!rule.pattern.test(target)) continue;
    return rule;
  }
  return undefined;
}

/**
 * The rule that should cache this request, or undefined when it must go to the
 * network untouched. This is the single decision point the worker uses.
 */
export function cacheRuleFor(rules: readonly CacheRule[], url: Pick<URL, 'pathname' | 'search'>): CacheRule | undefined {
  if (neverCached(url)) return undefined;
  const rule = findRule(rules, url);
  if (!rule || rule.strategy === 'network-only') return undefined;
  // Defence in depth: validateRules already requires allowApi for a pattern
  // that names /api/, but a broad pattern can still reach one indirectly.
  if (isApiPath(url.pathname) && !rule.allowApi) return undefined;
  return rule;
}

/** Names of all caches the rules use. */
export function cacheNamesFor(rules: readonly CacheRule[]): string[] {
  return rules.filter(r => r.strategy !== 'network-only').map(resolveCacheName);
}

/** Caches that "Reset app cache" leaves alone (see `keepOnReset`). */
export function preservedOnReset(rules: readonly CacheRule[]): string[] {
  return [
    ...EXTERNAL_CACHES,
    ...rules.filter(r => r.keepOnReset && r.strategy !== 'network-only').map(resolveCacheName),
  ];
}

/** Problems with a rule list; empty means valid. Run by a unit test and by the worker at startup. */
export function validateRules(rules: readonly CacheRule[]): string[] {
  const problems: string[] = [];
  const ids = new Set<string>();
  const names = new Set<string>();
  for (const rule of rules) {
    const where = `rule "${rule.id}"`;
    if (!/^[a-z0-9]+(-[a-z0-9]+)*$/.test(rule.id)) problems.push(`${where}: id must be kebab-case`);
    if (ids.has(rule.id)) problems.push(`${where}: duplicate id`);
    ids.add(rule.id);
    if (!(rule.pattern instanceof RegExp)) {
      problems.push(`${where}: pattern must be a RegExp`);
      continue;
    }
    if (rule.pattern.global || rule.pattern.sticky) problems.push(`${where}: pattern must not use the g or y flag (stateful lastIndex)`);
    if (rule.pattern.source.endsWith('$') && !rule.pattern.source.includes('\\?')) {
      problems.push(`${where}: pattern ends in $ without allowing a query string; end it with (\\?|$)`);
    }
    if (patternMentionsApi(rule.pattern) && !rule.allowApi && rule.strategy !== 'network-only') {
      problems.push(`${where}: pattern matches API routes; set allowApi: true to cache them deliberately`);
    }
    if (rule.strategy !== 'network-only') {
      if (!rule.cacheName || !/^[a-z0-9]+(-[a-z0-9]+)*$/.test(rule.cacheName)) problems.push(`${where}: cacheName is required (kebab-case)`);
      else {
        const name = resolveCacheName(rule);
        if (names.has(name)) problems.push(`${where}: cache name "${name}" is already used by another rule`);
        names.add(name);
      }
      if (rule.version !== undefined && (!Number.isInteger(rule.version) || rule.version < 1)) problems.push(`${where}: version must be a positive integer`);
      if (rule.statuses?.some(s => s === 401 || s === 403)) problems.push(`${where}: never store 401/403 responses`);
      for (const probe of NEVER_CACHE_PATHS) {
        const [pathname, search = ''] = probe.split('?');
        if (rule.pattern.test(pathname + (search ? `?${search}` : ''))) {
          problems.push(`${where}: pattern matches ${probe}, which must never be cached`);
        }
      }
    }
  }
  return problems;
}
