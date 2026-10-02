/**
 * Word Study commands: open the Word Study pane.
 */

import type { ICommandRegistry } from '../services/ICommandRegistry';
import type { IDisposable } from '../types/Command';
import { revealWordStudyPanel } from '../components/wordStudy/revealWordStudyPanel';

export function registerWordStudyCommands(registry: ICommandRegistry): IDisposable[] {
  return [
    registry.register({
      id: 'wordStudy.open',
      title: { key: 'wordStudy.open' },
      category: { key: 'wordStudy.open.category' },
      handler: () => {
        revealWordStudyPanel();
      },
    }),
  ];
}
