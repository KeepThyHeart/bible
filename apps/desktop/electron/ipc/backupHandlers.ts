/**
 * Backup/Restore IPC Handlers
 *
 * Channels:
 *   backup:create       encrypted backup (.bbk); asks where to save
 *   backup:exportPlain  unencrypted portable export (.zip); asks where to save
 *   backup:selectFile   asks which file to restore from
 *   backup:inspect      opens and fully verifies a file, returns what restoring it would do (writes nothing)
 *   backup:apply        applies the chosen sections of the inspected file
 *   backup:discard      forgets the inspected file
 *
 * Uses the `Result<T>` envelope convention. The renderer side lives in
 * `src/ui/stores/useBackupStore.ts`, using `unwrap` from `src/ui/services/ipcResult.ts`.
 * Cancelling a save/open dialog resolves with `null`: that is success, not an error.
 * The expected ways a backup can fail to open have their own error codes so the
 * dialog can say something specific; see `mapBackupError`.
 */

import { dialog, app } from 'electron';
import log from 'electron-log/main';
import path from 'path';
import { Backup } from '@bible/core';
import type { ISql } from '@bible/core';
import { getSharedUserDb, getUserDbPath } from '../services/sharedUserDb';
import { getSharedModuleMetadataRepo } from '../services/sharedMainDb';
import {
  createEncryptedBackup, createPlainExport, inspectBackupFile, applyInspection, discardInspection, NoActiveInspectionError,
} from '../services/BackupService';
import type { BackupContext } from '../services/BackupService';
import type { ExtensionPort } from '../services/backup/nodeAdapters';
import { createWorkerKdf } from '../services/backup/workerKdf';
import { getFileNotesService } from './fileNotesHandlers';
import { ipcHandler, IpcKnownError } from './handler-helper';
import { t } from '../services/MainI18n';
import { APP_CONFIG } from '../config/appConfig';
import type { BackupApplyResult, BackupInspection, BackupSummary } from './backupTypes';

/** Minimum password length for backup encryption. A copied backup can be guessed at offline forever. */
export const MIN_PASSWORD_LENGTH = 10;

export interface BackupHandlerDeps {
  /** Extension data access, once the extension host is up (it boots after the handlers register). */
  getExtensionPort: () => ExtensionPort | undefined;
}

/**
 * Validate that a backup password meets the minimum requirement.
 * Returns an error string if it is too weak, or null if acceptable.
 */
export function validateBackupPassword(password: string): string | null {
  if (!password || password.length < MIN_PASSWORD_LENGTH) {
    return `Password must be at least ${MIN_PASSWORD_LENGTH} characters long`;
  }
  return null;
}

/** Turn the backup code's typed errors into classified IPC errors. */
export function mapBackupError(err: unknown): unknown {
  if (err instanceof Backup.PasswordRequiredError) return new IpcKnownError('backup_password_required', err.message);
  if (err instanceof Backup.WrongPasswordError) return new IpcKnownError('backup_wrong_password', err.message);
  if (err instanceof Backup.NewerFormatError) return new IpcKnownError('backup_newer_format', err.message);
  if (err instanceof Backup.NotABackupError) return new IpcKnownError('backup_not_a_backup', err.message);
  if (err instanceof Backup.DamagedError) return new IpcKnownError('backup_damaged', err.message);
  if (err instanceof Backup.RestoreError) return new IpcKnownError('backup_restore_failed', err.message);
  if (err instanceof NoActiveInspectionError) return new IpcKnownError('backup_inspection_expired', err.message);
  return err;
}

async function guarded<T>(fn: () => Promise<T>): Promise<T> {
  try {
    return await fn();
  } catch (err) {
    throw mapBackupError(err);
  }
}

const kdf = createWorkerKdf();

async function buildContext(deps: BackupHandlerDeps): Promise<BackupContext> {
  const sql: ISql = await getSharedUserDb();
  const notesDir = getFileNotesService()?.getNotesDir();
  const userDbPath = getUserDbPath();
  return {
    sql,
    appInfo: { name: APP_CONFIG.productName, version: APP_CONFIG.appVersion, platform: `desktop-${process.platform}` },
    notesDir,
    extensions: deps.getExtensionPort(),
    modules: async () => {
      try {
        return getSharedModuleMetadataRepo().getAll().map((m) => ({
          id: m.moduleUuid, type: m.moduleType, abbreviation: m.abbreviation, version: m.version, name: m.moduleName,
        }));
      } catch (err) {
        log.warn('[BackupHandlers] Could not list modules for the backup:', err);
        return [];
      }
    },
    kdf,
    snapshot: { root: path.join(path.dirname(userDbPath), 'pre-restore'), userDbPath },
  };
}

const stamp = (): string => new Date().toISOString().slice(0, 10);

/**
 * Register all backup/restore IPC handlers
 */
export function registerBackupHandlers(deps: BackupHandlerDeps): void {
  log.info('[BackupHandlers] Registering backup handlers');

  ipcHandler<[{ password: string; includeHistory: boolean }], BackupSummary | null>('backup:create', async (options) => {
    const passwordError = validateBackupPassword(options.password);
    if (passwordError) {
      log.warn('[IPC] backup:create - Weak password rejected');
      throw new IpcKnownError('invalid_input', passwordError);
    }
    const result = await dialog.showSaveDialog({
      title: t('main.dialog.saveBackup'),
      defaultPath: path.join(app.getPath('documents'), `bible-backup-${stamp()}.bbk`),
      filters: [
        { name: t('main.filter.bibleBackup'), extensions: ['bbk'] },
        { name: t('main.filter.allFiles'), extensions: ['*'] },
      ],
    });
    if (result.canceled || !result.filePath) return null;
    const ctx = await buildContext(deps);
    return guarded(() => createEncryptedBackup(ctx, {
      password: options.password,
      destinationPath: result.filePath,
      includeHistory: options.includeHistory === true,
    }));
  });

  ipcHandler<[{ includeHistory: boolean }], BackupSummary | null>('backup:exportPlain', async (options) => {
    const result = await dialog.showSaveDialog({
      title: t('main.dialog.saveExport'),
      defaultPath: path.join(app.getPath('documents'), `keep-thy-heart-export-${stamp()}.zip`),
      filters: [
        { name: t('main.filter.exportZip'), extensions: ['zip'] },
        { name: t('main.filter.allFiles'), extensions: ['*'] },
      ],
    });
    if (result.canceled || !result.filePath) return null;
    const ctx = await buildContext(deps);
    return guarded(() => createPlainExport(ctx, { destinationPath: result.filePath, includeHistory: options.includeHistory === true }));
  });

  ipcHandler<[], { path: string } | null>('backup:selectFile', async () => {
    const result = await dialog.showOpenDialog({
      title: t('main.dialog.selectBackup'),
      filters: [
        { name: t('main.filter.bibleBackup'), extensions: ['bbk', 'zip'] },
        { name: t('main.filter.allFiles'), extensions: ['*'] },
      ],
      properties: ['openFile'],
    });
    if (result.canceled || result.filePaths.length === 0) return null;
    return { path: result.filePaths[0] };
  });

  ipcHandler<[{ backupPath: string; password?: string }], BackupInspection>('backup:inspect', async (options) => {
    log.info('[IPC] backup:inspect');
    if (typeof options?.backupPath !== 'string' || options.backupPath.length === 0) {
      throw new IpcKnownError('invalid_input', 'backupPath is required');
    }
    const ctx = await buildContext(deps);
    return guarded(() => inspectBackupFile(ctx, { backupPath: options.backupPath, password: options.password }));
  });

  ipcHandler<[{ token: string; mode: 'merge' | 'replace'; sections: string[] }], BackupApplyResult>('backup:apply', async (options) => {
    log.info(`[IPC] backup:apply - mode: ${options?.mode}`);
    if (!options || (options.mode !== 'merge' && options.mode !== 'replace') || !Array.isArray(options.sections)) {
      throw new IpcKnownError('invalid_input', 'mode and sections are required');
    }
    const ctx = await buildContext(deps);
    return guarded(() => applyInspection(ctx, { token: options.token, mode: options.mode, sections: options.sections.map(String) }));
  });

  ipcHandler<[string], null>('backup:discard', (token) => {
    discardInspection(typeof token === 'string' ? token : undefined);
    return null;
  });

  log.info('[BackupHandlers] Backup handlers registered');
}
