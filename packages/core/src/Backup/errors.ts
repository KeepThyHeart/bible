/** Errors raised by the backup container and payload readers. Each has a distinct meaning for the UI. */

export class BackupError extends Error {
  constructor(message: string) {
    super(message);
    this.name = new.target.name;
    Object.setPrototypeOf(this, new.target.prototype);
  }
}

/** The bytes are not a backup file at all (wrong magic, too short). */
export class NotABackupError extends BackupError {}

/** The file was made by a newer version (higher major, unknown cipher or payload type, no usable slot, newer manifest or schema, an unknown required section). */
export class NewerFormatError extends BackupError {}

/** No key slot could be opened with the password: wrong password (or a tampered slot, which looks the same). */
export class WrongPasswordError extends BackupError {}

/** The file is damaged, truncated, reordered or tampered with (an authentication tag failed or the structure is malformed). */
export class DamagedError extends BackupError {}

/** The file is encrypted and no password was given. */
export class PasswordRequiredError extends BackupError {}
