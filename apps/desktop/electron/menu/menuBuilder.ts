/**
 * Main-process application menu builder.
 *
 * This module is intentionally thin: it converts a renderer-supplied
 * `MenuSpec` into Electron's `MenuItemConstructorOptions[]` and registers it
 * via `Menu.setApplicationMenu`. All labels, accelerators, and command ids
 * come from the renderer (the source of truth for command/i18n state).
 *
 * Each command-typed menu item dispatches `commands:execute` back to the
 * focused window, which routes it through the renderer's command registry.
 */

import { Menu, BrowserWindow, MenuItem, ipcMain, type MenuItemConstructorOptions } from 'electron';
import log from 'electron-log/main';
import type {
  MenuSpec,
  MenuSpecItem,
  MenuCommandSpec,
  MenuSubmenuSpec,
} from './menuSpec';

const COMMANDS_EXECUTE_CHANNEL = 'commands:execute';
const MENU_REBUILD_CHANNEL = 'menu:rebuild';

function dispatchCommand(commandId: string, browserWindow: BrowserWindow | undefined): void {
  // Prefer the window the menu click came from; fall back to the focused
  // window so detached/popout windows still receive their own commands.
  const target = browserWindow ?? BrowserWindow.getFocusedWindow() ?? undefined;
  if (!target || target.isDestroyed()) return;
  target.webContents.send(COMMANDS_EXECUTE_CHANNEL, commandId);
}

function specItemToElectron(item: MenuSpecItem): MenuItemConstructorOptions {
  switch (item.type) {
    case 'separator':
      return { type: 'separator' };
    case 'role': {
      const out: MenuItemConstructorOptions = { role: item.role as MenuItemConstructorOptions['role'] };
      if (item.label !== undefined) out.label = item.label;
      return out;
    }
    case 'submenu':
      return submenuSpecToElectron(item);
    case 'command':
      return commandSpecToElectron(item);
  }
}

function commandSpecToElectron(item: MenuCommandSpec): MenuItemConstructorOptions {
  const out: MenuItemConstructorOptions = {
    label: item.label,
    click: (_menuItem, browserWindow) => {
      dispatchCommand(item.commandId, browserWindow as BrowserWindow | undefined);
    },
  };
  if (item.accelerator !== undefined) out.accelerator = item.accelerator;
  if (item.id !== undefined) out.id = item.id;
  if (item.radio) out.type = 'radio';
  else if (item.checkbox) out.type = 'checkbox';
  if (item.checked !== undefined) out.checked = item.checked;
  return out;
}

function submenuSpecToElectron(item: MenuSubmenuSpec): MenuItemConstructorOptions {
  const out: MenuItemConstructorOptions = {
    label: item.label,
    submenu: item.submenu.map(specItemToElectron),
  };
  if (item.role !== undefined) out.role = item.role as MenuItemConstructorOptions['role'];
  if (item.id !== undefined) out.id = item.id;
  return out;
}

/**
 * MenuBuilder owns the application menu lifecycle. It does not build any menu
 * by itself - it waits for the renderer to send a `MenuSpec` via the
 * `menu:rebuild` IPC channel and then applies it.
 */
export class MenuBuilder {
  private menu: Menu | null = null;

  /**
   * Apply a renderer-supplied menu spec. Replaces any existing application
   * menu. Safe to call repeatedly (locale change, keybinding rebind).
   */
  applyMenuSpec(spec: MenuSpec): Menu {
    const template = spec.map(specItemToElectron);
    this.menu = Menu.buildFromTemplate(template);
    Menu.setApplicationMenu(this.menu);
    return this.menu;
  }

  /**
   * Update the checked state of a theme menu item. Kept for compatibility
   * with the existing `menu:update-theme` IPC channel.
   */
  updateTheme(themeId: string): void {
    if (!this.menu) return;

    const themes = ['light', 'dark', 'sepia'];
    themes.forEach((theme) => {
      const menuItem = this.getMenuItem(`theme-${theme}`);
      if (menuItem && menuItem.type === 'radio') {
        menuItem.checked = theme === themeId;
      }
    });
  }

  private getMenuItem(id: string): MenuItem | null {
    if (!this.menu) return null;

    const findMenuItem = (items: MenuItem[]): MenuItem | null => {
      for (const item of items) {
        if (item.id === id) {
          return item;
        }
        if (item.submenu && 'items' in item.submenu) {
          const found = findMenuItem(item.submenu.items);
          if (found) return found;
        }
      }
      return null;
    };

    return findMenuItem(this.menu.items);
  }
}

/**
 * Register the `menu:rebuild` IPC handler. Call once at app startup. The
 * provided `getBuilder()` callback returns the active MenuBuilder, which
 * lets the caller swap or recreate it across window recreation.
 */
export function registerMenuRebuildHandler(getBuilder: () => MenuBuilder | null): void {
  ipcMain.on(MENU_REBUILD_CHANNEL, (_event, spec: MenuSpec) => {
    const builder = getBuilder();
    if (!builder) return;
    try {
      builder.applyMenuSpec(spec);
    } catch (err) {
      log.error('[menu] failed to apply menu spec:', err);
    }
  });
}
