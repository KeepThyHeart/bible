/**
 * View commands: theme, zoom, layout-related actions exposed in the View menu.
 *
 * The theme commands push directly into the preferences store. Zoom commands
 * call into Electron's webFrame via the preload bridge - the existing menu
 * already exposes that path; we just route it through the registry.
 */

import type { ICommandRegistry } from '../services/ICommandRegistry';
import type { IDisposable } from '../types/Command';
import { usePreferencesStore } from '../stores/usePreferencesStore';

declare global {
  interface Window {
    electronView?: {
      zoomIn?: () => void;
      zoomOut?: () => void;
      actualSize?: () => void;
    };
  }
}

function dispatchEvent(name: string, detail?: unknown): void {
  window.dispatchEvent(new CustomEvent(name, detail !== undefined ? { detail } : undefined));
}

export function registerViewCommands(registry: ICommandRegistry): IDisposable[] {
  return [
    registry.register({
      id: 'view.theme.light',
      title: { key: 'view.theme.light' },
      category: { key: 'view.theme.light.category' },
      handler: () => {
        usePreferencesStore.getState().setTheme?.('light');
      },
    }),
    registry.register({
      id: 'view.theme.dark',
      title: { key: 'view.theme.dark' },
      category: { key: 'view.theme.dark.category' },
      handler: () => {
        usePreferencesStore.getState().setTheme?.('dark');
      },
    }),
    registry.register({
      id: 'view.theme.sepia',
      title: { key: 'view.theme.sepia' },
      category: { key: 'view.theme.sepia.category' },
      handler: () => {
        usePreferencesStore.getState().setTheme?.('sepia');
      },
    }),
    registry.register({
      id: 'view.zoomIn',
      title: { key: 'view.zoomIn' },
      category: { key: 'view.zoomIn.category' },
      shortcut: { key: 'Ctrl+Plus', mac: 'Cmd+Plus' },
      handler: () => dispatchEvent('command:view:zoomIn'),
    }),
    registry.register({
      id: 'view.zoomOut',
      title: { key: 'view.zoomOut' },
      category: { key: 'view.zoomOut.category' },
      shortcut: { key: 'Ctrl+-', mac: 'Cmd+-' },
      handler: () => dispatchEvent('command:view:zoomOut'),
    }),
    registry.register({
      id: 'view.actualSize',
      title: { key: 'view.actualSize' },
      category: { key: 'view.actualSize.category' },
      shortcut: { key: 'Ctrl+0', mac: 'Cmd+0' },
      handler: () => dispatchEvent('command:view:actualSize'),
    }),
  ];
}
