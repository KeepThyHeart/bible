/**
 * Serializable menu spec exchanged between renderer and main.
 *
 * The renderer is the source of truth for menu contents because the command
 * registry, i18n service, and keybinding service all live there. The renderer
 * builds a `MenuSpec` from those services and ships it across IPC; the main
 * process converts it into Electron's `MenuItemConstructorOptions[]`.
 *
 * The spec is intentionally narrow: only the kinds of items the existing menu
 * needs (separators, role-only items, command items, and submenus). It does
 * NOT support arbitrary `click` callbacks - that would defeat the point of
 * routing everything through the registry.
 */

/** Subset of Electron `MenuItemConstructorOptions['role']` we currently use. */
export type MenuItemRole =
  | 'about'
  | 'services'
  | 'hide'
  | 'hideOthers'
  | 'unhide'
  | 'quit'
  | 'cut'
  | 'copy'
  | 'paste'
  | 'pasteAndMatchStyle'
  | 'delete'
  | 'startSpeaking'
  | 'stopSpeaking'
  | 'help';

export type MenuItemType = 'normal' | 'separator' | 'submenu' | 'radio' | 'checkbox';

export interface MenuSeparatorSpec {
  type: 'separator';
}

/** A built-in Electron role item (Quit, Cut, Copy, etc.). */
export interface MenuRoleSpec {
  type: 'role';
  role: MenuItemRole;
  /** Optional override label; usually omitted so Electron uses the OS default. */
  label?: string;
}

/** A user-actionable menu item that dispatches a registered command. */
export interface MenuCommandSpec {
  type: 'command';
  commandId: string;
  label: string;
  /** Electron accelerator string, e.g. 'CmdOrCtrl+F'. */
  accelerator?: string;
  /** Optional id for state-tracking (radio groups). */
  id?: string;
  /** Render as a radio item; the renderer-side spec builder sets this. */
  radio?: boolean;
  /** Render as a checkbox item (independent toggle, not part of a radio group). */
  checkbox?: boolean;
  checked?: boolean;
}

export interface MenuSubmenuSpec {
  type: 'submenu';
  label: string;
  /** Optional role on the submenu (e.g. 'help' on the Help menu). */
  role?: MenuItemRole;
  /** Optional id used by the main-side menu builder for lookups. */
  id?: string;
  submenu: MenuSpecItem[];
}

export type MenuSpecItem =
  | MenuSeparatorSpec
  | MenuRoleSpec
  | MenuCommandSpec
  | MenuSubmenuSpec;

/** Top-level menu spec - an array of top-level submenus. */
export type MenuSpec = MenuSubmenuSpec[];
