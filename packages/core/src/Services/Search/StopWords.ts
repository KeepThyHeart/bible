// NOTE: Stop words are English-only. For non-English Bible modules, a per-language stop word registry
// should be created, selected based on the module's language_code. See docs/queue/languages.md.
/**
 * Common English stop words for search query filtering.
 * Used in hybrid search mode to strip low-signal terms before building FTS5 queries.
 */
export const ENGLISH_STOP_WORDS = new Set([
  'a', 'an', 'the', 'and', 'or', 'but', 'in', 'on', 'at', 'to', 'for',
  'of', 'with', 'by', 'from', 'is', 'it', 'its', 'as', 'was', 'were',
  'be', 'been', 'being', 'have', 'has', 'had', 'do', 'does', 'did',
  'will', 'would', 'could', 'should', 'may', 'might', 'shall', 'can',
  'that', 'this', 'these', 'those', 'he', 'she', 'him', 'her', 'his',
  'they', 'them', 'their', 'we', 'us', 'our', 'you', 'your', 'i', 'me',
  'my', 'who', 'whom', 'which', 'what', 'where', 'when', 'how', 'why',
  'not', 'no', 'nor', 'if', 'then', 'than', 'so', 'up', 'out', 'about',
  'into', 'over', 'after', 'before', 'between', 'under', 'again', 'there',
  'here', 'all', 'each', 'every', 'both', 'some', 'any', 'such', 'only',
  'also', 'just', 'are', 'am', 'very', 'too', 'own',
]);

/**
 * Remove stop words from a query and return the meaningful terms.
 * Returns null if no meaningful terms remain.
 */
export function extractMeaningfulTerms(query: string, stopWords = ENGLISH_STOP_WORDS): string[] | null {
  const words = query.toLowerCase().replace(/[^a-z0-9\s'-]/g, '').split(/\s+/);
  const meaningful = words.filter(w => w.length > 1 && !stopWords.has(w));
  return meaningful.length > 0 ? meaningful : null;
}
