# Backup & Restore

**Last verified:** 2026-09-08

Backup and restore user data (notes, verse links, markup, collections, sessions) as a single password-encrypted `.bbk` file.

## Files

### Components

| File | Description |
|---|---|
| `src/ui/components/BackupRestoreDialog.tsx` | Dialog for creating/restoring backups, with a Backup tab and a Restore tab; mounted unconditionally in `src/ui/App.tsx` and opened via `useBackupStore.getState().openDialog()` (which takes the tab to open on, defaulting to `'backup'`) |
| `src/ui/components/BackupRestoreDialog.test.tsx` | Component tests for the dialog |

### State

| File | Description |
|---|---|
| `src/ui/stores/useBackupStore.ts` | Zustand store for dialog visibility, the active tab, the `includeHistory` option, and backup/restore state and progress |

### IPC Handlers (Main Process)

| File | Description |
|---|---|
| `electron/ipc/backupHandlers.ts` | Registers `backup:create`, `backup:selectFile`, `backup:validate`, `backup:restore`; owns the native save/open dialogs and the password-strength gate (`validateBackupPassword`, minimum 8 characters). Replies use the `Result<T>` envelope; a cancelled save/open dialog resolves with `null`, which is success rather than an error |
| `electron/ipc/allowedChannels.ts` | Allow-lists the four `backup:*` channels |
| `electron/preload.ts` | Exposes them to the renderer as `window.electron.backup.{create,selectFile,validate,restore}` |

### Services (Main Process)

| File | Description |
|---|---|
| `electron/services/BackupService.ts` | `createBackup` / `validateBackup` / `restoreBackup` / `restoreNoteFiles`; serializes user-database tables plus the file-notes directory to one JSON payload and seals it |
| `electron/services/__tests__/BackupService.test.ts` | Unit tests for the envelope, table selection, and note-file restore path |

## What is in a backup

A `.bbk` file is **not** a copy of the SQLite databases and not a zip archive. It is a UTF-8 JSON envelope (`magic: "bible-app-backup"`, `version: 1`) whose `ciphertext` is the AES-256-GCM-encrypted payload `{ metadata, tables: { <name>: Row[] }, files: { <relpath>: contents } }`. The key is derived from the user's password with scrypt (`N: 16384, r: 8, p: 1, keyLen: 32`); salt, IV, auth tag and KDF parameters travel in the clear part of the envelope.

**Encryption is not optional** - `backup:create` rejects a weak or missing password before the save dialog opens.

Table selection lives in `BackupService.ts`:

| Group | Tables | When |
|---|---|---|
| `CRITICAL_TABLES` | `user_note`, `verse_link`, `note_verse_link`, `content_verse_link`, `journal_verse_link`, `user_text_markup`, `user_commentary`, `collection`, `pinned_item` | Always |
| `IMPORTANT_TABLES` | `session` | Always |
| `HISTORY_TABLES` | `user_search_history`, `navigation_history` | Only when `includeHistory` is set |

`verse_link` is the unified verse-link table that every user link to scripture lands in. The three per-type link tables beside it are also listed, so a database that has not migrated still round-trips. Omitting any of them is a silent data-loss path, so add new user tables here when you add them.

File notes (the `.bn` files under the notes directory, resolved by `getFileNotesService()?.getNotesDir()` in `electron/ipc/fileNotesHandlers.ts`) are collected into `payload.files`, keyed by notes-dir-relative POSIX path. `.bak` note history is included only when `includeHistory` is set, and `metadata.noteFiles` records how many files were bundled. `restoreNoteFiles` writes them back, rejecting any path that would escape the notes directory. `files` is optional, so an archive taken before file-notes support still validates.

Restore takes a `mode` of `'merge'` or `'replace'`. In `'merge'` mode a note file that already exists on disk is left alone rather than overwritten.

## Not related to backups

`electron/providers/EncryptedSqliteProvider.ts` and `electron/utils/encryptionKeyManager.ts` encrypt the **live user database** (`electron/services/sharedUserDb.ts` opens it with a key from the OS keychain). They are not part of the backup path - `BackupService` does its own scrypt/AES-GCM.
