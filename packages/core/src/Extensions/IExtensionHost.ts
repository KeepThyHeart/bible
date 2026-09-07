/**
 * Host-side orchestrator interface.
 *
 * Spec A section "Architecture" + section "Lifecycle". `IExtensionHost` is the contract the
 * main-process singleton implements (`ExtensionHost.ts` under
 * `apps/desktop/electron/extensions/` - not yet implemented). The
 * desktop's renderer talks to it via IPC and the rest of the host code holds
 * a reference to it.
 *
 * The interface lives in `@bible/core` because it is the contract between
 * the desktop package's IPC bridge and the rest of the codebase - keeping it
 * type-only and dependency-free means tests, CLI tools, and future hosts can
 * depend on the same shape without pulling in Electron.
 */

import type {
  ExtensionManifest,
  ExtensionTrustTier,
  SignatureVerificationStatus,
} from './ExtensionManifest';
import type { ExtensionPermission } from './Permissions';
import type { LocalizedString } from './ExtensionApiDtos';
import type { ExtensionPointId } from './ExtensionApiTypes';

/**
 * Snapshot of an extension's state from the host's perspective. Returned by
 * `listExtensions()` and `getExtension()`.
 */
export interface ExtensionStateInfo {
  /** Manifest as loaded from disk. */
  manifest: ExtensionManifest;
  /** Absolute install path. */
  installPath: string;
  /** True if the extension is enabled (i.e. allowed to be activated). */
  enabled: boolean;
  /** Lifecycle stage. */
  status: ExtensionStatus;
  /** Permissions the user has granted, post-install. */
  grantedPermissions: ExtensionPermission[];
  /** Epoch ms when the extension was installed. */
  installedAt: number;
  /** Epoch ms when the extension was last updated. */
  updatedAt: number;
  /** Last load- or runtime-error message, if any. */
  lastError?: string;
  /** Number of crashes counted in the current app session. */
  crashCountSession: number;
  /** Ed25519 signature verification status from install time. */
  signatureStatus?: SignatureVerificationStatus;
  /** Hex-encoded public key when `signatureStatus === 'verified'`. */
  signatureKey?: string;
  /**
   * Provenance tier. **Derived, never stored** - computed from
   * `signatureStatus` + `signatureKey` against the app's current
   * trusted-publisher set each time this snapshot is built, so adding or
   * removing a trusted publisher reclassifies existing installs immediately
   * instead of leaving a stale value in the database.
   */
  trustTier?: ExtensionTrustTier;
  /**
   * Catalog URL this extension was installed from. Absent for a sideload or a
   * Developer-Mode load.
   *
   * Recorded because it is a historical fact about the install; whether it
   * still counts as *the* marketplace is decided at read time against the
   * app's current default-catalog setting, which is what makes `trustTier`
   * above track configuration changes instead of going stale.
   */
  sourceCatalogUrl?: string;
  /** Absolute path of the user-granted managed folder, if any. */
  folderGrantPath?: string;
  /** ISO 8601 date string when the folder grant was made. */
  folderGrantDate?: string;
  /**
   * True for an extension loaded **unpacked** in Developer Mode.
   *
   * A normal install copies the package into `data/extensions/<id>/` and the
   * host owns that directory. A dev-mode extension is instead run *in place*
   * from wherever the developer built it, so `installPath` points outside the
   * extensions root and the host watches it for rebuilds.
   *
   * It is a distinct flag rather than an inference from `installPath` because
   * every consumer that cares - reload, pruning, the UI badge - needs a
   * definite answer, and "is this path under the extensions root?" is a
   * question with an OS-dependent answer.
   */
  devMode?: boolean;
}

/**
 * Lifecycle stages an extension may be in.
 *
 * - `installed`: known to the host, manifest valid, not currently running.
 * - `loading`: host is spawning the worker / waiting for `activate()`.
 * - `active`: `activate()` resolved; the worker is alive and serving RPC.
 * - `disabled`: user disabled the extension; will not auto-activate.
 * - `failed`: load error or crash; details in `lastError`. Eligible for
 *   re-enable from the Extensions UI.
 * - `auto-disabled`: three crashes within one session; eligible for reset
 *   from the Extensions UI.
 * - `setup-required`: a `x-bibleAppRequired` setting is missing; the
 *   extension is loaded but cannot activate until the user fills it in.
 */
export type ExtensionStatus =
  | 'installed'
  | 'loading'
  | 'active'
  | 'disabled'
  | 'failed'
  | 'auto-disabled'
  | 'setup-required';

/**
 * Reasons the host may auto-disable an extension. Surfaced to the Extensions
 * UI so the user gets a clear "Why is this off?" answer.
 */
export type AutoDisableReason =
  | 'crash-loop'
  | 'incompatible-api-version'
  | 'manifest-invalid'
  | 'permission-revoked';

/**
 * Result of an install operation. The host returns enough info for the
 * Extensions UI to render a success or error state without re-querying.
 */
export interface InstallResult {
  ok: true;
  state: ExtensionStateInfo;
}

export interface InstallError {
  ok: false;
  /** Stable error code matching one of EXTENSION_API_ERROR_CODES or 'ManifestInvalid'. */
  code: string;
  message: string;
  /** Optional structured detail (validation error list, etc.). */
  detail?: unknown;
}

/**
 * Crash record written to `data/extensions/<id>/crash.log`. The host returns
 * the most recent N records to the Extensions UI on demand.
 */
export interface ExtensionCrashRecord {
  /** Epoch ms. */
  ts: number;
  /** OS exit code, or null if the worker did not exit cleanly. */
  exitCode: number | null;
  /** Last 200 lines of the worker's stderr. */
  stderrTail: string;
  /** Method name of the API call that immediately preceded the crash, if any. */
  lastRpcMethod?: string;
}

/**
 * Per-extension log line. The host writes these to
 * `data/extensions/<id>/extension.log`.
 */
export interface ExtensionLogEntry {
  ts: number;
  level: 'debug' | 'info' | 'warn' | 'error';
  message: string;
  /** Optional structured fields (key/value pairs). */
  fields?: Record<string, unknown>;
}

/**
 * Pending install consent the host needs the user to approve before
 * proceeding. Surfaced through the renderer's `ExtensionPermissionPrompt`
 * component.
 */
export interface InstallConsentRequest {
  manifest: ExtensionManifest;
  /** Permissions that will be requested at install time. */
  requestedPermissions: ExtensionPermission[];
  /** Permissions in `requestedPermissions` that warrant a separate detail dialog. */
  separatelyPrompted: ExtensionPermission[];
  /** Hosts the extension will be allowed to reach over the network. */
  networkHosts: { host: string; purpose: LocalizedString }[];
  /**
   * Provenance of the package about to be installed, so the dialog can lead
   * with an "untrusted" warning rather than presenting every extension as
   * equally vouched-for. Derived from the *source* directory before the copy.
   */
  trustTier?: ExtensionTrustTier;
  /**
   * Hex-encoded signing key when the package carries an intact signature.
   * Present even for the `untrusted` tier (a self-signed package has a valid
   * signature from an unknown key), which lets the dialog say "signed by an
   * unrecognised publisher" instead of the flatly wrong "unsigned".
   */
  signaturePublicKey?: string;
}

/**
 * Methods the host exposes to the rest of the desktop app (renderer IPC, the
 * Spec C layout system, the search bar, the command registry).
 *
 * Implementations live in `apps/desktop/electron/extensions/ExtensionHost.ts`.
 */
export interface IExtensionHost {
  // --- Discovery & state ------------------------------------------------

  /** Read every manifest under `data/extensions/` and register it. Idempotent. */
  loadAll(): Promise<void>;

  /** Snapshot of all known extensions. */
  listExtensions(): Promise<ExtensionStateInfo[]>;

  /** Snapshot of a single extension by ID, or null if not installed. */
  getExtension(extensionId: string): Promise<ExtensionStateInfo | null>;

  // --- Install / uninstall ----------------------------------------------

  /**
   * Install an extension from a directory or packaged archive. Validates the
   * manifest, prompts the user for consent if `consent` is omitted, copies
   * files to `data/extensions/<id>/`, persists state, and emits
   * `extension.activated` if `activateNow` is true.
   */
  installExtension(opts: {
    sourcePath: string;
    /** Pre-approved consent. If omitted, the host raises a consent request. */
    consent?: { grantedPermissions: ExtensionPermission[] };
    activateNow?: boolean;
  }): Promise<InstallResult | InstallError>;

  /**
   * Uninstall an extension. Disposes all contributions, kills the worker,
   * deletes files under `data/extensions/<id>/`, removes DB rows. User data
   * stored under `extension_storage` is deleted alongside.
   */
  uninstallExtension(extensionId: string): Promise<void>;

  // --- Enable / disable / reset -----------------------------------------

  enable(extensionId: string): Promise<void>;
  disable(extensionId: string): Promise<void>;

  /** Clear the auto-disable flag and reset the session crash counter. */
  resetCrashState(extensionId: string): Promise<void>;

  // --- Activation -------------------------------------------------------

  /**
   * Force-activate an extension regardless of activation events. Used by
   * tests, the Extensions UI's "Activate now" button, and `onCommand:` event
   * handling when a command is invoked before its extension has spawned.
   */
  activate(extensionId: string): Promise<void>;

  /** Deactivate an extension. Disposes contributions and kills the worker. */
  deactivate(extensionId: string): Promise<void>;

  /**
   * Tell the host an activation event has fired. Any extensions whose
   * `activationEvents` include this event get spawned.
   */
  fireActivationEvent(eventId: string): Promise<void>;

  // --- Permissions ------------------------------------------------------

  /**
   * Update granted permissions for an extension. Revoking a permission
   * disposes any contributions that depended on it and rejects in-flight
   * calls with `PermissionDeniedError`.
   */
  updatePermissions(
    extensionId: string,
    grantedPermissions: ExtensionPermission[],
  ): Promise<void>;

  // --- Settings ---------------------------------------------------------

  /** Read the user-edited settings KV for an extension. Used by the renderer's settings form. */
  getSettings(extensionId: string): Promise<Record<string, unknown>>;

  /** Replace the user-edited settings for an extension. Validates against the schema. */
  setSettings(extensionId: string, values: Record<string, unknown>): Promise<void>;

  // --- Diagnostics ------------------------------------------------------

  /** Recent crash records (most recent first). */
  getCrashLog(extensionId: string, limit?: number): Promise<ExtensionCrashRecord[]>;

  /** Recent log entries (most recent first). */
  getLog(extensionId: string, limit?: number): Promise<ExtensionLogEntry[]>;

  // --- Extension point dispatch -----------------------------------------

  /**
   * Internal dispatch entry - called by the host's own subsystems when an
   * extension point fires. Subscribers in active extensions receive the
   * payload via reverse RPC. The return shape depends on the point's kind
   * (event/filter/provider - see `EXTENSION_POINT_KINDS`).
   */
  dispatchExtensionPoint<TPayload, TReturn>(
    pointId: ExtensionPointId,
    payload: TPayload,
  ): Promise<TReturn>;
}
