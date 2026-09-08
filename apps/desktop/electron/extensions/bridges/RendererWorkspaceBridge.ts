/**
 * Production `IExtensionWorkspaceBridge`.
 *
 * Forwards `openPanel` / `closePanel` / `getActivePanel` / `getOpenPanels`
 * into the renderer-side `useLayoutStore`. The renderer pushes a snapshot of
 * the panel list at boot and a delta on every change so synchronous reads
 * (which the api-impl interface requires) hit the local cache.
 *
 * The `extensions:`-prefixed IPC handlers live in `extensionHandlers.ts` -
 * see that file for the small number of inbound channels this bridge listens
 * on.
 */

import { ipcMain, type BrowserWindow } from 'electron';
import type { Extensions } from '@bible/core';

import type { IExtensionWorkspaceBridge } from '../api-impl/IExtensionDataBridges';
import { BridgeRpc } from './RendererBridgeRpc';

type PanelInfoDto = Extensions.PanelInfoDto;
type OpenPanelOpts = Extensions.OpenPanelOpts;

export class RendererWorkspaceBridge implements IExtensionWorkspaceBridge {
  private readonly rpc: BridgeRpc;
  private readonly panels = new Map<string, PanelInfoDto>();
  private activePanelId: string | null = null;
  private readonly activeHandlers = new Set<(p: PanelInfoDto | null) => void>();
  private readonly openHandlers = new Set<(p: PanelInfoDto) => void>();
  private readonly closeHandlers = new Set<(info: { panelId: string; contentType: string }) => void>();
  private nextSyntheticId = 1;

  constructor(getWindow: () => BrowserWindow | null) {
    this.rpc = new BridgeRpc({
      outboundChannel: 'ext-bridge:workspace',
      responseChannel: 'ext-bridge:workspace:response',
      getWindow,
    });

    // Snapshot + delta channel - same shape as the context bridge.
    ipcMain.on('ext-bridge:workspace:sync', (_event, payload: {
      snapshot?: PanelInfoDto[];
      activePanelId?: string | null;
      opened?: PanelInfoDto;
      closed?: { panelId: string; contentType: string };
      activated?: PanelInfoDto | null;
    }) => {
      if (payload.snapshot) {
        this.panels.clear();
        for (const p of payload.snapshot) this.panels.set(p.panelId, p);
      }
      if ('activePanelId' in payload) {
        this.activePanelId = payload.activePanelId ?? null;
      }
      if (payload.opened) {
        this.panels.set(payload.opened.panelId, payload.opened);
        for (const h of this.openHandlers) {
          try { h(payload.opened); } catch { /* swallow */ }
        }
      }
      if (payload.closed) {
        const closed = payload.closed;
        this.panels.delete(closed.panelId);
        if (this.activePanelId === closed.panelId) this.activePanelId = null;
        for (const h of this.closeHandlers) {
          try { h(closed); } catch { /* swallow */ }
        }
      }
      if ('activated' in payload) {
        this.activePanelId = payload.activated?.panelId ?? null;
        for (const h of this.activeHandlers) {
          try { h(payload.activated ?? null); } catch { /* swallow */ }
        }
      }
    });
  }

  getActivePanel(): PanelInfoDto | null {
    if (!this.activePanelId) return null;
    return this.panels.get(this.activePanelId) ?? null;
  }

  getOpenPanels(): PanelInfoDto[] {
    return Array.from(this.panels.values());
  }

  openPanel(contentType: string, opts?: OpenPanelOpts): string {
    // The api-impl expects a synchronous return. We mint a synthetic id and
    // ask the renderer to remember the mapping when it actually opens the
    // panel. Subsequent calls (closePanel etc.) reference this id; the
    // renderer maintains a synthetic-id <-> real-panel-id map.
    const syntheticId = `ext-panel-${this.nextSyntheticId++}`;
    const optimistic: PanelInfoDto = {
      panelId: syntheticId,
      contentType,
      ...(opts?.state !== undefined ? { state: opts.state } : {}),
    };
    this.panels.set(syntheticId, optimistic);
    void this.rpc.request('openPanel', [syntheticId, contentType, opts ?? null]).catch(() => undefined);
    return syntheticId;
  }

  closePanel(panelId: string): void {
    void this.rpc.request('closePanel', [panelId]).catch(() => undefined);
  }

  subscribeActivePanel(handler: (p: PanelInfoDto | null) => void): () => void {
    this.activeHandlers.add(handler);
    return () => { this.activeHandlers.delete(handler); };
  }

  subscribeOpenPanel(handler: (p: PanelInfoDto) => void): () => void {
    this.openHandlers.add(handler);
    return () => { this.openHandlers.delete(handler); };
  }

  subscribeClosePanel(handler: (info: { panelId: string; contentType: string }) => void): () => void {
    this.closeHandlers.add(handler);
    return () => { this.closeHandlers.delete(handler); };
  }
}
