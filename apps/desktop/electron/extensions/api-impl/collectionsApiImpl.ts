/**
 * Host-side implementation of `ICollectionsApi` for one extension worker.
 *
 * CRUD plus ordering over the user-data `collection` / `pinned_item` tables,
 * viewed as ordered lists of passages. See `ICollectionsApi` in
 * `ExtensionApiTypes.ts` for why this is a namespace of its own rather than
 * more methods on `IBookmarksApi`.
 *
 * Permission gates: `bookmarks:read` for the reads, `bookmarks:write` for the
 * writes - deliberately the *same* grants `bookmarksApiImpl` uses, because
 * these are the same rows. Minting a `collections:*` pair would have handed an
 * extension the user refused bookmark access a second door into the identical
 * table, which is not a permission boundary, only the appearance of one.
 *
 * Every method validates its arguments before touching the bridge. That is not
 * belt-and-braces: the arguments arrive as an untyped `unknown[]` off the RPC
 * wire, from a QuickJS realm running third-party code, and TypeScript has
 * checked nothing about them. A `position` that arrives as the string `'2'`
 * would sort as a string and scatter the ordering; a `verseIdEnd` below its
 * start would store an inverted range that no range query can ever match.
 */

import { Extensions } from '@bible/core';

import type { ExtensionRpcRouter } from '../ExtensionRpcRouter';
import {
  type ExtensionPermissionGrant,
  requirePermission,
} from '../ExtensionPermissionGuard';
import type { IExtensionCollectionsBridge } from './IExtensionDataBridges';

const { ExtensionNotActiveError, RpcProtocolError } = Extensions;

type LocalizedString = Extensions.LocalizedString;
type NewCollectionOpts = Extensions.NewCollectionOpts;
type NewPassageDto = Extensions.NewPassageDto;

export interface CollectionsApiImplOptions {
  extensionId: string;
  router: ExtensionRpcRouter;
  bridge: IExtensionCollectionsBridge;
  grant: ExtensionPermissionGrant;
}

export class CollectionsApiImpl {
  private readonly extensionId: string;
  private readonly router: ExtensionRpcRouter;
  private readonly bridge: IExtensionCollectionsBridge;
  private readonly grant: ExtensionPermissionGrant;
  private disposed = false;

  constructor(opts: CollectionsApiImplOptions) {
    this.extensionId = opts.extensionId;
    this.router = opts.router;
    this.bridge = opts.bridge;
    this.grant = opts.grant;
  }

  attach(): void {
    this.router.registerNamespace('collections', {
      list: () => this.handleList(),
      create: (args) => this.handleCreate(args),
      rename: (args) => this.handleRename(args),
      delete: (args) => this.handleDelete(args),
      listPassages: (args) => this.handleListPassages(args),
      addPassage: (args) => this.handleAddPassage(args),
      removePassage: (args) => this.handleRemovePassage(args),
      move: (args) => this.handleMove(args),
      reorder: (args) => this.handleReorder(args),
    });
  }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
  }

  // --- RPC handlers ------------------------------------------------------

  private async handleList(): Promise<unknown> {
    this.assertActive();
    requirePermission(this.grant, 'bookmarks:read');
    return this.bridge.listCollections();
  }

  private async handleCreate(args: unknown[]): Promise<unknown> {
    this.assertActive();
    requirePermission(this.grant, 'bookmarks:write');
    const name = assertLocalizedString(args[0], 'collections.create: name');
    const opts = parseNewCollectionOpts(args[1]);
    return opts === undefined
      ? this.bridge.createCollection(name)
      : this.bridge.createCollection(name, opts);
  }

  private async handleRename(args: unknown[]): Promise<unknown> {
    this.assertActive();
    requirePermission(this.grant, 'bookmarks:write');
    const collectionId = assertId(args[0], 'collections.rename: collectionId');
    const name = assertLocalizedString(args[1], 'collections.rename: name');
    return this.bridge.renameCollection(collectionId, name);
  }

  private async handleDelete(args: unknown[]): Promise<unknown> {
    this.assertActive();
    requirePermission(this.grant, 'bookmarks:write');
    const collectionId = assertId(args[0], 'collections.delete: collectionId');
    this.bridge.deleteCollection(collectionId);
    return undefined;
  }

  private async handleListPassages(args: unknown[]): Promise<unknown> {
    this.assertActive();
    requirePermission(this.grant, 'bookmarks:read');
    const collectionId = assertId(args[0], 'collections.listPassages: collectionId');
    return this.bridge.listPassages(collectionId);
  }

  private async handleAddPassage(args: unknown[]): Promise<unknown> {
    this.assertActive();
    requirePermission(this.grant, 'bookmarks:write');
    const collectionId = assertId(args[0], 'collections.addPassage: collectionId');
    return this.bridge.addPassage(collectionId, parseNewPassage(args[1]));
  }

  private async handleRemovePassage(args: unknown[]): Promise<unknown> {
    this.assertActive();
    requirePermission(this.grant, 'bookmarks:write');
    const entryId = assertId(args[0], 'collections.removePassage: entryId');
    this.bridge.removePassage(entryId);
    return undefined;
  }

  private async handleMove(args: unknown[]): Promise<unknown> {
    this.assertActive();
    requirePermission(this.grant, 'bookmarks:write');
    const entryId = assertId(args[0], 'collections.move: entryId');
    const position = args[1];
    // Past-the-end is clamped by the bridge ("move it to the bottom" is a
    // reasonable thing to ask without knowing the length), but a negative or
    // fractional index is a caller bug: clamping 2.5 to 2 would silently
    // succeed at doing something slightly different from what was asked.
    if (!Number.isInteger(position) || (position as number) < 0) {
      throw new RpcProtocolError(
        'collections.move: position must be a non-negative integer',
      );
    }
    return this.bridge.movePassage(entryId, position as number);
  }

  private async handleReorder(args: unknown[]): Promise<unknown> {
    this.assertActive();
    requirePermission(this.grant, 'bookmarks:write');
    const collectionId = assertId(args[0], 'collections.reorder: collectionId');
    const entryIds = args[1];
    if (!Array.isArray(entryIds)) {
      throw new RpcProtocolError('collections.reorder: entryIds must be an array');
    }
    const ids = entryIds.map((id, i) =>
      assertId(id, `collections.reorder: entryIds[${i}]`),
    );
    return this.bridge.reorder(collectionId, ids);
  }

  private assertActive(): void {
    if (this.disposed) {
      throw new ExtensionNotActiveError(
        `collectionsApiImpl for ${this.extensionId} is disposed`,
      );
    }
  }
}

// --- Argument validation ---------------------------------------------------

/**
 * Ids cross the wire as opaque strings. An empty one is rejected rather than
 * passed through because it reads as "no id" to every store and would turn a
 * targeted delete into an unbounded one under a bridge less careful than ours.
 */
function assertId(value: unknown, ctx: string): string {
  if (typeof value !== 'string' || value.length === 0) {
    throw new RpcProtocolError(`${ctx} must be a non-empty string`);
  }
  return value;
}

/**
 * `LocalizedString` is `string | { key, params? }`. The object form is a
 * catalog lookup, so an object without a usable `key` is not a label at all -
 * it would persist and later render as blank.
 */
function assertLocalizedString(value: unknown, ctx: string): LocalizedString {
  if (typeof value === 'string') {
    if (value.length === 0) throw new RpcProtocolError(`${ctx} must not be empty`);
    return value;
  }
  if (value !== null && typeof value === 'object') {
    const key = (value as { key?: unknown }).key;
    if (typeof key === 'string' && key.length > 0) return value as LocalizedString;
  }
  throw new RpcProtocolError(
    `${ctx} must be a non-empty string or a { key } localization object`,
  );
}

function assertOptionalString(value: unknown, ctx: string): string | undefined {
  if (value === undefined || value === null) return undefined;
  if (typeof value !== 'string') throw new RpcProtocolError(`${ctx} must be a string`);
  return value;
}

function parseNewCollectionOpts(value: unknown): NewCollectionOpts | undefined {
  if (value === undefined || value === null) return undefined;
  if (typeof value !== 'object') {
    throw new RpcProtocolError('collections.create: opts must be an object');
  }
  const raw = value as Record<string, unknown>;
  const parentId = assertOptionalString(raw.parentId, 'collections.create: opts.parentId');
  if (parentId !== undefined && parentId.length === 0) {
    throw new RpcProtocolError('collections.create: opts.parentId must not be empty');
  }
  const description = assertOptionalString(
    raw.description,
    'collections.create: opts.description',
  );
  const color = assertOptionalString(raw.color, 'collections.create: opts.color');
  const icon = assertOptionalString(raw.icon, 'collections.create: opts.icon');
  return {
    ...(parentId !== undefined ? { parentId } : {}),
    ...(description !== undefined ? { description } : {}),
    ...(color !== undefined ? { color } : {}),
    ...(icon !== undefined ? { icon } : {}),
  };
}

/**
 * Validate a `NewPassageDto` off the wire.
 *
 * The range checks are the load-bearing ones. `verse_id_end` is inclusive and
 * NOT NULL in the schema, and the codebase has already paid once for treating
 * it loosely: a nullable end made every single-verse row match every range
 * query starting after it, which mis-selected reads and silently deleted
 * out-of-range rows. So an omitted end becomes `start` at the bridge, and an
 * end *below* its start is refused outright - an inverted range is not a
 * narrower selection, it is one that matches nothing and looks like data loss
 * to whoever stored it.
 */
function parseNewPassage(value: unknown): NewPassageDto {
  if (value === null || typeof value !== 'object') {
    throw new RpcProtocolError('collections.addPassage: passage must be an object');
  }
  const raw = value as Record<string, unknown>;

  const verseIdStart = raw.verseIdStart;
  if (typeof verseIdStart !== 'number' || !Number.isFinite(verseIdStart)) {
    throw new RpcProtocolError(
      'collections.addPassage: verseIdStart must be a finite number',
    );
  }

  let verseIdEnd: number | undefined;
  if (raw.verseIdEnd !== undefined && raw.verseIdEnd !== null) {
    if (typeof raw.verseIdEnd !== 'number' || !Number.isFinite(raw.verseIdEnd)) {
      throw new RpcProtocolError(
        'collections.addPassage: verseIdEnd must be a finite number when provided',
      );
    }
    if (raw.verseIdEnd < verseIdStart) {
      throw new RpcProtocolError(
        'collections.addPassage: verseIdEnd must be >= verseIdStart',
      );
    }
    verseIdEnd = raw.verseIdEnd;
  }

  let position: number | undefined;
  if (raw.position !== undefined && raw.position !== null) {
    if (!Number.isInteger(raw.position) || (raw.position as number) < 0) {
      throw new RpcProtocolError(
        'collections.addPassage: position must be a non-negative integer',
      );
    }
    position = raw.position as number;
  }

  const label =
    raw.label === undefined || raw.label === null
      ? undefined
      : assertLocalizedString(raw.label, 'collections.addPassage: label');
  const moduleId = assertOptionalString(
    raw.moduleId,
    'collections.addPassage: moduleId',
  );
  const notes = assertOptionalString(raw.notes, 'collections.addPassage: notes');

  return {
    verseIdStart,
    ...(verseIdEnd !== undefined ? { verseIdEnd } : {}),
    ...(label !== undefined ? { label } : {}),
    ...(moduleId !== undefined ? { moduleId } : {}),
    ...(notes !== undefined ? { notes } : {}),
    ...(position !== undefined ? { position } : {}),
  };
}
