/**
 * Renderer-side dispatcher for the extension bridges.
 *
 * The main process holds five `Renderer*Bridge` classes (Command / Context /
 * Ui / Workspace / L10n). Each one talks to a tiny IPC pair owned by this
 * file:
 *
 *   ext-bridge:command           <- main -> renderer requests
 *   ext-bridge:command:response  -> main <- renderer responses
 *   ext-bridge:command:invoke    -> main <- renderer command-fired callbacks
 *   ext-bridge:context           <- main -> renderer requests
 *   ext-bridge:context:response  -> main <- renderer responses
 *   ext-bridge:context:sync      -> main <- renderer snapshot+delta
 *   ext-bridge:ui                <- main -> renderer requests
 *   ext-bridge:ui:response       -> main <- renderer responses
 *   ext-bridge:workspace         <- main -> renderer requests
 *   ext-bridge:workspace:response -> main <- renderer responses
 *   ext-bridge:workspace:sync    -> main <- renderer snapshot+delta
 *   ext-bridge:l10n              <- main -> renderer requests
 *   ext-bridge:l10n:response     -> main <- renderer responses
 *   ext-bridge:l10n:sync         -> main <- locale snapshot/delta
 *
 * Boot order: call `attachExtensionRendererBridge(services)` once after the
 * core services are constructed in `main.tsx`. The function attaches every
 * listener and pushes initial snapshots so the main side has a primed cache
 * before the first extension activates.
 */

import type { ICommandRegistry } from '../services/ICommandRegistry';
import type { IWhenContextService } from '../services/IWhenContextService';
import type { II18nService } from '../services/II18nService';
import type { CommandRegistration, CommandContext } from '../types/Command';
import type { LocalizedString } from '../types/LocalizedString';
import type { Extensions } from '@bible/core';
import { useLayoutStore, type LayoutPanel } from '../stores/useLayoutStore';
import {
  useExtensionUiStore,
  deliverPanelMessage,
  type ExtensionPanelType,
} from './extensionUiStore';
import { useExtensionConsentStore } from './extensionConsentStore';

interface ExtensionBridgeApi {
  /** Subscribe to a main -> renderer channel; returns a disposer. */
  on(channel: string, handler: (payload: unknown) => void): () => void;
  /** Renderer -> main fire-and-forget. */
  send(channel: string, payload: unknown): void;
  /** Renderer -> main request-response (matches main's `ipcMain.handle`). */
  invoke<T = unknown>(channel: string, payload: unknown): Promise<T>;
}

interface ExtensionRendererServices {
  registry: ICommandRegistry;
  whenContext: IWhenContextService;
  i18n: II18nService;
}

/**
 * Wire every bridge listener. Returns a single disposer that tears them all
 * down - useful for tests, or for hot reload.
 */
export function attachExtensionRendererBridge(
  services: ExtensionRendererServices,
  bridge?: ExtensionBridgeApi,
): () => void {
  const w = window as unknown as {
    electron?: { extensionBridge?: ExtensionBridgeApi };
  };
  const api = bridge ?? w.electron?.extensionBridge;
  if (!api) {
    // The preload may not have been loaded (e.g. e2e tests of the renderer
    // alone). Render the rest of the app without the extension bridge -
    // every extension surface degrades to "no extensions installed".
    // eslint-disable-next-line no-console
    console.warn('[extensionRendererBridge] window.electron.extensionBridge not present');
    return () => undefined;
  }

  const disposers: (() => void)[] = [];

  // --- Command bridge --------------------------------------------------
  const registrationDisposers = new Map<string, () => void>();

  disposers.push(
    api.on('ext-bridge:command', (raw) => {
      const payload = raw as { requestId: number; op: string; args: unknown[] };
      handleCommandRequest(payload, api, services, registrationDisposers).catch((err) => {
        api.send('ext-bridge:command:response', {
          requestId: payload.requestId,
          ok: false,
          error: err instanceof Error ? err.message : String(err),
        });
      });
    }),
  );

  // --- Context bridge --------------------------------------------------
  disposers.push(
    api.on('ext-bridge:context', (raw) => {
      const payload = raw as { requestId: number; op: string; args: unknown[] };
      try {
        const result = handleContextRequest(payload.op, payload.args, services);
        api.send('ext-bridge:context:response', {
          requestId: payload.requestId,
          ok: true,
          result,
        });
      } catch (err) {
        api.send('ext-bridge:context:response', {
          requestId: payload.requestId,
          ok: false,
          error: err instanceof Error ? err.message : String(err),
        });
      }
    }),
  );

  // Push the initial when-context snapshot so the main side can serve
  // synchronous reads immediately.
  api.send('ext-bridge:context:sync', { snapshot: services.whenContext.snapshot().toJSON() });
  // Forward future deltas. The WhenContextService doesn't expose a generic
  // "any-key changed" event today, so we re-push a snapshot on every locale
  // change as a stand-in. Better resolution can land in a follow-up.
  const localeUnsub = services.i18n.onDidChangeLocale(() => {
    api.send('ext-bridge:context:sync', { snapshot: services.whenContext.snapshot().toJSON() });
    api.send('ext-bridge:l10n:sync', { locale: services.i18n.currentLocale });
  });
  disposers.push(() => localeUnsub.dispose());

  // --- UI bridge -------------------------------------------------------
  disposers.push(
    api.on('ext-bridge:ui', (raw) => {
      const payload = raw as { requestId: number; op: string; args: unknown[] };
      handleUiRequest(payload.op, payload.args)
        .then((result) => {
          if (payload.requestId !== 0) {
            api.send('ext-bridge:ui:response', {
              requestId: payload.requestId,
              ok: true,
              result,
            });
          }
        })
        .catch((err) => {
          if (payload.requestId !== 0) {
            api.send('ext-bridge:ui:response', {
              requestId: payload.requestId,
              ok: false,
              error: err instanceof Error ? err.message : String(err),
            });
          }
        });
    }),
  );

  // --- Workspace bridge ------------------------------------------------
  disposers.push(
    api.on('ext-bridge:workspace', (raw) => {
      const payload = raw as { requestId: number; op: string; args: unknown[] };
      try {
        const result = handleWorkspaceRequest(payload.op, payload.args);
        api.send('ext-bridge:workspace:response', {
          requestId: payload.requestId,
          ok: true,
          result,
        });
      } catch (err) {
        api.send('ext-bridge:workspace:response', {
          requestId: payload.requestId,
          ok: false,
          error: err instanceof Error ? err.message : String(err),
        });
      }
    }),
  );

  // Push initial workspace snapshot.
  pushWorkspaceSnapshot(api);
  const layoutUnsub = useLayoutStore.subscribe(() => {
    pushWorkspaceSnapshot(api);
  });
  disposers.push(layoutUnsub);

  // --- Consent prompter ------------------------------------------------
  disposers.push(
    api.on('ext-bridge:consent', (raw) => {
      const payload = raw as { requestId: number; op: string; args: unknown[] };
      if (payload.op !== 'prompt') {
        api.send('ext-bridge:consent:response', {
          requestId: payload.requestId,
          ok: false,
          error: `Unknown consent op: ${payload.op}`,
        });
        return;
      }
      const req = payload.args[0] as {
        manifest: never;
        requestedPermissions: never;
        separatelyPrompted: never;
        networkHosts: never;
        trustTier?: 'untrusted' | 'signed' | 'marketplace';
        signaturePublicKey?: string;
      };
      useExtensionConsentStore.getState().setPending({
        manifest: req.manifest,
        requestedPermissions: req.requestedPermissions,
        separatelyPrompted: req.separatelyPrompted,
        networkHosts: req.networkHosts,
        // Provenance drives the untrusted banner. Forwarded verbatim;
        // `undefined` is meaningful and renders as untrusted downstream.
        ...(req.trustTier !== undefined ? { trustTier: req.trustTier } : {}),
        ...(req.signaturePublicKey !== undefined
          ? { signaturePublicKey: req.signaturePublicKey }
          : {}),
        resolve: (value) => {
          api.send('ext-bridge:consent:response', {
            requestId: payload.requestId,
            ok: true,
            result: value,
          });
        },
      });
    }),
  );

  // --- L10n bridge -----------------------------------------------------
  api.send('ext-bridge:l10n:sync', { locale: services.i18n.currentLocale });
  disposers.push(
    api.on('ext-bridge:l10n', (raw) => {
      const payload = raw as { requestId: number; op: string; args: unknown[] };
      try {
        if (payload.op === 'loadCatalog') {
          const arg = (payload.args[0] ?? {}) as {
            extensionId: string;
            locale: string;
            strings: Record<string, string>;
          };
          // Namespace the extension's keys so they don't collide with built-ins.
          const namespaced: Record<string, string> = {};
          for (const [k, v] of Object.entries(arg.strings)) {
            namespaced[`ext.${arg.extensionId}.${k}`] = v;
          }
          services.i18n.loadCatalog(arg.locale, `ext-${arg.extensionId}`, namespaced);
        }
        // Other ops (`dropCatalog`) are best-effort: I18nService doesn't
        // expose a "drop namespace" call today. Catalogs are small enough
        // that the few KB of stale strings is acceptable until the
        // I18nService grows a drop hook.
      } catch (err) {
        // eslint-disable-next-line no-console
        console.warn('[extensionRendererBridge] l10n op failed:', err);
      }
    }),
  );

  // --- Panel discovery -------------------------------------------------
  //
  // Auto-register one "Open <panel title>" command per contributed panel type,
  // so every extension panel is reachable from the command palette - and, once
  // menu contributions land, from the application menu - without the extension
  // author doing anything.
  //
  // This is the cheapest lever on the platform's reachability problem.
  // `ICommandRegistry` is the one registry that already serves the palette, the
  // keyboard and the menu bar, and `RendererCommandBridge` already puts
  // extension commands into it. Registering here means a panel that an
  // extension merely *declares* becomes something a user can find, rather than
  // something only the extension itself can open.
  //
  // The registration is derived state: it is rebuilt from the store on every
  // change rather than maintained incrementally, because the store is the
  // authority and a divergent shadow copy is exactly the bug class this whole
  // workstream exists to fix.
  {
    const panelCommandDisposers = new Map<string, () => void>();

    const syncPanelCommands = (panelTypes: ExtensionPanelType[]): void => {
      const wanted = new Set(panelTypes.map((p) => p.key));
      for (const [key, dispose] of panelCommandDisposers) {
        if (!wanted.has(key)) {
          try { dispose(); } catch { /* swallow */ }
          panelCommandDisposers.delete(key);
        }
      }
      for (const panel of panelTypes) {
        if (panelCommandDisposers.has(panel.key)) continue;
        // Namespaced under the owning extension so it satisfies the registry's
        // `ext.<extensionId>.` prefix rule and cannot collide with a command
        // the extension registered itself.
        //
        // `extensionId` is a manifest id and so already carries the `ext.`
        // prefix. Prepending a second one produced `ext.ext.acme.plan.` ids,
        // which matched only because `CommandRegistry` was concatenating the
        // same way; both sides are normalised now.
        const commandId = `${panel.extensionId}.openPanel.${panel.panelTypeId}`;
        const registration: CommandRegistration = {
          id: commandId,
          // The extension supplies an already-localized title; wrap it in the
          // app's "Open X" phrasing so the palette reads as a verb.
          title: { key: 'commands.openExtensionPanel', params: { name: panel.def.title } },
          ownerExtensionId: panel.extensionId,
          handler: () => {
            useLayoutStore
              .getState() // allow-getstate: event handler - imperative open, no subscription needed
              .addPanel(panel.contentType, undefined, services.i18n.resolve(panel.def.title));
          },
        };
        try {
          const disposable = services.registry.register(registration);
          panelCommandDisposers.set(panel.key, () => disposable.dispose());
        } catch (err) {
          // A duplicate id is the only realistic failure and it must not take
          // the bridge down - the panel is still openable from the new-tab page.
          // eslint-disable-next-line no-console
          console.warn(`[extensionRendererBridge] could not register ${commandId}:`, err);
        }
      }
    };

    syncPanelCommands(useExtensionUiStore.getState().panelTypes); // allow-getstate: effect/init - prime from the current snapshot
    const unsubscribe = useExtensionUiStore.subscribe((state) => {
      syncPanelCommands(state.panelTypes);
    });
    disposers.push(() => {
      unsubscribe();
      for (const d of panelCommandDisposers.values()) {
        try { d(); } catch { /* swallow */ }
      }
      panelCommandDisposers.clear();
    });
  }

  return () => {
    for (const d of disposers) {
      try { d(); } catch { /* swallow */ }
    }
    for (const d of registrationDisposers.values()) {
      try { d(); } catch { /* swallow */ }
    }
    registrationDisposers.clear();
  };
}

// --- Command request handler -----------------------------------------

async function handleCommandRequest(
  payload: { requestId: number; op: string; args: unknown[] },
  api: ExtensionBridgeApi,
  services: ExtensionRendererServices,
  registrationDisposers: Map<string, () => void>,
): Promise<void> {
  switch (payload.op) {
    case 'register': {
      const { registrationId, spec } = payload.args[0] as {
        registrationId: string;
        spec: {
          id: string;
          ownerExtensionId: string;
          title: LocalizedString;
          category?: LocalizedString;
          shortcut?: unknown;
          when?: string;
          order?: number;
          hidden?: boolean;
        };
      };
      const registration: CommandRegistration = {
        id: spec.id,
        title: spec.title,
        handler: async (ctx: CommandContext) => {
          // Forward back to main, which forwards to the worker via reverse RPC.
          await api.invoke('ext-bridge:command:invoke', {
            registrationId,
            args: ctx.args,
          });
        },
        ownerExtensionId: spec.ownerExtensionId,
        ...(spec.category !== undefined ? { category: spec.category } : {}),
        ...(spec.shortcut !== undefined ? { shortcut: spec.shortcut as CommandRegistration['shortcut'] } : {}),
        ...(spec.when !== undefined ? { when: spec.when } : {}),
        ...(spec.order !== undefined ? { order: spec.order } : {}),
        ...(spec.hidden !== undefined ? { hidden: spec.hidden } : {}),
      };
      const disposable = services.registry.register(registration);
      registrationDisposers.set(registrationId, () => disposable.dispose());
      api.send('ext-bridge:command:response', { requestId: payload.requestId, ok: true });
      return;
    }
    case 'dispose': {
      const id = payload.args[0] as string;
      registrationDisposers.get(id)?.();
      registrationDisposers.delete(id);
      api.send('ext-bridge:command:response', { requestId: payload.requestId, ok: true });
      return;
    }
    case 'disposeMany': {
      const ids = payload.args[0] as string[];
      for (const id of ids) {
        registrationDisposers.get(id)?.();
        registrationDisposers.delete(id);
      }
      api.send('ext-bridge:command:response', { requestId: payload.requestId, ok: true });
      return;
    }
    case 'execute': {
      const commandId = payload.args[0] as string;
      const args = payload.args[1];
      const result = await services.registry.execute(commandId, args);
      api.send('ext-bridge:command:response', { requestId: payload.requestId, ok: true, result });
      return;
    }
    default:
      api.send('ext-bridge:command:response', {
        requestId: payload.requestId,
        ok: false,
        error: `Unknown command op: ${payload.op}`,
      });
  }
}

// --- Context request handler ----------------------------------------

function handleContextRequest(
  op: string,
  args: unknown[],
  services: ExtensionRendererServices,
): unknown {
  switch (op) {
    case 'setForExtension': {
      const [extensionId, key, value] = args as [string, string, unknown];
      services.whenContext.setForExtension(extensionId, key, value as never);
      return undefined;
    }
    case 'disposeExtensionKeys': {
      const [extensionId] = args as [string];
      return services.whenContext.disposeExtensionKeys(extensionId);
    }
    default:
      throw new Error(`Unknown context op: ${op}`);
  }
}

// --- UI request handler ---------------------------------------------

async function handleUiRequest(op: string, args: unknown[]): Promise<unknown> {
  const store = useExtensionUiStore.getState();
  switch (op) {
    case 'showNotification': {
      const [extensionId, message, opts] = args as [string, LocalizedString, unknown];
      store.pushNotification(extensionId, message, opts as never);
      return undefined;
    }
    case 'showQuickPick': {
      const [extensionId, items, opts] = args as [
        string,
        { id: number; label: LocalizedString; detail?: LocalizedString; description?: LocalizedString }[],
        unknown,
      ];
      return await new Promise<number | null>((resolve) => {
        store.setModal({
          kind: 'quickPick',
          extensionId,
          items,
          opts: opts as never,
          resolve: (pickedId) => {
            store.setModal(null);
            resolve(pickedId);
          },
        });
      });
    }
    case 'showInputBox': {
      const [extensionId, opts] = args as [string, unknown];
      return await new Promise<string | null>((resolve) => {
        store.setModal({
          kind: 'inputBox',
          extensionId,
          opts: opts as never,
          resolve: (value) => {
            store.setModal(null);
            resolve(value);
          },
        });
      });
    }
    case 'showConfirm': {
      const [extensionId, opts] = args as [string, unknown];
      return await new Promise<boolean>((resolve) => {
        store.setModal({
          kind: 'confirm',
          extensionId,
          opts: opts as never,
          resolve: (value) => {
            store.setModal(null);
            resolve(value);
          },
        });
      });
    }
    // --- Contributed UI, rendered by the app ---------------------------
    //
    // `RendererUiBridge` has always pushed these; nothing handled them, so an
    // extension calling `ui.registerContextMenu(...)` got a valid
    // `DisposableHandle`, passed the permission guard, appeared in
    // `ContributionRegistry.listContextMenuItems()`, and was then dropped on
    // the floor with no error and no warning.
    case 'contextMenuItemRegistered': {
      const [payload] = args as [
        { extensionId: string; target: Extensions.ContextMenuTarget; item: Extensions.ContextMenuItemDescriptor },
      ];
      store.addContextMenuItem(payload.extensionId, payload.target, payload.item);
      return undefined;
    }
    case 'contextMenuItemUnregistered': {
      const [payload] = args as [{ extensionId: string; itemId: string }];
      store.removeContextMenuItem(payload.extensionId, payload.itemId);
      return undefined;
    }
    case 'statusBarItemRegistered': {
      const [payload] = args as [{ extensionId: string; item: Extensions.StatusBarItemDescriptor }];
      store.addStatusBarItem(payload.extensionId, payload.item);
      return undefined;
    }
    case 'statusBarItemUnregistered': {
      const [payload] = args as [{ extensionId: string; itemId: string }];
      store.removeStatusBarItem(payload.extensionId, payload.itemId);
      return undefined;
    }
    case 'panelMessage': {
      // `api.panels.postMessage(...)` from a worker. Fan it out to the mounted
      // panel hosts, which each decide whether it is addressed to them.
      // `extensionId` was stamped by the main process from the sending worker,
      // so it is trustworthy here.
      const [payload] = args as [
        { extensionId?: unknown; panelId?: unknown; message?: unknown } | undefined,
      ];
      if (!payload || typeof payload.extensionId !== 'string') return undefined;
      deliverPanelMessage({
        extensionId: payload.extensionId,
        ...(typeof payload.panelId === 'string' ? { panelId: payload.panelId } : {}),
        message: payload.message,
      });
      return undefined;
    }
    case 'panelTypeRegistered': {
      // The registry of record still lives in main; the renderer keeps its own
      // copy so the new-tab page can list contributed panels and so each one
      // gets a command (below). Before this, `workspace.openPanel` worked but
      // only the extension itself could call it - nothing in `NewTabPage`, the
      // application menu or Preferences opened an extension panel, so a panel
      // an extension contributed was effectively unreachable.
      const [payload] = args as [
        { extensionId: string; def: Extensions.ExtensionPanelTypeDef },
      ];
      store.addPanelType(payload.extensionId, payload.def);
      return undefined;
    }
    case 'panelTypeUnregistered': {
      const [payload] = args as [{ extensionId: string; panelTypeId: string }];
      store.removePanelType(payload.extensionId, payload.panelTypeId);
      return undefined;
    }
    default:
      throw new Error(`Unknown ui op: ${op}`);
  }
}

// --- Workspace request handler --------------------------------------

function handleWorkspaceRequest(op: string, args: unknown[]): unknown {
  const layout = useLayoutStore.getState();
  switch (op) {
    case 'openPanel': {
      const [_syntheticId, contentType] = args as [string, string, unknown];
      // The synthetic ID from main is informational; the layout store mints
      // its own panel ID and we map back via the next snapshot push.
      const panelId = layout.addPanel(contentType as never);
      return panelId;
    }
    case 'closePanel': {
      const [panelId] = args as [string];
      layout.removePanel(panelId);
      return undefined;
    }
    default:
      throw new Error(`Unknown workspace op: ${op}`);
  }
}

function pushWorkspaceSnapshot(api: ExtensionBridgeApi): void {
  const layout = useLayoutStore.getState();
  const snapshot = Array.from(layout.panels.values()).map((p: LayoutPanel) => ({
    panelId: p.panelId,
    contentType: p.contentType,
  }));
  api.send('ext-bridge:workspace:sync', { snapshot, activePanelId: null });
}
