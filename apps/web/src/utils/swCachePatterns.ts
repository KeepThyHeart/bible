/**
 * The API URL shapes the service worker is allowed to cache.
 *
 * They live here, apart from `sw.ts`, only so they can be tested: a workbox
 * `registerRoute` RegExp is matched against the **whole URL** (`url.href`), not
 * against the path, and getting that wrong fails silently — the route simply
 * never matches and the request goes to the network for ever. That is exactly
 * what a trailing `$` did to every one of these, because each of them carries a
 * query string in the request that actually runs:
 *
 *   /api/commentary/all/43/3?modules=Barnes,Geneva   ← every chapter change
 *   /api/commentary/home/43/3?verse=16
 *   /api/interlinear/43/3?module=KJV
 *
 * Hence `(\?|$)` rather than `$` throughout.
 *
 * Only content that is the same for every reader belongs here. Anything
 * auth-gated or user-specific must go to the network, or a cached 200 outlives
 * a logout.
 */

/**
 * Commentary text and the chapter-keyed metadata served under the same prefix.
 *
 * The `[^/?]+` segment covers all four shapes this needs: a module abbreviation
 * (`/api/commentary/Barnes/43/3`), and the `all`, `chapter-overview` and `home`
 * pseudo-modules. It deliberately does not match `/api/commentary/:module/verse/:id`,
 * whose second segment is not a number.
 */
export const COMMENTARY_CACHE_PATTERN = /\/api\/commentary\/[^/?]+\/\d+\/\d+(\?|$)/;

/** Interlinear rows for a chapter — immutable, and always carries `?module=`. */
export const INTERLINEAR_CACHE_PATTERN = /\/api\/interlinear\/\d+\/\d+(\?|$)/;

/** Pre-generated per-chapter study data. */
export const STUDY_OVERVIEW_CACHE_PATTERN = /\/api\/study\/overview\/\d+\/\d+(\?|$)/;
