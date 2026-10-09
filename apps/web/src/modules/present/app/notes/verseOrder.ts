/** A hymn's verse order from the chooser's toggles; undefined = the hymn's own default. */
export function buildVerseOrder(
  verseCount: number,
  hasRefrain: boolean,
  selected: readonly number[],
  refrainAfterEach: boolean,
): string[] | undefined {
  const verses = [...selected].sort((a, b) => a - b);
  const all = verses.length === verseCount && verses.every((v, i) => v === i + 1);
  if (all && !(refrainAfterEach && hasRefrain)) return undefined;
  const order: string[] = [];
  for (const v of verses) {
    order.push(String(v));
    if (refrainAfterEach && hasRefrain) order.push('R');
  }
  return order;
}
