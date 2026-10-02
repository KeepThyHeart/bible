/**
 * The system tray icon (opt-in, per device). Present only while the user has
 * "keep running in the tray" on; main.ts then hides the window on close
 * instead of quitting, so reminders keep firing.
 */
import { Menu, Tray, nativeImage } from 'electron';
import log from 'electron-log';

export interface TrayControllerOptions {
  iconPath: () => string | undefined;
  tooltip: () => string;
  labels: () => { open: string; settings: string; quit: string };
  showWindow: () => void;
  openSettings: () => void;
  quit: () => void;
}

export class TrayController {
  private tray: Tray | null = null;

  constructor(private readonly opts: TrayControllerOptions) {}

  get active(): boolean {
    return this.tray !== null;
  }

  /** Create the tray icon (no-op when it exists). Returns false if it could not be created. */
  enable(): boolean {
    if (this.tray) return true;
    try {
      const iconPath = this.opts.iconPath();
      const image = iconPath ? nativeImage.createFromPath(iconPath) : nativeImage.createEmpty();
      const tray = new Tray(image.isEmpty() ? image : image.resize({ width: 22, height: 22 }));
      tray.setToolTip(this.opts.tooltip());
      tray.setContextMenu(this.buildMenu());
      tray.on('click', () => this.opts.showWindow());
      this.tray = tray;
      return true;
    } catch (err) {
      log.warn('[notifications] could not create the tray icon:', err);
      this.tray = null;
      return false;
    }
  }

  /** Rebuild labels (after a locale change). */
  refreshMenu(): void {
    if (!this.tray) return;
    this.tray.setToolTip(this.opts.tooltip());
    this.tray.setContextMenu(this.buildMenu());
  }

  disable(): void {
    if (!this.tray) return;
    try {
      this.tray.destroy();
    } catch (err) {
      log.warn('[notifications] could not destroy the tray icon:', err);
    }
    this.tray = null;
  }

  private buildMenu(): Menu {
    const l = this.opts.labels();
    return Menu.buildFromTemplate([
      { label: l.open, click: () => this.opts.showWindow() },
      { label: l.settings, click: () => this.opts.openSettings() },
      { type: 'separator' },
      { label: l.quit, click: () => this.opts.quit() },
    ]);
  }
}
