/**
 * Diagnostics commands.
 *
 * Exposes `help.reportIssue` which opens the in-app Report an Issue dialog.
 * Follows the same CustomEvent dispatch pattern used by {@link appCommands}
 * so the command module stays decoupled from React state.
 */

import type { ICommandRegistry } from '../services/ICommandRegistry';
import type { IDisposable } from '../types/Command';

function dispatchAppEvent(name: string, detail?: unknown): void {
  window.dispatchEvent(new CustomEvent(name, detail !== undefined ? { detail } : undefined));
}

export function registerDiagnosticsCommands(registry: ICommandRegistry): IDisposable[] {
  return [
    registry.register({
      id: 'help.reportIssue',
      title: { key: 'help.reportIssue' },
      category: { key: 'help.reportIssue.category' },
      handler: () => dispatchAppEvent('command:help:reportIssue'),
    }),
  ];
}
