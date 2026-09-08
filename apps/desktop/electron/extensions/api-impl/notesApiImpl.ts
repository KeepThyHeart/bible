/**
 * Host-side implementation of `INotesApi` for one extension worker.
 *
 * CRUD over the user-data notes tables, plus an `onDidChange` event channel.
 * Permission gates: `notes:read` for list/get, `notes:write` for
 * create/update/delete.
 *
 * The bridge wiring goes through `sharedUserDb` exactly the same way the
 * existing IPC handlers in `electron/ipc/notesHandlers.ts` do.
 */

import { Extensions } from '@bible/core';

import type { ExtensionRpcRouter } from '../ExtensionRpcRouter';
import {
  type ExtensionPermissionGrant,
  requirePermission,
} from '../ExtensionPermissionGuard';
import type { IExtensionNotesBridge } from './IExtensionDataBridges';

const { ExtensionNotActiveError, RpcProtocolError } = Extensions;

const CHANGE_CHANNEL = 'notes.onDidChange';

export interface NotesApiImplOptions {
  extensionId: string;
  router: ExtensionRpcRouter;
  bridge: IExtensionNotesBridge;
  grant: ExtensionPermissionGrant;
}

export class NotesApiImpl {
  private readonly extensionId: string;
  private readonly router: ExtensionRpcRouter;
  private readonly bridge: IExtensionNotesBridge;
  private readonly grant: ExtensionPermissionGrant;
  private unsubscribe: (() => void) | undefined;
  private disposed = false;

  constructor(opts: NotesApiImplOptions) {
    this.extensionId = opts.extensionId;
    this.router = opts.router;
    this.bridge = opts.bridge;
    this.grant = opts.grant;
  }

  attach(): void {
    this.router.registerNamespace('notes', {
      list: (args) => this.handleList(args),
      get: (args) => this.handleGet(args),
      create: (args) => this.handleCreate(args),
      update: (args) => this.handleUpdate(args),
      delete: (args) => this.handleDelete(args),
    });

    this.unsubscribe = this.bridge.subscribeChange((payload) => {
      if (this.disposed) return;
      this.router.emitEvent(CHANGE_CHANNEL, payload);
    });
  }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
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
    requirePermission(this.grant, 'notes:read');
    const query = args[0];
    if (query !== undefined && query !== null && typeof query !== 'object') {
      throw new RpcProtocolError('notes.list: query must be an object when provided');
    }
    return this.bridge.list(
      query as Extensions.NoteQueryDto | undefined,
    );
  }

  private async handleGet(args: unknown[]): Promise<unknown> {
    this.assertActive();
    requirePermission(this.grant, 'notes:read');
    const id = args[0];
    if (typeof id !== 'string' || id.length === 0) {
      throw new RpcProtocolError('notes.get: id must be a non-empty string');
    }
    return this.bridge.get(id);
  }

  private async handleCreate(args: unknown[]): Promise<unknown> {
    this.assertActive();
    requirePermission(this.grant, 'notes:write');
    const raw = args[0];
    if (!raw || typeof raw !== 'object') {
      throw new RpcProtocolError('notes.create: note must be an object');
    }
    const note = raw as Extensions.NewNoteDto;
    if (typeof note.content !== 'string') {
      throw new RpcProtocolError('notes.create: note.content must be a string');
    }
    return this.bridge.create(note);
  }

  private async handleUpdate(args: unknown[]): Promise<unknown> {
    this.assertActive();
    requirePermission(this.grant, 'notes:write');
    const id = args[0];
    if (typeof id !== 'string' || id.length === 0) {
      throw new RpcProtocolError('notes.update: id must be a non-empty string');
    }
    const patch = args[1];
    if (!patch || typeof patch !== 'object') {
      throw new RpcProtocolError('notes.update: patch must be an object');
    }
    return this.bridge.update(id, patch as Partial<Extensions.UserNoteDto>);
  }

  private async handleDelete(args: unknown[]): Promise<unknown> {
    this.assertActive();
    requirePermission(this.grant, 'notes:write');
    const id = args[0];
    if (typeof id !== 'string' || id.length === 0) {
      throw new RpcProtocolError('notes.delete: id must be a non-empty string');
    }
    this.bridge.delete(id);
    return undefined;
  }

  private assertActive(): void {
    if (this.disposed) {
      throw new ExtensionNotActiveError(`notesApiImpl for ${this.extensionId} is disposed`);
    }
  }
}
