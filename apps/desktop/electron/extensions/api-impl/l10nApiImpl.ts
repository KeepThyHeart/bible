/**
 * Host-side implementation of `IL10nApi` for one extension worker.
 *
 * Bridges the worker's `api.l10n.t / .currentLocale / .onDidChangeLocale`
 * calls into the renderer's `I18nService` (or any equivalent provider) via
 * the `IExtensionL10nBridge` interface.
 *
 * Catalogs are namespaced under `ext.<extensionId>.`.
 * The api-impl forwards the bare key from the extension; the bridge
 * implementation owns the prefixing so the renderer-side service stays in
 * one place.
 *
 * No permission gate - every extension may resolve its own catalog keys.
 */

import { Extensions } from '@bible/core';

import type { ExtensionRpcRouter } from '../ExtensionRpcRouter';
import type { IExtensionL10nBridge } from './IExtensionDataBridges';

const { ExtensionNotActiveError, RpcProtocolError } = Extensions;

const LOCALE_CHANGE_CHANNEL = 'l10n.onDidChangeLocale';

export interface L10nApiImplOptions {
  extensionId: string;
  router: ExtensionRpcRouter;
  bridge: IExtensionL10nBridge;
}

export class L10nApiImpl {
  private readonly extensionId: string;
  private readonly router: ExtensionRpcRouter;
  private readonly bridge: IExtensionL10nBridge;
  private unsubLocale: (() => void) | undefined;
  private disposed = false;

  constructor(opts: L10nApiImplOptions) {
    this.extensionId = opts.extensionId;
    this.router = opts.router;
    this.bridge = opts.bridge;
  }

  attach(): void {
    this.router.registerNamespace('l10n', {
      t: (args) => this.handleT(args),
      currentLocale: () => this.handleCurrentLocale(),
    });

    this.unsubLocale = this.bridge.subscribeLocaleChange((locale) => {
      if (this.disposed) return;
      this.router.emitEvent(LOCALE_CHANGE_CHANNEL, locale);
    });
  }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    if (this.unsubLocale) {
      try {
        this.unsubLocale();
      } catch {
        /* best-effort */
      }
      this.unsubLocale = undefined;
    }
  }

  private async handleT(args: unknown[]): Promise<string> {
    this.assertActive();
    const key = args[0];
    if (typeof key !== 'string' || key.length === 0) {
      throw new RpcProtocolError('l10n.t: key must be a non-empty string');
    }
    const params = args[1];
    if (params !== undefined && params !== null && typeof params !== 'object') {
      throw new RpcProtocolError('l10n.t: params must be an object when provided');
    }
    return this.bridge.t(
      this.extensionId,
      key,
      (params ?? undefined) as Record<string, unknown> | undefined,
    );
  }

  private async handleCurrentLocale(): Promise<string> {
    this.assertActive();
    return this.bridge.currentLocale();
  }

  private assertActive(): void {
    if (this.disposed) {
      throw new ExtensionNotActiveError(`l10nApiImpl for ${this.extensionId} is disposed`);
    }
  }
}
