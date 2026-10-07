/**
 * The lazy handler of the "Present" verse action: puts the right-clicked verse
 * on the live wall. Imports only `presentStore` and `utils/verseId`, so the
 * chunk stays small and `bibleStore` stays out of it.
 */
import type { VerseActionHandler } from '@bible/core/browser';
import { presentStore } from '../../stores/presentStore';
import { parseVerseId } from '../../utils/verseId';

export const presentVerseHandler: VerseActionHandler = {
  async run(ctx) {
    const { bookNumber, chapter, verse } = parseVerseId(ctx.verseId);
    await presentStore.show({ kind: 'passage', module: ctx.module, book: bookNumber, chapter }, verse);
  },
};
