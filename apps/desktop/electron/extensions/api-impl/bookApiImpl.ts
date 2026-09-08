/**
 * Host-side implementation of `IBookApi` for one extension worker.
 *
 * Read methods: `listModules`, `getSection`,
 * `listSections`. Provider registration via `registerProvider` lets
 * extensions contribute book modules the host treats like built-in ones.
 *
 * Permission gates:
 *   - Read methods: `book:read`
 *   - `registerProvider`: `book:provide`
 */

import { Extensions } from '@bible/core';

import type { ExtensionRpcRouter } from '../ExtensionRpcRouter';
import {
  type ExtensionPermissionGrant,
  requirePermission,
} from '../ExtensionPermissionGuard';
import type { IExtensionBookBridge } from './IExtensionDataBridges';
import type { ContributionRegistry } from '../ContributionRegistry';
import { RegistrationDisposers } from './registrationDisposers';

const { ExtensionNotActiveError, RpcProtocolError } = Extensions;

type BookProviderDescriptor = Extensions.BookProviderDescriptor;

export interface BookApiImplOptions {
  extensionId: string;
  router: ExtensionRpcRouter;
  bridge: IExtensionBookBridge;
  grant: ExtensionPermissionGrant;
  /** Shared contribution registry. Omit in tests that don't need it. */
  contributionRegistry?: ContributionRegistry;
}

export class BookApiImpl {
  private readonly extensionId: string;
  private readonly router: ExtensionRpcRouter;
  private readonly bridge: IExtensionBookBridge;
  private readonly grant: ExtensionPermissionGrant;
  private readonly contributionRegistry: ContributionRegistry | undefined;
  private readonly registrations = new RegistrationDisposers('provider');
  private disposed = false;

  constructor(opts: BookApiImplOptions) {
    this.extensionId = opts.extensionId;
    this.router = opts.router;
    this.bridge = opts.bridge;
    this.grant = opts.grant;
    this.contributionRegistry = opts.contributionRegistry;
  }

  attach(): void {
    this.router.registerNamespace('book', {
      listModules: () => this.handleListModules(),
      getSection: (args) => this.handleGetSection(args),
      listSections: (args) => this.handleListSections(args),
      iterateSections: (args) => this.handleIterateSections(args),
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
    requirePermission(this.grant, 'book:read');
    return this.bridge.listModules();
  }

  private async handleGetSection(args: unknown[]): Promise<unknown> {
    this.assertActive();
    requirePermission(this.grant, 'book:read');
    const moduleId = args[0];
    const sectionId = args[1];
    if (typeof moduleId !== 'string' || moduleId.length === 0) {
      throw new RpcProtocolError('book.getSection: moduleId must be a non-empty string');
    }
    if (typeof sectionId !== 'string' || sectionId.length === 0) {
      throw new RpcProtocolError('book.getSection: sectionId must be a non-empty string');
    }
    return this.bridge.getSection(moduleId, sectionId);
  }

  private async handleListSections(args: unknown[]): Promise<unknown> {
    this.assertActive();
    requirePermission(this.grant, 'book:read');
    const moduleId = args[0];
    if (typeof moduleId !== 'string' || moduleId.length === 0) {
      throw new RpcProtocolError('book.listSections: moduleId must be a non-empty string');
    }
    const parentId = args[1];
    if (parentId !== undefined && typeof parentId !== 'string') {
      throw new RpcProtocolError(
        'book.listSections: parentId must be a string when provided',
      );
    }
    return this.bridge.listSections(moduleId, parentId);
  }

  private async handleIterateSections(args: unknown[]): Promise<unknown> {
    this.assertActive();
    requirePermission(this.grant, 'book:read');
    const raw = args[0];
    if (!raw || typeof raw !== 'object') {
      throw new RpcProtocolError('book.iterateSections: opts must be an object');
    }
    const opts = raw as Record<string, unknown>;
    if (typeof opts.moduleId !== 'string' || opts.moduleId.length === 0) {
      throw new RpcProtocolError(
        'book.iterateSections: opts.moduleId must be a non-empty string',
      );
    }
    const rootSectionId = opts.rootSectionId !== undefined
      ? expectString(opts.rootSectionId, 'book.iterateSections', 'rootSectionId')
      : undefined;
    let pageSize = 100;
    if (opts.pageSize !== undefined) {
      pageSize = expectFiniteNumber(opts.pageSize, 'book.iterateSections', 'pageSize');
      if (pageSize <= 0) pageSize = 100;
      if (pageSize > 500) pageSize = 500;
    }
    const cursor = opts.cursor !== undefined
      ? expectString(opts.cursor, 'book.iterateSections', 'cursor')
      : undefined;
    return this.bridge.iterateSections(opts.moduleId, rootSectionId, pageSize, cursor);
  }

  private async handleRegisterProvider(args: unknown[]): Promise<unknown> {
    this.assertActive();
    requirePermission(this.grant, 'book:provide');

    const raw = args[0];
    if (!raw || typeof raw !== 'object') {
      throw new RpcProtocolError('book.registerProvider: descriptor must be an object');
    }
    const desc = raw as Record<string, unknown>;
    if (typeof desc.id !== 'string' || desc.id.length === 0) {
      throw new RpcProtocolError('book.registerProvider: descriptor.id must be a non-empty string');
    }
    if (typeof desc.fetchEndpoint !== 'string' || desc.fetchEndpoint.length === 0) {
      throw new RpcProtocolError(
        'book.registerProvider: descriptor.fetchEndpoint must be a non-empty string',
      );
    }
    if (!desc.name) {
      throw new RpcProtocolError('book.registerProvider: descriptor.name is required');
    }
    if (typeof desc.abbreviation !== 'string' || desc.abbreviation.length === 0) {
      throw new RpcProtocolError(
        'book.registerProvider: descriptor.abbreviation must be a non-empty string',
      );
    }
    if (!Array.isArray(desc.capabilities)) {
      throw new RpcProtocolError(
        'book.registerProvider: descriptor.capabilities must be an array',
      );
    }

    const providerId = `ext.${this.extensionId}.${desc.id}`;
    const descriptor: BookProviderDescriptor = {
      ...(raw as BookProviderDescriptor),
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
          'bookProvider',
          providerId,
          descriptor,
        )
      : (): void => {};
    const disposalId = this.registrations.add(dispose);

    return { providerId, disposalId };
  }

  private assertActive(): void {
    if (this.disposed) {
      throw new ExtensionNotActiveError(`bookApiImpl for ${this.extensionId} is disposed`);
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
