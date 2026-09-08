/**
 * Production `IExtensionCommandBridge`.
 *
 * Forwards `commandRegistry.register` / `disposeByOwner` / `execute` calls
 * into the renderer-side `CommandRegistry` instance via a small IPC pair:
 *
 *   main ->  renderer  : 'ext-bridge:command'           ({ op, requestId, args })
 *   renderer -> main   : 'ext-bridge:command:response'  ({ requestId, ok, ... })
 *   renderer -> main   : 'ext-bridge:command:invoke'    (callback when the
 *                       renderer fires a registered extension command)
 *
 * The renderer side of the protocol lives in
 * `src/ui/extensions/extensionRendererBridge.ts`. Both ends agree on a small
 * `op` vocabulary documented inline below.
 */

import { ipcMain, type BrowserWindow } from 'electron';

import type {
  ExtensionCommandSpec,
  IExtensionCommandBridge,
} from '../api-impl/IExtensionRegistryBridges';
import { BridgeRpc } from './RendererBridgeRpc';

export class RendererCommandBridge implements IExtensionCommandBridge {
  private readonly rpc: BridgeRpc;
  /** registrationId -> invoke callback (set by `register`, drained by inbound). */
  private readonly invokers = new Map<string, (args: unknown) => Promise<unknown>>();
  /** extensionId -> set of registrationIds, for `disposeByOwner`. */
  private readonly ownerToIds = new Map<string, Set<string>>();
  private nextRegistrationId = 1;

  constructor(getWindow: () => BrowserWindow | null) {
    this.rpc = new BridgeRpc({
      outboundChannel: 'ext-bridge:command',
      responseChannel: 'ext-bridge:command:response',
      getWindow,
    });

    // Renderer-initiated callback path: when a command registered through
    // this bridge fires (menu / palette / keybinding), the renderer routes
    // the dispatch back to main via this channel and main forwards to the
    // worker through the cached `invoke` callback.
    ipcMain.handle('ext-bridge:command:invoke', async (_event, payload: { registrationId: string; args: unknown }) => {
      const cb = this.invokers.get(payload.registrationId);
      if (!cb) throw new Error(`No registered extension command callback for ${payload.registrationId}`);
      return cb(payload.args);
    });
  }

  register(
    spec: ExtensionCommandSpec,
    invoke: (args: unknown) => Promise<unknown>,
  ): () => void {
    const registrationId = `cmd-${this.nextRegistrationId++}`;
    this.invokers.set(registrationId, invoke);
    let owners = this.ownerToIds.get(spec.ownerExtensionId);
    if (!owners) {
      owners = new Set();
      this.ownerToIds.set(spec.ownerExtensionId, owners);
    }
    owners.add(registrationId);

    // Best-effort dispatch - the renderer may not be ready (e.g. during
    // shutdown). We deliberately do not await: the api-impl is sync.
    void this.rpc
      .request('register', [{ registrationId, spec }])
      .catch((err) => {
        // Silently swallow - registration failures land in the worker on
        // the next call. The host already logs RPC errors centrally.
        void err;
      });

    return () => {
      if (!this.invokers.delete(registrationId)) return;
      this.ownerToIds.get(spec.ownerExtensionId)?.delete(registrationId);
      void this.rpc.request('dispose', [registrationId]).catch(() => undefined);
    };
  }

  disposeByOwner(extensionId: string): number {
    const owners = this.ownerToIds.get(extensionId);
    if (!owners) return 0;
    const ids = Array.from(owners);
    for (const id of ids) {
      this.invokers.delete(id);
    }
    this.ownerToIds.delete(extensionId);
    if (ids.length > 0) {
      void this.rpc.request('disposeMany', [ids]).catch(() => undefined);
    }
    return ids.length;
  }

  async execute(commandId: string, args?: unknown): Promise<unknown> {
    return this.rpc.request('execute', [commandId, args]);
  }
}
