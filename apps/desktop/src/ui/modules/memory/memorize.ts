/**
 * The "Memorize" verse action's handler. The core answers with the passage added (or already there);
 * the host toasts it, with a "Practice now" button that opens Memory and starts that passage.
 */
import type { VerseActionContext, VerseActionHandler } from '@bible/core/browser';
import { openApp } from '../../apps/appHost';
import { useToastStore } from '../../stores/useToastStore';
import { MEMORY_APP_ID } from '@bible/memory/manifest';
import { requestMemoryPractice } from './cardsRequest';
import { memoryClient } from './memoryClient';
import { memoryT } from './memoryT';

const TOAST_TEXT = {
  added: 'Added {reference} to Memory.',
  revived: 'Restored {reference} to Memory.',
  exists: '{reference} is already in Memory.',
} as const;

export const run: VerseActionHandler['run'] = async (ctx: VerseActionContext) => {
  const r = await memoryClient.addVerses({ verseIds: ctx.verseIds, module: ctx.module });
  const params = { reference: r.reference };
  useToastStore.getState().addToast(
    memoryT(`memory.toast.${r.outcome}`, TOAST_TEXT[r.outcome], params),
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
