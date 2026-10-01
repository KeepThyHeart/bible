/**
 * Reading plan commands: open the Reading plans pane (command palette).
 */

import type { ICommandRegistry } from '../services/ICommandRegistry';
import type { IDisposable } from '../types/Command';
import { useLayoutStore } from '../stores/useLayoutStore';
import { genericEnglishTitle } from '../utils/paneNames';

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
  ];
}
