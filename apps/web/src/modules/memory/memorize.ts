/** The "Memorize" verse action (lazy): the "Add to Memory" dialog, then show the Memory app. */
import type { VerseActionHandler } from '@bible/core/browser';
import { openAddToMemoryDialog } from '@bible/memory/add-to-memory';
import i18n from '../../i18n';
import { openApp } from '../../host/appHost';
import { setJustAdded } from './justAdded';
import { loadMemoryTranslator } from './memoryT';
import { getWebMemoryApi } from './webMemoryApi';

export const memorizeHandler: VerseActionHandler = {
  async run(ctx) {
    const locale = i18n.resolvedLanguage || i18n.language || 'en';
    const r = await openAddToMemoryDialog({
      api: getWebMemoryApi().api,
      verseIds: ctx.verseIds,
      module: ctx.module,
      t: await loadMemoryTranslator(locale),
      locale,
    });
    if (!r) return;
    setJustAdded({ passageId: r.passageId, reference: r.reference, outcome: r.outcome });
    await openApp('memory');
  },
};

export default memorizeHandler;
