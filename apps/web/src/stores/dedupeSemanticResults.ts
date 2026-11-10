/**
 * Display-level de-duplication of Ideas (semantic) results: the same verse range listed twice
 * (a verse hit and its one-verse paragraph hit) shows once, at the first position, keeping the
 * best score. Mirrors the desktop's `dedupeSemanticResults` for rows with identical ranges.
 */
interface RangeRow {
  verseId: number;
  endVerseId?: number;
  verseIds?: number[];
  module?: string;
  score?: number;
}

export function dedupeSemanticResults<T extends RangeRow>(results: T[]): T[] {
  const at = new Map<string, number>();
  const out: T[] = [];
  for (const r of results) {
    const last = r.endVerseId ?? r.verseIds?.[r.verseIds.length - 1] ?? r.verseId;
    const key = `${r.module ?? ''}:${r.verseId}-${last}`;
    const i = at.get(key);
    if (i === undefined) {
      at.set(key, out.length);
      out.push(r);
    } else if ((r.score ?? 0) > (out[i].score ?? 0)) {
      out[i] = { ...out[i], score: r.score };
    }
  }
  return out;
}
