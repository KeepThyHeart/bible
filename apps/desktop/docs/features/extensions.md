# Extensions

**Last verified:** 2026-09-23

Third-party code runs inside a QuickJS-in-WASM realm hosted by an Electron `utilityProcess`. It never touches the renderer, never gets a Node.js global, and reaches the app only through an RPC surface the host defines. This doc is the file map for finding your way around that surface.

## Host - lifecycle and registry

| File | Role |
|---|---|
| `electron/extensions/ExtensionHost.ts` | Public entry point; composes the subsystems below |
| `electron/extensions/ExtensionHostTypes.ts` | `ExtensionHostContext` - the internal object passed to every subsystem |
| `electron/extensions/ExtensionHostLifecycle.ts` | Activate / deactivate / crash handling. **Blocklist enforcement lives here**, before the worker spawns. `activate()` coalesces concurrent calls for the same extension (task 0024 round 3, P1.5) |
| `electron/extensions/DeclaredContributions.ts` | Reads `contributes.commands`/`contributes.panelTypes` and pre-registers placeholders before the owning worker exists (P1.5) - see "Lazy activation" below |
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
| `electron/main.ts` | The **only production composition site** - `initializeExtensionHostInBackground()` builds the `ExtensionHost` with the real worker factory, gateways, bridges and keychain, wires `DeclaredContributions`, then registers the IPC surfaces and fires `onStartupFinished` |

## Host - sandbox and RPC

| File | Role |
|---|---|
| `electron/extensions/ExtensionWorkerProcess.ts` | Worker supervision, restart, crash capture |
| `electron/extensions/electronUtilityProcessFactory.ts` | Spawns the `utilityProcess` in production |
| `electron/extensions/ExtensionHostRpc.ts` | Builds the RPC router and registers every namespace |
| `electron/extensions/ExtensionRpcRouter.ts` | Envelope protocol, method dispatch, error mapping |
| `electron/extensions/ExtensionPermissionGuard.ts`, `ExtensionHostPermissions.ts` | Per-call permission checks |
| `electron/extensions/ExtensionSqlGuard.ts` | Keeps extension SQL inside its own database file (blocks `ATTACH`/`PRAGMA`/`VACUUM`/raw transaction control). Not an injection filter - see the file header |
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

`electron/extensions/api-impl/*.ts` holds one file per namespace (`bibleApiImpl`, `notesApiImpl`, `panelsApiImpl`, ...) plus the bridge interfaces (`IExtensionDataBridges.ts`, `IExtensionRegistryBridges.ts`) and their in-memory test doubles (`InMemoryDataBridges.ts`, `InMemoryRegistryBridges.ts`). `electron/extensions/bridges/*.ts` connects those implementations to app services: `BibleBridge`, `BookBridge`, `CommentaryBridge` and `DictionaryBridge` reach the main-process databases, while the `Renderer*` bridges (`RendererBridgeRpc`, `RendererCommandBridge`, `RendererConsentPrompter`, `RendererContextBridge`, `RendererL10nBridge`, `RendererUiBridge`, `RendererWorkspaceBridge`) round-trip to the renderer for UI, commands, consent and localization.

**Not yet wired:** `api-impl/authApiImpl.ts` exists but no host binds it. It is attached only when `ctx.authBrokerFactory` **and** `ctx.externalUrlOpener` are both supplied, and the production construction in `electron/main.ts` supplies neither, so an extension holding `network:oauth` gets an explicit "not configured on this host" error rather than a missing method. See `ExtensionHostRpc.ts`.

**`api.ai` is a reserved stub.** `ai.isAvailable` is registered directly on the router and always resolves `false`; there is no api-impl behind it. It exists so an extension that politely checks for AI support gets the documented `false` instead of `Unknown RPC method`.

**`ui.registerDisplayMode` no longer exists.** Custom verse display modes were declared in `IUiApi` but never implemented: nothing rendered a registered mode, and the Bible pane's Display Mode picker is the fixed Simple/Standard/Study set. It briefly existed as a reserved method that rejected every call with `MethodNotImplementedYet`; task 0024 round 3 (P2.13) removed the whole tentacle outright - the manifest field, the runtime method, the bridge plumbing and the `display-mode:provide` permission - on the same "delete dead code" precedent that had already removed `search:provide` / `import:provide` / `tts:provide` / `ai:provide`. A real declarative-and-imperative registration path can be added from scratch if custom display modes are ever built.

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
| `src/ui/components/extensions/useIframeBridge.ts` | The postMessage channel between the panel iframe and the renderer host. Also carries `panel.invoke` (panel -> worker) and delivers worker pushes back as a `panel.message` event |
| `src/ui/components/StatusBar.tsx` | The app status bar, filled entirely by `ui.registerStatusBarItem` contributions. Renders `null` when there are none - see [Status Bar](status-bar.md) |
| `src/ui/components/VerseContextMenu.tsx` | Renders `ui.registerContextMenu('verse', ...)` contributions beneath the built-in items, behind a separator |
| `src/ui/menu/buildMenuSpec.ts` | `buildExtensionToolsSubmenu` - the Tools menu, built from commands carrying an `ownerExtensionId`. Omitted entirely when empty, so a fresh install has no Tools menu |
| `src/ui/extensions/extensionRendererBridge.ts`, `extensionUiStore.ts`, `extensionConsentStore.ts` | Renderer-side plumbing and state. Attached from `src/ui/main.tsx` (`attachExtensionRendererBridge`) |

Whether an installed extension is blocked is answered by the host via `extensions:blocklist:checkInstalled`, not recomputed in the renderer - matching a semver range in the UI would be a second implementation free to disagree with the code that actually refuses activation.

## Reverse RPC: making handlers actually run

Several registration DTOs carry a `handlerEndpoint` *string* rather than a function, because a function cannot survive the RPC envelope that carries the registration to the host. When the user fires the command, the host issues a *reverse* request naming that endpoint. Nothing bound a function to an endpoint name, so every reverse request came back `Unknown reverse RPC method` and every registration was inert: `contributes.commands` entries appeared in the command palette and did nothing when invoked.

`api.runtime.expose(endpoint, handler)` is what closes that. It never leaves the worker - there is nothing to send, because what it binds to is the worker's own inbound-request table.

| File | Role |
|---|---|
| `packages/core/src/Extensions/ExtensionApiTypes.ts` | `IRuntimeApi` - `expose`, `unexpose`, `listExposed` |
| `extension-runtime/apiProxy.ts` | `makeRuntimeMethod` implements the three, `IReverseEndpointTable` is the contract with the runtime, and `RESERVED_ENDPOINT_PREFIX` refuses names beginning `runtime.` so an extension cannot shadow a host control message |
| `extension-runtime/runtime.ts` | Owns the table and hands it to the proxy at construction. `ExtensionRuntime.registerReverseHandler` had no caller before this: the table stayed empty and `handleReverseRequest` had nothing to find |

Endpoint names are the extension's own choice and are scoped to its worker, so two extensions may use the same name without colliding.

## Panel-to-worker channel

A panel iframe runs on its own sandboxed `ext-ui://` origin. It could navigate a verse, read the theme and make a permission-gated fetch, and that was the whole surface: it could not read scripture, store anything or localize a string, so no stateful panel extension was possible at all. This channel closes that without handing the renderer a slice of the API.

The panel posts an **opaque** payload; the extension's own worker receives it and answers using API access it already holds. Any `api.*` call the worker then makes runs through `ExtensionPermissionGuard` exactly as before, so permission enforcement stays in one place instead of being duplicated into the renderer - the least appropriate host for that decision. No permission gates the channel itself: a panel talking to its own worker is not a capability, the capabilities are whatever the worker does in response.

| File | Role |
|---|---|
| `packages/extension-ui/src/BibleExtUI.ts` | The panel-side API: `postToWorker(message)` (request/reply) and `onWorkerMessage(cb)` (worker pushes, fire-and-forget) |
| `src/ui/components/extensions/useIframeBridge.ts` | Serves the iframe's `panel.invoke` request and forwards worker pushes back as a `panel.message` event. Assembles the panel's identity from the props it was mounted with |
| `electron/ipc/extensionHandlers.ts` | The `extensions:panelInvoke` channel. Validates the three identifiers and calls `host.panelInvoke` |
| `electron/extensions/ExtensionHost.ts` | `panelInvoke(sender, message)` - resolves the worker and rejects usefully when the extension is inactive or has no panel channel |
| `electron/extensions/api-impl/panelsApiImpl.ts` | `panels.setMessageHandler` (the worker tells the host a handler exists), `panels.postMessage` (worker to panel), and `deliver()` (host to worker, not an RPC method). Also `PANEL_MESSAGE_ENDPOINT`, `PANEL_MESSAGE_TIMEOUT_MS` (10s) and `MAX_PANEL_MESSAGE_BYTES` (256 KB, enforced both ways) |
| `extension-runtime/apiProxy.ts` | `api.panels.onMessage` is `runtime.expose` under that fixed endpoint name, plus a one-off `panels.setMessageHandler(true)` so a message arriving before the handler exists is refused with a useful error |
| `src/ui/extensions/extensionUiStore.ts` | `subscribeToPanelMessages` - the fan-out to mounted panel hosts. A message for an extension with no open panel is simply dropped |

**The security property to preserve:** `sender.extensionId` is resolved by the host from the closure that mounted the iframe. It never comes from the message payload, so a panel cannot name another extension and spend its grants. Same trust model as `extensions:uiFetch`. `PanelChannel.test.ts` and `RpcFuzzing.test.ts` both pin it.

Both size caps exist because the worker is a QuickJS-in-WASM realm with a bounded heap: a panel that could post unbounded payloads into it at will is a denial-of-service surface against the extension host. A panel needing to move more than 256 KB wants a database, not a message.

## Contributed UI that now renders

`RendererUiBridge` pushes seven kinds of UI contribution at the renderer, and the renderer's dispatcher handled one of them. An extension calling `ui.registerContextMenu` or `ui.registerStatusBarItem` passed the permission guard, landed in `ContributionRegistry`, and was then dropped on the floor. The platform's biggest gap was not a missing API; it was missing rendering for APIs that already validated.

- **Verse context menu** (`src/ui/components/VerseContextMenu.tsx`). Items with `target: 'verse'` render beneath the built-ins, behind a separator, ordered by the descriptor's `order`. Built-ins come first deliberately: a freshly installed extension should not be able to push "Copy passage" down the list. Items dispatch through `ICommandRegistry` rather than a new IPC path, because `RendererCommandBridge` has already put extension commands there. Items carrying a `when` clause are **held back** rather than shown unconditionally - `when` evaluates against `IContextApi` keys, and wiring that expression evaluator into a menu that opens on every right-click is separate work; showing the item anyway would be the wrong answer in the one case the author cared enough to write a condition for. `ContextMenuItemDescriptor.icon` is deliberately not rendered: it is a string the extension chooses, and putting arbitrary extension-supplied markup into the app's own menu is the injection this platform exists to avoid.
- **Status bar** (`src/ui/components/StatusBar.tsx`), which did not exist as a component at all. Full detail in [Status Bar](status-bar.md).
- **Tools menu** (`src/ui/menu/buildMenuSpec.ts`, `buildExtensionToolsSubmenu`). The only place in the application menu an extension can reach. Commands carrying an `ownerExtensionId` and not marked `hidden`, grouped by owning extension in id order, then by the command's `order`, then by resolved label. Omitted entirely when empty, so a fresh install has no Tools menu at all. Labels come from the extension's own already-localized command title, not from the `menu.*` catalog - the app cannot know a phrase for something it did not ship.

## Permission enforcement that was declared but not checked

Two confused-deputy holes: any installed extension, with zero granted permissions, could register a command (`commands:register` was in `DEFAULT_GRANTED_PERMISSIONS` but never actually checked) and could execute *any* built-in command through `commands.execute` - including ones that write notes, open Preferences, or change the layout - because `commandsApiImpl.ts` had no permission gate on it at all and simply forwarded to the same `ICommandRegistry` the menu uses.

- `commandsApiImpl.ts` now checks `commands:register` on `commands.register`.
- `commands.execute` now always permits an extension's own commands (anything under its `ext.<id>.` prefix - structurally guaranteed, since `CommandRegistry.register` refuses anything outside that prefix) and gates everything else behind a new permission, `commands:execute-builtin`, **and** a reviewed, hand-maintained allowlist (`BUILTIN_COMMAND_ALLOWLIST` in `commandsApiImpl.ts`) of which built-ins are safe to expose - adding a new built-in command never silently widens what an already-permissioned extension can reach. Another extension's command (also `ext.`-prefixed, but under a different id) is never reachable this way; that is what `api.extensions.call` is for.
- The four permissions with no API behind them at all - `search:provide`, `import:provide`, `tts:provide`, `ai:provide` - were removed outright (schema, validator, consent dialog): don't ask the user to grant a capability the host cannot deliver. `display-mode:provide` was kept at the time because `ui.registerDisplayMode` existed and rejected loudly rather than doing nothing - but task 0024 round 3 (P2.13) later removed `ui.registerDisplayMode` itself as dead code, and `display-mode:provide` went with it, on the same rule.
- Found along the way: `bible:provide` was in the manifest JSON schema's permission enum but missing from `ExtensionManifestValidator`'s `ALLOWED_PERMISSIONS`, so a manifest declaring it - to use the real, already-implemented `bible:provide` gate in `bibleApiImpl.ts` - was unconditionally rejected at install time. Fixed as part of the same pass. Task 0024 round 3 later found and fixed the same class of bug twice more: `contributes.bibleProviders` (in the schema, missing from the validator's `contributes` allow-list) and `ui:media` (in the schema and in `Permissions.ts`'s type union, missing from `ALLOWED_PERMISSIONS`) - see `ExtensionManifestValidator.ts` and its new schema/validator parity test.

## Workspace: panel presence (`api.workspace`)

`getOpenPanels()`/`getActivePanel()` could see a panel, but an extension that owned a tab had no way to say anything about it beyond the status bar - no "5 due" on its own tab, no way to bring it forward from elsewhere in the UI.

| Method | Gate | Notes |
|---|---|---|
| `workspace.setPanelTitle(panelId, title)` | Restricted to panels whose `contentType` is the caller's own (`ext:<extensionId>.*`) | Renaming a built-in or another extension's tab would be a spoofing vector; `workspaceApiImpl.assertOwnsPanel` checks via the same synchronous `getOpenPanels()` cache read the unrestricted methods already use. Renderer side calls dockview's `panel.api.setTitle()` (`extensionRendererBridge.ts`'s `setPanelTitle` op) |
| `workspace.setPanelBadge(panelId, badge)` | Same ownership check | Writes into `extensionUiStore.panelBadges`; `DockviewTabRenderer.tsx` renders a small badge pill next to the tab title for `ext:`-content-type tabs |
| `workspace.revealPanel(panelId)` | Unrestricted, like `openPanel`/`closePanel` | Focuses an already-open tab without touching its content - calls the same `panel.api.setActive()` `navigateToVerseInPrimary` and the `revealNotesPanel`/`revealDictionaryPanel` helpers already use. Resolves `false` if the panel is no longer open |

`api.bible.navigateToVerse` already activates the Bible pane's tab (`sharedSlice.ts`'s `navigateToVerseInPrimary` calls `dockPanel.api.setActive()`) as of a change already on this branch before task 0024 - no host change was needed for that half of the "Show in Bible" case task 0032 asked for; `BibleApiImpl`'s `navigateToVerse` test closes the extension-API-facing half of the coverage.

## Settings, both directions (`storage.setSetting` / `ui.openSettings`)

Settings used to be read-only to the extension - the user could edit them through the form, `getSetting` could read them back, and that was the whole surface. Two gaps followed from that: an extension could not write its own setting (e.g. persist a token it obtained through an OAuth flow), and it had no way to send the user to its own settings page - only the ungated `commands.execute('app.openPreferences')`, which lands on the General section, not the extension's own.

| Method | Gate | Notes |
|---|---|---|
| `storage.setSetting(key, value)` | None beyond the schema check below - same reasoning as `getSetting`: a setting the extension declared in its own manifest is already its own | Rejects (`RpcProtocolError`) unless `key` names a property in the extension's own `contributes.configuration` and `value` type-checks against that property's declared type (and, for `enum`, is one of the declared values; for `number`/`integer`, within `minimum`/`maximum`). Implemented in `storageApiImpl.ts`, reusing `extensionSettingsSchema.ts`'s `extractFields`/`findField`/`validateSettingValue` - the same pure functions the settings form renders from, so the form and this call can never disagree about what is valid. Writes one `__settings.<key>` row (upsert, not the wholesale replace the form's `setSettings` does) and fires `settings.changed` to the extension's own worker, exactly as a user edit does |
| `ui.openSettings(section?)` | None | Opens the host's Extensions preferences page, expanded to the caller's own settings form. `section` optionally names one of the extension's own configuration keys (dot-path, e.g. `'advanced.endpoint'`) to scroll to. Routes through `RendererUiBridge.openSettings` (a fire-and-forget push, like `postPanelMessage`) to a `window` `CustomEvent` (`open-preferences-extension-settings`) that `App.tsx` listens for - the same shape as the pre-existing `open-preferences-fonts` event |

The settings **form** itself changed underneath both of these: `ExtensionsSection.tsx`'s hand-rolled inline form (which degraded `integer` to a text input saved as a string, flattened `array`/`object` to `String(value)`, and ignored `required`/`title`/nested groups entirely) is now `ExtensionSettingsRenderer.tsx` + `extensionSettingsSchema.ts` - both already existed, fully built, and were imported nowhere in production before this. `ExtensionsSection` also takes an `initialExpand` prop so `ui.openSettings` can pre-expand the right extension's row (and, via `ExtensionSettingsRenderer`'s `scrollToKey`, scroll to the named field) instead of just switching to the Extensions tab and leaving the user to find it.

Not fixed here: a `{ $ref: string }` `contributes.configuration` (a schema file reference rather than an inline object) still renders no fields and so accepts no `setSetting` key - `extractFields` does not resolve `$ref`, matching the form's pre-existing limitation. No manifest in this repository uses it.

## Lazy activation (task 0024 round 3, P1.5)

Every installed, enabled extension used to activate (spawn its worker) unconditionally at boot. `DeclaredContributions.ts` reads `contributes.commands`/`contributes.panelTypes` at load time and pre-registers a *placeholder* for each - an ordinary command/panel type as far as the palette, the Tools menu, the keyboard and the new-tab page are concerned - so the extension itself starts only on first real use.

**Activation events the host actually fires**, as of this round (`ActivationEvents.ts`'s `FIRED_ACTIVATION_EVENTS`):

| Event | Fires | Notes |
|---|---|---|
| `onStartupFinished` | Once, after the window is shown (`main.ts`'s boot sequence) | The one bare "activate at boot" event. Replaces the inert pre-round-3 `'onStartup'`, which is now rejected outright - there is no compatibility alias (`EXTENSION_API_VERSION` is `0.1.0`, pre-release; one first-party extension exists and was updated in the same round) |
| `onCommand:<fully-qualified command id>` | When a declared command's placeholder is invoked (palette, Tools menu, or its `shortcut`'s accelerator) and the extension is not already active | `RendererCommandBridge.invokeDeclared` |
| `onView:<short panel type id>` | When a declared panel type's content is about to mount and the extension is not already active | `extensionHandlers.ts`'s `extensions:getPanelTypeUiEntry` - every way a panel opens (palette, new-tab page, restored layout, pop-out) passes through this one handler |

The other prefixes in `ActivationEvents.ts` (`onLanguage:`, `onModuleInstalled:`, etc.) remain in the accepted vocabulary - declaring one is not an error - but the host has no firing site for them yet; `DeclaredContributions.warnOnUnfiredEvents()` logs a one-time note per extension to that effect. `'*'` (built-ins only) is now enforced by the validator and rejected unconditionally - there is no built-in-extension concept in this codebase, so nothing may legally declare it.

**The state machine**, per declared command id: `placeholder` (worker not active, the declared invoker is registered) -> `superseded` (the worker activated and called `api.commands.register` for the same id itself - the placeholder is disposed and the real registration takes over) -> back to `placeholder` if the real registration is later disposed (the worker deactivates, crashes, or disposes it itself) - the command comes back, it does not vanish. A declared command with a `handlerEndpoint` but no imperative registration is called directly via reverse RPC (`ExtensionHost.callWorkerEndpoint`, mirroring `commandsApiImpl.ts`'s own dispatch) once activation succeeds - `IRuntimeApi.expose`'s own doc comment already specified this: "the host may call before any imperative registration has run". A declared command with neither rejects as unresolved (logged once, not on every invocation) but the placeholder is left in place, so it starts working the moment the manifest or `activate()` is fixed. Panel types have no such states - `RendererUiBridge.registerPanelType` already replaces by key, so a declared pre-registration and a later imperative one are simply one row, written twice.

**A subtlety worth knowing if you touch this code:** `contributes.panelTypes[].id` is validated and stored in its LONG form (`ext.<publisher.name>.<id>`), like every other contribution id - but the renderer addresses a panel type by its SHORT id (`RendererUiBridge.registerPanelType`'s `${extensionId}.${def.id}` key, `extensionUiStore.ts`'s `contentType: ext:${extensionId}.${def.id}`). `RendererUiBridge.registerDeclaredPanelType` strips the prefix back off before registering; forgetting this produces a ghost panel type under a doubled prefix (`ext:ext.pub.name.ext.pub.name.panel`) that never collides with the real one and just silently never opens.

**`commands[].shortcut`** (deferred from P2.13, settled here): rides the existing native-menu-accelerator path, not `KeybindingService`. A declared command's `shortcut` is copied onto the placeholder's registration exactly as the imperative `api.commands.register({ shortcut })` path already does; `buildExtensionToolsSubmenu` (`buildMenuSpec.ts`) builds a Tools-menu entry with that accelerator for every visible extension command, dispatching by command id - so a shortcut on a not-yet-active extension's command activates it, exactly like a palette invocation. `KeybindingService`'s dedicated `'extension'` source is deliberately not fed yet: its `keydown` listener would double-fire alongside the OS accelerator, and its `user > extension > builtin` priority table has no built-ins registered in it today, so an `'extension'` entry would win every conflict by default rather than lose to one. A `shortcut` on a `hidden: true` command is rejected at validation time - `buildExtensionToolsSubmenu` skips hidden commands, so the accelerator would be silently unreachable.

**Concurrency:** `ExtensionHostLifecycle.activate` coalesces concurrent calls for the same extension id - a fixed bug, not new-for-this-feature: before this, two callers invoking `activate()` for the same extension in close succession (e.g. a shortcut fired twice while a worker was still spawning) could each spawn their own worker, since the only prior guard (`activeWorkers.has(id)`) does not become true until well after the worker process exists.

## Notifications that resolve with an action

`ui.showNotification`'s `opts.actions` was validated and sent to the renderer, and nothing rendered it - a toast was a message and a dismiss button, and the promise resolved the instant the toast was queued rather than when the user did anything. It now resolves with the clicked action's `id`, or `undefined` if dismissed, replaced, or auto-dismissed - the same "wait for the user" shape `showConfirm`/`showQuickPick`/`showInputBox` already have. `extensionUiStore.ts` tracks one resolver per notification (settled exactly once, by whichever of action-click / manual dismiss / timeout happens first); `ExtensionUiHost.tsx` renders `opts.actions` as buttons.

## Task progress in the status bar

`api.tasks.run` has always documented "the host shows a progress entry in the status bar"; `electron/main.ts` never supplied `taskStatusBridge` to `ExtensionHost`, so nothing did. `RendererTaskStatusBridge.ts` closes that by piggy-backing on the same status bar surface described in [Status Bar](status-bar.md#background-tasks) rather than a second one. `taskNotifier` (for `notifyOnComplete`) is wired the same pass, as a one-line adapter onto `uiBridge.showNotification`.

## Panel iframe SDK: verse events and popups

`packages/extension-ui/src/BibleExtUI.ts` declared `onActiveVerseChanged` and `showVersePopup`/`hideVersePopup` from the start; none of the three worked.

- **`onActiveVerseChanged`**: `useIframeBridge.ts` forwarded only `theme.changed` to panel iframes. It now also forwards `verse.activeChanged`, sourced from a new renderer-local pub/sub (`src/ui/extensions/activeVerseBroadcast.ts`) that `verseSlice.ts` publishes to from the same two call sites it already uses to IPC an active-verse change to workers (the same channel a worker extension gets via `api.events.subscribe('verse.activeChanged', ...)` - named `bible.onDidChangeActiveVerse` at the time this fix shipped, before task 0024 round 3's event-system unification) - so a panel iframe sees exactly the same active-verse changes a worker extension does, not a second, possibly-diverging notion of "active". The SDK's payload shape was also wrong: the channel's declared shape is `{ verseId, module } | null` (`ExtensionPointTypes.ts`; corrected from an earlier, never-implemented `{ verseId, source }` in the same round-3 pass), but `onActiveVerseChanged` expected a bare number. Fixed as a clean break (no SDK release has shipped) rather than a compat shim.
- **`showVersePopup(verseId, rect)` / `hideVersePopup()`**: `useIframeBridge.ts` accepted both and discarded them ("Future: wire to the host's verse popup overlay"). `showVersePopup` now translates `rect` (iframe-local) into host-page coordinates via the iframe element's own `getBoundingClientRect()` and shows a real popup - reusing `VersePreviewTooltip`, the same component the host's built-in cross-reference and note hovers use, rather than a bespoke extension-only one. Neither call is permission-gated beyond the panel already needing `ui:contribute-pane` to exist, matching `bible.navigateToVerse`'s existing trust model in the same bridge.

## Panel styling

A panel renders in a sandboxed iframe on its own `ext-ui://<extensionId>` origin, which shares nothing with the app's renderer by default - no stylesheet, no `<html data-theme>` attribute, no CSS custom properties. Two read-only stylesheets are served at the reserved `ext-ui://host` origin (already permitted by the panel CSP's `style-src`) so a panel author does not have to reinvent the app's visual language from guesswork:

- **`ext-ui://host/theme.css`** (`electron/extensions/hostThemeCss.ts`) - the app's ~143 `--theme-*` design tokens (`src/ui/styles/themes.css`), flattened to a single `:root` block for whichever theme the user currently has active. Link it before your own stylesheet and use the custom properties (`--theme-text-primary`, `--theme-bg-primary`, `--theme-accent`, `--theme-border-*`, ...) instead of hard-coded colors, and your panel follows the app's theme automatically, including a live theme switch. `create-bible-extension`'s scaffold links this and uses the tokens by default - see the generated `ui/index.html` / `ui/styles.css`.
- **`ext-ui://host/controls.css`** (`electron/extensions/hostControlsCss.ts`) - ready-made classes for the host's own toolbar/button chrome (`.control-toolbar`, `.control-toolbar-button`, `.control-nav-button`), built from the same tokens, for a panel that wants a toolbar matching the app's own `PaneToolbar.tsx` look rather than styling one from scratch.

Both are token/utility-class offers, not component takeovers: only `--`-prefixed custom properties and the named control classes are exported, never the app's full component CSS or layout rules - a panel's own layout stays its own. Icons are not separately served; an extension bundles whatever icon assets its own `ui/` folder needs, same as any other panel asset.

## Popping an extension panel out

Extension panels detach into their own window like any other pane. Two things stopped that working before:

- `POP_OUT_PANE_TYPE` is a plain record keyed by `PanelContentType`, and an extension panel's content type is `ext:<extensionId>.<panelTypeId>` - one per contributed panel, and not known until an extension registers, so the lookup always missed and the menu left the item off. `popOutPaneTypeFor()` in `src/ui/components/DockviewTabRenderer.tsx` handles the `ext:` prefix first and maps every extension panel to the single `'extension'` window kind; `parseExtensionContentType()` splits the identity back out on the **last** dot, because extension ids contain dots.
- There was no `'extension'` entry in `PaneType` / `PANE_CONFIGS` / `COMPONENT_MAP`. One config covers every extension panel: the panel is an iframe on the extension's own origin, so the host has nothing type-specific to configure, and what distinguishes one from another travels in the detach payload.

Only the panel's identity and its contributed title travel. The panel's state lives inside a sandboxed iframe on the extension's own origin, so the host cannot read it and must not try. A popped-out panel reloads from whatever its worker persisted, which is the same thing that happens when the user reopens it.

The load-bearing detail is in the main process: `registerExtUiProtocol` is called with no session, so it serves `session.defaultSession`, and detached windows reach it only because `WindowManager` sets no `partition`. Give them their own partition without registering the handler on that session and every extension panel window loads blank, silently - a protocol with no handler simply fails the request. See the comment in `electron/services/WindowManager.ts`, and [Pop-Out / Detach Pane](pop-out.md).

## Developing an extension outside this repository

Everything above describes extensions as the host sees them. This section is the other side: what a third-party author needs, and where it comes from. The platform was complete long before this path was — an author outside the monorepo could not `npm install` the SDK, had no editor validation for `extension.json`, no typed `api`, and no way to produce the artifact the installer accepts.

| Piece | Where |
|---|---|
| `scripts/pack-sdk.js` | `npm run pack:sdk` — builds and `npm pack`s `@bible/core` and `@bible/extension-testing` into `build/sdk/`. The bridge until those packages are published |
| `packages/create-extension/src/index.ts` | The scaffolder. `--local-sdk=<dir>` writes `file:` specifiers for the packed tarballs instead of version ranges |
| `packages/core/scripts/copy-assets.js` | Copies `ExtensionManifestSchema.json` into `dist/` after `tsc`. Nothing imports it, so `tsc` never emitted it, so it reached nobody outside this repo — which is its only audience |
| `packages/extension-testing/src/cli/validateCommand.ts` | `bible-ext validate` — manifest schema, then the files the manifest points at |
| `packages/extension-testing/src/cli/packageCommand.ts` | `bible-ext package` — the installable `.zip` |
| `packages/extension-testing/src/cli/createZip.ts` | Dependency-free ZIP writer (deflate via `node:zlib`), producing reproducible archives |
| `packages/extension-testing/src/cli/manifestAssets.ts` | The "does the file the manifest names actually exist" check, shared by both commands |
| `packages/extension-testing/src/cli/ignoreRules.ts` | `.extensionignore` matching |

Three decisions worth not re-litigating:

- **`@bible/core` is a type-only dependency for an extension**, imported with `import type` and erased at build. That is what lets an MIT-licensed extension use the API contract of a GPL-3.0-or-later package without linking it, and it is why the scaffold declares no `peerDependencies` — nobody `npm install`s an extension, so a peer range there was a claim with no consumer to honour it.
- **`createZip` takes no dependency.** `archiver` and `jszip` are both in this tree, but only transitively via electron-builder; depending on either would push a real dependency tree onto every extension author. The format needed is one method and three record types.
- **Archives are reproducible** — fixed entry timestamps, not mtimes — because `installFromCatalog` verifies a published SHA-256 before unpacking, and an author cannot publish a digest they cannot reproduce.

`manifestAssets.ts` deliberately does **not** re-check path shape. Absolute paths and `..` escapes are already rejected by `validatePackagePath` in `ExtensionManifestValidator.ts`, which every caller runs first; a second implementation of that rule is free to drift from the one the host actually enforces.

## Bundling a first-party extension

`packages/word-count-example` is a real extension package in this repository, and nothing referenced it from a build script - so it reached neither `npm run dev` nor a packaged installer, and `data/extensions/` was absent from the `extraResources` allowlist besides.

| File | Role |
|---|---|
| `scripts/stage-extensions.js` | Copies each package in its explicit `BUNDLED_EXTENSIONS` list into an extensions root, defaulting to `data/extensions/`. It never wipes that root - in a dev tree it also holds sideloaded extensions and every extension's `db/` directory and lifecycle log - and replaces only the directories it owns. Run by `npm run stage-extensions`; `--out=<dir>` retargets it for the curated config, which ships `build-data/` rather than `data/` |
| `electron-builder.yml` | One `extensions/<id>/**` line per bundled extension inside the `data` allowlist. Named per extension, **not** `extensions/**`: in a dev tree that directory also holds whatever the developer sideloaded or installed from a catalog, plus arbitrary per-extension user data |

The bundled list is deliberate and explicit rather than a glob over `packages/`, which also holds `@bible/core`, `@bible/extension-ui`, `@bible/extension-testing` and a scaffolder - none of them extensions. Whether a given extension ships in v1 is a product decision; the mechanism is one line in each of those two files.

Licensing here is the opposite of the module allowlist beside it: a bundled extension is our own source under a GPL-compatible licence (`word-count-example` is MIT, deliberately permissive so it can be copied as the starting point for someone else's extension), so there is no per-file redistribution right to check. What stays reviewable is *which* packages get bundled.

**Known limitation on packaged installs.** The extensions root is `join(getDataPath(), 'extensions')`, and `getDataPath()` resolves to `process.resourcesPath/data` in a packaged app - read-only for a `.deb`/`.rpm` install, inside the signed bundle on macOS, and a read-only squashfs mount for an AppImage. Discovery only reads, so a bundled extension still loads; but `ExtensionDatabaseRegistry` and `ExtensionLifecycleLogger` both write under that root, so a bundled extension that calls `api.storage.openDatabase()` will fail on those platforms until the extensions root is seeded into user-writable storage the way `resolveMainDbPath()` seeds `main.db`. `word-count-example` uses neither.

## Tests

- **Host / sandbox:** `electron/extensions/__tests__/` - including `SandboxEscape`, `RpcFuzzing`, `ApiSurfaceContract`, `TrustTiers`, `ExtensionCatalog`, `ExtensionMarketplace`, `ExtensionPermissionGuard`, `ExtensionSqlGuard`, `ExtensionRpcRouter`, `ExtensionWorkerProcess`, `ExtUiCsp`, `ExtUiProtocolHost`, `PanelChannel`, `UiTier2`, `DeveloperMode`, `CommandsContextIntegration` (permission gates + the built-in allowlist), `RendererTaskStatusBridge`, `TasksApi` (`showInStatusBar` filtering), `LazyActivation` (P1.5 end-to-end: boot laziness, enable/disable/auto-disable eligibility, `activate()` coalescing and failure retry), `DeclaredContributionsBridges` (the declared-command/panel-type placeholder state machine inside `RendererCommandBridge`/`RendererUiBridge` directly - one of the few files here that mocks `electron` to unit-test a production `Renderer*Bridge`)
- **Runtime:** `extension-runtime/__tests__/` - realm behaviour, guest bundle, bundle size, worker bootstrap, supervisor, smoke harness
- **UI:** `src/ui/components/extensions/ExtensionMarketplace.test.tsx`, `extensionSettingsSchema.test.ts`, `src/ui/components/extensions/useIframeBridge.test.tsx` (including `verse.activeChanged` forwarding and verse popups), `src/ui/extensions/contributedUi.test.tsx` (verse context menu + status bar), `src/ui/extensions/notifications.test.tsx` (action-click resolution), `src/ui/extensions/workspaceBridge.test.ts` (`setPanelTitle`/`setPanelBadge`/`revealPanel` renderer wiring), `src/ui/components/extensionPopOut.test.ts`, `src/ui/menu/extensionToolsMenu.test.ts`
- **SDK:** `packages/extension-ui/src/BibleExtUI.test.ts` - `onActiveVerseChanged`'s payload shape, `showVersePopup`/`hideVersePopup` request dispatch
- **Runtime endpoint binding:** `extension-runtime/__tests__/reverseEndpointBinding.test.ts` - that `api.runtime.expose` and `api.panels.onMessage` land in the table `handleReverseRequest` dispatches from
- **E2E:** `e2e/tests/extension-host-asar.spec.ts`
- `electron/extensions/__tests__/fakeSql.ts` is a hand-rolled in-memory `ISql`; it exists so these tests avoid better-sqlite3's Electron ABI. Adding a table or column to `extensionSchema.ts` usually means teaching `fakeSql` the new query shape. `makeZip.ts` beside it builds the archives the installer tests unpack.
