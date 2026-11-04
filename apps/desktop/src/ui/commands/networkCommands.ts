/**
 * Network privacy commands.
 *
 * Exposes `network.toggleWebRequests`, the master switch surfaced in the
 * Privacy menu and the command palette. It is OFF on a fresh install; turning
 * it on raises a confirmation dialog in the main process before anything is
 * persisted, so the checked state must always be read back from the IPC reply
 * rather than assumed.
 *
 * Every egress path consults the flag it writes - the `NetworkGateway`
 * (catalog, downloads, diagnostics, extensions), the updater, and the handler
 * behind external links - so one action turns ALL of them on or off.
 *
 * The handler dispatches a DOM CustomEvent that `main.tsx` listens for; the
 * menu-wiring there owns the IPC round-trip and the menu re-push so the
 * checkbox reflects the new state. This keeps the command module decoupled
 * from the electron bridge, matching the {@link appCommands} pattern.
 */

import type { ICommandRegistry } from '../services/ICommandRegistry';
import type { IDisposable } from '../types/Command';

function dispatchAppEvent(name: string, detail?: unknown): void {
  window.dispatchEvent(new CustomEvent(name, detail !== undefined ? { detail } : undefined));
}

export function registerNetworkCommands(registry: ICommandRegistry): IDisposable[] {
  return [
    registry.register({
      id: 'network.toggleWebRequests',
      title: { key: 'network.toggleWebRequests' },
      category: { key: 'network.toggleWebRequests.category' },
      // B-032: the Privacy menu checkbox drives this command in both
      // directions, so it must stay executable; the palette shows the two
      // state-specific entries below instead.
      hidden: true,
      handler: () => dispatchAppEvent('command:network:toggleWebRequests'),
    }),
    registry.register({
      id: 'network.allowWebRequests',
      title: { key: 'network.toggleWebRequests' },
      category: { key: 'network.toggleWebRequests.category' },
      when: '!webRequestsAllowed',
      handler: () => dispatchAppEvent('command:network:toggleWebRequests'),
    }),
    registry.register({
      id: 'network.disableWebRequests',
      title: { key: 'network.disableWebRequests' },
      category: { key: 'network.toggleWebRequests.category' },
      when: 'webRequestsAllowed',
      handler: () => dispatchAppEvent('command:network:toggleWebRequests'),
    }),
  ];
}
