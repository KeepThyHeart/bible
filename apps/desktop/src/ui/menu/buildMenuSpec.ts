/**
 * Renderer-side application menu builder.
 *
 * The Electron menu lives in main, but its labels and accelerators must come
 * from the renderer because that's where the command registry, i18n service,
 * and keybinding service live. This function takes those services and returns
 * a serializable `MenuSpec` that can be shipped to main via IPC.
 *
 * Adding a new menu item is a three-step process:
 *  1. Register a command in `src/ui/commands/`.
 *  2. Add the label this menu should show to `locales/en/menu.json`.
 *  3. Reference the command id and that key here. The accelerator is pulled
 *     from the keybinding service automatically.
 *
 * Menu labels live in their own `menu.*` namespace rather than reusing the
 * command titles: a palette entry is phrased as a verb ("Open Module Manager")
 * so it can be found by typing, while the same entry under **File** should
 * read as a place ("Module Manager"). No English literal belongs in this file.
 */

import type {
  MenuSpec,
  MenuSpecItem,
  MenuCommandSpec,
} from '../../../electron/menu/menuSpec';
import type { ICommandRegistry } from '../services/ICommandRegistry';
import type { II18nService } from '../services/II18nService';
import type { IKeybindingService } from '../services/IKeybindingService';

export interface BuildMenuSpecDeps {
  registry: ICommandRegistry;
  i18n: II18nService;
  keybindings: IKeybindingService;
  isMac: boolean;
  /**
   * Current state of the master "Allow web requests" switch. Reflected
   * as the checked state of the Privacy -> Allow Web Requests toggle. When
   * undefined the toggle renders unchecked - which is also the app's default
   * and its safe state, so an unknown value never reads as "online".
   */
  allowWebRequests?: boolean;
}

/**
 * Resolve the display label for a menu entry.
 *
 * The label comes from the menu's own `menu.*` catalog keys rather than from
 * the command's title, because the two are written for different places: a
 * command palette entry reads "Open Module Manager" so it can be searched for
 * by verb, while the same thing under **File** should read "Module Manager".
 * Sharing one string forced palette phrasing into the menu bar. The command id
 * still supplies the accelerator and the dispatch target.
 *
 * An unregistered command id is a programming error; it is warned about and
 * the entry still gets its label, so the menu never goes blank.
 */
function labelFor(deps: BuildMenuSpecDeps, commandId: string, labelKey: string): string {
  if (!deps.registry.get(commandId)) {
    // eslint-disable-next-line no-console
    console.warn(`[menu] referenced unknown command id: ${commandId}`);
  }
  return deps.i18n.t(labelKey);
}

/**
 * Resolve the accelerator for a command id. Prefers a user/extension/builtin
 * binding from the keybinding service; falls back to the command's own
 * `shortcut` descriptor if no binding has been registered yet (most builtins
 * are in this state at the moment).
 */
function acceleratorFor(deps: BuildMenuSpecDeps, commandId: string): string | undefined {
  const bindings = deps.keybindings.getBindingsForCommand(commandId);
  if (bindings.length > 0) {
    const first = bindings[0]!;
    return deps.isMac && first.mac ? first.mac : first.key;
  }
  // Fall back to the command's static shortcut descriptor.
  const cmd = deps.registry.get(commandId);
  if (!cmd?.shortcut) return undefined;
  const list = Array.isArray(cmd.shortcut) ? cmd.shortcut : [cmd.shortcut];
  if (list.length === 0) return undefined;
  const first = list[0]!;
  return deps.isMac && first.mac ? first.mac : first.key;
}

function commandItem(
  deps: BuildMenuSpecDeps,
  commandId: string,
  labelKey: string,
  extras?: Partial<Pick<MenuCommandSpec, 'id' | 'radio' | 'checkbox' | 'checked'>>,
): MenuCommandSpec {
  const accel = acceleratorFor(deps, commandId);
  return {
    type: 'command',
    commandId,
    label: labelFor(deps, commandId, labelKey),
    ...(accel !== undefined ? { accelerator: accel } : {}),
    ...(extras ?? {}),
  };
}

/**
 * Whether a command exists in the registry. Commands that are registered
 * conditionally (e.g. `app.toggleDevTools`, which only exists in development)
 * must be gated on this so the menu doesn't show an entry that dispatches to
 * nothing.
 */
function isRegistered(deps: BuildMenuSpecDeps, commandId: string): boolean {
  return deps.registry.get(commandId) !== undefined;
}

/**
 * Build the Tools submenu from extension-registered commands.
 *
 * Every command carrying an `ownerExtensionId` is eligible; hidden commands
 * are not, because `hidden` is how an extension says "reachable, but not by
 * browsing" and a menu is browsing. Entries are grouped by owning extension so
 * one extension's items stay together, then ordered within a group by the
 * command's own `order`, then by resolved label so equal orders are stable
 * rather than dependent on activation timing.
 *
 * Exported for testing: the whole of P3a's logic is this selection and
 * ordering, and the rest is Electron menu plumbing a unit test cannot reach.
 */
export function buildExtensionToolsSubmenu(deps: BuildMenuSpecDeps): MenuSpecItem[] {
  const byExtension = new Map<string, { label: string; item: MenuCommandSpec }[]>();

  for (const command of deps.registry.list()) {
    const owner = command.ownerExtensionId;
    if (owner === undefined || command.hidden === true) continue;

    // The extension supplies its own title, already localized through its own
    // catalog. Resolving it here rather than looking up a `menu.*` key is the
    // one place this file departs from its usual rule - see the Tools comment
    // in `buildMenuSpec`.
    const label = deps.i18n.resolve(command.title);
    const accel = acceleratorFor(deps, command.id);
    const item: MenuCommandSpec = {
      type: 'command',
      commandId: command.id,
      label,
      ...(accel !== undefined ? { accelerator: accel } : {}),
    };
    const group = byExtension.get(owner);
    if (group) group.push({ label, item });
    else byExtension.set(owner, [{ label, item }]);
  }

  if (byExtension.size === 0) return [];

  const orderOf = (commandId: string): number =>
    deps.registry.get(commandId)?.order ?? 0;

  const out: MenuSpecItem[] = [];
  // Extensions in id order: stable across restarts, and independent of which
  // extension happened to activate first.
  for (const owner of [...byExtension.keys()].sort()) {
    if (out.length > 0) out.push({ type: 'separator' });
    const entries = byExtension.get(owner)!.sort((a, b) => {
      const delta = orderOf(a.item.commandId) - orderOf(b.item.commandId);
      return delta !== 0 ? delta : a.label.localeCompare(b.label);
    });
    for (const entry of entries) out.push(entry.item);
  }
  return out;
}

export function buildMenuSpec(deps: BuildMenuSpecDeps): MenuSpec {
  const { isMac } = deps;
  const out: MenuSpec = [];

  // ---- macOS app menu ----
  if (isMac) {
    const submenu: MenuSpecItem[] = [
      commandItem(deps, 'app.about', 'menu.app.about'),
      { type: 'separator' },
      commandItem(deps, 'app.openPreferences', 'menu.app.preferences'),
      { type: 'separator' },
      { type: 'role', role: 'services' },
      { type: 'separator' },
      { type: 'role', role: 'hide' },
      { type: 'role', role: 'hideOthers' },
      { type: 'role', role: 'unhide' },
      { type: 'separator' },
      { type: 'role', role: 'quit' },
    ];
    out.push({ type: 'submenu', label: deps.i18n.t('menu.app.title'), submenu });
  }

  // ---- File menu ----
  const fileSubmenu: MenuSpecItem[] = [
    commandItem(deps, 'module.openManager', 'menu.file.moduleManager'),
    commandItem(deps, 'notes.export', 'menu.file.exportNotes'),
    { type: 'separator' },
  ];
  if (!isMac) {
    fileSubmenu.push(
      commandItem(deps, 'app.openPreferences', 'menu.app.preferences'),
      { type: 'separator' },
      { type: 'role', role: 'quit' },
    );
  }
  out.push({ type: 'submenu', label: deps.i18n.t('menu.file.title'), submenu: fileSubmenu });

  // ---- Edit menu ----
  const editSubmenu: MenuSpecItem[] = [
    { type: 'role', role: 'cut' },
    { type: 'role', role: 'copy' },
    { type: 'role', role: 'paste' },
  ];
  if (isMac) {
    editSubmenu.push(
      { type: 'role', role: 'pasteAndMatchStyle' },
      { type: 'role', role: 'delete' },
      { type: 'separator' },
      {
        type: 'submenu',
        label: deps.i18n.t('menu.edit.speech'),
        submenu: [
          { type: 'role', role: 'startSpeaking' },
          { type: 'role', role: 'stopSpeaking' },
        ],
      },
    );
  } else {
    editSubmenu.push({ type: 'role', role: 'delete' });
  }
  editSubmenu.push(
    { type: 'separator' },
    commandItem(deps, 'search.openFindBar', 'menu.edit.findInPane'),
  );
  out.push({ type: 'submenu', label: deps.i18n.t('menu.edit.title'), submenu: editSubmenu });

  // ---- View menu ----
  const themeSubmenu: MenuSpecItem[] = [
    commandItem(deps, 'view.theme.light', 'menu.view.themeLight', {
      id: 'theme-light',
      radio: true,
      checked: true,
    }),
    commandItem(deps, 'view.theme.dark', 'menu.view.themeDark', {
      id: 'theme-dark',
      radio: true,
      checked: false,
    }),
    commandItem(deps, 'view.theme.sepia', 'menu.view.themeSepia', {
      id: 'theme-sepia',
      radio: true,
      checked: false,
    }),
  ];
  const viewSubmenu: MenuSpecItem[] = [
    { type: 'submenu', label: deps.i18n.t('menu.view.theme'), submenu: themeSubmenu },
    { type: 'separator' },
    commandItem(deps, 'view.actualSize', 'menu.view.actualSize'),
    commandItem(deps, 'view.zoomIn', 'menu.view.zoomIn'),
    commandItem(deps, 'view.zoomOut', 'menu.view.zoomOut'),
  ];
  // Developer tools only exist in development builds - see
  // `commands/appCommands.ts`. Drop the trailing separator with them so the
  // consumer build's View menu doesn't end in a stray divider.
  if (isRegistered(deps, 'app.toggleDevTools')) {
    viewSubmenu.push(
      { type: 'separator' },
      commandItem(deps, 'app.toggleDevTools', 'menu.view.toggleDevTools'),
    );
  }
  out.push({ type: 'submenu', label: deps.i18n.t('menu.view.title'), id: 'view', submenu: viewSubmenu });

  // ---- Privacy menu ----
  // The master "Allow web requests" switch, OFF on a fresh install.
  // Every egress path consults it - the NetworkGateway, the updater, and
  // external links - so one click turns ALL network access on or off.
  if (isRegistered(deps, 'network.toggleWebRequests')) {
    out.push({
      type: 'submenu',
      label: deps.i18n.t('menu.privacy.title'),
      id: 'privacy',
      submenu: [
        commandItem(deps, 'network.toggleWebRequests', 'menu.privacy.allowWebRequests', {
          id: 'network-allow-web-requests',
          checkbox: true,
          checked: deps.allowWebRequests === true,
        }),
      ],
    });
  }

  // ---- Tools menu ----
  //
  // Extension-contributed entries, and the only place in the application menu
  // an extension can reach. Before this the command palette was an extension's
  // sole entry point, which is fine for power users and invisible to everyone
  // else - a panel an extension contributed could not be found by looking.
  //
  // **Omitted entirely when empty.** This follows the rule the rest of this
  // file already keeps for developer tools and the privacy toggle: an entry
  // whose command is not registered is left off rather than shown dead, and a
  // submenu with nothing in it is worse than no submenu. A fresh install with
  // no extensions therefore has no Tools menu at all.
  //
  // Labels come from the extension's own already-localized command title, not
  // from the `menu.*` catalog: the app cannot know a phrase for something it
  // did not ship. That is a deliberate departure from this file's usual rule,
  // and it is why `menuItemsFor` is separate from `commandItem`.
  const toolsSubmenu = buildExtensionToolsSubmenu(deps);
  if (toolsSubmenu.length > 0) {
    out.push({
      type: 'submenu',
      label: deps.i18n.t('menu.tools.title'),
      id: 'tools',
      submenu: toolsSubmenu,
    });
  }

  // ---- Help menu ----
  const helpSubmenu: MenuSpecItem[] = [
    commandItem(deps, 'app.startTour', 'menu.help.takeTour'),
    commandItem(deps, 'app.openDocumentation', 'menu.help.documentation'),
    commandItem(deps, 'app.openKeyboardShortcuts', 'menu.help.keyboardShortcuts'),
    { type: 'separator' },
    // Manual, user-initiated update check. No background beacon - the
    // dialog names the host and requires confirmation before any egress.
    commandItem(deps, 'app.checkForUpdates', 'menu.help.checkForUpdates'),
    commandItem(deps, 'help.reportIssue', 'menu.help.reportIssue'),
  ];
  if (!isMac) {
    helpSubmenu.push({ type: 'separator' }, commandItem(deps, 'app.about', 'menu.help.about'));
  }
  out.push({ type: 'submenu', label: deps.i18n.t('menu.help.title'), role: 'help', submenu: helpSubmenu });

  return out;
}
