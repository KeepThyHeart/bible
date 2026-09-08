/**
 * Host-side implementation of `IDictionaryApi` for one extension worker.
 *
 * Read methods: `listModules`, `lookup`, `search`.
 * Provider registration via `registerProvider` lets extensions contribute
 * dictionary modules the host treats like built-in ones.
 *
 * Permission gates:
 *   - Read methods: `dictionary:read`
 *   - `registerProvider`: `dictionary:provide`
 */

import { Extensions } from '@bible/core';

import type { ExtensionRpcRouter } from '../ExtensionRpcRouter';
import {
  type ExtensionPermissionGrant,
  requirePermission,
} from '../ExtensionPermissionGuard';
import type { IExtensionDictionaryBridge } from './IExtensionDataBridges';
import type { ContributionRegistry } from '../ContributionRegistry';
import { RegistrationDisposers } from './registrationDisposers';

const { ExtensionNotActiveError, RpcProtocolError } = Extensions;

type DictionaryProviderDescriptor = Extensions.DictionaryProviderDescriptor;

const MAX_SEARCH_LIMIT = 200;

export interface DictionaryApiImplOptions {
  extensionId: string;
  router: ExtensionRpcRouter;
  bridge: IExtensionDictionaryBridge;
  grant: ExtensionPermissionGrant;
  /** Shared contribution registry. Omit in tests that don't need it. */
  contributionRegistry?: ContributionRegistry;
}

export class DictionaryApiImpl {
  private readonly extensionId: string;
  private readonly router: ExtensionRpcRouter;
  private readonly bridge: IExtensionDictionaryBridge;
  private readonly grant: ExtensionPermissionGrant;
  private readonly contributionRegistry: ContributionRegistry | undefined;
  private readonly registrations = new RegistrationDisposers('provider');
  private disposed = false;

  constructor(opts: DictionaryApiImplOptions) {
    this.extensionId = opts.extensionId;
    this.router = opts.router;
    this.bridge = opts.bridge;
    this.grant = opts.grant;
    this.contributionRegistry = opts.contributionRegistry;
  }

  attach(): void {
    this.router.registerNamespace('dictionary', {
      listModules: () => this.handleListModules(),
      lookup: (args) => this.handleLookup(args),
      search: (args) => this.handleSearch(args),
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
    requirePermission(this.grant, 'dictionary:read');
    return this.bridge.listModules();
  }

  private async handleLookup(args: unknown[]): Promise<unknown> {
    this.assertActive();
    requirePermission(this.grant, 'dictionary:read');
    const moduleId = args[0];
    const key = args[1];
    if (typeof moduleId !== 'string' || moduleId.length === 0) {
      throw new RpcProtocolError('dictionary.lookup: moduleId must be a non-empty string');
    }
    if (typeof key !== 'string' || key.length === 0) {
      throw new RpcProtocolError('dictionary.lookup: key must be a non-empty string');
    }
    return this.bridge.lookup(moduleId, key);
  }

  private async handleSearch(args: unknown[]): Promise<unknown> {
    this.assertActive();
    requirePermission(this.grant, 'dictionary:read');
    const moduleId = args[0];
    const query = args[1];
    if (typeof moduleId !== 'string' || moduleId.length === 0) {
      throw new RpcProtocolError('dictionary.search: moduleId must be a non-empty string');
    }
    if (typeof query !== 'string') {
      throw new RpcProtocolError('dictionary.search: query must be a string');
    }
    let limit: number | undefined;
    const opts = args[2];
    if (opts !== undefined && opts !== null) {
      if (typeof opts !== 'object') {
        throw new RpcProtocolError('dictionary.search: opts must be an object');
      }
      const rawLimit = (opts as Record<string, unknown>).limit;
      if (rawLimit !== undefined) {
        if (typeof rawLimit !== 'number' || !Number.isFinite(rawLimit) || rawLimit <= 0) {
          throw new RpcProtocolError(
            'dictionary.search: opts.limit must be a positive number when provided',
          );
        }
        limit = Math.min(Math.floor(rawLimit), MAX_SEARCH_LIMIT);
      }
    }
    return this.bridge.search(moduleId, query, limit);
  }

  private async handleIterateEntries(args: unknown[]): Promise<unknown> {
    this.assertActive();
    requirePermission(this.grant, 'dictionary:read');
    const raw = args[0];
    if (!raw || typeof raw !== 'object') {
      throw new RpcProtocolError('dictionary.iterateEntries: opts must be an object');
    }
    const opts = raw as Record<string, unknown>;
    if (typeof opts.moduleId !== 'string' || opts.moduleId.length === 0) {
      throw new RpcProtocolError(
        'dictionary.iterateEntries: opts.moduleId must be a non-empty string',
      );
    }
    const keyPrefix = opts.keyPrefix !== undefined
      ? expectString(opts.keyPrefix, 'dictionary.iterateEntries', 'keyPrefix')
      : undefined;
    let pageSize = 100;
    if (opts.pageSize !== undefined) {
      pageSize = expectFiniteNumber(opts.pageSize, 'dictionary.iterateEntries', 'pageSize');
      if (pageSize <= 0) pageSize = 100;
      if (pageSize > 500) pageSize = 500;
    }
    const cursor = opts.cursor !== undefined
      ? expectString(opts.cursor, 'dictionary.iterateEntries', 'cursor')
      : undefined;
    return this.bridge.iterateEntries(opts.moduleId, keyPrefix, pageSize, cursor);
  }

  private async handleRegisterProvider(args: unknown[]): Promise<unknown> {
    this.assertActive();
    requirePermission(this.grant, 'dictionary:provide');

    const raw = args[0];
    if (!raw || typeof raw !== 'object') {
      throw new RpcProtocolError('dictionary.registerProvider: descriptor must be an object');
    }
    const desc = raw as Record<string, unknown>;
    if (typeof desc.id !== 'string' || desc.id.length === 0) {
      throw new RpcProtocolError('dictionary.registerProvider: descriptor.id must be a non-empty string');
    }
    if (typeof desc.fetchEndpoint !== 'string' || desc.fetchEndpoint.length === 0) {
      throw new RpcProtocolError(
        'dictionary.registerProvider: descriptor.fetchEndpoint must be a non-empty string',
      );
    }
    if (!desc.name) {
      throw new RpcProtocolError('dictionary.registerProvider: descriptor.name is required');
    }
    if (typeof desc.abbreviation !== 'string' || desc.abbreviation.length === 0) {
      throw new RpcProtocolError(
        'dictionary.registerProvider: descriptor.abbreviation must be a non-empty string',
      );
    }
    if (!Array.isArray(desc.capabilities)) {
      throw new RpcProtocolError(
        'dictionary.registerProvider: descriptor.capabilities must be an array',
      );
    }

    const providerId = `ext.${this.extensionId}.${desc.id}`;
    const descriptor: DictionaryProviderDescriptor = {
      ...(raw as DictionaryProviderDescriptor),
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
          'dictionaryProvider',
          providerId,
          descriptor,
        )
      : (): void => {};
    const disposalId = this.registrations.add(dispose);

    return { providerId, disposalId };
  }

  private assertActive(): void {
    if (this.disposed) {
      throw new ExtensionNotActiveError(`dictionaryApiImpl for ${this.extensionId} is disposed`);
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
