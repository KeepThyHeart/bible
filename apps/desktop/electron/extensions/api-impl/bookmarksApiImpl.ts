/**
 * Host-side implementation of `IBookmarksApi` for one extension worker.
 *
 * CRUD over the user-data bookmarks and collections tables. Permission gates:
 * `bookmarks:read` for list/listCollections, `bookmarks:write` for
 * add/remove/createCollection.
 */

import { Extensions } from '@bible/core';

import type { ExtensionRpcRouter } from '../ExtensionRpcRouter';
import {
  type ExtensionPermissionGrant,
  requirePermission,
} from '../ExtensionPermissionGuard';
import type { IExtensionBookmarksBridge } from './IExtensionDataBridges';

const { ExtensionNotActiveError, RpcProtocolError } = Extensions;

export interface BookmarksApiImplOptions {
  extensionId: string;
  router: ExtensionRpcRouter;
  bridge: IExtensionBookmarksBridge;
  grant: ExtensionPermissionGrant;
}

export class BookmarksApiImpl {
  private readonly extensionId: string;
  private readonly router: ExtensionRpcRouter;
  private readonly bridge: IExtensionBookmarksBridge;
  private readonly grant: ExtensionPermissionGrant;
  private disposed = false;

  constructor(opts: BookmarksApiImplOptions) {
    this.extensionId = opts.extensionId;
    this.router = opts.router;
    this.bridge = opts.bridge;
    this.grant = opts.grant;
  }

  attach(): void {
    this.router.registerNamespace('bookmarks', {
      list: (args) => this.handleList(args),
      add: (args) => this.handleAdd(args),
      remove: (args) => this.handleRemove(args),
      listCollections: () => this.handleListCollections(),
      createCollection: (args) => this.handleCreateCollection(args),
    });
  }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
  }

  // --- RPC handlers ------------------------------------------------------

  private async handleList(args: unknown[]): Promise<unknown> {
    this.assertActive();
    requirePermission(this.grant, 'bookmarks:read');
    const collectionId = args[0];
    if (collectionId !== undefined && collectionId !== null) {
      if (typeof collectionId !== 'string') {
        throw new RpcProtocolError('bookmarks.list: collectionId must be a string');
      }
      return this.bridge.list(collectionId);
    }
    return this.bridge.list();
  }

  private async handleAdd(args: unknown[]): Promise<unknown> {
    this.assertActive();
    requirePermission(this.grant, 'bookmarks:write');
    const verseId = args[0];
    if (typeof verseId !== 'number' || !Number.isFinite(verseId)) {
      throw new RpcProtocolError('bookmarks.add: verseId must be a finite number');
    }
    const collectionId = args[1];
    if (collectionId !== undefined && collectionId !== null && typeof collectionId !== 'string') {
      throw new RpcProtocolError('bookmarks.add: collectionId must be a string when provided');
    }
    return this.bridge.add(
      verseId,
      typeof collectionId === 'string' ? collectionId : undefined,
    );
  }

  private async handleRemove(args: unknown[]): Promise<unknown> {
    this.assertActive();
    requirePermission(this.grant, 'bookmarks:write');
    const id = args[0];
    if (typeof id !== 'string' || id.length === 0) {
      throw new RpcProtocolError('bookmarks.remove: id must be a non-empty string');
    }
    this.bridge.remove(id);
    return undefined;
  }

  private async handleListCollections(): Promise<unknown> {
    this.assertActive();
    requirePermission(this.grant, 'bookmarks:read');
    return this.bridge.listCollections();
  }

  private async handleCreateCollection(args: unknown[]): Promise<unknown> {
    this.assertActive();
    requirePermission(this.grant, 'bookmarks:write');
    const name = args[0];
    if (!name) {
      throw new RpcProtocolError('bookmarks.createCollection: name is required');
    }
    return this.bridge.createCollection(name as Extensions.LocalizedString);
  }

  private assertActive(): void {
    if (this.disposed) {
      throw new ExtensionNotActiveError(`bookmarksApiImpl for ${this.extensionId} is disposed`);
    }
  }
}
