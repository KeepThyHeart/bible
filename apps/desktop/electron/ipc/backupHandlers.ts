/**
 * Backup/Restore IPC Handlers
 *
 * Registers IPC channels for backup creation, validation, and restoration.
 *
 * Uses the `Result<T>` envelope convention. The
 * renderer side lives in `src/ui/stores/useBackupStore.ts` which uses
 * `unwrap` from `src/ui/services/ipcResult.ts`. Cancellation (user dismissed
 * a save/open dialog) resolves with `null` - that is success, not an error.
 */

import { dialog, app } from 'electron';
import log from 'electron-log/main';
import path from 'path';
import fs from 'fs';
import { getSharedUserDb } from '../services/sharedUserDb';
import {
  createBackup,
  validateBackup,
  restoreBackup,
} from '../services/BackupService';
import { getFileNotesService } from './fileNotesHandlers';
import { ipcHandler, IpcKnownError } from './handler-helper';
import { t } from '../services/MainI18n';

/** Minimum password length for backup encryption. */
const MIN_PASSWORD_LENGTH = 8;

export interface BackupCreateResult {
  path: string;
  metadata?: any;
}

export interface BackupSelectResult {
  path: string;
}

export interface BackupValidateResult {
  valid: boolean;
  metadata?: any;
  error?: string;
}

export interface BackupRestoreResult {
  success: boolean;
  tablesRestored?: string[];
  rowCounts?: Record<string, number>;
  noteFilesRestored?: number;
  error?: string;
}

/**
 * Validate that a backup password meets minimum entropy requirements.
 * Returns an error string if the password is too weak, or null if acceptable.
 */
function validateBackupPassword(password: string): string | null {
  if (!password || password.length < MIN_PASSWORD_LENGTH) {
    return `Password must be at least ${MIN_PASSWORD_LENGTH} characters long`;
  }
  return null;
}

/**
 * Register all backup/restore IPC handlers
 */
export function registerBackupHandlers(): void {
  log.info('[BackupHandlers] Registering backup handlers');

  // -------------------------------------------------------------------------
  // Create backup - resolves with `null` if the user cancels the save dialog.
  // -------------------------------------------------------------------------
  ipcHandler<
    [{ password: string; includeHistory?: boolean }],
    BackupCreateResult | null
  >('backup:create', async (options) => {
    log.info('[IPC] backup:create - Starting backup creation');

    const passwordError = validateBackupPassword(options.password);
    if (passwordError) {
      log.warn('[IPC] backup:create - Weak password rejected');
      throw new IpcKnownError('invalid_input', passwordError);
    }

    const result = await dialog.showSaveDialog({
      title: t('main.dialog.saveBackup'),
      defaultPath: path.join(
        app.getPath('documents'),
        `bible-backup-${new Date().toISOString().slice(0, 10)}.bbk`
      ),
      filters: [
        { name: t('main.filter.bibleBackup'), extensions: ['bbk'] },
        { name: t('main.filter.allFiles'), extensions: ['*'] },
      ],
    });

    if (result.canceled || !result.filePath) {
      return null;
    }

    const destinationDir = path.dirname(result.filePath);
    const userDb = await getSharedUserDb();
    const notesDir = getFileNotesService()?.getNotesDir();

    const backupResult = await createBackup(userDb, {
      password: options.password,
      destinationPath: destinationDir,
      includeHistory: options.includeHistory,
      username: 'default',
      notesDir,
    });

    if (!backupResult.success || !backupResult.path) {
      throw new Error(backupResult.error || 'Backup failed');
    }

    if (backupResult.path !== result.filePath) {
      fs.renameSync(backupResult.path, result.filePath);
      backupResult.path = result.filePath;
    }

    return { path: backupResult.path, metadata: backupResult.metadata };
  });

  // -------------------------------------------------------------------------
  // Select backup file (for restore). Returns `null` on cancel.
  // -------------------------------------------------------------------------
  ipcHandler<[], BackupSelectResult | null>('backup:selectFile', async () => {
    const result = await dialog.showOpenDialog({
      title: t('main.dialog.selectBackup'),
      filters: [
        { name: t('main.filter.bibleBackup'), extensions: ['bbk'] },
        { name: t('main.filter.allFiles'), extensions: ['*'] },
      ],
      properties: ['openFile'],
    });

    if (result.canceled || result.filePaths.length === 0) {
      return null;
    }

    return { path: result.filePaths[0] };
  });

  // -------------------------------------------------------------------------
  // Validate backup and get metadata. Returns the raw validation result -
  // invalid backups are not an error, they are a `valid: false` response so
  // the UI can show a specific message.
  // -------------------------------------------------------------------------
  ipcHandler<[string, string], BackupValidateResult>(
    'backup:validate',
    async (backupPath, password) => {
      log.info('[IPC] backup:validate');
      return validateBackup(backupPath, password);
    }
  );

  // -------------------------------------------------------------------------
  // Restore backup. Returns the raw restore result including `success` so
  // the UI can distinguish soft failures (wrong password, bad data) from
  // hard failures (thrown exceptions -> `internal`).
  // -------------------------------------------------------------------------
  ipcHandler<
    [{ backupPath: string; password: string; mode: 'merge' | 'replace' }],
    BackupRestoreResult
  >('backup:restore', async (options) => {
    log.info(`[IPC] backup:restore - mode: ${options.mode}`);
    const userDb = await getSharedUserDb();
    const notesDir = getFileNotesService()?.getNotesDir();

    return restoreBackup(userDb, {
      password: options.password,
      backupPath: options.backupPath,
      mode: options.mode,
      notesDir,
    });
  });

  log.info('[BackupHandlers] Backup handlers registered');
}
