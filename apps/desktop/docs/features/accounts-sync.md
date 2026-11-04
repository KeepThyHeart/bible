# Accounts & Sync (desktop)

**Last verified:** 2026-10-12

Optional accounts with end-to-end encrypted sync of personal content (notes, highlights, bookmarks, study data, `.bn` file notes and opted-in extension data) between devices. The server only ever sees ciphertext. The protocol, record codecs, merge rules and crypto live in core: [Sync contracts](../../../../packages/core/docs/features/sync-contracts.md) and [Extension sync](../../../../packages/core/docs/features/extension-sync.md). This page covers what the desktop app adds. The feature is off by default and invisible until its flag is on.

## Files

### Main process: module

| File | Description |
|---|---|
| `electron/modules/accounts/manifest.ts` | Main-process manifest (`id: 'accounts'`, `flag: 'accounts'`, desktop only, activates on `onStartupFinished`). Data only |
| `electron/modules/accounts/index.ts` | Registers one `module:accounts:<method>` IPC handler per `AccountsApi` method and pushes `statusChanged`. Loads the sync stack lazily (first call, or a timer 5 s after launch that resumes a signed-in account). Pauses the engine before a backup restore and restarts it after |
| `electron/modules/accounts/service.ts` | The real wiring: safeStorage, the shared user DB, the network gateway, the Argon2 worker, the module-reference resolver, save dialogs, the extension opt-in predicate |
| `electron/modules/accounts/types.ts` | `AccountsApi`, `AccountsEvents`, `AccountsFailure` tokens and `DesktopSyncSettings` shared with the renderer |
| `electron/modules/accounts/accounts.test.ts` | Module tests |

### Main process: sync services

| File | Description |
|---|---|
| `electron/services/sync/DesktopSyncService.ts` | The brain, free of Electron imports (everything arrives through `DesktopSyncDeps`). One `AccountClient` per server URL; on unlock it installs the change tracker on the user DB and starts a `SyncEngine` with the core codecs plus the `.bn` adapter. Sign-in, sign-up, recovery, password change, key rotation, devices, delete account, server export. `toAccountsError` maps failures to tokens |
| `electron/services/sync/syncSettings.ts` | Non-secret settings file and `normalizeServerUrl` |
| `electron/services/sync/SafeStorageSecretStore.ts` | Keys and token encrypted with Electron `safeStorage`; refuses weak backends |
| `electron/services/sync/gatewayFetch.ts` | A `fetch` over `NetworkGateway.fetchBuffered` for the sync client |
| `electron/services/sync/scheduler.ts` | Engine timers (interval, resume, back online) and the 10 s local-change poller |
| `electron/services/sync/BnFileSyncAdapter.ts` | Syncs `.bn` file notes as `bn.file` records |
| `electron/services/sync/moduleRefResolver.ts` | Local module install id to portable module reference (the module abbreviation) and back |
| `electron/services/sync/__tests__/` | Tests for the above |

### Renderer

| File | Description |
|---|---|
| `src/ui/modules/accounts/manifest.ts`, `module.ts` | Renderer module manifest (flag `accounts`) and registration; contributes the Preferences section "Account & sync" (order 27) |
| `src/ui/modules/accounts/AccountSection.tsx` | The Preferences UI: server URL, sign up, sign in, unlock, recovery, devices, password, sign out, delete, export |
| `src/ui/modules/accounts/useAccountsStore.ts`, `accountsClient.ts` | Zustand store and the typed IPC client |
| `src/ui/modules/accounts/binding.ts`, `commands.ts`, `errors.ts`, `glyph.ts`, `labels.ts` | Status bar binding, commands, error-token messages, icon and labels |
| `src/ui/modules/accounts/AccountSection.test.tsx`, `accountsModule.test.ts` | Component and module tests |

## The flag

`accounts` is off by default and `requires` `localUserDb` (declared in `packages/core/src/Settings/FeatureFlags.ts`), so both must be on. With the flag off the module registers nothing and no sync code is loaded.

- **Main process:** the `KTH_FLAGS` environment variable, for example `KTH_FLAGS=localUserDb,accounts`. Ignored in a packaged app (`electron/modules/mainModules.ts`).
- **Renderer:** `VITE_KTH_FLAGS=localUserDb,accounts` baked into a demo or e2e build, or in a development build `localStorage['kth.flags'] = 'localUserDb,accounts'` (`src/ui/settings/featureFlags.ts`). Dev overrides are ignored in production builds.

Enable both sides, or the renderer shows no section while the main process serves it (or the reverse).

## Settings file

`<userData>/sync/accounts.json`, written atomically (temp file and rename) with mode 0600, in a 0700 folder. Fields:

| Field | Meaning |
|---|---|
| `v` | Always 1 |
| `serverUrl` | The sync server; `''` until set |
| `askPasswordEachLaunch` | Keep keys in memory only (see below) |
| `deviceId` | 16 lowercase hex characters, made once on first read and never changed |
| `email` | The remembered account email, or null |
| `signedIn` | Lets a launch show "locked" when the keys are not available |

No key, password or token is ever stored here. A damaged file is replaced by defaults with a new device id. Sibling files: `<userData>/sync/bn-state.json` (the `.bn` scan state, removed on sign-out) and `<userData>/secrets/sync-sync.unlocked.enc`, `sync-sync.token.enc` (the encrypted secrets).

## Keyring, weak stores, "ask for password each launch"

The unlocked keys and the session token are encrypted with Electron `safeStorage` (Keychain, DPAPI, libsecret or kwallet) and written with mode 0600. Nothing is ever written as plaintext.

- If the OS cannot encrypt, or on Linux the backend is `basic_text` (obfuscation only, reported as `secretStoreWeak`), the persistent store is not used: keys live in memory and every launch starts **locked**.
- The person can also choose **ask for the password at each launch** (`askPasswordEachLaunch`, set from the sign-in "remember" box or `setAskPasswordEachLaunch`). Same behaviour: memory only.
- A locked app shows an unlock prompt; `unlock({ password })` signs in again with the remembered email and the sync engine starts. Until then local editing works and nothing syncs.

## "Allow web requests"

Every server call goes through the network gateway (`gatewayFetch.ts`), which honours the app-wide **Allow web requests** switch. With it off, account actions fail with the network-blocked error (not "offline") and the engine does not sync; the settings reply carries `networkAllowed` so the UI can say so. Redirects are refused, so a key or token is never re-sent elsewhere, and responses are capped at 24 MiB.

## Server URL rules

`normalizeServerUrl` accepts `https:` URLs, and `http:` only for `localhost`, `127.0.0.1` and `[::1]`. No credentials, query or fragment, at most 2048 characters. The trailing slash is dropped. An empty string means "no server". The URL cannot be changed while signed in.

## Sign out and delete on desktop

Desktop never wipes the person's data. **Sign out** (with or without "wipe local") stops the engine, removes the change-tracking triggers and `sync_*` bookkeeping tables from the user database, deletes the `.bn` scan state and the stored secrets, and clears `signedIn` and `email`. Notes, highlights and the rest, and all `.bn` files, stay exactly as they are. **Delete account** removes the account and its data on the server (password required); the local bookkeeping and notes are likewise kept. Signing in again to the same or another account re-uploads what is on the device.

## `.bn` file notes

`BnFileSyncAdapter` syncs the notes folder's `.bn` files (hidden files, `.bak` history and temp files never sync). Each file is a `bn.file` record `{ path, bn, mtime }` keyed by its relative path, so two devices agree on a path regardless of case or Unicode form. Local changes are found by comparing mtime and size, then hashing. A file whose record would exceed the 1 MiB record limit is skipped with a `too-large` warning (shown under `bnWarnings` in the settings reply); invalid JSON and unreadable files are skipped too. Remote writes land after the database transaction commits; a remote delete renames the file to `<name>.bn.deleted-<date>.bak`, and a conflict keeps the loser as `<name> (conflicted copy YYYY-MM-DD).bn`.

## Extension key-value opt-in

Only an extension's key-value rows (`extension_storage`) sync, and only when its manifest sets `userData.sync: true` and it is enabled (`kvSyncOptIn` in `electron/main.ts`, passed to `createCoreCodecs({ extKvSyncs })`). Rows of other extensions never reach the server. See [Extension sync](../../../../packages/core/docs/features/extension-sync.md).

## Gotchas

- **Backup restore pauses sync**: the module waits for a running sync, restores, then resumes. A merge or replace restore on a synced database keeps record identities when the backup is from the same account, and falls back to plain 1.0 behaviour otherwise ([Backup & Restore](backup-restore.md)).
- **Module references are portable abbreviations**: highlights and similar rows refer to a Bible module by its abbreviation on the wire; a module that is not installed here leaves the record opaque until it is.
- **No global `fetch` in `electron/**`**: sync talks to the server only through the gateway adapter.
