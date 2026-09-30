import type { TimelineDataset, TimelineItemDto } from './types';

/**
 * Items whose passages cover a verse. Primary-passage matches sort first,
 * then narrower passages before wider ones (a verse-level match is more
 * specific than a whole-chapter range).
 */
export function itemsForPassage(
  dataset: Pick<TimelineDataset, 'items'>,
  verseId: number,
  verseIdEnd: number = verseId
): TimelineItemDto[] {
  const hits: { item: TimelineItemDto; primary: boolean; width: number }[] = [];
  for (const item of dataset.items) {
    let best: { primary: boolean; width: number } | null = null;
    for (const p of item.passages) {
      if (p.start <= verseIdEnd && p.end >= verseId) {
        const width = p.end - p.start;
        if (!best || (p.primary && !best.primary) || (p.primary === best.primary && width < best.width)) {
          best = { primary: p.primary, width };
        }
      }
    }
    if (best) hits.push({ item, ...best });
  }
  hits.sort((a, b) => Number(b.primary) - Number(a.primary) || a.width - b.width || a.item.id - b.item.id);
  return hits.map((h) => h.item);
}

/** The verse to open for an item's "Read" button. */
export function primaryPassage(item: TimelineItemDto): { start: number; end: number } | null {
  const p = item.passages.find((x) => x.primary) ?? item.passages[0];
  return p ? { start: p.start, end: p.end } : null;
}
