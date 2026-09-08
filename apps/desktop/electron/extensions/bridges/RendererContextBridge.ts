/**
 * Production `IExtensionContextBridge`.
 *
 * Forwards `whenContext.get` / `setForExtension` / `disposeExtensionKeys`
 * into the renderer-side `WhenContextService` instance via the same simple
 * IPC pair pattern as `RendererCommandBridge`.
 *
 * Reads (`get`) need to be synchronous from the api-impl's perspective, and
 * reads are unrestricted, so the bridge keeps a write-through cache populated by the renderer at boot and on every
 * `set` - see `seedReadCache()`. The cache is best-effort: if a key isn't in
 * the cache the bridge returns `undefined` and the worker treats it as
 * "unset", which matches the WhenContextService contract.
 */

import { ipcMain, type BrowserWindow } from 'electron';
import type { Extensions } from '@bible/core';

import type { IExtensionContextBridge } from '../api-impl/IExtensionRegistryBridges';
import { BridgeRpc } from './RendererBridgeRpc';

type WhenContextValue = Extensions.WhenContextValue;

export class RendererContextBridge implements IExtensionContextBridge {
  private readonly rpc: BridgeRpc;
  private readonly cache = new Map<string, WhenContextValue>();

  constructor(getWindow: () => BrowserWindow | null) {
    this.rpc = new BridgeRpc({
      outboundChannel: 'ext-bridge:context',
      responseChannel: 'ext-bridge:context:response',
      getWindow,
    });

    // Renderer pushes a snapshot of the current when-context at boot, plus
    // a delta on every change. We listen on a single channel and overwrite
    // the cache so reads stay cheap.
    ipcMain.on('ext-bridge:context:sync', (_event, payload: { snapshot?: Record<string, unknown>; delta?: { key: string; value: unknown } }) => {
      if (payload.snapshot) {
        this.cache.clear();
        for (const [k, v] of Object.entries(payload.snapshot)) {
          this.cache.set(k, v as WhenContextValue);
        }
      }
      if (payload.delta) {
        if (payload.delta.value === undefined) {
          this.cache.delete(payload.delta.key);
        } else {
          this.cache.set(payload.delta.key, payload.delta.value as WhenContextValue);
        }
      }
    });
  }

  get(key: string): WhenContextValue | undefined {
    return this.cache.get(key);
  }

  setForExtension(extensionId: string, key: string, value: WhenContextValue): void {
    // Update the local cache eagerly so the next `get` from the same worker
    // sees its own write without waiting on the round-trip.
    this.cache.set(key, value);
    void this.rpc.request('setForExtension', [extensionId, key, value]).catch(() => undefined);
  }

  disposeExtensionKeys(extensionId: string): number {
    // We don't know the count without round-tripping; the renderer side
    // returns it. Fire-and-forget here, return 0 - the host only uses the
    // return value for diagnostic logging.
    void this.rpc.request('disposeExtensionKeys', [extensionId]).catch(() => undefined);
    // Best-effort cache eviction by prefix.
    const prefix = `ext.${extensionId}.`;
    let removed = 0;
    for (const key of Array.from(this.cache.keys())) {
      if (key.startsWith(prefix)) {
        this.cache.delete(key);
        removed++;
      }
    }
    return removed;
  }
}
