/**
 * TypeScript shape of `extension.json`.
 *
 * Spec A section "Manifest". The companion JSON Schema lives at
 * `ExtensionManifestSchema.json` and is the **only** validator - the loader
 * rejects anything that fails schema validation. The TypeScript type below
 * mirrors the schema and exists so host and worker code can read manifests
 * with type safety.
 *
 * The loader's beyond-schema rules (id format, permission/network
 * cross-checks, path containment) are documented in
 * section "Manifest validation rules" and enforced by `ExtensionManifestLoader.ts`
 * (not yet implemented).
 */

import type { ExtensionPermission } from './Permissions';
import type {
  BookProviderDescriptor,
  CommentaryProviderDescriptor,
  ContextMenuItemDescriptor,
  DictionaryProviderDescriptor,
  DisplayModeDescriptor,
  ExtensionPanelTypeDef,
  KeybindingDescriptor,
  LocalizedString,
} from './ExtensionApiDtos';

// --- Identity & marketplace metadata ---------------------------------------

export type PricingTier = 'free' | 'freemium' | 'paid';

export interface ExtensionManifestIdentity {
  /**
   * Required. Must match `^ext\.[a-z0-9]+(?:-[a-z0-9]+)*\.[a-z0-9]+(?:-[a-z0-9]+)*$`,
   * e.g. `ext.example.greek-tools`.
   */
  id: string;
  /** Required. Internal name. */
  name: LocalizedString;
  /** Optional marketplace display name. */
  displayName?: LocalizedString;
  /** Required. Semver version of this extension package. */
  version: string;
  /** Required. Publisher identifier. Used for marketplace grouping. */
  publisher: string;
  description?: LocalizedString;
}

export interface ExtensionMarketplaceMetadata {
  /**
   * Controlled vocabulary; see `Extensions/README.md` once published.
   * Optional - used by the future plugin browser.
   */
  categories?: string[];
  keywords?: string[];
  homepage?: string;
  repository?: string;
  bugs?: string;
  /** SPDX identifier. */
  license?: string;
  pricing?: PricingTier;
  /** Path under the extension package root. */
  icon?: string;
  /** Marks the extension as unstable / preview. Default false. */
  preview?: boolean;
}

// --- Compatibility ---------------------------------------------------------

export interface ExtensionEngines {
  /** Semver range against `EXTENSION_API_VERSION`. */
  bibleApp: string;
}

// --- Network allowlist -----------------------------------------------------

export interface AllowedNetworkHost {
  /**
   * Hostname or `*.subdomain` wildcard. Wildcards match one or more labels;
   * a bare hostname matches only that exact host.
   */
  host: string;
  /**
   * Human-readable purpose shown in the install consent dialog. Required so
   * the user understands *what* the extension will reach.
   */
  purpose: LocalizedString;
  /** Optional method allowlist. Default: all methods. */
  methods?: ('GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE' | 'HEAD')[];
}

export interface ExtensionNetworkConfig {
  /** Required if `permissions` includes `network`. */
  allowedHosts: AllowedNetworkHost[];
}

// --- Privacy declaration --------------------------------------------------

/**
 * Categories of data the extension may collect and send to its backend.
 * Required in the manifest when the extension has `network` permission -
 * marketplace review will flag missing declarations.
 */
export type DataCollectionCategory =
  | 'analytics'
  | 'crash-reports'
  | 'user-content'
  | 'personalization'
  | 'none';

/**
 * Privacy declaration. Tells users and reviewers what data the extension
 * collects, why, and where the full policy lives. Shown in the install
 * consent dialog and the "Extension Details" pane.
 */
export interface ExtensionPrivacyConfig {
  /** What categories of data the extension sends to its backend. */
  dataCollection: DataCollectionCategory[];
  /** URL to the full privacy policy (displayed in install consent and details). */
  privacyPolicyUrl?: string;
}

// --- Webview CSP -----------------------------------------------------------

/**
 * CSP source list per directive. The token `self` expands to
 * `ext-ui://<extensionId>` at load time. `data:` and `blob:` are explicit
 * tokens; everything else must be a URL host that also appears in
 * `network.allowedHosts`.
 */
export interface ExtensionWebviewCsp {
  'img-src'?: string[];
  'font-src'?: string[];
  'style-src'?: string[];
  'connect-src'?: string[];
  'media-src'?: string[];
  /** Per-directive escape hatch for sources the host hasn't enumerated. */
  'frame-src'?: string[];
}

export interface ExtensionWebviewsConfig {
  /** Defaults to strict 'self'-only when omitted. */
  csp?: ExtensionWebviewCsp;
}

// --- Contributions ---------------------------------------------------------

/**
 * Contribution declarations declared statically in the manifest. Each is the
 * declarative twin of an `api.ui.register*` call - the host pre-registers
 * them at install time so activation events tied to a contribution work even
 * before the worker spawns.
 */
export interface ExtensionContributes {
  commands?: ContributedCommand[];
  panelTypes?: ExtensionPanelTypeDef[];
  /** Keyed by ContextMenuTarget; values are arrays of menu item refs. */
  menus?: Record<string, ContributedMenuItem[]>;
  /**
   * JSON Schema (draft-07) defining user-editable settings. Either an inline
   * schema object or a `$ref` to a schema file inside the package.
   */
  configuration?: ContributedConfiguration;
  /**
   * Map from provider role ID to the in-extension provider key the user can
   * pick. The host shows these in Preferences -> Extensions -> Provider Roles.
   */
  providers?: Record<string, string>;
  displayModes?: DisplayModeDescriptor[];
  themes?: ContributedTheme[];
  fonts?: ContributedFont[];
  icons?: ContributedIcon[];
  styles?: ContributedStyle[];
  fileImporters?: ContributedFileImporter[];
  apiExports?: ContributedApiExport[];
  /**
   * Provider descriptors statically declared in the manifest. Mirrors what an
   * extension would otherwise call via `api.commentary.registerProvider` /
   * `api.dictionary.registerProvider` / `api.book.registerProvider` so the
   * host can pre-register the provider before the worker starts.
   */
  commentaryProviders?: CommentaryProviderDescriptor[];
  dictionaryProviders?: DictionaryProviderDescriptor[];
  bookProviders?: BookProviderDescriptor[];
}

export interface ContributedCommand {
  id: string;
  title: LocalizedString;
  category?: LocalizedString;
  shortcut?: KeybindingDescriptor | KeybindingDescriptor[];
  when?: string;
  /** Optional reverse-RPC endpoint name. If omitted, the command is API-only. */
  handlerEndpoint?: string;
  order?: number;
  hidden?: boolean;
}

/**
 * Menu item declared statically. Mirrors `ContextMenuItemDescriptor` minus
 * the `id` (the loader generates one) and minus runtime-only fields.
 */
export type ContributedMenuItem = Omit<ContextMenuItemDescriptor, 'id'> & {
  /** Optional explicit ID; the loader generates one if absent. */
  id?: string;
};

export type ContributedConfiguration =
  | { $ref: string }
  | Record<string, unknown>;

export interface ContributedTheme {
  id: string;
  label: LocalizedString;
  /** Path under the extension package root. */
  path: string;
}

export interface ContributedFont {
  id: string;
  family: string;
  /** Paths under the extension package root. */
  files: string[];
  fallback?: string;
}

export interface ContributedIcon {
  id: string;
  /** Path under the extension package root. */
  path: string;
}

export interface ContributedStyle {
  /** Path under the extension package root. */
  path: string;
  /** Where the host scopes the stylesheet to. */
  scope: 'verse' | 'panel' | 'global';
}

export interface ContributedFileImporter {
  id: string;
  label: LocalizedString;
  /** File extensions handled, including the leading dot. */
  extensions: string[];
  /** Reverse-RPC endpoint that receives the file contents. */
  handlerEndpoint: string;
}

export interface ContributedApiExport {
  /** Method name. Must be a valid identifier. */
  method: string;
  description?: LocalizedString;
  /** Reverse-RPC endpoint the host calls when another extension invokes this method. */
  handlerEndpoint: string;
}

// --- Runtime configuration ------------------------------------------------

export interface ExtensionRuntimeConfig {
  /**
   * Maximum V8 heap size in MB for the worker process.
   * Clamped to 256-1024 MB at spawn time. Default 256 if omitted.
   */
  maxMemoryMB?: number;
}

// --- Signature / verification ---------------------------------------------

/**
 * Content of `extension.sig` - the Ed25519 signature of the extension's
 * content hash plus the publisher's public key. Laid down by the publisher's
 * build tooling and verified at install time.
 */
export interface ExtensionSignature {
  /** Hex-encoded Ed25519 public key (32 bytes -> 64 hex chars). */
  publicKey: string;
  /** Hex-encoded Ed25519 signature of the content hash (64 bytes -> 128 hex chars). */
  signature: string;
  /**
   * Algorithm identifier. Only `ed25519-sha256` is supported in v1; included
   * for forward compatibility.
   */
  algorithm: 'ed25519-sha256';
}

/**
 * Verification status stored in the extension registry after install.
 *
 * **`verified` means integrity, not provenance.** It says the package contents
 * match the signature made by the key *shipped inside the package itself* -
 * i.e. the package has not been tampered with since it was signed. Anyone can
 * generate a keypair and self-sign, so `verified` alone establishes nothing
 * about who the publisher is. Use {@link deriveTrustTier} for that.
 */
export type SignatureVerificationStatus =
  | 'verified'
  | 'unsigned'
  | 'invalid'
  | 'error';

/**
 * How much provenance the app can vouch for. Tiers, deliberately **not** a
 * gate: an unsigned extension still installs, it is simply marked untrusted
 * and must have its permissions approved.
 *
 * - `untrusted` - sideloaded, unsigned, or signed by a publisher we don't know.
 *   The default and the common case for self-published extensions.
 * - `signed` - signature is intact AND the signing key is in the app's
 *   trusted-publisher set. Earns the "Verified publisher" badge.
 * - `marketplace` - came from the curated catalog. Nothing emits this yet;
 *   the catalog lands in Phase 4.
 */
export type ExtensionTrustTier = 'untrusted' | 'signed' | 'marketplace';

/**
 * Classify an extension's provenance.
 *
 * The important rule, and the one this function exists to enforce: a valid
 * signature is **not** sufficient for the `signed` tier. Verification proves
 * only that the bytes match the key bundled with the package, which a hostile
 * author controls end to end. Promotion to `signed` additionally requires that
 * key to appear in `trustedPublisherKeys` - a set the *app* controls.
 *
 * Kept pure and dependency-free so the host and the renderer classify
 * identically, and so the rule is trivially testable.
 */
export function deriveTrustTier(opts: {
  signatureStatus?: SignatureVerificationStatus;
  /** Hex-encoded Ed25519 public key from the package signature, if any. */
  signatureKey?: string;
  /** Hex-encoded keys the app is willing to vouch for. */
  trustedPublisherKeys: readonly string[];
  /** True when the extension was installed from the curated catalog. */
  fromMarketplace?: boolean;
}): ExtensionTrustTier {
  if (opts.fromMarketplace === true) return 'marketplace';
  if (opts.signatureStatus !== 'verified') return 'untrusted';

  const key = opts.signatureKey?.toLowerCase();
  if (key === undefined || key.length === 0) return 'untrusted';

  return opts.trustedPublisherKeys.some((k) => k.toLowerCase() === key)
    ? 'signed'
    : 'untrusted';
}

// --- Top-level manifest shape ----------------------------------------------

export interface ExtensionManifest
  extends ExtensionManifestIdentity,
    ExtensionMarketplaceMetadata {
  /** JSON Schema reference (informational; the loader uses the bundled schema). */
  $schema?: string;
  engines: ExtensionEngines;
  /** Worker entry point. Absent for UI-only extensions. */
  main?: string;
  /** Permissions requested at install time. The user approves the set. */
  permissions?: ExtensionPermission[];
  network?: ExtensionNetworkConfig;
  /** Privacy declaration - required for marketplace extensions with `network` permission. */
  privacy?: ExtensionPrivacyConfig;
  webviews?: ExtensionWebviewsConfig;
  /** Activation event strings. See `ActivationEvents.ts`. */
  activationEvents?: string[];
  contributes?: ExtensionContributes;
  /** Runtime resource limits for the worker process. */
  runtime?: ExtensionRuntimeConfig;
  /** Folder containing per-locale JSON files. Defaults to `./l10n`. */
  l10n?: string;
}
