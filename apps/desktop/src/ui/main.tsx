import React from 'react';
import ReactDOM from 'react-dom/client';
import App from './App';
import { ContextProvider, createDefaultServices } from './contexts/ContextProvider';
import { LocaleCatalogLoader } from './services/LocaleCatalogLoader';
import { attachExtensionRendererBridge } from './extensions/extensionRendererBridge';
import { registerBuiltinCommands } from './commands';
import { buildMenuSpec } from './menu/buildMenuSpec';
import { bindDocumentDirection, restorePersistedLocale } from './utils/documentDirection';
import { markLocaleCatalogsReady, whenLocaleCatalogsReady } from './services/localeCatalogsReady';
import enUi from '../../locales/en/ui.json';
import enCommands from '../../locales/en/commands.json';
import enLayout from '../../locales/en/layout.json';
import enSearchBar from '../../locales/en/searchBar.json';
import enMenu from '../../locales/en/menu.json';
import './styles/globals.css';
import './styles/highlights.css';

const root = ReactDOM.createRoot(
  document.getElementById('root') as HTMLElement
);

// Build the singleton services once and provide them to the tree. The `en`
// catalogs are bundled into the renderer JS as static JSON imports so the UI
// has working strings on the very first paint - there is no flash of bracketed
// `[key]` placeholders even before any IPC round-trip resolves. The
// LocaleCatalogLoader then merges in any other built-in locales and any
// user-supplied catalogs from `userData/locales/`, overriding the bundled ones
// if a key is redefined.
const services = createDefaultServices();
services.i18n.loadCatalog('en', 'ui', enUi as Record<string, string>);
services.i18n.loadCatalog('en', 'commands', enCommands as Record<string, string>);
services.i18n.loadCatalog('en', 'layout', enLayout as Record<string, string>);
services.i18n.loadCatalog('en', 'searchBar', enSearchBar as Record<string, string>);
// `menu` belongs in this list for a sharper reason than the rest. The others
// back React components, which re-render when something else changes and so
// repair themselves once the catalogs land. The application menu does not: it
// is built ONCE below by `pushMenuSpec()` and handed to main, and is rebuilt
// only when the locale or a keybinding changes. A reader already on `en`
// changes neither, so a menu built before `menu.json` arrived stays
// `[menu.file.title]` for the whole session.
services.i18n.loadCatalog('en', 'menu', enMenu as Record<string, string>);
// `<html dir>` / `<html lang>` follow the active locale. Bound before the
// first render so an RTL locale never paints a frame of LTR layout. The
// disposer is leaked deliberately (lifetime = renderer).
bindDocumentDirection(services.i18n);

// Restore the user's chosen locale only AFTER every catalog is in. Switching
// earlier would flip `currentLocale` while that locale's strings were still in
// flight, and `loadCatalog()` fires no event to re-render the difference away.
// `markLocaleCatalogsReady()` is what unblocks the first-run language picker,
// which reads the LIST of locales rather than strings from it and would
// otherwise be stuck showing only the statically-bundled `en`. It runs in a
// `finally` because a failed load must still release that wait - the loader
// already logs and swallows per-catalog failures, and a picker that never
// appears is worse than a short one.
void new LocaleCatalogLoader(services.i18n)
  .loadAll()
  .then(() => restorePersistedLocale(services.i18n))
  .finally(() => markLocaleCatalogsReady());

// Register every built-in command module against the registry. The disposable
// is intentionally leaked for the lifetime of the renderer - there is no
// app-level teardown path that needs to call it.
registerBuiltinCommands(services.registry);

// Publish runtime context keys owned by the app shell rather than any single
// store. `os` comes from the preload-exposed platform string; `currentLocale`
// mirrors the i18n service's active locale and is updated on every change.
const platformBridge = (window as unknown as { electron?: { platform?: string } }).electron;
const platformString = platformBridge?.platform ?? null;
services.whenContext.set('os', platformString);
services.whenContext.set('currentLocale', services.i18n.currentLocale);
services.i18n.onDidChangeLocale((locale) => {
  services.whenContext.set('currentLocale', locale);
});

// Wire the keybinding service to the global window so registered shortcuts
// dispatch through the registry. The disposable is leaked deliberately -
// the listener lives for the renderer's lifetime.
services.keybindings.attachToWindow(window);

// Diagnostics: forward unhandled renderer errors and promise
// rejections to the main-process DiagnosticsService. The ErrorBoundary and
// PaneErrorBoundary components handle component-level failures separately.
window.addEventListener('error', (ev: ErrorEvent) => {
  try {
    void window.electron?.diagnostics?.reportRendererError?.({
      message: ev.message,
      stack: ev.error instanceof Error ? ev.error.stack : undefined,
    });
  } catch {
    // ignore
  }
});
window.addEventListener('unhandledrejection', (ev: PromiseRejectionEvent) => {
  try {
    const reason: unknown = ev.reason;
    const stack = reason instanceof Error ? reason.stack : undefined;
    void window.electron?.diagnostics?.reportRendererError?.({
      message: reason instanceof Error ? reason.message : String(reason),
      stack,
    });
  } catch {
    // ignore
  }
});

// Wire the renderer side of the extension bridges so the main-process
// Renderer*Bridge classes can drive the renderer services + the
// extension UI surfaces in this window. The disposer is leaked deliberately
// (lifetime = renderer).
attachExtensionRendererBridge({
  registry: services.registry,
  whenContext: services.whenContext,
  i18n: services.i18n,
});

// Expose the singleton service bundle on window for e2e tests. The
// `command-registry.spec.ts` Playwright suite reaches into this from inside
// the renderer to verify the registry/i18n/when-context loop end-to-end.
// Production code paths should always go through `useAppServices()` instead.
(window as unknown as { __services?: typeof services }).__services = services;

// --- Application menu wiring ----------------------------------------------
// The Electron menu is owned by main but its labels and accelerators come
// from the renderer (registry + i18n + keybindings). We push a fresh spec
// at boot and any time the locale or keybindings change.
const isMacRenderer = typeof navigator !== 'undefined' && /Mac/i.test(navigator.platform);

interface ElectronMenuBridge {
  rebuild: (spec: ReturnType<typeof buildMenuSpec>) => void;
  onCommandExecute: (cb: (commandId: string) => void) => () => void;
}
const electronMenuBridge = (window as unknown as { electron?: { electronMenu?: ElectronMenuBridge } })
  .electron?.electronMenu;

// Master "Allow web requests" switch. Cached in the renderer purely to
// reflect the checked state of the Privacy -> Allow Web Requests menu toggle;
// the source of truth is the persisted network config in main.
interface NetworkBridge {
  getAllowWebRequests: () => Promise<{ ok: boolean; value?: boolean }>;
  setAllowWebRequests: (allow: boolean) => Promise<{ ok: boolean; value?: boolean }>;
}
const networkBridge = (window as unknown as { electron?: { network?: NetworkBridge } })
  .electron?.network;
// Starts false to match the persisted default, so the menu never shows
// "allowed" before main has answered.
let allowWebRequests = false;

function pushMenuSpec(): void {
  if (!electronMenuBridge) return;
  try {
    const spec = buildMenuSpec({
      registry: services.registry,
      i18n: services.i18n,
      keybindings: services.keybindings,
      isMac: isMacRenderer,
      allowWebRequests,
    });
    electronMenuBridge.rebuild(spec);
  } catch (err) {
    // eslint-disable-next-line no-console
    console.error('[menu] failed to build/send menu spec:', err);
  }
}

// Initial push. The `en` catalogs above (including `menu`) are already in, so
// this paints real labels rather than placeholders.
pushMenuSpec();
// Push again once every catalog has settled. The static `en` bundle is only a
// first-paint floor: a non-`en` locale, or a user catalog under
// `userData/locales/` that redefines a `menu.*` key, arrives asynchronously.
// `restorePersistedLocale()` covers the locale case via `onDidChangeLocale`,
// but an override within `en` itself fires no event at all.
void whenLocaleCatalogsReady().then(() => pushMenuSpec());
// Re-push on locale change
services.i18n.onDidChangeLocale(() => {
  pushMenuSpec();
});
// Re-push on keybinding change (rebinds, user overrides, plugin contributions)
services.keybindings.onDidChange(() => {
  pushMenuSpec();
});

// Listen for command-execution requests from main (menu clicks). Routes them
// through the renderer's command registry so the same code path handles menu,
// palette, and keyboard invocation.
electronMenuBridge?.onCommandExecute((commandId: string) => {
  void services.registry.execute(commandId);
});

// Master "Allow web requests" switch. Load the persisted state at boot
// so the menu reflects it, and flip it when `network.toggleWebRequests` fires.
if (networkBridge) {
  void networkBridge
    .getAllowWebRequests()
    .then((res) => {
      if (res.ok && typeof res.value === 'boolean') {
        allowWebRequests = res.value;
        pushMenuSpec();
      }
    })
    .catch(() => {
      /* leave the default (not allowed) */
    });

  window.addEventListener('command:network:toggleWebRequests', () => {
    void networkBridge
      .setAllowWebRequests(!allowWebRequests)
      .then((res) => {
        // The reply carries the state AFTER main's confirmation dialog, so a
        // cancelled prompt comes back `false` and the checkbox stays off. Never
        // assume the requested value took effect.
        if (res.ok && typeof res.value === 'boolean') {
          allowWebRequests = res.value;
          pushMenuSpec();
        }
      })
      .catch((err: unknown) => {
        // eslint-disable-next-line no-console
        console.error('[network] failed to toggle web requests:', err);
      });
  });
}

root.render(
  <React.StrictMode>
    <ContextProvider services={services}>
      <App />
    </ContextProvider>
  </React.StrictMode>
);
