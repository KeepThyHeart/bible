/**
 * Settings > Notifications. The shared `NotificationPreferences` body over the web reminder host's
 * view state. The web has no device section (no tray, no login item); when the browser cannot show
 * notifications the tab still renders and explains why.
 */
import { useSyncExternalStore } from 'preact/compat';
import { useMemo } from 'preact/hooks';
import { useTranslation } from 'react-i18next';
import { NotificationPreferences } from '@bible/ui';
import type { NotificationPreferencesLabels } from '@bible/ui';
import type { NotificationsViewState } from '@bible/core/browser';
import { getWebReminders } from './webReminders';
import type { WebReminderHost } from './webReminders';

const LABEL_KEYS: (keyof NotificationPreferencesLabels)[] = [
  'statusGranted', 'statusDenied', 'statusPrompt', 'statusUnsupported', 'allow',
  'whenClosedFires', 'whenClosedNever', 'whenClosedBackgroundOnly', 'enabled',
  'quietHours', 'quietFrom', 'quietTo', 'quietHelp', 'sources', 'noSources', 'dailyTime',
  'next', 'scheduled', 'device', 'tray', 'openAtLogin', 'sendTest', 'general',
];

export function NotificationsSettingsTab({ host }: { host?: WebReminderHost }) {
  const { t } = useTranslation();
  const h = useMemo(() => host ?? getWebReminders(), [host]);
  // Starting is idempotent; it matters only when boot skipped it (unsupported browsers never get here).
  useMemo(() => { void h.start().catch(() => {}); }, [h]);
  const state: NotificationsViewState = useSyncExternalStore(h.store.subscribe, h.store.getSnapshot);

  const labels = useMemo(() => {
    const out = {} as NotificationPreferencesLabels;
    for (const k of LABEL_KEYS) out[k] = t(`notifications.labels.${k}`);
    return out;
  }, [t]);

  return (
    <div class="settings-panel__section" data-section="notifications">
      <NotificationPreferences
        state={state}
        labels={labels}
        idPrefix="settings-notifications"
        onSettingsChange={(next) => { void h.setSettings(next); }}
        onRequestPermission={() => { void h.requestPermission(); }}
        onSendTest={() => { void h.sendTest(); }}
      />
    </div>
  );
}
