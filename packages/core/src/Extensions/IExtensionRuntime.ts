/**
 * Worker-side runtime interface.
 *
 * Spec A section "Architecture" + section "Lifecycle" (steps 5-6). `IExtensionRuntime` is
 * the contract the bundled `extension-runtime/` (under
 * `apps/desktop/extension-runtime/`) implements inside each extension
 * worker process. The host injects an instance of this on worker spawn; the
 * worker entry point hands it the `BibleExtensionAPI` proxy and dispatches
 * RPC envelopes through it.
 *
 * Living in `@bible/core` keeps the worker code dependency-free from
 * Electron and from `@bible/desktop` so the runtime bundle stays under the
 * 50 KB gzipped budget the spec mandates.
 */

import type { BibleExtensionAPI } from './ExtensionApiTypes';
import type { ExtensionManifest } from './ExtensionManifest';
import type { ExtensionPermission } from './Permissions';
import type { RpcEnvelope } from './RpcEnvelope';

/**
 * Init payload sent by the host to the worker on spawn (`init` RPC).
 *
 * Spec A section "Capability negotiation".
 */
export interface ExtensionInitPayload {
  manifest: ExtensionManifest;
  /**
   * Absolute path to the directory the extension is installed in.
   *
   * `manifest.main` is required by `ExtensionManifestValidator` to be a
   * package-relative path (`"./main.js"`), so the worker cannot load it
   * without knowing what to resolve it against - the runtime bundle lives in
   * a completely different directory (`out/main/extension-runtime/`), and a
   * bare relative specifier resolves against *that*. The host therefore has
   * to ship the install directory alongside the manifest.
   *
   * The worker resolves + containment-checks the entry point against this
   * path (see `extension-runtime/resolveEntry.ts`); a `main` that escapes the
   * install directory is rejected rather than loaded.
   */
  installPath: string;
  /** Permissions the user approved at install time, post-revocation. */
  grantedPermissions: ExtensionPermission[];
  /** EXTENSION_API_VERSION the host is currently serving. */
  hostApiVersion: string;
  /**
   * Oldest major API version the host still loads. Lets the worker pick a
   * compatibility branch when it pins to a non-current major.
   */
  hostMinSupportedApiVersion: string;
  /** Initial locale the worker should use for `IL10nApi`. */
  locale: string;
  /**
   * Optional capability flags. The worker can branch on these without
   * parsing the host's marketing version.
   * Example: `['ai.providerUi', 'webview.csp.relaxed']`.
   */
  hostFeatures: string[];
}

/**
 * Module shape an extension's compiled `main` entry point exports. The host's
 * worker bootstrap dynamically imports `manifest.main` and calls
 * `module.activate(api)` after the runtime is ready. `deactivate` is optional;
 * if present, the host calls it before tearing down the worker.
 */
export interface ExtensionEntryPointModule {
  activate(api: BibleExtensionAPI): void | Promise<void>;
  deactivate?: () => void | Promise<void>;
}

/**
 * The minimal transport the runtime needs to talk to the host. The host
 * provides this when constructing the runtime - typically wrapping a
 * `MessagePort` from `MessageChannelMain` (worker) or a `Window.postMessage`
 * channel (iframe).
 */
export interface IExtensionRpcTransport {
  send(envelope: RpcEnvelope): void;
  /**
   * Register a handler for incoming envelopes. The runtime owns the only
   * subscription; the transport may invoke it synchronously or
   * asynchronously.
   */
  onMessage(handler: (envelope: RpcEnvelope) => void): void;
  /** Tear down the transport. Idempotent. */
  close(): void;
}

/**
 * Worker-side runtime contract.
 *
 * Implementations live in `apps/desktop/extension-runtime/index.ts`.
 * Tests can substitute a mock implementation backed by an in-memory transport.
 */
export interface IExtensionRuntime {
  /**
   * Receive the init payload from the host. Builds the `BibleExtensionAPI`
   * proxy from the granted permissions, dynamically imports the manifest's
   * `main`, and calls `activate(api)`. Resolves once `activate()` has resolved
   * (or rejects on timeout / load error).
   */
  init(payload: ExtensionInitPayload): Promise<void>;

  /**
   * Dispatch an incoming RPC envelope. The host calls this for reverse-RPC
   * (host -> worker) requests, e.g. invoking command handlers or commentary
   * provider endpoints registered by the extension.
   */
  dispatch(envelope: RpcEnvelope): Promise<void>;

  /**
   * Get the API proxy injected into the extension. Mostly useful for tests;
   * production extensions hold their own reference from `activate(api)`.
   */
  getApi(): BibleExtensionAPI;

  /**
   * Run the extension's `deactivate()` (if any) and tear down the runtime.
   * After `dispose()` resolves, the worker process exits naturally.
   */
  dispose(): Promise<void>;
}
