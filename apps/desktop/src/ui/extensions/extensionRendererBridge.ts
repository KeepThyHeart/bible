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
import { useLayoutStore, type LayoutPanel } from '../stores/useLayoutStore';
import { useExtensionUiStore } from './extensionUiStore';
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
    case 'panelTypeRegistered':
    case 'panelTypeUnregistered':
      // Panel-type registry lives in main; the renderer just learns about
      // them so a future "open extension panel" menu can list them. No
      // immediate UI work in 6b - the bare list view from 6a is enough.
      return undefined;
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
