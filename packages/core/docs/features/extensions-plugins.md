# Extensions and Plugins

There are **two unrelated extensibility systems** in `@bible/core` with
confusingly similar names. `src/Extensions/` is the sandboxed, permissioned,
out-of-process **third-party extension API**. `src/Plugin/` is a small
**in-process hook registry** for first-party code. They share no code and no
concepts. Read the table below before touching either.

## The two systems

| | `src/Extensions/` | `src/Plugin/` |
|---|---|---|
| Audience | Third-party authors shipping an `extension.json` package | First-party code inside a consuming app |
| Isolation | Separate `utilityProcess` worker per extension, plus `ext-ui://` iframes | Same process, direct function calls |
| Transport | JSON-only RPC envelopes over `MessageChannelMain` / `postMessage` | None - `await handler(value)` |
| Security | Declared permissions, install-time consent, `ExtensionPermissionGuard` at every API boundary, signature verification, blocklist | None |
| Contents of core | **Types and validators only.** No runtime. | The actual runtime (`HookRegistry`, `PluginLoader`) |
| Runtime lives in | The consuming app - an extension host process plus a per-extension worker | The consuming app - a plugin manager on each side it runs |
| Versioning | `EXTENSION_API_VERSION` (`'1.0.0'`), additive-only | Unversioned |

Neither system is the other's successor. If you are asked to "add a hook", work
out first whether the caller is a sandboxed third-party extension (Extensions)
or first-party code in the app itself (Plugin).

## Files - `src/Extensions/` (the extension API contract)

| File | Purpose |
|---|---|
| `src/Extensions/ExtensionApiTypes.ts` | `BibleExtensionAPI` (the root object injected into each worker) plus every namespace interface: `IBibleApi`, `ICommentaryApi`, `IDictionaryApi`, `IBookApi`, `INotesApi`, `IHighlightsApi`, `IBookmarksApi`, `ICollectionsApi`, `ICommandsApi`, `IUiApi`, `IWorkspaceApi`, `IContextApi`, `IStorageApi`, `IL10nApi`, `IEventsApi`, `INetworkApi`, `IAuthApi`, `ITasksApi`, `IExtensionsApi`, `IAiApi`. Also `ExtensionPointId` and `EXTENSION_API_VERSION`. |
| `src/Extensions/ExtensionApiDtos.ts` | Every plain-JSON DTO crossing the boundary (`BibleVerseDto`, `CommentaryEntryDto`, `DecorationDto`, `KeybindingDescriptor`, `LocalizedString`, ...) plus `EXTENSION_API_ERROR_CODES`. Separated from the methods so the shapes can be locked independently. |
| `src/Extensions/ExtensionApiErrors.ts` | Error class hierarchy (`ExtensionApiError` base, `PermissionDeniedError`, ...) and `reviveExtensionApiError`. `error.code` is the wire-stable identifier. |
| `src/Extensions/ExtensionPointTypes.ts` | `ExtensionPointKind` (`event` \| `filter` \| `provider`), the `EXTENSION_POINT_KINDS` map, and the payload/return type maps for every host-emitted extension point. |
| `src/Extensions/ExtensionManifest.ts` | TypeScript shape of `extension.json`. |
| `src/Extensions/ExtensionManifestSchema.json` | JSON Schema (draft-07) for `extension.json` - the canonical authoring schema. |
| `src/Extensions/ExtensionManifestValidator.ts` | Hand-written validator mirroring the schema (avoids an AJV runtime dependency). Auto-prefixes contribution IDs to `ext.<id>.`, enforces the beyond-schema rules, returns `ManifestValidationError`s with a JSON-pointer-ish `path`. |
| `src/Extensions/ExtensionCatalog.ts` | Marketplace wire formats: `ExtensionCatalog`, `CatalogExtensionEntry`, `ExtensionBlocklist`, `BlocklistEntry`, and their validators. Untrusted network input. |
| `src/Extensions/Permissions.ts` | Every `PERM_*` identifier, the `ExtensionPermission` union, `DEFAULT_GRANTED_PERMISSIONS`, `SEPARATELY_PROMPTED_PERMISSIONS`, and the `ORDER_*` render-order constants. |
| `src/Extensions/ActivationEvents.ts` | `ACT_*` event identifiers/prefixes and helpers that compose the parameterized forms (`onView:bible`, `onCommand:ext.foo.bar`). |
| `src/Extensions/RpcEnvelope.ts` | `RpcRequest` / `RpcResponse` / `RpcEvent` / `RpcSubscribe` / `RpcUnsubscribe` / `RpcHeartbeat`, the `RpcEnvelope` union, and the `isRpcEnvelope` guard. |
| `src/Extensions/IExtensionHost.ts` | Host-side orchestrator contract: `loadAll`, `listExtensions`, `installExtension`, `uninstallExtension`, `enable`/`disable`, `activate`/`deactivate`, `fireActivationEvent`, `updatePermissions`, settings, crash log, log. |
| `src/Extensions/IExtensionRuntime.ts` | Worker-side runtime contract and `ExtensionInitPayload` (carries `installPath`, which is what makes `manifest.main` resolvable). |
| `src/Extensions/index.ts` | Barrel for the namespace. |
| `src/Extensions/README.md` | Folder navigation aid + the T3 deferred-features list. |

Tests: `src/__tests__/ExtensionsContract.test.ts` (version constant reachable
both ways, permission sets, order-constant separation, activation-event
composition, `isRpcEnvelope`, every extension point has a registered kind, error
codes in sync with the classes, `reviveExtensionApiError`),
`src/Extensions/ExtensionManifestValidator.test.ts`,
`src/Extensions/ExtensionCatalog.test.ts`.

### Why the `Extensions` namespace alias

`src/index.ts` exports the folder as a namespace, not flat:

```typescript
export * as Extensions from './Extensions';
export { EXTENSION_API_VERSION } from './Extensions/ExtensionApiTypes';
```

Because `src/Api/` already exports `IBibleApi`, `ICommentaryApi`,
`IDictionaryApi` - the host's *internal* IPC contract - and `ExtensionApiTypes.ts`
declares interfaces of exactly those names for the *third-party* contract. A flat
re-export would collide. Consumers write:

```typescript
import { Extensions, EXTENSION_API_VERSION } from '@bible/core';
const v: Extensions.BibleVerseDto = ...;
```

`EXTENSION_API_VERSION` is additionally re-exported at the root so host and
worker code can read it without the prefix. `ExtensionsContract.test.ts` asserts
both paths return the same value.

## Files - `src/Plugin/` (the in-process hook system)

| File | Purpose |
|---|---|
| `src/Plugin/HookRegistry.ts` | `HookRegistry<TFilterMap, TActionMap>` - typed filter and action hooks. `addFilter`/`applyFilters`/`applyFiltersSync`, `addAction`/`runActions`/`fireActions`, `hasFilters`/`hasActions`, `clear`. Registration returns an unsubscribe function. |
| `src/Plugin/PluginLoader.ts` | `PluginLoader<TContext>` - `register(manifest)`, `activateAll(contextFactory, moduleLoader)` in dependency order, per-plugin state tracking. |
| `src/Plugin/PluginTypes.ts` | `PluginManifest` (from a package.json `bible-plugin` field), `PluginState`, `PluginModule<TContext>`, `PluginLogger`, `BasePluginContext`, `IServerPluginContext`, `IClientPluginContext`, `PluginStorage`. |
| `src/Plugin/index.ts` | Barrel; flat-exported from `src/index.ts` via `export * from './Plugin'`. |

Tests: `src/__tests__/HookRegistry.test.ts`,
`src/__tests__/PluginLoader.test.ts`.

`HookRegistry` is also exported from the browser barrel `src/browser.ts` (along
with the `FilterHandler` / `ActionHandler` types), because client-side plugins run
in the renderer and need it there. `PluginLoader` is **not** in the browser barrel
- it reaches the filesystem, so a client needs its own loader.

## How it works

### Extensions

Core holds only the contract. The flow, with the runtime pieces named:

```
extension.json
  -> ExtensionManifestSchema.json               (canonical schema)
  -> validateExtensionManifest()                (src/Extensions/ExtensionManifestValidator.ts)
      auto-prefixes ids to ext.<id>.*, cross-checks network/CSP, rejects `..` paths
  -> manifest loader                            (consuming app)
  -> install-time consent
      DEFAULT_GRANTED_PERMISSIONS              auto-granted, no dialog
      SEPARATELY_PROMPTED_PERMISSIONS          own focused dialog
  -> extension host  (implements IExtensionHost)
      activation event fires  ->  spawn utilityProcess worker
      -> ExtensionInitPayload { manifest, installPath, grantedPermissions, ... }
      -> worker runtime  (implements IExtensionRuntime)
           resolves (installPath, manifest.main) into a file:// URL
           exposes BibleExtensionAPI over RPC
  <-> RpcEnvelope over MessageChannelMain
      isRpcEnvelope() validates shape on both sides; malformed -> RpcProtocolError
      every method call -> ExtensionPermissionGuard -> PermissionDeniedError on failure
```

Extension points come in three kinds (`EXTENSION_POINT_KINDS`):

- **event** - fire-and-forget, subscribers run in parallel, host does not await.
- **filter** - subscribers run sequentially; a non-`undefined` return becomes the
  next subscriber's payload. 2-second per-subscriber timeout.
- **provider** - subscribers run in parallel; results collected into one array
  ordered by each subscriber's `order` hint.

Render order is partitioned so a plugin cannot push core UI off the Z-stack:
built-ins get `ORDER_BUILTIN_MIN`..`MAX` (0-99), plugins get
`ORDER_PLUGIN_MIN`..`MAX` (100-1000, default 500), and the manifest validator
rejects a plugin declaring `order < 100`.

### Plugins (web)

```
discover package.json "bible-plugin" fields
  -> PluginLoader.register(manifest)                    state: 'discovered'
  -> PluginLoader.activateAll(contextFactory, moduleLoader)
      resolveDependencyOrder()                         manifest.dependencies
      per plugin: moduleLoader() -> PluginModule.activate(context)
                                                       state: 'activating' -> 'active' | 'error'

at runtime:
  hooks.addFilter('bible.verse.render', fn, priority)  -> unsubscribe fn
  await hooks.applyFilters('bible.verse.render', v)    -> waterfall, lower priority first
  hooks.fireActions('note.saved', payload)             -> fire-and-forget
```

`applyFilters`/`runActions` check `Map.has()` first, so an unhooked call site
costs nothing.

## Gotchas

- **`src/Extensions/` contains no runtime.** Every file there is types,
  constants, or a pure validator. The host process, the permission guard, the RPC
  router and the worker runtime all belong to the consuming app; core only says
  what shape they must take (`IExtensionHost`, `IExtensionRuntime`).

- **`ExtensionManifestSchema.json` and `ExtensionManifestValidator.ts` are two
  hand-maintained copies of the same rules.** The README calls the schema "the
  only validator"; the validator's own header says it mirrors the schema in
  TypeScript to avoid an AJV dependency. They can drift. Change both.

- **`instanceof` does not cross the host/worker boundary.** Each side has its own
  constructor for `PermissionDeniedError` and friends. Branch on `error.code`.
  Adding an error class means adding its code to `EXTENSION_API_ERROR_CODES` in
  `ExtensionApiDtos.ts`; `ExtensionsContract.test.ts` enforces the pairing.

- **`manifest.main` must be package-relative.** Absolute paths are rejected
  (`path.absolute`). A bare relative specifier handed to `import()` in the worker
  would resolve against the *runtime bundle*, not the extension - which is why
  `ExtensionInitPayload` carries `installPath` and `resolveEntry.ts` does the
  joining, rejecting anything that escapes it. `data:text/javascript,...` is also
  accepted; `file:`, `http(s):` and `node:` are not.

- **Install extensions under the per-user data directory, not the packaged
  resources directory.** A resources-relative root is read-only in a packaged app
  on Linux and macOS, and is replaced wholesale on every app update - which
  silently deletes user-installed extensions. Moving an existing install needs a
  migration plus a re-point of the `extensions` table's `install_path`.

- **Catalog validation promises shape, not trust.** `validateExtensionCatalog`
  stops malformed JSON from reaching the install path. The `sha256` in an entry
  is only as good as the connection that served it; provenance is decided after
  download by `verifyExtensionSignature` + `deriveTrustTier`. Unknown fields are
  preserved, not rejected, so a newer catalog format does not break an older app.

- **`applyFiltersSync` throws if a handler returns a Promise.** It is not a
  silent fallback - use `applyFilters` unless you control every handler.

- **`runActions` never throws.** It uses `Promise.allSettled` and
  `console.error`s rejections, so a failing action handler is invisible unless
  you read the console. `fireActions` does not even await that.

- **`PluginLoader` has no sandbox at all.** A plugin's `activate(context)` runs
  in-process with whatever the platform context hands it - potentially database
  access and route registration. It is a first-party mechanism; do not treat it
  as a place to run untrusted code.

## Related

- [`src/Extensions/README.md`](../../src/Extensions/README.md) is the navigation
  aid for the contract types themselves; each file's header comment carries the
  rationale for its own slice.
- [Data layer](data-layer.md) | [Module format](module-format.md) |
  [Search](search.md)
