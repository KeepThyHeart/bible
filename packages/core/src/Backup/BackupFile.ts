import { openStream, sniff } from './Envelope';
import type { OpenOptions } from './Envelope';
import { NotABackupError, PasswordRequiredError } from './errors';
import { readBackupPayload } from './Payload';
import type { BackupArchive, ReadOptions } from './Payload';
import { peek } from './Streams';
import type { ByteSource } from './Streams';

export interface OpenedBackupFile {
  /** The plaintext payload (a ZIP), whether or not the file was encrypted. */
  plain: ByteSource;
  encrypted: boolean;
}

/**
 * Look at the first bytes of a file and return its payload stream: decrypted
 * when it is an encrypted backup, as-is when it is a plain ZIP export.
 */
export async function openBackupFile(file: ByteSource, unlock?: { password: string }, opts: OpenOptions = {}): Promise<OpenedBackupFile> {
  const { head, all } = await peek(file, 16);
  const kind = sniff(head);
  if (kind === 'zip') return { plain: all, encrypted: false };
  if (kind !== 'bbk') {
    await all.return(undefined);
    throw new NotABackupError('Not a backup file');
  }
  if (!unlock) {
    await all.return(undefined);
    throw new PasswordRequiredError('This backup is encrypted; a password is required');
  }
  const opened = await openStream(all, unlock, opts);
  return { plain: opened.plain, encrypted: true };
}

/** Open, decrypt if needed, and fully verify a backup file. */
export async function readBackupFile(
  file: ByteSource,
  unlock?: { password: string },
  opts: OpenOptions & ReadOptions = {}
): Promise<BackupArchive & { encrypted: boolean }> {
  const { plain, encrypted } = await openBackupFile(file, unlock, opts);
  const archive = await readBackupPayload(plain, opts);
  return { ...archive, encrypted };
}
