/**
 * Word Study commands: open the Word Study pane. The handler goes through the panel request
 * seam, so the pane's code (and the module) loads only when the command runs.
 */

import type { ICommandRegistry } from '../../services/ICommandRegistry';
import type { IDisposable } from '../../types/Command';
import { requestPanel } from '../host/panelRequests';

export function registerWordStudyCommands(registry: ICommandRegistry): IDisposable[] {
  return [
    registry.register({
      id: 'wordStudy.open',
      title: { key: 'wordStudy.open' },
      category: { key: 'wordStudy.open.category' },
      handler: () => {
        requestPanel('wordStudy');
      },
    }),
  ];
}
