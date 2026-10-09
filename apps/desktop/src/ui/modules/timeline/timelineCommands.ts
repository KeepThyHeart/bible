/**
 * Timeline commands: open the Timeline explorer pane (command palette).
 */

import type { ICommandRegistry } from '../../services/ICommandRegistry';
import type { IDisposable } from '../../types/Command';
import { useLayoutStore } from '../../stores/useLayoutStore';
import { genericEnglishTitle } from '../../utils/paneNames';

export function registerTimelineCommands(registry: ICommandRegistry): IDisposable[] {
  return [
    registry.register({
      id: 'timeline.open',
      title: { key: 'timeline.open' },
      category: { key: 'timeline.open.category' },
      handler: () => {
        const layout = useLayoutStore.getState(); // allow-getstate: command handler - imperative panel creation
        for (const [panelId, panel] of layout.panels) {
          if (panel.contentType === 'timeline') {
            layout.dockviewApi?.getPanel(panelId)?.api.setActive();
            return;
          }
        }
        layout.addPanel('timeline', undefined, genericEnglishTitle('timeline'));
      },
    }),
  ];
}
