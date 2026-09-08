/**
 * Host-side implementation of `ICommentaryApi` for one extension worker.
 *
 * Read methods: `listModules`, `getEntry`,
 * `getEntriesForRange`. Provider registration via `registerProvider` lets
 * extensions contribute commentary modules the host treats like built-in ones.
 *
 * Permission gates:
 *   - Read methods: `commentary:read`
 *   - `registerProvider`: `commentary:provide`
 */

import { Extensions } from '@bible/core';

import type { ExtensionRpcRouter } from '../ExtensionRpcRouter';
import {
  type ExtensionPermissionGrant,
  requirePermission,
} from '../ExtensionPermissionGuard';
import type { IExtensionCommentaryBridge } from './IExtensionDataBridges';
import type { ContributionRegistry } from '../ContributionRegistry';
import { RegistrationDisposers } from './registrationDisposers';

const { ExtensionNotActiveError, RpcProtocolError } = Extensions;

type CommentaryProviderDescriptor = Extensions.CommentaryProviderDescriptor;

export interface CommentaryApiImplOptions {
  extensionId: string;
  router: ExtensionRpcRouter;
  bridge: IExtensionCommentaryBridge;
  grant: ExtensionPermissionGrant;
  /** Shared contribution registry. Omit in tests that don't need it. */
  contributionRegistry?: ContributionRegistry;
}

export class CommentaryApiImpl {
  private readonly extensionId: string;
  private readonly router: ExtensionRpcRouter;
  private readonly bridge: IExtensionCommentaryBridge;
  private readonly grant: ExtensionPermissionGrant;
  private readonly contributionRegistry: ContributionRegistry | undefined;
  private readonly registrations = new RegistrationDisposers('provider');
  private disposed = false;

  constructor(opts: CommentaryApiImplOptions) {
    this.extensionId = opts.extensionId;
    this.router = opts.router;
    this.bridge = opts.bridge;
    this.grant = opts.grant;
    this.contributionRegistry = opts.contributionRegistry;
  }

  attach(): void {
    this.router.registerNamespace('commentary', {
      listModules: () => this.handleListModules(),
      getEntry: (args) => this.handleGetEntry(args),
      getEntriesForRange: (args) => this.handleGetEntriesForRange(args),
      iterateEntries: (args) => this.handleIterateEntries(args),
      registerProvider: (args) => this.handleRegisterProvider(args),
      dispose: (args) => this.registrations.handleDispose(args),
    });
  }

  dispose(): void {
    this.disposed = true;
    this.registrations.disposeAll();
  }

  private async handleListModules(): Promise<unknown> {
    this.assertActive();
    requirePermission(this.grant, 'commentary:read');
    return this.bridge.listModules();
  }

  private async handleGetEntry(args: unknown[]): Promise<unknown> {
    this.assertActive();
    requirePermission(this.grant, 'commentary:read');
    const moduleId = args[0];
    const verseId = args[1];
    if (typeof moduleId !== 'string' || moduleId.length === 0) {
      throw new RpcProtocolError('commentary.getEntry: moduleId must be a non-empty string');
    }
    if (typeof verseId !== 'number' || !Number.isFinite(verseId)) {
      throw new RpcProtocolError('commentary.getEntry: verseId must be a finite number');
    }
    return this.bridge.getEntry(moduleId, verseId);
  }

  private async handleGetEntriesForRange(args: unknown[]): Promise<unknown> {
    this.assertActive();
    requirePermission(this.grant, 'commentary:read');
    const moduleId = args[0];
    const start = args[1];
    const end = args[2];
    if (typeof moduleId !== 'string' || moduleId.length === 0) {
      throw new RpcProtocolError(
        'commentary.getEntriesForRange: moduleId must be a non-empty string',
      );
    }
    if (
      typeof start !== 'number' ||
      typeof end !== 'number' ||
      !Number.isFinite(start) ||
      !Number.isFinite(end)
    ) {
      throw new RpcProtocolError(
        'commentary.getEntriesForRange: startVerseId and endVerseId must be finite numbers',
      );
    }
    if (end < start) {
      throw new RpcProtocolError('commentary.getEntriesForRange: end must be >= start');
    }
    return this.bridge.getEntriesForRange(moduleId, start, end);
  }

  private async handleIterateEntries(args: unknown[]): Promise<unknown> {
    this.assertActive();
    requirePermission(this.grant, 'commentary:read');
    const raw = args[0];
    if (!raw || typeof raw !== 'object') {
      throw new RpcProtocolError('commentary.iterateEntries: opts must be an object');
    }
    const opts = raw as Record<string, unknown>;
    if (typeof opts.moduleId !== 'string' || opts.moduleId.length === 0) {
      throw new RpcProtocolError(
        'commentary.iterateEntries: opts.moduleId must be a non-empty string',
      );
    }
    const startVerseId = opts.startVerseId !== undefined
      ? expectFiniteNumber(opts.startVerseId, 'commentary.iterateEntries', 'startVerseId')
      : undefined;
    const endVerseId = opts.endVerseId !== undefined
      ? expectFiniteNumber(opts.endVerseId, 'commentary.iterateEntries', 'endVerseId')
      : undefined;
    let pageSize = 50;
    if (opts.pageSize !== undefined) {
      pageSize = expectFiniteNumber(opts.pageSize, 'commentary.iterateEntries', 'pageSize');
      if (pageSize <= 0) pageSize = 50;
      if (pageSize > 500) pageSize = 500;
    }
    const cursor = opts.cursor !== undefined
      ? expectString(opts.cursor, 'commentary.iterateEntries', 'cursor')
      : undefined;
    return this.bridge.iterateEntries(opts.moduleId, startVerseId, endVerseId, pageSize, cursor);
  }

  private async handleRegisterProvider(args: unknown[]): Promise<unknown> {
    this.assertActive();
    requirePermission(this.grant, 'commentary:provide');

    const raw = args[0];
    if (!raw || typeof raw !== 'object') {
      throw new RpcProtocolError('commentary.registerProvider: descriptor must be an object');
    }
    const desc = raw as Record<string, unknown>;
    if (typeof desc.id !== 'string' || desc.id.length === 0) {
      throw new RpcProtocolError('commentary.registerProvider: descriptor.id must be a non-empty string');
    }
    if (typeof desc.fetchEndpoint !== 'string' || desc.fetchEndpoint.length === 0) {
      throw new RpcProtocolError(
        'commentary.registerProvider: descriptor.fetchEndpoint must be a non-empty string',
      );
    }
    if (!desc.name) {
      throw new RpcProtocolError('commentary.registerProvider: descriptor.name is required');
    }
    if (typeof desc.abbreviation !== 'string' || desc.abbreviation.length === 0) {
      throw new RpcProtocolError(
        'commentary.registerProvider: descriptor.abbreviation must be a non-empty string',
      );
    }
    if (!Array.isArray(desc.capabilities)) {
      throw new RpcProtocolError(
        'commentary.registerProvider: descriptor.capabilities must be an array',
      );
    }

    // Namespace the provider ID under the extension.
    const providerId = `ext.${this.extensionId}.${desc.id}`;
    const descriptor: CommentaryProviderDescriptor = {
      ...(raw as CommentaryProviderDescriptor),
      id: providerId,
    };

    // A disposalId is minted even without a contribution registry (which only
    // happens in unit tests that omit it): the declared return type is
    // `DisposableHandle`, and a handle that is a no-op is still a handle. The
    // alternative - omitting it - would make `dispose()` exist or not exist
    // depending on host wiring the extension cannot see.
    const dispose = this.contributionRegistry
      ? this.contributionRegistry.register(
          this.extensionId,
          'commentaryProvider',
          providerId,
          descriptor,
        )
      : (): void => {};
    const disposalId = this.registrations.add(dispose);

    // `providerId` is kept alongside `disposalId` so the worker can still
    // reference the namespaced id; the guest proxy adds `dispose()` on top of
    // whatever else the result carries.
    return { providerId, disposalId };
  }

  private assertActive(): void {
    if (this.disposed) {
      throw new ExtensionNotActiveError(`commentaryApiImpl for ${this.extensionId} is disposed`);
    }
  }
}

function expectFiniteNumber(val: unknown, method: string, field: string): number {
  if (typeof val !== 'number' || !Number.isFinite(val)) {
    throw new RpcProtocolError(`${method}: ${field} must be a finite number`);
  }
  return val;
}

function expectString(val: unknown, method: string, field: string): string {
  if (typeof val !== 'string') {
    throw new RpcProtocolError(`${method}: ${field} must be a string`);
  }
  return val;
}
