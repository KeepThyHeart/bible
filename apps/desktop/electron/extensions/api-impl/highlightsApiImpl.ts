/**
 * Host-side implementation of `IHighlightsApi` for one extension worker.
 *
 * CRUD over the user-data highlights tables, plus `registerStyle` / `listStyles`
 * for custom highlight styles (built-in + extension-contributed share the same
 * picker). Permission gates: `highlights:read` for list/listStyles,
 * `highlights:write` for create/update/delete/registerStyle.
 */

import { Extensions } from '@bible/core';

import type { ExtensionRpcRouter } from '../ExtensionRpcRouter';
import {
  type ExtensionPermissionGrant,
  requirePermission,
} from '../ExtensionPermissionGuard';
import type { IExtensionHighlightsBridge } from './IExtensionDataBridges';
import { RegistrationDisposers } from './registrationDisposers';

const { ExtensionNotActiveError, RpcProtocolError } = Extensions;

const CHANGE_CHANNEL = 'highlights.onDidChange';

export interface HighlightsApiImplOptions {
  extensionId: string;
  router: ExtensionRpcRouter;
  bridge: IExtensionHighlightsBridge;
  grant: ExtensionPermissionGrant;
}

export class HighlightsApiImpl {
  private readonly extensionId: string;
  private readonly router: ExtensionRpcRouter;
  private readonly bridge: IExtensionHighlightsBridge;
  private readonly grant: ExtensionPermissionGrant;
  private readonly registrations = new RegistrationDisposers('style');
  private unsubscribe: (() => void) | undefined;
  private disposed = false;

  constructor(opts: HighlightsApiImplOptions) {
    this.extensionId = opts.extensionId;
    this.router = opts.router;
    this.bridge = opts.bridge;
    this.grant = opts.grant;
  }

  attach(): void {
    this.router.registerNamespace('highlights', {
      list: (args) => this.handleList(args),
      create: (args) => this.handleCreate(args),
      update: (args) => this.handleUpdate(args),
      delete: (args) => this.handleDelete(args),
      registerStyle: (args) => this.handleRegisterStyle(args),
      listStyles: () => this.handleListStyles(),
      dispose: (args) => this.registrations.handleDispose(args),
    });

    this.unsubscribe = this.bridge.subscribeChange((payload) => {
      if (this.disposed) return;
      this.router.emitEvent(CHANGE_CHANNEL, payload);
    });
  }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    // Individual disposers first, then the bulk sweep as a backstop for
    // anything registered outside this map. The bulk call is not redundant:
    // it is the only path that catches styles a future bridge might register
    // on the extension's behalf.
    this.registrations.disposeAll();
    try {
      this.bridge.disposeStylesByOwner(this.extensionId);
    } catch {
      /* best-effort */
    }
    if (this.unsubscribe) {
      try {
        this.unsubscribe();
      } catch {
        /* best-effort */
      }
      this.unsubscribe = undefined;
    }
  }

  // --- RPC handlers ------------------------------------------------------

  private async handleList(args: unknown[]): Promise<unknown> {
    this.assertActive();
    requirePermission(this.grant, 'highlights:read');
    const verseId = args[0];
    if (verseId !== undefined && verseId !== null) {
      if (typeof verseId !== 'number' || !Number.isFinite(verseId)) {
        throw new RpcProtocolError('highlights.list: verseId must be a finite number');
      }
      return this.bridge.list(verseId);
    }
    return this.bridge.list();
  }

  private async handleCreate(args: unknown[]): Promise<unknown> {
    this.assertActive();
    requirePermission(this.grant, 'highlights:write');
    const raw = args[0];
    if (!raw || typeof raw !== 'object') {
      throw new RpcProtocolError('highlights.create: highlight must be an object');
    }
    const highlight = raw as Extensions.NewHighlightDto;
    if (!highlight.range) {
      throw new RpcProtocolError('highlights.create: highlight.range is required');
    }
    if (typeof highlight.styleId !== 'string' || highlight.styleId.length === 0) {
      throw new RpcProtocolError('highlights.create: highlight.styleId must be a non-empty string');
    }
    return this.bridge.create(highlight);
  }

  private async handleUpdate(args: unknown[]): Promise<unknown> {
    this.assertActive();
    requirePermission(this.grant, 'highlights:write');
    const id = args[0];
    if (typeof id !== 'string' || id.length === 0) {
      throw new RpcProtocolError('highlights.update: id must be a non-empty string');
    }
    const patch = args[1];
    if (!patch || typeof patch !== 'object') {
      throw new RpcProtocolError('highlights.update: patch must be an object');
    }
    return this.bridge.update(id, patch as Partial<Extensions.NewHighlightDto>);
  }

  private async handleDelete(args: unknown[]): Promise<unknown> {
    this.assertActive();
    requirePermission(this.grant, 'highlights:write');
    const id = args[0];
    if (typeof id !== 'string' || id.length === 0) {
      throw new RpcProtocolError('highlights.delete: id must be a non-empty string');
    }
    this.bridge.delete(id);
    return undefined;
  }

  private async handleRegisterStyle(args: unknown[]): Promise<unknown> {
    this.assertActive();
    requirePermission(this.grant, 'highlights:write');
    const raw = args[0];
    if (!raw || typeof raw !== 'object') {
      throw new RpcProtocolError('highlights.registerStyle: style must be an object');
    }
    const style = raw as Extensions.HighlightStyleDescriptor;
    if (typeof style.id !== 'string' || style.id.length === 0) {
      throw new RpcProtocolError('highlights.registerStyle: style.id must be a non-empty string');
    }
    if (!style.label) {
      throw new RpcProtocolError('highlights.registerStyle: style.label is required');
    }
    if (!style.style || typeof style.style !== 'object') {
      throw new RpcProtocolError('highlights.registerStyle: style.style must be an object');
    }
    this.bridge.registerStyle(this.extensionId, style);
    // `handle` is retained for compatibility with anything already reading it;
    // `disposalId` is what the guest proxy turns into the `DisposableHandle`
    // the return type has always promised.
    const disposalId = this.registrations.add(() => {
      this.bridge.unregisterStyle(this.extensionId, style.id);
    });
    return { handle: style.id, disposalId };
  }

  private async handleListStyles(): Promise<unknown> {
    this.assertActive();
    requirePermission(this.grant, 'highlights:read');
    return this.bridge.listStyles();
  }

  private assertActive(): void {
    if (this.disposed) {
      throw new ExtensionNotActiveError(`highlightsApiImpl for ${this.extensionId} is disposed`);
    }
  }
}
