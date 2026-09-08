/**
 * ExtensionHost - main-process orchestrator. Thin facade that composes the
 * subsystem modules in
 * `electron/extensions/ExtensionHost*.ts`: Discovery, Installer, Permissions,
 * Lifecycle, and Rpc. Shared state lives on `ExtensionHostContext`; each
 * public method delegates to the matching helper.
 */

import { existsSync, mkdirSync } from 'fs';
import { join } from 'path';
import log from 'electron-log';

import { Extensions } from '@bible/core';

type ExtensionCrashRecord = Extensions.ExtensionCrashRecord;
type ExtensionLogEntry = Extensions.ExtensionLogEntry;
type ExtensionPermission = Extensions.ExtensionPermission;
type ExtensionPointId = Extensions.ExtensionPointId;
type ExtensionStateInfo = Extensions.ExtensionStateInfo;
type IExtensionHost = Extensions.IExtensionHost;
type InstallError = Extensions.InstallError;
type InstallResult = Extensions.InstallResult;

import { initializeExtensionSchema } from './extensionSchema';
import { ExtensionRegistry } from './ExtensionRegistry';
import { ExtensionLifecycleLogger } from './ExtensionLifecycleLogger';
import { ContributionRegistry } from './ContributionRegistry';
import { SingleActiveProviderRegistry } from './SingleActiveProviderRegistry';

import type {
  ConsentPrompter,
  ExtensionHostContext,
  ExtensionHostOptions,
} from './ExtensionHostTypes';
import {
  loadAll as discoveryLoadAll,
  listExtensions as discoveryListExtensions,
  getExtension as discoveryGetExtension,
} from './ExtensionHostDiscovery';
import {
  installExtension as installerInstall,
  installExtensionFromZip as installerInstallFromZip,
  uninstallExtension as installerUninstall,
  enableExtension as installerEnable,
  disableExtension as installerDisable,
  resetCrashState as installerResetCrashState,
} from './ExtensionHostInstaller';
import {
  updatePermissions as permissionsUpdate,
  getSettings as permissionsGetSettings,
  setSettings as permissionsSetSettings,
} from './ExtensionHostPermissions';
import {
  loadUnpackedExtension as devLoadUnpacked,
  reloadUnpackedExtension as devReloadUnpacked,
  startDevWatches as devStartWatches,
} from './ExtensionHostDevMode';
import { ExtensionDevWatcher } from './ExtensionDevWatcher';
import {
  activate as lifecycleActivate,
  deactivate as lifecycleDeactivate,
  fireActivationEvent as lifecycleFireActivationEvent,
  dispatchExtensionPoint as lifecycleDispatchExtensionPoint,
} from './ExtensionHostLifecycle';

// Re-exports so existing callers (`main.ts`, `RendererConsentPrompter.ts`,
// tests) continue to import these names from `./ExtensionHost`.
export { MethodNotImplementedYet } from './ExtensionHostTypes';
export type { ConsentPrompter, ExtensionHostOptions } from './ExtensionHostTypes';

export class ExtensionHost implements IExtensionHost {
  /**
   * Internal state shared with every subsystem helper. Declared as a private
   * field (not `readonly`) because `consentPrompter` is rewriteable after
   * construction via `setConsentPrompter`. Individual fields on the context
   * are otherwise stable for the lifetime of the host.
   */
  private readonly ctx: ExtensionHostContext;

  constructor(opts: ExtensionHostOptions) {
    // Default worker script: the bundled extension-runtime entry sits next to
    // the main bundle (`out/main/extension-runtime/index.js`) - see the
    // electron-vite config.
    this.ctx = {
      db: opts.db,
      extensionsRoot: opts.extensionsRoot,
      registry: new ExtensionRegistry(opts.db),
      logger: new ExtensionLifecycleLogger(opts.extensionsRoot),
      workerFactory: opts.workerFactory,
      workerScriptPath:
        opts.workerScriptPath ?? join(__dirname, 'extension-runtime', 'index.js'),
      workerHeartbeatIntervalMs: opts.workerHeartbeatIntervalMs,
      crashThreshold: opts.crashThreshold ?? 3,
      activeWorkers: new Map(),
      commandBridge: opts.commandBridge,
      contextBridge: opts.contextBridge,
      bibleBridge: opts.bibleBridge,
      commentaryBridge: opts.commentaryBridge,
      dictionaryBridge: opts.dictionaryBridge,
      bookBridge: opts.bookBridge,
      uiBridge: opts.uiBridge,
      workspaceBridge: opts.workspaceBridge,
      l10nBridge: opts.l10nBridge,
      notesBridge: opts.notesBridge,
      highlightsBridge: opts.highlightsBridge,
      bookmarksBridge: opts.bookmarksBridge,
      folderBridge: opts.folderBridge,
      storageQuotaBytes: opts.storageQuotaBytes,
      secretsKeychain: opts.secretsKeychain,
      extensionDatabaseRegistry: opts.extensionDatabaseRegistry,
      networkGatewayFactory: opts.networkGatewayFactory,
      authBrokerFactory: opts.authBrokerFactory,
      externalUrlOpener: opts.externalUrlOpener,
      networkThrottleRequestsPerMinute: opts.networkThrottleRequestsPerMinute,
      networkBandwidthBytesPerMinute: opts.networkBandwidthBytesPerMinute,
      taskStatusBridge: opts.taskStatusBridge,
      taskNotifier: opts.taskNotifier,
      taskDisposeDrainMs: opts.taskDisposeDrainMs,
      blocklist: opts.blocklist,
      contributionRegistry:
        opts.contributionRegistry ?? new ContributionRegistry(),
      singleActiveProviderRegistry:
        opts.singleActiveProviderRegistry ??
        new SingleActiveProviderRegistry(opts.providerPreferencePersistence),
      consentPrompter: opts.consentPrompter,
      devConfig: opts.devConfig,
      // The watcher is only built when a config exists to gate it. A host with
      // no Developer Mode has nothing to watch, and creating watchers it will
      // never use would leave fs handles open in every test.
      devWatcher:
        opts.devConfig === undefined
          ? undefined
          : new ExtensionDevWatcher({
              onChange: (id) => {
                void this.reloadUnpacked(id);
              },
              ...(opts.devWatchDebounceMs !== undefined
                ? { debounceMs: opts.devWatchDebounceMs }
                : {}),
            }),
      activate: (id) => this.activate(id),
      deactivate: (id) => this.deactivate(id),
      isActive: (id) => this.isActive(id),
    };

    initializeExtensionSchema(this.ctx.db);
    // The extensions root is not always writable. `main.ts` currently derives
    // it from `getDataPath()`, which in a packaged app is
    // `process.resourcesPath/data` - writable under the current Windows NSIS
    // config (perMachine: false) but READ-ONLY inside a Linux AppImage mount
    // and inside a signed macOS .app. Throwing here would take the entire
    // extension subsystem down: the throw escapes the constructor and
    // `initializeExtensionHostInBackground()` swallows it, so the host simply
    // never exists and nothing says why.
    //
    // Degrade instead: a host with an unwritable root can still enumerate and
    // run extensions that are already present; only installs and log writes
    // fail, and those report their own errors. See "Known issue - extensions
    // root is not user-writable when packaged" in
    // `packages/core/src/Extensions/README.md`; the durable fix is to root
    // extensions at `app.getPath('userData')` (i.e. `getUserDataPath()`).
    try {
      if (!existsSync(this.ctx.extensionsRoot)) {
        mkdirSync(this.ctx.extensionsRoot, { recursive: true });
      }
    } catch (err) {
      log.warn(
        `[ExtensionHost] could not create extensions root ${this.ctx.extensionsRoot} — ` +
          'installs and per-extension logs will fail (read-only location?):',
        err,
      );
    }
  }

  /** Wire the consent prompter after construction (e.g. once the window exists). */
  setConsentPrompter(prompter: ConsentPrompter): void {
    this.ctx.consentPrompter = prompter;
  }

  /** Public accessor for the contribution registry. */
  getContributionRegistry(): ContributionRegistry {
    return this.ctx.contributionRegistry;
  }

  /** Public accessor for the single-active provider registry. */
  getSingleActiveProviderRegistry(): SingleActiveProviderRegistry {
    return this.ctx.singleActiveProviderRegistry;
  }

  /**
   * The host context, for the catalog install path.
   *
   * `installExtensionFromCatalog` needs the same context the sideload
   * installers take (registry, extensions root, logger, consent prompter) and
   * lives outside this class so the download/verify step stays separable from
   * host lifecycle. Deliberately narrow in name: this is not a general escape
   * hatch, and nothing else should reach for it.
   */
  getContextForMarketplace(): ExtensionHostContext {
    return this.ctx;
  }

  // --- Discovery ----------------------------------------------------------

  async loadAll(): Promise<void> {
    await discoveryLoadAll(this.ctx);
    // Watches are established after discovery, not during it: a dev extension
    // registered in a previous session is only known once its row has been
    // reconciled with disk.
    devStartWatches(this.ctx);
  }

  listExtensions(): Promise<ExtensionStateInfo[]> {
    return discoveryListExtensions(this.ctx);
  }

  getExtension(extensionId: string): Promise<ExtensionStateInfo | null> {
    return discoveryGetExtension(this.ctx, extensionId);
  }

  // --- Install / uninstall / enable / disable -----------------------------

  installExtension(opts: {
    sourcePath: string;
    consent?: { grantedPermissions: ExtensionPermission[] };
    activateNow?: boolean;
  }): Promise<InstallResult | InstallError> {
    return installerInstall(this.ctx, opts);
  }

  installExtensionFromZip(opts: {
    zipPath: string;
    consent?: { grantedPermissions: ExtensionPermission[] };
    activateNow?: boolean;
  }): Promise<InstallResult | InstallError> {
    return installerInstallFromZip(this.ctx, opts);
  }

  // --- Developer Mode -----------------------------------------------------

  /** True when unpacked loading is enabled for this install. */
  isDeveloperMode(): boolean {
    return this.ctx.devConfig?.isDeveloperMode() ?? false;
  }

  /**
   * Turn Developer Mode on or off. Turning it off stops every dev watch
   * immediately - leaving watchers running against a mode the user just
   * switched off would be a surprising amount of background behaviour.
   * Already-loaded unpacked extensions keep working; they just stop
   * auto-reloading until it is switched back on.
   */
  setDeveloperMode(enabled: boolean): void {
    this.ctx.devConfig?.setDeveloperMode(enabled);
    if (enabled) {
      devStartWatches(this.ctx);
    } else {
      this.ctx.devWatcher?.dispose();
    }
  }

  /** Register a directory as an unpacked extension. Requires Developer Mode. */
  loadUnpacked(opts: {
    sourcePath: string;
    consent?: { grantedPermissions: ExtensionPermission[] };
  }): Promise<InstallResult | InstallError> {
    return devLoadUnpacked(this.ctx, opts);
  }

  /** Re-read an unpacked extension from disk, restarting it if it was running. */
  reloadUnpacked(extensionId: string): Promise<InstallResult | InstallError> {
    return devReloadUnpacked(this.ctx, extensionId);
  }

  uninstallExtension(extensionId: string): Promise<void> {
    // Drop the watch before the row goes: a debounced reload that fires after
    // removal would otherwise re-register the extension from disk.
    this.ctx.devWatcher?.unwatchExtension(extensionId);
    return installerUninstall(this.ctx, extensionId);
  }

  enable(extensionId: string): Promise<void> {
    return installerEnable(this.ctx, extensionId);
  }

  disable(extensionId: string): Promise<void> {
    return installerDisable(this.ctx, extensionId);
  }

  resetCrashState(extensionId: string): Promise<void> {
    return installerResetCrashState(this.ctx, extensionId);
  }

  // --- Activation / lifecycle ---------------------------------------------

  activate(extensionId: string): Promise<void> {
    return lifecycleActivate(this.ctx, extensionId);
  }

  deactivate(extensionId: string): Promise<void> {
    return lifecycleDeactivate(this.ctx, extensionId);
  }

  fireActivationEvent(eventId: string): Promise<void> {
    return lifecycleFireActivationEvent(this.ctx, eventId);
  }

  /** True iff the worker for `extensionId` is currently active. Used by tests. */
  /**
   * Perform an outbound request on behalf of an extension's **UI iframe**.
   *
   * The panel iframe is deliberately NOT handed a CSP `connect-src` listing
   * the extension's allowed hosts. Letting UI code call `fetch()` directly
   * would bypass every defense the logic host enforces - no throttle, no
   * bandwidth cap, no private-IP or redirect re-validation, and crucially no
   * master offline switch. Routing through the extension's own
   * `NetworkApiImpl` means iframe traffic and worker traffic share one
   * pipeline and one budget, which is the whole point of having a gateway.
   *
   * Requires the extension to be active AND to hold the `network` permission
   * (the api-impl is only attached when it does), so an extension whose UI
   * asks for network it never declared gets a clear refusal.
   */
  uiFetch(
    extensionId: string,
    url: string,
    init?: Extensions.NetworkFetchInit,
  ): Promise<Extensions.NetworkFetchResponse> {
    const active = this.ctx.activeWorkers.get(extensionId);
    if (!active) {
      return Promise.reject(
        new Error(`Extension '${extensionId}' is not active — cannot perform a UI fetch.`),
      );
    }
    if (!active.networkApi) {
      return Promise.reject(
        new Error(
          `Extension '${extensionId}' does not hold the 'network' permission — UI fetch refused.`,
        ),
      );
    }
    return active.networkApi.fetchInternal(url, init);
  }

  isActive(extensionId: string): boolean {
    return this.ctx.activeWorkers.has(extensionId);
  }

  // --- Permissions / settings ---------------------------------------------

  updatePermissions(
    extensionId: string,
    grantedPermissions: ExtensionPermission[],
  ): Promise<void> {
    return permissionsUpdate(this.ctx, extensionId, grantedPermissions);
  }

  getSettings(extensionId: string): Promise<Record<string, unknown>> {
    return permissionsGetSettings(this.ctx, extensionId);
  }

  setSettings(extensionId: string, values: Record<string, unknown>): Promise<void> {
    return permissionsSetSettings(this.ctx, extensionId, values);
  }

  // --- Diagnostics --------------------------------------------------------

  async getCrashLog(extensionId: string, limit?: number): Promise<ExtensionCrashRecord[]> {
    return this.ctx.logger.readCrashLog(extensionId, limit);
  }

  async getLog(extensionId: string, limit?: number): Promise<ExtensionLogEntry[]> {
    return this.ctx.logger.readLog(extensionId, limit);
  }

  // --- Extension point dispatch ------------------------------------------

  dispatchExtensionPoint<TPayload, TReturn>(
    pointId: ExtensionPointId,
    payload: TPayload,
  ): Promise<TReturn> {
    return lifecycleDispatchExtensionPoint<TPayload, TReturn>(this.ctx, pointId, payload);
  }
}
