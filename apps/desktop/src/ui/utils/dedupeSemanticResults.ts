/**
 * Display-level de-duplication of Ideas (semantic) results.
 *
 * The index holds verse rows and paragraph rows, and a one-verse "paragraph"
 * is the same passage as its verse row, so a search could list one verse twice
 * (once as a paragraph hit, once alone). This runs over the ranked list and
 * never reorders it:
 *
 * - a one-verse paragraph row is that verse: it becomes a verse row, and a
 *   second row for the same range is merged into the first (best similarity kept);
 * - a lone verse row inside a multi-verse paragraph row that is also listed is
 *   dropped (the paragraph already shows it).
 */
import type { SemanticResult } from '../stores/useSearchStore';

export function dedupeSemanticResults(results: SemanticResult[]): SemanticResult[] {
  if (results.length < 2) return results.map(normalizeSingle);

  const merged: SemanticResult[] = [];
  const byRange = new Map<string, number>();
  for (const raw of results) {
    const r = normalizeSingle(raw);
    const key = `${r.startVerseId}-${r.endVerseId}`;
    const at = byRange.get(key);
    if (at === undefined) {
      byRange.set(key, merged.length);
      merged.push(r);
    } else if (r.similarity > merged[at].similarity) {
      merged[at] = { ...merged[at], similarity: r.similarity };
    }
  }

  const paragraphs = merged.filter((r) => r.endVerseId > r.startVerseId && r.level !== 'chapter');
  if (paragraphs.length === 0) return merged;
  return merged.filter((r) =>
    r.startVerseId !== r.endVerseId ||
    !paragraphs.some((p) => r.startVerseId >= p.startVerseId && r.endVerseId <= p.endVerseId),
  );
}

/** A one-verse paragraph is that verse. */
function normalizeSingle(r: SemanticResult): SemanticResult {
  return r.level === 'paragraph' && r.startVerseId === r.endVerseId ? { ...r, level: 'verse' } : r;
}
