/**
 * The notifications state file: `<userData>/notifications.json`.
 *
 * Holds two things that must NOT live in the (synced, per-user) user data:
 *   - `scheduler`: the reminder engine's checkpoints and item sources' pending
 *     sets (device-local: what this machine has already shown);
 *   - `device`: tray and start-at-login, which are per device.
 *
 * Writes are atomic (temp file + rename) so a crash mid-write cannot leave a
 * half-written file, and a corrupt or foreign file is tolerated: it reads as
 * empty and is replaced on the next save.
 */
import fs from 'fs';
import path from 'path';
import {
  DEFAULT_NOTIFICATION_DEVICE_SETTINGS,
  type NotificationDeviceSettings,
  type ReminderState,
  type ReminderStatePort,
} from '@bible/core/browser';

export interface NotificationsFile {
  version: 1;
  scheduler: ReminderState | null;
  device: NotificationDeviceSettings;
}

export function normalizeDeviceSettings(v: unknown): NotificationDeviceSettings {
  const o = (typeof v === 'object' && v !== null ? v : {}) as Record<string, unknown>;
  return {
    tray: typeof o.tray === 'boolean' ? o.tray : DEFAULT_NOTIFICATION_DEVICE_SETTINGS.tray,
    openAtLogin: typeof o.openAtLogin === 'boolean' ? o.openAtLogin : DEFAULT_NOTIFICATION_DEVICE_SETTINGS.openAtLogin,
  };
}

export class NotificationStateFile {
  private cache: NotificationsFile | null = null;

  constructor(
    private readonly filePath: string,
    private readonly onError: (err: unknown, context: string) => void = () => {},
  ) {}

  /** Read (once, then cached) the whole file; a missing or corrupt file reads as empty. */
  read(): NotificationsFile {
    if (this.cache) return this.cache;
    let out: NotificationsFile = { version: 1, scheduler: null, device: { ...DEFAULT_NOTIFICATION_DEVICE_SETTINGS } };
    try {
      const parsed: unknown = JSON.parse(fs.readFileSync(this.filePath, 'utf8'));
      if (typeof parsed === 'object' && parsed !== null && !Array.isArray(parsed)) {
        const p = parsed as Record<string, unknown>;
        const s = p.scheduler as ReminderState | null | undefined;
        out = {
          version: 1,
          scheduler: s && typeof s === 'object' && s.version === 1 ? s : null,
          device: normalizeDeviceSettings(p.device),
        };
      }
    } catch (err) {
      if ((err as NodeJS.ErrnoException)?.code !== 'ENOENT') this.onError(err, 'stateFile.read');
    }
    this.cache = out;
    return out;
  }

  private write(): void {
    const data = this.read();
    const tmp = `${this.filePath}.${process.pid}.tmp`;
    try {
      fs.mkdirSync(path.dirname(this.filePath), { recursive: true });
      fs.writeFileSync(tmp, JSON.stringify(data), 'utf8');
      fs.renameSync(tmp, this.filePath);
    } catch (err) {
      try {
        fs.rmSync(tmp, { force: true });
      } catch {
        /* nothing to clean */
      }
      this.onError(err, 'stateFile.write');
    }
  }

  getDevice(): NotificationDeviceSettings {
    return { ...this.read().device };
  }

  setDevice(device: NotificationDeviceSettings): void {
    this.read().device = normalizeDeviceSettings(device);
    this.write();
  }

  /** The scheduler's persistence port. */
  statePort(): ReminderStatePort {
    return {
      load: () => this.read().scheduler,
      save: (state) => {
        this.read().scheduler = state;
        this.write();
      },
    };
  }
}
