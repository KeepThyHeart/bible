/**
 * Shared limit for user-supplied search queries.
 *
 * This is a resource guard, not a usability limit - 512 characters is far more
 * than any real search query.
 *
 * Every semantic search path feeds the query straight into a transformer whose
 * attention cost is O(n^2). Passing `truncation: true` to transformers.js does
 * not help: the feature-extraction pipeline already tokenizes with truncation
 * on, and the bound it applies is the tokenizer's own `model_max_length` -
 * 8192 for nomic-embed-text-v1.5. That leaves query length as a direct CPU and
 * memory amplifier. Measured on a dev box:
 *
 *   |    50 chars |    19 ms |    +0 MB |
 *   | 5,000 chars |   1.5 s  |  +218 MB |
 *   | 15,000 chars|  10.5 s  | +1544 MB |
 *   | 60,000 chars|    58 s  | +6680 MB |
 *
 * 15,000 characters is a perfectly legal GET under Node's default 16 KB header
 * cap, so the ceiling has to be enforced in code.
 *
 * Applied at three layers, deliberately: HTTP routes reject over-long queries
 * outright (400), and each embedder clamps independently as a backstop for
 * non-route callers.
 */
export const MAX_SEARCH_QUERY_CHARS = 512;

/**
 * Truncate a search query to `MAX_SEARCH_QUERY_CHARS`.
 *
 * Embedders clamp rather than reject: by the time a query reaches an embedder
 * the caller has committed to searching, and returning a slightly truncated
 * result beats throwing. Callers that can reject earlier (HTTP routes) should
 * do so instead, so the user gets a clear error rather than silently different
 * results.
 */
export function clampSearchQuery(query: string): string {
  return query.length > MAX_SEARCH_QUERY_CHARS
    ? query.slice(0, MAX_SEARCH_QUERY_CHARS)
    : query;
}
