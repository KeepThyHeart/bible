/**
 * NotificationPreferences: the Notifications settings page body. Controlled and store-free:
 * the caller passes a `NotificationsViewState` snapshot (from the engine, over IPC on desktop)
 * and receives the next settings / device patch through callbacks. Strings arrive as `labels`
 * (English defaults); all text is rendered as plain text.
 */
import type { ReactNode } from 'react';
import type {
  NotificationDeviceSettings,
  NotificationSettings,
  NotificationsViewState,
  QuietHours,
  ReminderPlan,
  Weekday,
} from '@bible/core/browser';

export interface NotificationPreferencesLabels {
  statusGranted: string;
  statusDenied: string;
  statusPrompt: string;
  statusUnsupported: string;
  allow: string;
  whenClosedFires: string;
  whenClosedNever: string;
  whenClosedBackgroundOnly: string;
  enabled: string;
  quietHours: string;
  quietFrom: string;
  quietTo: string;
  quietHelp: string;
  sources: string;
  noSources: string;
  /** Hint under a source the host has blocked (extension disabled or permission revoked). */
  blocked: string;
  /** `{source}` is replaced by the source label. */
  dailyTime: string;
  /** `{time}` is replaced by the formatted next fire. */
  next: string;
  /** `{count}` is replaced by the number of pending items. */
  scheduled: string;
  device: string;
  tray: string;
  openAtLogin: string;
  sendTest: string;
  general: string;
}

export const DEFAULT_NOTIFICATION_PREFERENCES_LABELS: NotificationPreferencesLabels = {
  statusGranted: 'Notifications are allowed.',
  statusDenied: 'Notifications are blocked. Allow them in your system or browser settings.',
  statusPrompt: 'Notifications are not allowed yet.',
  statusUnsupported: 'This browser or device cannot show notifications.',
  allow: 'Allow notifications',
  whenClosedFires: 'Reminders keep arriving while the app runs in the tray.',
  whenClosedNever: 'Reminders arrive only while the app is open.',
  whenClosedBackgroundOnly: 'Reminders arrive while the app is open, even in the background.',
  enabled: 'Show notifications',
  quietHours: 'Quiet hours',
  quietFrom: 'From',
  quietTo: 'To',
  quietHelp: 'Notifications due in quiet hours wait until they end.',
  sources: 'Reminders',
  noSources: 'No features use notifications yet.',
  blocked: 'Turned off because the extension is disabled or lacks permission.',
  dailyTime: 'Time for {source}',
  next: 'Next: {time}',
  scheduled: '{count} scheduled',
  device: 'When the window is closed',
  tray: 'Keep running in the tray',
  openAtLogin: 'Start when I log in (in the tray)',
  sendTest: 'Send a test notification',
  general: 'General',
};

export interface NotificationPreferencesProps {
  state: NotificationsViewState;
  onSettingsChange(next: NotificationSettings): void;
  /** The device section is shown only when `state.device` is set. */
  onDeviceChange?(patch: Partial<NotificationDeviceSettings>): void;
  onRequestPermission?(): void;
  onSendTest?(): void;
  formatTime?(epochMs: number): string;
  /** Plural-aware "{count} scheduled"; falls back to the `scheduled` label. */
  formatScheduled?(count: number): string;
  labels?: Partial<NotificationPreferencesLabels>;
  idPrefix?: string;
}

const DEFAULT_QUIET: QuietHours = { start: '21:30', end: '07:00' };
const ALL_DAYS: Weekday[] = [0, 1, 2, 3, 4, 5, 6];

function defaultFormatTime(epochMs: number): string {
  return new Date(epochMs).toLocaleString();
}

function firstFixedTime(plan: ReminderPlan | null): string {
  const slot = plan?.slots.find((s) => s.kind === 'fixed');
  return slot && slot.kind === 'fixed' ? slot.time : '';
}

function dailyPlan(existing: ReminderPlan | null, time: string): ReminderPlan {
  const only = existing && existing.slots.length === 1 ? existing.slots[0] : undefined;
  const days = only && only.kind === 'fixed' ? only.days : ALL_DAYS;
  return { slots: [{ id: 'daily', kind: 'fixed', time, days }] };
}

export function NotificationPreferences({
  state,
  onSettingsChange,
  onDeviceChange,
  onRequestPermission,
  onSendTest,
  formatTime = defaultFormatTime,
  formatScheduled,
  labels,
  idPrefix = 'notify',
}: NotificationPreferencesProps) {
  const l: NotificationPreferencesLabels = { ...DEFAULT_NOTIFICATION_PREFERENCES_LABELS, ...labels };
  const { settings, capabilities } = state;
  const unsupported = capabilities.permission === 'unsupported';
  const off = !settings.enabled || unsupported;
  const quiet = settings.quiet;

  const setSource = (id: string, patch: { enabled?: boolean; plan?: ReminderPlan }): void => {
    onSettingsChange({
      ...settings,
      sources: { ...settings.sources, [id]: { ...settings.sources[id], ...patch } },
    });
  };
  const setQuiet = (next: QuietHours | null): void => onSettingsChange({ ...settings, quiet: next });

  const status =
    capabilities.permission === 'granted'
      ? l.statusGranted
      : capabilities.permission === 'denied'
        ? l.statusDenied
        : capabilities.permission === 'prompt'
          ? l.statusPrompt
          : l.statusUnsupported;
  const whenClosed =
    capabilities.whenClosed === 'fires'
      ? l.whenClosedFires
      : capabilities.whenClosed === 'never'
        ? l.whenClosedNever
        : l.whenClosedBackgroundOnly;

  const sw = (id: string, label: string, checked: boolean, disabled: boolean, onChange: (v: boolean) => void): ReactNode => (
    <div className="kth-notify-prefs__switch">
      <input
        id={id}
        type="checkbox"
        role="switch"
        checked={checked}
        disabled={disabled}
        onChange={(e) => onChange(e.currentTarget.checked)}
      />
      <label htmlFor={id}>{label}</label>
    </div>
  );

  return (
    <div className="kth-notify-prefs">
      <fieldset className="kth-fieldset">
        <legend>{l.general}</legend>
        <p className={unsupported ? 'kth-notify-prefs__status kth-notify-prefs__hint' : 'kth-notify-prefs__status'} role="status">{status}</p>
        {capabilities.permission === 'prompt' && onRequestPermission && (
          <button type="button" className="kth-btn kth-notify-prefs__hint" onClick={() => onRequestPermission()}>
            {l.allow}
          </button>
        )}
        {!unsupported && <p className="kth-field__hint kth-notify-prefs__hint">{whenClosed}</p>}
        <div className="kth-field">
          {sw(`${idPrefix}-enabled`, l.enabled, settings.enabled && !unsupported, unsupported, (v) => onSettingsChange({ ...settings, enabled: v }))}
        </div>
        <div className="kth-field">
          {sw(`${idPrefix}-quiet`, l.quietHours, quiet !== null, off, (v) => setQuiet(v ? { ...DEFAULT_QUIET } : null))}
          {quiet !== null && (
            <div className="kth-notify-prefs__times">
              <label htmlFor={`${idPrefix}-quiet-start`}>{l.quietFrom}</label>
              <input
                id={`${idPrefix}-quiet-start`}
                className="kth-input"
                type="time"
                value={quiet.start}
                disabled={off}
                onChange={(e) => setQuiet({ ...quiet, start: e.currentTarget.value })}
              />
              <label htmlFor={`${idPrefix}-quiet-end`}>{l.quietTo}</label>
              <input
                id={`${idPrefix}-quiet-end`}
                className="kth-input"
                type="time"
                value={quiet.end}
                disabled={off}
                onChange={(e) => setQuiet({ ...quiet, end: e.currentTarget.value })}
              />
            </div>
          )}
          <p className="kth-field__hint">{l.quietHelp}</p>
        </div>
      </fieldset>

      <fieldset className="kth-fieldset">
        <legend>{l.sources}</legend>
        {state.sources.length === 0 && <p className="kth-field__hint">{l.noSources}</p>}
        {state.sources.map((source) => {
          const blocked = source.allowed === false;
          const rowOff = off || blocked;
          const base = `${idPrefix}-src-${source.id.replace(/[^A-Za-z0-9_-]/g, '-')}`;
          return (
            <div key={source.id} className="kth-field" data-source-id={source.id}>
              {sw(base, source.label, source.enabled, rowOff, (v) => setSource(source.id, { enabled: v }))}
              {source.description && (
                <p id={`${base}-description`} className="kth-field__hint">{source.description}</p>
              )}
              {blocked && (
                <p id={`${base}-blocked`} className="kth-field__hint">{l.blocked}</p>
              )}
              {source.enabled && source.kind === 'rules' && source.userEditable && (
                <div className="kth-notify-prefs__times">
                  <label htmlFor={`${base}-time`}>{l.dailyTime.replace('{source}', () => source.label)}</label>
                  <input
                    id={`${base}-time`}
                    className="kth-input"
                    type="time"
                    value={firstFixedTime(source.plan)}
                    disabled={rowOff}
                    onChange={(e) => {
                      const time = e.currentTarget.value;
                      if (time) setSource(source.id, { plan: dailyPlan(source.plan, time) });
                    }}
                  />
                </div>
              )}
              {source.nextAt !== null && (
                <p className="kth-field__hint">{l.next.replace('{time}', () => formatTime(source.nextAt as number))}</p>
              )}
              {source.kind === 'items' && (
                <p className="kth-field__hint">
                  {formatScheduled ? formatScheduled(source.pending) : l.scheduled.replace('{count}', () => String(source.pending))}
                </p>
              )}
            </div>
          );
        })}
      </fieldset>

      {state.device && (
        <fieldset className="kth-fieldset">
          <legend>{l.device}</legend>
          <div className="kth-field">
            {sw(`${idPrefix}-tray`, l.tray, state.device.tray, unsupported || state.deviceSupport?.tray === false, (v) =>
              onDeviceChange?.({ tray: v }),
            )}
          </div>
          <div className="kth-field">
            {sw(`${idPrefix}-login`, l.openAtLogin, state.device.openAtLogin,
              unsupported || state.deviceSupport?.openAtLogin === false || (!state.device.tray && !state.device.openAtLogin), (v) =>
              onDeviceChange?.({ openAtLogin: v }),
            )}
          </div>
        </fieldset>
      )}

      {onSendTest && (
        <button type="button" className="kth-btn" disabled={unsupported} onClick={() => onSendTest()}>
          {l.sendTest}
        </button>
      )}
    </div>
  );
}
