/**
 * Host-side implementation of `IBibleApi` for one extension worker.
 *
 * Read methods: `getVerse`, `getRange`, `listModules`, `listBooks`,
 * `parseReference`, `onDidChangeActiveVerse`.
 *
 * Iteration and token methods: `iterateVerses` (cursor-based),
 * `getVerseTokens` (interlinear token data), `onDidSelectVerseWord` (word
 * selection event).
 *
 * Permission gate: every method requires `bible:read`. The permission is
 * default-granted (see `DEFAULT_GRANTED_PERMISSIONS`) so any installed
 * extension can call these methods without an explicit consent step.
 */

import { Extensions } from '@bible/core';

import type { ExtensionRpcRouter } from '../ExtensionRpcRouter';
import {
  type ExtensionPermissionGrant,
  requirePermission,
} from '../ExtensionPermissionGuard';
import type { IExtensionBibleBridge } from './IExtensionDataBridges';
import type { ContributionRegistry } from '../ContributionRegistry';
import { RegistrationDisposers } from './registrationDisposers';

const { ExtensionNotActiveError, RpcProtocolError } = Extensions;

type BibleProviderDescriptor = Extensions.BibleProviderDescriptor;

const ACTIVE_VERSE_CHANNEL = 'bible.onDidChangeActiveVerse';
const WORD_SELECTION_CHANNEL = 'bible.onDidSelectVerseWord';

/** Maximum verses returned by a single `getRange` call. */
const MAX_RANGE_SIZE = 500;

/** Iteration page size limits for `iterateVerses`. */
const DEFAULT_ITERATE_PAGE_SIZE = 200;
const MAX_ITERATE_PAGE_SIZE = 1000;

export interface BibleApiImplOptions {
  extensionId: string;
  router: ExtensionRpcRouter;
  bridge: IExtensionBibleBridge;
  grant: ExtensionPermissionGrant;
  /** Shared contribution registry. Omit in tests that don't need it. */
  contributionRegistry?: ContributionRegistry;
}

export class BibleApiImpl {
  private readonly extensionId: string;
  private readonly router: ExtensionRpcRouter;
  private readonly bridge: IExtensionBibleBridge;
  private readonly grant: ExtensionPermissionGrant;
  private readonly contributionRegistry: ContributionRegistry | undefined;
  private readonly registrations = new RegistrationDisposers('provider');
  private unsubscribeActiveVerse: (() => void) | undefined;
  private unsubscribeWordSelection: (() => void) | undefined;
  private disposed = false;

  constructor(opts: BibleApiImplOptions) {
    this.extensionId = opts.extensionId;
    this.router = opts.router;
    this.bridge = opts.bridge;
    this.grant = opts.grant;
    this.contributionRegistry = opts.contributionRegistry;
  }

  attach(): void {
    this.router.registerNamespace('bible', {
      getVerse: (args) => this.handleGetVerse(args),
      getRange: (args) => this.handleGetRange(args),
      listModules: () => this.handleListModules(),
      listBooks: (args) => this.handleListBooks(args),
      parseReference: (args) => this.handleParseReference(args),
      iterateVerses: (args) => this.handleIterateVerses(args),
      getVerseTokens: (args) => this.handleGetVerseTokens(args),
      navigateToVerse: (args) => this.handleNavigateToVerse(args),
      registerProvider: (args) => this.handleRegisterProvider(args),
      dispose: (args) => this.registrations.handleDispose(args),
    });

    // Wire the active-verse forward channel. The bridge calls our handler
    // every time the user navigates anywhere in the app; we forward the
    // payload to the worker via the router. The router only emits if the
    // worker has actually subscribed, so this is cheap when no one cares.
    this.unsubscribeActiveVerse = this.bridge.subscribeActiveVerse((payload) => {
      if (this.disposed) return;
      this.router.emitEvent(ACTIVE_VERSE_CHANNEL, payload);
    });

    // Wire the word-selection forward channel.
    this.unsubscribeWordSelection = this.bridge.subscribeWordSelection((payload) => {
      if (this.disposed) return;
      this.router.emitEvent(WORD_SELECTION_CHANNEL, payload);
    });
  }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    this.registrations.disposeAll();
    if (this.unsubscribeActiveVerse) {
      try {
        this.unsubscribeActiveVerse();
      } catch {
        /* best-effort */
      }
      this.unsubscribeActiveVerse = undefined;
    }
    if (this.unsubscribeWordSelection) {
      try {
        this.unsubscribeWordSelection();
      } catch {
        /* best-effort */
      }
      this.unsubscribeWordSelection = undefined;
    }
  }

  // --- RPC handlers ------------------------------------------------------

  private async handleGetVerse(args: unknown[]): Promise<unknown> {
    this.assertActive();
    requirePermission(this.grant, 'bible:read');
    const verseId = args[0];
    if (typeof verseId !== 'number' || !Number.isFinite(verseId)) {
      throw new RpcProtocolError('bible.getVerse: verseId must be a finite number');
    }
    const moduleId = readOptionalModule(args[1], 'bible.getVerse');
    return this.bridge.getVerse(verseId, moduleId);
  }

  private async handleGetRange(args: unknown[]): Promise<unknown> {
    this.assertActive();
    requirePermission(this.grant, 'bible:read');
    const start = args[0];
    const end = args[1];
    if (
      typeof start !== 'number' ||
      typeof end !== 'number' ||
      !Number.isFinite(start) ||
      !Number.isFinite(end)
    ) {
      throw new RpcProtocolError('bible.getRange: start and end must be finite numbers');
    }
    if (end < start) {
      throw new RpcProtocolError('bible.getRange: end must be >= start');
    }
    if (end - start + 1 > MAX_RANGE_SIZE) {
      throw new RpcProtocolError(
        `bible.getRange: range size exceeds the ${MAX_RANGE_SIZE}-verse maximum`,
      );
    }
    const moduleId = readOptionalModule(args[2], 'bible.getRange');
    return this.bridge.getRange(start, end, moduleId);
  }

  private async handleListModules(): Promise<unknown> {
    this.assertActive();
    requirePermission(this.grant, 'bible:read');
    return this.bridge.listModules();
  }

  private async handleListBooks(args: unknown[]): Promise<unknown> {
    this.assertActive();
    requirePermission(this.grant, 'bible:read');
    const moduleId = args[0];
    if (moduleId !== undefined && typeof moduleId !== 'string') {
      throw new RpcProtocolError('bible.listBooks: moduleId must be a string when provided');
    }
    return this.bridge.listBooks(moduleId);
  }

  private async handleParseReference(args: unknown[]): Promise<unknown> {
    this.assertActive();
    requirePermission(this.grant, 'bible:read');
    const input = args[0];
    if (typeof input !== 'string' || input.length === 0) {
      throw new RpcProtocolError('bible.parseReference: input must be a non-empty string');
    }
    const locale = args[1];
    if (locale !== undefined && typeof locale !== 'string') {
      throw new RpcProtocolError('bible.parseReference: locale must be a string when provided');
    }
    return this.bridge.parseReference(input, locale);
  }

  private async handleIterateVerses(args: unknown[]): Promise<unknown> {
    this.assertActive();
    requirePermission(this.grant, 'bible:read');
    const raw = args[0];
    if (!raw || typeof raw !== 'object') {
      throw new RpcProtocolError('bible.iterateVerses: opts must be an object');
    }
    const opts = raw as Record<string, unknown>;
    if (typeof opts.module !== 'string' || opts.module.length === 0) {
      throw new RpcProtocolError('bible.iterateVerses: opts.module must be a non-empty string');
    }
    const startVerseId = opts.startVerseId !== undefined ? expectFiniteNumber(opts.startVerseId, 'bible.iterateVerses', 'startVerseId') : undefined;
    const endVerseId = opts.endVerseId !== undefined ? expectFiniteNumber(opts.endVerseId, 'bible.iterateVerses', 'endVerseId') : undefined;
    let pageSize = DEFAULT_ITERATE_PAGE_SIZE;
    if (opts.pageSize !== undefined) {
      pageSize = expectFiniteNumber(opts.pageSize, 'bible.iterateVerses', 'pageSize');
      if (pageSize <= 0) pageSize = DEFAULT_ITERATE_PAGE_SIZE;
      if (pageSize > MAX_ITERATE_PAGE_SIZE) pageSize = MAX_ITERATE_PAGE_SIZE;
    }
    const cursor = opts.cursor !== undefined ? expectString(opts.cursor, 'bible.iterateVerses', 'cursor') : undefined;
    return this.bridge.iterateVerses(opts.module, startVerseId, endVerseId, pageSize, cursor);
  }

  private async handleGetVerseTokens(args: unknown[]): Promise<unknown> {
    this.assertActive();
    requirePermission(this.grant, 'bible:read');
    const verseId = args[0];
    if (typeof verseId !== 'number' || !Number.isFinite(verseId)) {
      throw new RpcProtocolError('bible.getVerseTokens: verseId must be a finite number');
    }
    const moduleId = readOptionalModule(args[1], 'bible.getVerseTokens');
    return this.bridge.getVerseTokens(verseId, moduleId);
  }

  private async handleNavigateToVerse(args: unknown[]): Promise<unknown> {
    this.assertActive();
    requirePermission(this.grant, 'bible:read');
    const verseId = args[0];
    if (typeof verseId !== 'number' || !Number.isFinite(verseId)) {
      throw new RpcProtocolError('bible.navigateToVerse: verseId must be a finite number');
    }
    await this.bridge.navigateToVerse(verseId);
    return null;
  }

  private async handleRegisterProvider(args: unknown[]): Promise<unknown> {
    this.assertActive();
    requirePermission(this.grant, 'bible:provide');

    const raw = args[0];
    if (!raw || typeof raw !== 'object') {
      throw new RpcProtocolError('bible.registerProvider: descriptor must be an object');
    }
    const desc = raw as Record<string, unknown>;
    if (typeof desc.id !== 'string' || desc.id.length === 0) {
      throw new RpcProtocolError('bible.registerProvider: descriptor.id must be a non-empty string');
    }
    if (typeof desc.fetchEndpoint !== 'string' || desc.fetchEndpoint.length === 0) {
      throw new RpcProtocolError(
        'bible.registerProvider: descriptor.fetchEndpoint must be a non-empty string',
      );
    }
    if (!desc.name) {
      throw new RpcProtocolError('bible.registerProvider: descriptor.name is required');
    }
    if (typeof desc.abbreviation !== 'string' || desc.abbreviation.length === 0) {
      throw new RpcProtocolError(
        'bible.registerProvider: descriptor.abbreviation must be a non-empty string',
      );
    }
    if (!Array.isArray(desc.capabilities)) {
      throw new RpcProtocolError(
        'bible.registerProvider: descriptor.capabilities must be an array',
      );
    }

    const providerId = `ext.${this.extensionId}.${desc.id}`;
    const descriptor: BibleProviderDescriptor = {
      ...(raw as BibleProviderDescriptor),
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
          'bibleProvider',
          providerId,
          descriptor,
        )
      : (): void => {};
    const disposalId = this.registrations.add(dispose);

    return { providerId, disposalId };
  }

  private assertActive(): void {
    if (this.disposed) {
      throw new ExtensionNotActiveError(`bibleApiImpl for ${this.extensionId} is disposed`);
    }
  }
}

function expectFiniteNumber(val: unknown, method: string, field: string): number {
  if (typeof val !== 'number' || !Number.isFinite(val)) {
    throw new Extensions.RpcProtocolError(`${method}: ${field} must be a finite number`);
  }
  return val;
}

function expectString(val: unknown, method: string, field: string): string {
  if (typeof val !== 'string') {
    throw new Extensions.RpcProtocolError(`${method}: ${field} must be a string`);
  }
  return val;
}

function readOptionalModule(raw: unknown, methodName: string): string | undefined {
  if (raw === undefined || raw === null) return undefined;
  if (typeof raw !== 'object') {
    throw new Extensions.RpcProtocolError(`${methodName}: opts must be an object`);
  }
  const opts = raw as Record<string, unknown>;
  if (opts.module === undefined) return undefined;
  if (typeof opts.module !== 'string') {
    throw new Extensions.RpcProtocolError(`${methodName}: opts.module must be a string`);
  }
  return opts.module;
}
