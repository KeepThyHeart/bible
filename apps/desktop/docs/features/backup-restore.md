# Backup & Restore

**Last verified:** 2026-09-26

Back up your data (notes, highlights, links, collections, study data, note files and extension data) to a single password-encrypted `.bbk` file, export an unencrypted copy, and restore either into this or another installation. The format itself - the encrypted container, the payload, the table registry, and the replace and merge rules - is specified in core: [Backup format](../../../../packages/core/docs/features/backup-format.md). This page covers what the desktop app adds.

## Files

### Components

| File | Description |
|---|---|
| `src/ui/components/BackupRestoreDialog.tsx` | Dialog with a Create Backup tab (password with a strength hint, history checkbox, and an unencrypted export behind a warning) and a Restore Backup tab (choose a file, unlock if encrypted, choose Merge or Replace, choose which groups to restore, see a preview and warnings, restore, read the outcome). Mounted unconditionally in `src/ui/App.tsx` and opened via `useBackupStore.getState().openDialog()`. Exports `passwordStrength` and `groupSections` for tests |
| `src/ui/components/BackupRestoreDialog.test.tsx` | Component tests for both tabs |

### State

| File | Description |
|---|---|
| `src/ui/stores/useBackupStore.ts` | Zustand store for the dialog: passwords and options, the open backup (`inspection`), the selected sections and mode, and every result and failure. Local validation (empty, mismatched or short password) happens here; main-process failures arrive as `backup_*` error codes the dialog turns into specific messages. Closing the dialog tells the main process to forget the open backup |
| `src/ui/stores/useBackupStore.test.ts` | Store tests with a mocked `window.electron.backup` |

### IPC Handlers (Main Process)

| File | Description |
|---|---|
| `electron/ipc/backupHandlers.ts` | Registers `backup:create` (encrypted), `backup:exportPlain` (unencrypted ZIP), `backup:selectFile`, `backup:inspect`, `backup:apply`, `backup:discard`. Owns the native save/open dialogs, the password rule (`MIN_PASSWORD_LENGTH`, 10 characters) and `mapBackupError`, which turns the format code's typed errors into classified IPC errors (`backup_password_required`, `backup_wrong_password`, `backup_newer_format`, `backup_damaged`, `backup_not_a_backup`, `backup_restore_failed`, `backup_inspection_expired`). Replies use the `Result<T>` envelope; a cancelled dialog resolves with `null`, which is success |
| `electron/ipc/backupTypes.ts` | Type-only reply types shared by the handlers, the preload and the renderer |
| `electron/ipc/allowedChannels.ts` | Allow-lists the six `backup:*` channels |
| `electron/preload.ts` | Exposes them as `window.electron.backup.{create,exportPlain,selectFile,inspect,apply,discard}` |

### Services (Main Process)

| File | Description |
|---|---|
| `electron/services/BackupService.ts` | A thin caller of `@bible/core`'s `Backup` code: `createEncryptedBackup`, `createPlainExport`, `inspectBackupFile`, `applyInspection`, `discardInspection`. Holds the one verified backup between inspect and apply (in memory only, expires after 30 minutes) |
| `electron/services/backup/nodeAdapters.ts` | The desktop's sides of core's interfaces: file streams (a backup is written to `<name>.partial` and renamed, so a failure never leaves a half-written file), the notes folder (`NotesDirStore`, refusing paths that escape it), extension data (`DesktopExtensionData`: manifests' `userData`, `VACUUM INTO` snapshots, writing databases back), and the pre-restore snapshot |
| `electron/services/backup/kdfWorker.ts`, `workerKdf.ts` | Argon2id in a `worker_threads` worker so the key derivation does not block the main process; `workerKdf.ts` falls back to deriving in-thread when the worker cannot start. `kdfWorker.ts` is its own entry in `electron.vite.config.ts` (`out/main/backup-kdf-worker.js`) |
| `electron/schema/userSchema.ts` | Stamps `PRAGMA user_version` with `Backup.USER_SCHEMA_VERSION` after creating the schema |
| `electron/services/__tests__/BackupService.test.ts` | Round trips against a real SQLite database with the app's own DDL and real files |
| `electron/services/__tests__/BackupRegistry.test.ts` | Drift test: the core table registry against the DDL this app creates |

## How it works

**Create.** The handler asks where to save, then `createEncryptedBackup` reads the selected tables, the notes folder and the extension data, builds the payload, and seals it with Argon2id (64 MiB, 3 passes) and AES-256-GCM. `backup:exportPlain` writes the payload ZIP itself; the dialog puts it behind a warning because anyone with that file can read it.

**Restore.** Two steps, so nothing changes before the person has seen what would happen:

1. `backup:inspect` opens the file (asking for the password only if it is encrypted), reads and verifies the whole of it, and returns a plan: sections with counts, warnings, columns this version does not have, and a dry-run preview of both modes.
2. `backup:apply` takes a **safety snapshot**, then restores the chosen sections. The snapshot is a copy of the (still encrypted) user database file and the notes folder in `<user data>/data/users/pre-restore/<timestamp>/`; the newest three are kept. If the snapshot cannot be written, nothing is restored. All database changes are one transaction; note files and extension databases are written after it commits, and a replace moves the existing notes folder aside (`<notes folder>.before-restore-<date>`) instead of deleting it.

Merge is the default: it adds the backup to the data already here, keeps everything you have, and does not duplicate what is already present. Replace is for a new computer or a reset. Saved sessions, layouts and keyboard shortcuts are restored by default only in Replace; search and navigation history is restored only when chosen. After a restore the app asks the person to restart it.

## Extension data

An extension's `extension.json` may declare `userData` (see [Backup format](../../../../packages/core/docs/features/backup-format.md#extension-data)): its key-value store is backed up unless it opts out, and each of its databases only when declared. The main process reads the declarations from the running extension host, so a backup taken before the host has finished starting carries no extension databases.

## Gotchas

- **Add new user tables to the registry** (`packages/core/src/Backup/Registry.ts`), or to its excluded list. The drift tests fail otherwise, which is the point: a table missing from a backup is silent data loss.
- **The verified backup lives in memory** between `backup:inspect` and `backup:apply`. It is dropped after an apply, when the dialog closes, or after 30 minutes.
- **Encryption is not optional for `.bbk`**: `backup:create` rejects a password shorter than 10 characters before the save dialog opens.
- **Highlights, pins and display options refer to Bible modules by their local number.** The plan warns about this; restoring onto a machine whose modules were installed in a different order can attach them to the wrong module.
- **The safety snapshot is a manual undo**: to go back, copy the snapshot's database file over `user_default.db` with the app closed. There is no "restore snapshot" button.
- **The extension-database restore closes the extension's open handles first**, then replaces the file; the extension sees the restored data the next time it opens the database.

## Not related to backups

`electron/providers/EncryptedSqliteProvider.ts` and `electron/utils/encryptionKeyManager.ts` encrypt the **live user database** (`electron/services/sharedUserDb.ts` opens it with a key from the OS keychain). They are not part of the backup path: a backup is encrypted with its own password-derived key and does not depend on the keychain, so it can be restored on another computer.
