/**
 * Host-side implementation of `IWorkspaceApi` for one extension worker.
 *
 * Bridges the worker to the
 * renderer's `useLayoutStore` via the `IExtensionWorkspaceBridge` interface.
 *
 * Read methods (`getActivePanel`, `getOpenPanels`) and the panel-mutation
 * methods (`openPanel`, `closePanel`) are unrestricted - opening a panel is
 * a user-visible action that the user can always close. The three event
 * channels (`onDidChangeActivePanel`, `onDidOpenPanel`, `onDidClosePanel`)
 * are wired through the router's `emitEvent`, so the worker only sees them
 * when it has actually subscribed.
 */

import { Extensions } from '@bible/core';

import type { ExtensionRpcRouter } from '../ExtensionRpcRouter';
import type { IExtensionWorkspaceBridge } from './IExtensionDataBridges';

const { ExtensionNotActiveError, RpcProtocolError } = Extensions;

const ACTIVE_PANEL_CHANNEL = 'workspace.onDidChangeActivePanel';
const OPEN_PANEL_CHANNEL = 'workspace.onDidOpenPanel';
const CLOSE_PANEL_CHANNEL = 'workspace.onDidClosePanel';

export interface WorkspaceApiImplOptions {
  extensionId: string;
  router: ExtensionRpcRouter;
  bridge: IExtensionWorkspaceBridge;
}

export class WorkspaceApiImpl {
  private readonly extensionId: string;
  private readonly router: ExtensionRpcRouter;
  private readonly bridge: IExtensionWorkspaceBridge;
  private unsubActive: (() => void) | undefined;
  private unsubOpen: (() => void) | undefined;
  private unsubClose: (() => void) | undefined;
  private disposed = false;

  constructor(opts: WorkspaceApiImplOptions) {
    this.extensionId = opts.extensionId;
    this.router = opts.router;
    this.bridge = opts.bridge;
  }

  attach(): void {
    this.router.registerNamespace('workspace', {
      getActivePanel: () => this.handleGetActivePanel(),
      getOpenPanels: () => this.handleGetOpenPanels(),
      openPanel: (args) => this.handleOpenPanel(args),
      closePanel: (args) => this.handleClosePanel(args),
    });

    this.unsubActive = this.bridge.subscribeActivePanel((panel) => {
      if (this.disposed) return;
      this.router.emitEvent(ACTIVE_PANEL_CHANNEL, panel);
    });
    this.unsubOpen = this.bridge.subscribeOpenPanel((panel) => {
      if (this.disposed) return;
      this.router.emitEvent(OPEN_PANEL_CHANNEL, panel);
    });
    this.unsubClose = this.bridge.subscribeClosePanel((info) => {
      if (this.disposed) return;
      this.router.emitEvent(CLOSE_PANEL_CHANNEL, info);
    });
  }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    for (const u of [this.unsubActive, this.unsubOpen, this.unsubClose]) {
      if (u) {
        try {
          u();
        } catch {
          /* best-effort */
        }
      }
    }
    this.unsubActive = undefined;
    this.unsubOpen = undefined;
    this.unsubClose = undefined;
  }

  // --- RPC handlers ------------------------------------------------------

  private async handleGetActivePanel(): Promise<unknown> {
    this.assertActive();
    return this.bridge.getActivePanel();
  }

  private async handleGetOpenPanels(): Promise<unknown> {
    this.assertActive();
    return this.bridge.getOpenPanels();
  }

  private async handleOpenPanel(args: unknown[]): Promise<string> {
    this.assertActive();
    const contentType = args[0];
    if (typeof contentType !== 'string' || contentType.length === 0) {
      throw new RpcProtocolError('workspace.openPanel: contentType must be a non-empty string');
    }
    const opts = args[1];
    if (opts !== undefined && opts !== null && typeof opts !== 'object') {
      throw new RpcProtocolError('workspace.openPanel: opts must be an object when provided');
    }
    return this.bridge.openPanel(
      contentType,
      (opts ?? undefined) as Extensions.OpenPanelOpts | undefined,
    );
  }

  private async handleClosePanel(args: unknown[]): Promise<void> {
    this.assertActive();
    const panelId = args[0];
    if (typeof panelId !== 'string' || panelId.length === 0) {
      throw new RpcProtocolError('workspace.closePanel: panelId must be a non-empty string');
    }
    this.bridge.closePanel(panelId);
  }

  private assertActive(): void {
    if (this.disposed) {
      throw new ExtensionNotActiveError(`workspaceApiImpl for ${this.extensionId} is disposed`);
    }
  }
}
