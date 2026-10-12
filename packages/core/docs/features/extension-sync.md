# Extension sync

Which extension data syncs across a user's devices (end-to-end encrypted, like all sync). Only an extension's key-value store can sync, and only when the extension opts in.

## What syncs

- The `extension_storage` table (record kind `ext.kv`), one record per `(extension_id, key)`: `{ ext, key, value, updatedAt }`. Codec: `packages/core/src/Sync/codecs/extKv.ts`.
- Opt-in: the extension manifest sets `userData.sync: true` (`ExtensionUserDataConfig` in `packages/core/src/Extensions/ExtensionManifest.ts`). Default is off: nothing of the extension is pushed.
- The host passes the predicate to `createCoreCodecs({ extKvSyncs })` in `packages/core/src/Sync/codecs/RecordCodec.ts`. `extKvSyncs(extensionId)` is true for an extension that declared `userData.sync`. Without the option, no extension syncs.

## How the gate works

- `encode` returns `null` for a row whose extension is not opted in, so the engine does not push it. A tracked row that never reached the server is skipped for the session and not counted as pending forever; a row that already has a server version is marked synced and left alone (the server keeps its last version).
- `decode`, `upsert` and `remove` are not gated. A record that arrives from another device is applied even if this device has not opted in; opting in later uploads the local rows.
- Deletion of an extension's rows when it is uninstalled is not synced as a special case; row deletes sync like any other change for opted-in extensions.

## Deferred

- Per-table extension database sync: `ext.db` kinds stay opaque (not produced, not interpreted). `userData.databases[name].sync` is validated and ignored.
- A `storage.synced` API for extensions (an explicit synced namespace instead of the whole store).
- A `syncStatus` API so an extension can show whether its data is synced.

## Tests

`packages/core/src/__tests__/Sync/codecs/codecs.test.ts` (the `ext.kv opt-in gate` block).

See also: `sync-contracts.md`, `backup-format.md`.
