/**
 * Worker side of `{op:'backup'}`: the privacy export built from the real OPFS database with core `Backup.*`
 * (every class the Registry exports: highlights, notes, bookmarks, Memory, ...), the same payload the desktop writes.
 * The password is used only to seal the file; it is never logged and never put in an error.
 */
import { Backup, type Sync } from '@bible/core/browser';
import type { ExtCtx } from './handler';
import type { UserDbRequest } from './protocol';

export const WEB_APP_INFO: Backup.AppInfo = { name: 'Keep Thy Heart', version: '0', platform: 'web' };

export interface BackupExportResult {
  bytes: Uint8Array;
  extension: 'zip' | 'bbk';
}

export interface BackupExportOptions {
  /** With a password the result is an encrypted `.bbk`; without one, the plain `.zip`. */
  password?: string;
  now?: () => Date;
  /** Injection point for tests (cheap KDF, deterministic randomness). */
  seal?: Parameters<typeof Backup.sealStream>[2];
}

export async function exportBackup(sql: Sync.ISql, options: BackupExportOptions = {}): Promise<BackupExportResult> {
  const payload = await Backup.createBackupPayload({ sql }, { includeHistory: false, app: WEB_APP_INFO, now: options.now });
  if (!options.password) return { bytes: payload.zip, extension: 'zip' };
  const sealed = Backup.sealStream(
    Backup.chunked(payload.zip, 64 * 1024),
    [{ type: 'password', password: options.password }],
    options.seal,
  );
  return { bytes: await Backup.collect(sealed), extension: 'bbk' };
}

/** The handler extension: `extensions.backup`. */
export async function handleBackup(req: Extract<UserDbRequest, { op: 'backup' }>, ctx: ExtCtx): Promise<BackupExportResult> {
  if (req.action === 'exportEncrypted') {
    if (!req.password) throw new Error('A password is required for an encrypted export');
    return exportBackup(ctx.sql, { password: req.password });
  }
  if (req.action === 'exportPlain') return exportBackup(ctx.sql);
  throw new Error('Unknown backup action');
}
