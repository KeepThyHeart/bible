# Application Menu System

This directory contains the native Electron menu implementation for the Bible Desktop App.

## Architecture

The menu is owned by the main process but described by the renderer. Labels come from the i18n service, accelerators from the keybinding service, and every clickable entry names a command in the renderer's command registry, so all three live where those services live. The renderer builds a serializable `MenuSpec` and ships it to main over `menu:rebuild`; main converts it into Electron's `MenuItemConstructorOptions[]` and calls `Menu.setApplicationMenu`. A click sends `commands:execute` with the command id back to the window the click came from, and the renderer runs it through the same registry that serves the command palette and the keyboard.

That gives one code path for menu, palette and keyboard invocation, and it means a locale change or a rebind is just another spec push.

- **macOS**: menus appear in the system menu bar, and the app menu is the first submenu.
- **Windows/Linux**: menus appear in the application window; Quit lives under File and About under Help.
- **Native shortcuts**: platform-specific accelerators are handled by Electron.

## Files

- **`menuSpec.ts`**: the serializable spec exchanged between renderer and main - separators, role items, command items and submenus, and nothing else. It deliberately has no `click` callbacks, so nothing can bypass the command registry.
- **`menuBuilder.ts`**: `MenuBuilder`, which applies a spec (`applyMenuSpec`) and keeps the theme radio group in sync (`updateTheme`), plus `registerMenuRebuildHandler` for the `menu:rebuild` channel.
- **`README.md`**: this file.

The menu's *contents* are not defined here: they are built by `src/ui/menu/buildMenuSpec.ts` in the renderer.

## Menu Structure

```
Bible (macOS only)
+- About Bible
+- -------------
+- Open Preferences
+- -------------
+- Services / Hide / Hide Others / Show All
+- -------------
+- Quit

File
+- Open Module Manager
+- Export My Notes
+- -------------
+- Open Preferences   (Windows/Linux only)
+- Quit               (Windows/Linux only)

Edit
+- Cut / Copy / Paste / Delete
+- Speech >           (macOS only)
+- -------------
+- Find in Pane

View
+- Theme >            (Light, Dark, Sepia - radio group)
+- -------------
+- Actual Size / Zoom In / Zoom Out
+- -------------
+- Toggle Developer Tools   (development builds only)

Privacy
+- Allow Web Requests (checkbox; the master network switch)

Help
+- Take a Tour
+- Open Documentation
+- Show Keyboard Shortcuts
+- -------------
+- Check for Updates
+- Report an Issue
+- -------------
+- About Bible        (Windows/Linux only)
```

Entries that depend on a conditionally registered command (developer tools, the Privacy toggle) are omitted rather than shown dead, so the menu never dispatches to a command that does not exist.

## Usage in the Main Process

```typescript
// In electron/main.ts
import { MenuBuilder, registerMenuRebuildHandler } from './menu/menuBuilder';

const menuBuilder = new MenuBuilder();

// Handle `menu:rebuild` pushes from the renderer for the lifetime of the app.
registerMenuRebuildHandler(() => menuBuilder);

// Keep the theme radio group in sync when the theme changes elsewhere.
menuBuilder.updateTheme('dark');
```

`MenuBuilder` holds no window reference: `applyMenuSpec` sets the application menu, and command dispatch targets the window the click came from (falling back to the focused window), so detached and pop-out windows receive their own commands.

## Usage in the Renderer Process

`src/ui/main.tsx` pushes a spec at boot and again whenever the locale catalogs settle, the locale changes, or a keybinding changes:

```typescript
import { buildMenuSpec } from './menu/buildMenuSpec';

const bridge = window.electron.electronMenu;

bridge.rebuild(buildMenuSpec({
  registry: services.registry,
  i18n: services.i18n,
  keybindings: services.keybindings,
  isMac,
  allowWebRequests,
}));

// Menu clicks arrive as command ids and go straight to the registry.
bridge.onCommandExecute((commandId) => {
  void services.registry.execute(commandId);
});
```

## Adding a New Menu Item

1. **Register the command** in `src/ui/commands/`. If it should only exist in some builds, register it conditionally; `buildMenuSpec` checks the registry before emitting the entry.
2. **Add the label** to `locales/en/menu.json` under the `menu.*` namespace. Menu labels live apart from command titles on purpose, so a menu can name a thing where the palette names an action, and each can be phrased for where it is read. No English literal belongs in `buildMenuSpec.ts`.
3. **Reference the command id and the label key** in `src/ui/menu/buildMenuSpec.ts`. The accelerator is pulled from the keybinding service automatically.

Nothing in this directory needs to change: `menuSpec.ts` already covers separators, roles, commands, submenus, radios and checkboxes, and `menuBuilder.ts` translates whatever the renderer sends.

## Platform Differences

### macOS
- Application menu ("Bible") appears as the first menu, carrying About, Preferences and Quit
- Standard macOS services and hide/unhide items are included
- Edit gains Paste and Match Style, Delete, and the Speech submenu
- Command key for shortcuts

### Windows/Linux
- File menu includes Preferences and Quit
- Help menu includes About
- Ctrl key for shortcuts

These differences are driven by the `isMac` flag passed into `buildMenuSpec`.
