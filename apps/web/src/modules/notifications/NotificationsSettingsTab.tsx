/**
 * Settings > Notifications. The shared `NotificationPreferences` body over the web reminder host's
 * view state. The web has no device section (no tray, no login item); when the browser cannot show
 * notifications the tab still renders and explains why.
 */
import { useSyncExternalStore } from 'preact/compat';
import { useEffect, useMemo } from 'preact/hooks';
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
  useEffect(() => { void h.start().catch(() => {}); }, [h]);
  const hostState: NotificationsViewState = useSyncExternalStore(h.store.subscribe, h.store.getSnapshot);
  // W-048: with browser permission denied nothing can ever fire, but the shared component only disables its
  // controls (and drops the duplicate per-source "blocked" line) for 'unsupported'. Present denied as
  // unsupported to it, with the denied text as its status; the stored preference is not touched.
  const denied = hostState.capabilities.permission === 'denied';
  const state: NotificationsViewState = useMemo(
    () => (denied ? { ...hostState, capabilities: { ...hostState.capabilities, permission: 'unsupported' } } : hostState),
    [hostState, denied],
  );

  const labels = useMemo(() => {
    const out = {} as NotificationPreferencesLabels;
    // The component fills these placeholders itself: hand them back untouched.
    const keep = { time: '{time}', count: '{count}', source: '{source}' };
    for (const k of LABEL_KEYS) out[k] = t(`notifications.labels.${k}`, keep);
    if (denied) out.statusUnsupported = out.statusDenied;
    return out;
  }, [t, denied]);

  return (
    <div class="settings-panel__section" data-section="notifications">
      <NotificationPreferences
        state={state}
        labels={labels}
        idPrefix="settings-notifications"
        formatScheduled={(count) => t('notifications.scheduledCount', { count })}
        onSettingsChange={(next) => { void h.setSettings(next); }}
        onRequestPermission={() => { void h.requestPermission(); }}
        onSendTest={() => { void h.sendTest(); }}
      />
    </div>
  );
}
