/**
 * `api.reminders` - notifications the host shows for this extension (task 0083).
 */

import type { IRemindersApi } from '../../ExtensionApiTypes';
import { defineApiNamespace, FAKE_DISPOSABLE, fakeReturns } from '../defineApiNamespace';

export const remindersNamespace = defineApiNamespace<IRemindersApi>()({
  name: 'reminders',
  description: 'Schedule reminders the host shows as notifications, and hear when the user clicks one.',
  since: '0.2.0',
  optional: true,
  // The host attaches the namespace only for an extension holding the permission
  // (feature-detect with `typeof api.reminders`).
  availability: { whenGranted: 'notifications:schedule' },
  permissions: [
    {
      id: 'notifications:schedule',
      // Interrupts the user outside the app, so not default-granted; bounded (64
      // plain-text items, nothing leaves the machine), so not separately prompted.
      grant: 'prompt',
      consent: {
        key: 'extensionConsent.permission.notificationsSchedule',
        text: 'Show you reminders at times it chooses, even when the app is in the background.',
      },
      since: '0.2.0',
    },
  ],
  methods: {
    replaceAll: { permission: 'notifications:schedule', fake: fakeReturns({ accepted: 0 }) },
    list: { permission: 'notifications:schedule', fake: fakeReturns([]) },
    capabilities: { permission: 'notifications:schedule' },
    requestPermission: { permission: 'notifications:schedule' },
    takeActivations: { permission: 'notifications:schedule', fake: fakeReturns([]) },
    // Worker-side sugar over the `reminder.activated` / `reminder.missed` channels.
    onActivated: { permission: 'notifications:schedule', local: true, fake: FAKE_DISPOSABLE },
    onMissed: { permission: 'notifications:schedule', local: true, fake: FAKE_DISPOSABLE },
  },
  activationEvents: [
    {
      event: 'onReminder',
      fired: true,
      description: "Activate when the user clicks one of this extension's reminders.",
      since: '0.2.0',
    },
  ],
  events: {
    'reminder.activated': {
      kind: 'event',
      permission: 'notifications:schedule',
      description: "The user clicked one of this extension's reminders.",
      since: '0.2.0',
    },
    'reminder.missed': {
      kind: 'event',
      permission: 'notifications:schedule',
      description: "Reminders came due while they could not be shown (collapsed into one notice).",
      since: '0.2.0',
    },
  },
});
