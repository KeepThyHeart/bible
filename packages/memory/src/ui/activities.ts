/**
 * Recite helpers shared by Today's picker and the verse page.
 *
 * DOM-free apart from `startReciteRun`, which talks to the host. The recite
 * entries exist only while speech is ready; the activity picker itself lives
 * in `flows.ts`.
 */

import { reciteEnabled } from '../core/features';
import type { PlanView, ReciteStateView } from '../core/types';
import type { PanelHost } from './host';
import { tr } from './i18n';

/** The recite tile is offered only when speech is ready. */
export function reciteTileVisible(plan: PlanView): boolean {
  return reciteEnabled() && plan.speech.state === 'ready';
}

/** The "Recite what's due aloud" entry: label, due count and whether it can be pressed. */
export function reciteDueEntry(plan: PlanView): { label: string; count: number; enabled: boolean } | null {
  if (!reciteTileVisible(plan)) return null;
  const count = plan.reciteDueCount;
  return {
    label: count > 0 ? tr('memory.ui.settings.reciteDueCount', "Hands-free: recite what's due aloud ({count})", { count }) : tr('memory.ui.settings.reciteDue', "Hands-free: recite what's due aloud"),
    count,
    enabled: count > 0,
  };
}

/**
 * Starts a recite run and switches the panel to it.
 *
 * The panel (`panel.ts`) builds the screen from `getReciteState` when the
 * `recite` view renders, so this only has to start the run and navigate.
 */
export async function startReciteRun(
  host: PanelHost,
  source: { kind: 'passage'; passageId: number } | { kind: 'due' },
  mode: 'tap' | 'handsfree',
): Promise<ReciteStateView | null> {
  const reply = await host.request({ type: 'startRecite', source, mode });
  if (!reply.ok) {
    (host.fail ?? host.announce)(reply.error); // B-136: a refusal (e.g. no TTS voice) must be visible
    return null;
  }
  host.go({ type: 'reciteStarted', reciteId: reply.data.reciteId, mode: reply.data.mode });
  return reply.data;
}
