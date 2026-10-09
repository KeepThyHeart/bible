/**
 * NotificationsSection.tsx
 *
 * Preferences > Notifications. A thin host for the shared `NotificationPreferences`
 * component: state lives in the main process (the settings document in the user
 * database, the device options and engine schedule in `notifications.json`), reached through the module client (`module:notifications:*`).
 */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { NotificationSettings, NotificationsViewState } from '@bible/core/browser';
import {
  NotificationPreferences,
  DEFAULT_NOTIFICATION_PREFERENCES_LABELS,
  type NotificationPreferencesLabels,
} from '@bible/ui';
import { useI18n } from '../../contexts/useI18n';
import { useModuleNamespace } from '../host/useModuleNamespace';
import { notificationsClient } from './notificationsAPI';

const LABEL_KEYS = Object.keys(
  DEFAULT_NOTIFICATION_PREFERENCES_LABELS
) as (keyof NotificationPreferencesLabels)[];

function NotificationsSectionBody() {
  const { t, locale } = useI18n();
  const [state, setState] = useState<NotificationsViewState | null>(null);
  const [failed, setFailed] = useState(false);
  const mounted = useRef(true);

  const apply = useCallback((next: NotificationsViewState) => {
    if (mounted.current) setState(next);
  }, []);

  const fail = useCallback(() => {
    if (mounted.current) setFailed(true);
  }, []);

  useEffect(() => {
    mounted.current = true;
    let unsubscribe: () => void;
    try {
      unsubscribe = notificationsClient.on('state-changed', apply);
    } catch {
      setFailed(true); // no module bridge (not running in Electron)
      return () => {
        mounted.current = false;
      };
    }
    notificationsClient.getState().then(apply, fail);
    return () => {
      mounted.current = false;
      unsubscribe();
    };
  }, [apply, fail]);

  const labels = useMemo(() => {
    const out = {} as NotificationPreferencesLabels;
    for (const key of LABEL_KEYS) {
      // `next`, `scheduled` and `dailyTime` carry `{time}` / `{count}` / `{source}` placeholders
      // that the shared component fills in itself; hand them back verbatim.
      out[key] = t(`notifications.${key}`, { time: '{time}', count: '{count}', source: '{source}' });
    }
    return out;
    // `t` re-binds when the locale changes.
  }, [t]);

  const formatTime = useCallback(
    (epochMs: number) => {
      try {
        return new Intl.DateTimeFormat(locale, { dateStyle: 'medium', timeStyle: 'short' }).format(epochMs);
      } catch {
        return new Date(epochMs).toLocaleString();
      }
    },
    [locale]
  );

  // Plural-aware "N scheduled" (ICU plural per locale).
  const formatScheduled = useCallback((count: number) => t('notifications.scheduledCount', { count }), [t]);

  if (failed) {
    return <p data-testid="notifications-error">{t('notifications.loadError')}</p>;
  }
  if (!state) {
    return <p data-testid="notifications-loading">{t('notifications.loading')}</p>;
  }

  const api = notificationsClient;

  const onSettingsChange = (settings: NotificationSettings): void => {
    setState({ ...state, settings }); // optimistic
    api.setSettings(settings).then(apply, fail);
  };

  return (
    <NotificationPreferences
      state={state}
      labels={labels}
      formatTime={formatTime}
      formatScheduled={formatScheduled}
      idPrefix="desktop-notify"
      onSettingsChange={onSettingsChange}
      onDeviceChange={(patch) => {
        api.setDevice(patch).then(apply, fail);
      }}
      onRequestPermission={() => {
        api
          .requestPermission()
          .then(() => api.getState())
          .then(apply, fail);
      }}
      onSendTest={() => {
        api.sendTest().catch(fail);
      }}
    />
  );
}

/** Holds the section back until the `notifications` catalog has loaded, so it never paints key placeholders. */
export function NotificationsSection() {
  return useModuleNamespace('notifications') ? <NotificationsSectionBody /> : null;
}
