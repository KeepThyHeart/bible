# Extensions

**Last verified:** 2026-09-08

Third-party code runs inside a QuickJS-in-WASM realm hosted by an Electron `utilityProcess`. It never touches the renderer, never gets a Node.js global, and reaches the app only through an RPC surface the host defines. This doc is the file map for finding your way around that surface.

## Host - lifecycle and registry

| File | Role |
|---|---|
| `electron/extensions/ExtensionHost.ts` | Public entry point; composes the subsystems below |
| `electron/extensions/ExtensionHostTypes.ts` | `ExtensionHostContext` - the internal object passed to every subsystem |
| `electron/extensions/ExtensionHostLifecycle.ts` | Activate / deactivate / crash handling. **Blocklist enforcement lives here**, before the worker spawns |
| `electron/extensions/ExtensionHostDiscovery.ts` | Scans the extensions root and lists installed extensions |
| `electron/extensions/ExtensionHostInstaller.ts`, `ExtensionInstaller.ts` | Install from folder or `.zip`, including zip-slip refusal |
| `electron/extensions/ExtensionRegistry.ts` | SQLite-backed record of what is installed, enabled, granted, and where it came from |
| `electron/extensions/extensionSchema.ts` | Table definitions and the `addColumnIfMissing` migrations |
| `electron/extensions/ExtensionManifestLoader.ts` | Reads and validates `extension.json` |
| `electron/extensions/ExtensionLifecycleLogger.ts` | Per-extension log and crash log |
| `electron/extensions/semverRange.ts` | The single semver implementation used for `engines` and block rules |
| `electron/extensions/ContributionRegistry.ts` | What each extension contributes (commands, panels, settings) while it is active |
| `electron/extensions/SingleActiveProviderRegistry.ts` | Enforces one active provider per provider slot |
| `electron/extensions/ExtensionDatabaseRegistry.ts` | Per-extension SQLite handles for `api.storage` |
| `electron/extensions/ExtensionDevConfig.ts`, `ExtensionDevWatcher.ts`, `ExtensionHostDevMode.ts` | Developer Mode: the opt-in config, the reload-on-change watcher, and the host wiring. Off until the user turns it on |
| `electron/extensions/extUiProtocol.ts` | The `ext-ui://` scheme handler that serves an extension's panel assets to the iframe |
| `electron/ipc/extensionHandlers.ts` | The renderer-facing `extensions:*` channels (everything that is not marketplace) |
| `electron/main.ts` | The **only production composition site** - `initializeExtensionHostInBackground()` builds the `ExtensionHost` with the real worker factory, gateways, bridges and keychain, then registers the IPC surfaces and fires `onStartup` / `*` |

## Host - sandbox and RPC

| File | Role |
|---|---|
| `electron/extensions/ExtensionWorkerProcess.ts` | Worker supervision, restart, crash capture |
| `electron/extensions/electronUtilityProcessFactory.ts` | Spawns the `utilityProcess` in production |
| `electron/extensions/ExtensionHostRpc.ts` | Builds the RPC router and registers every namespace |
| `electron/extensions/ExtensionRpcRouter.ts` | Envelope protocol, method dispatch, error mapping |
| `electron/extensions/ExtensionPermissionGuard.ts`, `ExtensionHostPermissions.ts` | Per-call permission checks |
| `electron/extensions/ExtensionSqlGuard.ts` | Parameterized-only SQL for extension storage |
| `electron/extensions/gateways/ExtensionNetworkGateway.ts` | `api.network` egress, per-extension session, honours the master offline switch |
| `electron/extensions/SecretsKeychain.ts` | `api.storage.setSecret` backing store |
| `extension-runtime/host/QuickJSRealm.ts` | The WASM realm itself |
| `extension-runtime/guest/guestGlobals.ts` | Guest-side globals installed into the realm |
| `extension-runtime/binaryCodec.ts` | Wire encoding between host and guest |
| `extension-runtime/apiProxy.ts`, `bootstrap.ts`, `runtime.ts`, `resolveEntry.ts` | Guest bootstrap: the `api.*` proxy, entry resolution, and the runtime the guest bundle loads |
| `extension-runtime/errorBoundary.ts`, `eventEmitter.ts` | Guest-side error containment and event plumbing |
| `packages/core/src/Extensions/ExtensionManifestValidator.ts` (+ `ExtensionManifestSchema.json`) | Manifest schema validation shared by host and tooling |
| `packages/core/src/Extensions/Permissions.ts`, `RpcEnvelope.ts`, `ExtensionApiTypes.ts` | The permission vocabulary, the envelope shape, and the typed API surface |
| `packages/core/src/Extensions/ExtensionApiDtos.ts`, `ExtensionApiErrors.ts` | The data shapes crossing the RPC boundary and the error codes an `api.*` call can reject with |
| `packages/core/src/Extensions/ActivationEvents.ts`, `ExtensionPointTypes.ts` | When an extension activates, and the contribution-point vocabulary |
| `packages/core/src/Extensions/IExtensionHost.ts`, `IExtensionRuntime.ts` | The host and runtime interfaces the implementations above satisfy |

`electron/extensions/api-impl/*.ts` holds one file per namespace (`bibleApiImpl`, `notesApiImpl`, ...) plus the bridge interfaces (`IExtensionDataBridges.ts`, `IExtensionRegistryBridges.ts`) and their in-memory test doubles (`InMemoryDataBridges.ts`, `InMemoryRegistryBridges.ts`). `electron/extensions/bridges/*.ts` connects those implementations to app services: `BibleBridge`, `BookBridge`, `CommentaryBridge` and `DictionaryBridge` reach the main-process databases, while the `Renderer*` bridges (`RendererBridgeRpc`, `RendererCommandBridge`, `RendererConsentPrompter`, `RendererContextBridge`, `RendererL10nBridge`, `RendererUiBridge`, `RendererWorkspaceBridge`) round-trip to the renderer for UI, commands, consent and localization.

**Not yet wired:** `api-impl/authApiImpl.ts` exists but no host binds it. It is attached only when `ctx.authBrokerFactory` **and** `ctx.externalUrlOpener` are both supplied, and the production construction in `electron/main.ts` supplies neither, so an extension holding `network:oauth` gets an explicit "not configured on this host" error rather than a missing method. See `ExtensionHostRpc.ts`.

**`api.ai` is a reserved stub.** `ai.isAvailable` is registered directly on the router and always resolves `false`; there is no api-impl behind it. It exists so an extension that politely checks for AI support gets the documented `false` instead of `Unknown RPC method`.

## Trust and provenance

| File | Role |
|---|---|
| `electron/extensions/ExtensionSignatureVerifier.ts` | Ed25519 signature check over the package contents |
| `electron/extensions/TrustedPublishers.ts` | The app's own key set - the only thing that can promote to `signed` |
| `electron/extensions/DefaultCatalog.ts` | The configured default catalog URL - the only thing that can promote to `marketplace`. Ships unset |
| `packages/core/src/Extensions/ExtensionManifest.ts` | `deriveTrustTier` - computed on every read, never stored. The tiers are `untrusted`, `signed` and `marketplace` (`ExtensionTrustTier`) |

A valid signature proves the files are unaltered, not who signed them. Both promotions therefore depend on app-controlled configuration, not on anything inside the package or the catalog.

## Marketplace

| File | Role |
|---|---|
| `packages/core/src/Extensions/ExtensionCatalog.ts` | Wire formats and pure validators for catalog and blocklist documents |
| `electron/extensions/marketplace/ExtensionCatalogService.ts` | Source list, fetch, cache. **The risk-acknowledgement gate lives here**, before any socket is opened |
| `electron/extensions/marketplace/installFromCatalog.ts` | Download, SHA-256 check **before** unpacking, then the normal zip install |
| `electron/extensions/marketplace/ExtensionBlocklistService.ts` | Block rules: refresh, `check(id, version)`, list |
| `electron/ipc/marketplaceHandlers.ts` | The renderer-facing channels: `extensions:catalog:listSources`, `addSource`, `acknowledgeRisk`, `removeSource`, `refresh`, `refreshAll`, `listAvailable`, `install`; plus `extensions:blocklist:list` and `extensions:blocklist:checkInstalled` |
| `electron/ipc/updateHandlers.ts` | The blocklist's **only** fetch trigger, piggy-backed on the manual update check |

There is deliberately no `blocklist:refresh` channel and no timer: block rules arrive when the user runs Help > Check for Updates, and at no other time.

## Renderer UI

| File | Role |
|---|---|
| `src/ui/components/ExtensionsSection.tsx` | Preferences > Extensions. Tabs: Installed / Browse / Catalogs. Owns the trust badge, the blocked badge, permission revocation, settings, and the log viewers |
| `src/ui/components/extensions/ExtensionCatalogBrowser.tsx` | Browse tab - cached listings, provenance label, install |
| `src/ui/components/extensions/ExtensionCatalogSources.tsx` | Catalogs tab - add/confirm/refresh/remove sources, plus the read-only block-rule list |
| `src/ui/components/extensions/marketplaceTypes.ts` | Renderer mirrors of the wire shapes (the preload types these channels as `any`) |
| `src/ui/components/extensions/ExtensionConsentDialog.tsx` | The permission prompt, shown for sideloads and catalog installs alike |
| `src/ui/components/extensions/ExtensionUiHost.tsx`, `ExtensionPanelHost.tsx` | Hosts extension-contributed panels in a locked-down iframe |
| `src/ui/components/extensions/ExtensionSettingsRenderer.tsx`, `extensionSettingsSchema.ts` | Renders `contributes.configuration` |
| `src/ui/components/extensions/useIframeBridge.ts` | The postMessage channel between the panel iframe and the renderer host |
| `src/ui/extensions/extensionRendererBridge.ts`, `extensionUiStore.ts`, `extensionConsentStore.ts` | Renderer-side plumbing and state. Attached from `src/ui/main.tsx` (`attachExtensionRendererBridge`) |

Whether an installed extension is blocked is answered by the host via `extensions:blocklist:checkInstalled`, not recomputed in the renderer - matching a semver range in the UI would be a second implementation free to disagree with the code that actually refuses activation.

## Tests

- **Host / sandbox:** `electron/extensions/__tests__/` - including `SandboxEscape`, `RpcFuzzing`, `ApiSurfaceContract`, `TrustTiers`, `ExtensionCatalog`, `ExtensionMarketplace`, `ExtensionPermissionGuard`, `ExtensionSqlGuard`, `ExtensionRpcRouter`, `ExtensionWorkerProcess`, `ExtUiCsp`, `DeveloperMode`
- **Runtime:** `extension-runtime/__tests__/` - realm behaviour, guest bundle, bundle size, worker bootstrap, supervisor, smoke harness
- **UI:** `src/ui/components/extensions/ExtensionMarketplace.test.tsx`, `extensionSettingsSchema.test.ts`
- **E2E:** `e2e/tests/extension-host-asar.spec.ts`
- `electron/extensions/__tests__/fakeSql.ts` is a hand-rolled in-memory `ISql`; it exists so these tests avoid better-sqlite3's Electron ABI. Adding a table or column to `extensionSchema.ts` usually means teaching `fakeSql` the new query shape. `makeZip.ts` beside it builds the archives the installer tests unpack.
