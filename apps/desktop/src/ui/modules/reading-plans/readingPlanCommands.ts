/**
 * Reading plan commands (command palette): open the Reading plans pane, continue today's reading, open the pane
 * beside the Bible.
 */

import { ReadingPlans } from '@bible/core/browser';
import type { ICommandRegistry } from '../../services/ICommandRegistry';
import type { IDisposable } from '../../types/Command';
import { openApp } from '../../apps/appHost';
import { useLayoutStore } from '../../stores/useLayoutStore';
import { genericEnglishTitle } from '../../utils/paneNames';
import { getReadingPlanService } from './readingPlansAPI';
import { openPlanReading } from './useActiveReadingStore';
import { openReadingPlansBeside } from './openBeside';

/** Open the first unticked reading of today across the active plans, else the Reading plans app. */
export async function continueReadingPlan(): Promise<void> {
  try {
    for (const view of await getReadingPlanService().todayViews()) {
      const first = ReadingPlans.dueReadings(view)[0];
      if (first) {
        openPlanReading({ enrollmentId: view.enrollmentId, day: first.day, index: first.index, reading: first.reading });
        return;
      }
    }
  } catch { /* fall through to the app */ }
  await openApp('reading-plans');
}

export function registerReadingPlanCommands(registry: ICommandRegistry): IDisposable[] {
  return [
    registry.register({
      id: 'readingPlans.open',
      title: { key: 'readingPlans.open' },
      category: { key: 'readingPlans.open.category' },
      handler: () => {
        const layout = useLayoutStore.getState(); // allow-getstate: command handler - imperative panel creation
        for (const [panelId, panel] of layout.panels) {
          if (panel.contentType === 'reading-plans') {
            layout.dockviewApi?.getPanel(panelId)?.api.setActive();
            return;
          }
        }
        layout.addPanel('reading-plans', undefined, genericEnglishTitle('reading-plans'));
      },
    }),
    registry.register({
      id: 'readingPlans.continue',
      title: { key: 'readingPlans.continue' },
      category: { key: 'readingPlans.open.category' },
      handler: () => continueReadingPlan(),
    }),
    registry.register({
      id: 'readingPlans.openBeside',
      title: { key: 'readingPlans.openBeside' },
      category: { key: 'readingPlans.open.category' },
      handler: () => openReadingPlansBeside(),
    }),
  ];
}
