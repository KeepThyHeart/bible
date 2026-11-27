/**
 * The "Memorize" verse action's handler. It opens the "Add to Memory" dialog (pick a list or create one);
 * on Add the host toasts the result, with a "Practice now" button that opens Memory and starts that
 * passage. Cancel does nothing.
 */
import type { VerseActionContext, VerseActionHandler } from '@bible/core/browser';
import { openApp } from '../../apps/appHost';
import { useToastStore } from '../../stores/useToastStore';
import { MEMORY_APP_ID } from '@bible/memory/manifest';
import { openAddToMemoryDialog } from '@bible/memory/add-to-memory';
import { i18nService } from '../../services/I18nService';
import { requestMemoryPractice } from './cardsRequest';
import { memoryClient } from './memoryClient';
import { memoryT } from './memoryT';

const TOAST_TEXT = {
  added: 'Added {reference} to {list}.',
  revived: 'Restored {reference} to {list}.',
  exists: '{reference} is already in {list}.',
} as const;

const TOAST_KEY = {
  added: 'memory.toast.addedToList',
  revived: 'memory.toast.revivedToList',
  exists: 'memory.toast.existsInList',
} as const;

export const run: VerseActionHandler['run'] = async (ctx: VerseActionContext) => {
  const r = await openAddToMemoryDialog({
    api: memoryClient,
    verseIds: ctx.verseIds,
    module: ctx.module,
    t: memoryT,
    locale: i18nService.currentLocale,
  });
  if (!r) return;
  const params = { reference: r.reference, list: r.listName };
  useToastStore.getState().addToast(
    memoryT(TOAST_KEY[r.outcome], TOAST_TEXT[r.outcome], params),
    'info',
    undefined,
    {
      label: memoryT('memory.toast.practiceNow', 'Practice now'),
      run: () => {
        void openApp(MEMORY_APP_ID).then((res) => {
          if (res.status === 'activated' || res.status === 'already') requestMemoryPractice(r.passageId);
        });
      },
    },
  );
};

export default { run } satisfies VerseActionHandler;
