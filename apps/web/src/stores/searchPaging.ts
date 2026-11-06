/** Step sizes for search "Show more" (kept apart so UI and store share them). */

/** How many more occurrences each Strong's "Show more" asks for (bounded by STRONGS_MAX_RESULTS). */
export const STRONGS_LOAD_MORE_STEP = 1000;

/**
 * Semantic (Ideas) results re-run the vector search at a larger cap, and
 * relevance drops with depth, so "Show more" grows by a larger bounded step
 * (+100) instead of the whole remainder. The server clamps maxResults to
 * MAX_SEMANTIC_RESULTS (server/routes/searchRoutes.ts), so that is the ceiling.
 */
export const SEMANTIC_LOAD_MORE_STEP = 100;
export const SEMANTIC_MAX_RESULTS = 50;
