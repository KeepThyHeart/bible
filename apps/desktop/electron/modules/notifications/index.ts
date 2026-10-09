/**
 * Main-process half of the Notifications feature module (tasks 0083, 0128). The renderer's
 * Preferences page reads the view state, saves settings, changes device options (tray, start at
 * login), sends a test and asks for permission; the engine (`ElectronReminderHost`, published through
 * `getActiveReminderHost`) does the work. Replies use the `Result<T>` envelope.
 *
 * Channels are `module:notifications:<method>`. Events to the renderer (`state-changed`,
 * `open-target`) are sent by the engine on `module:notifications:event:<name>`.
 */
import type { NotificationDeviceSettings } from '@bible/core/browser';
import { IpcKnownError } from '../../ipc/result';
import { getActiveReminderHost } from '../../notifications/activeHost';
import type { ElectronReminderHost } from '../../notifications/ElectronReminderHost';
import type { FeatureMainModule } from '../FeatureMainModule';
import type { NotificationsApi } from './types';

function isPlainObject(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

const mainModule: FeatureMainModule = {
  id: 'notifications',
  registerIpc(ipc) {
    const host = (): ElectronReminderHost => {
      const h = getActiveReminderHost();
      if (!h) throw new IpcKnownError('unavailable', 'Notifications are not ready yet.');
      return h;
    };
    const handle = <K extends keyof NotificationsApi>(
      method: K,
      fn: (...args: Parameters<NotificationsApi[K]>) => ReturnType<NotificationsApi[K]> | Promise<ReturnType<NotificationsApi[K]>>,
    ): void => ipc.handle(method, fn as (...args: unknown[]) => unknown);

    handle('getState', () => host().getViewState());

    handle('setSettings', async (settings) => {
      if (!isPlainObject(settings)) throw new IpcKnownError('invalid_input', 'Notification settings must be an object.');
      return host().setSettings(settings);
    });

    handle('setDevice', (patch) => {
      if (!isPlainObject(patch)) throw new IpcKnownError('invalid_input', 'A device settings patch must be an object.');
      const clean: Partial<NotificationDeviceSettings> = {};
      for (const key of ['tray', 'openAtLogin'] as const) {
        if (patch[key] === undefined) continue;
        if (typeof patch[key] !== 'boolean') throw new IpcKnownError('invalid_input', `${key} must be true or false.`);
        clean[key] = patch[key] as boolean;
      }
      return host().setDevice(clean);
    });

    handle('sendTest', async () => {
      await host().sendTest();
    });

    handle('requestPermission', () => host().requestPermission());

    handle('takeOpenTarget', () => getActiveReminderHost()?.takeOpenTarget() ?? null);
  },
};

export default mainModule;
