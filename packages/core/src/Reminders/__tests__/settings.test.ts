import { describe, expect, it } from 'vitest';
import { MemoryUserDb } from '../../UserData';
import {
  DEFAULT_NOTIFICATION_SETTINGS,
  NOTIFICATIONS_COLLECTION,
  NOTIFICATIONS_OWNER,
  NOTIFICATIONS_SETTINGS_KEY,
  NotificationSettingsStore,
  isSourceEnabled,
  normalizeNotificationSettings,
  normalizeQuietHours,
  normalizeReminderPlan,
  type NotificationSettings,
} from '../settings';
import { UserDataItem } from '../../Data/Models/User/UserDataItem';

const defaults: NotificationSettings = { version: 1, enabled: true, quiet: null, sources: {} };

describe('normalizeNotificationSettings', () => {
  it('returns defaults for null, undefined, arrays and scalars', () => {
    for (const v of [null, undefined, [], 'x', 42, true]) {
      expect(normalizeNotificationSettings(v)).toEqual(defaults);
    }
  });

  it('returns a fresh sources object, never the shared default', () => {
    const a = normalizeNotificationSettings(null);
    a.sources['x'] = {};
    expect(normalizeNotificationSettings(null).sources).toEqual({});
    expect(DEFAULT_NOTIFICATION_SETTINGS.sources).toEqual({});
  });

  it('falls back field by field on garbage', () => {
    const s = normalizeNotificationSettings({ enabled: 'yes', quiet: { start: 'x', end: '07:00' }, sources: 'nope' });
    expect(s).toEqual(defaults);
  });

  it('keeps enabled=false and valid quiet hours (trimmed)', () => {
    const s = normalizeNotificationSettings({ enabled: false, quiet: { start: ' 21:30 ', end: '07:00' } });
    expect(s.enabled).toBe(false);
    expect(s.quiet).toEqual({ start: '21:30', end: '07:00' });
  });

  it('keeps valid sources and plans, drops non-object sources and empty ids', () => {
    const plan = {
      slots: [{ id: 'daily', kind: 'fixed', time: '08:00', days: [0, 1, 2, 3, 4, 5, 6] }],
      quiet: { start: '22:00', end: '06:00' },
      maxPerDay: 3,
    };
    const s = normalizeNotificationSettings({
      sources: {
        'app:votd': { enabled: true, plan },
        'ext:x': { enabled: false },
        'bad': 'str',
        'arr': [],
        '': { enabled: true },
      },
    });
    expect(Object.keys(s.sources).sort()).toEqual(['app:votd', 'ext:x']);
    expect(s.sources['app:votd']).toEqual({ enabled: true, plan });
    expect(s.sources['ext:x']).toEqual({ enabled: false });
  });

  it('ignores non-boolean enabled in a source and a non-plan plan', () => {
    const s = normalizeNotificationSettings({ sources: { a: { enabled: 'true', plan: { nope: 1 } } } });
    expect(s.sources.a).toEqual({});
  });

  it('is idempotent', () => {
    const raw = {
      enabled: true,
      quiet: { start: '21:30', end: '07:00' },
      sources: { a: { enabled: true, plan: { slots: [{ id: 's', kind: 'date', date: '2026-02-03', time: '09:00' }] } } },
    };
    const once = normalizeNotificationSettings(raw);
    expect(normalizeNotificationSettings(once)).toEqual(once);
  });
});

describe('normalizeReminderPlan', () => {
  const fixed = { id: 'a', kind: 'fixed', time: '08:00', days: [1, 2] };

  it('returns null for non-plans', () => {
    expect(normalizeReminderPlan(null)).toBeNull();
    expect(normalizeReminderPlan({})).toBeNull();
    expect(normalizeReminderPlan({ slots: 'x' })).toBeNull();
  });

  it('drops bad slots: bad time, unknown kind, duplicate ids, count 0', () => {
    const plan = normalizeReminderPlan({
      slots: [
        fixed,
        { id: 'bad-time', kind: 'fixed', time: '25:00', days: [1] },
        { id: 'bad-min', kind: 'fixed', time: '08:60', days: [1] },
        { id: 'weird', kind: 'sometimes', time: '08:00', days: [1] },
        { ...fixed, time: '09:00' }, // duplicate id: first wins
        { id: 'w0', kind: 'window', start: '09:00', end: '17:00', count: 0, days: [1] },
        { id: 'w49', kind: 'window', start: '09:00', end: '17:00', count: 49, days: [1] },
        { id: 'wfrac', kind: 'window', start: '09:00', end: '17:00', count: 1.5, days: [1] },
        { id: 'nodays', kind: 'fixed', time: '08:00' },
        { id: '', kind: 'fixed', time: '08:00', days: [1] },
        { kind: 'fixed', time: '08:00', days: [1] },
        { id: 'baddate', kind: 'date', date: '2026-02-30', time: '09:00' },
        null,
        'x',
      ],
    })!;
    expect(plan.slots).toEqual([{ id: 'a', kind: 'fixed', time: '08:00', days: [1, 2] }]);
  });

  it('keeps valid window and date slots, normalizes days (dedupe, sort, range)', () => {
    const plan = normalizeReminderPlan({
      slots: [
        { id: 'w', kind: 'window', start: '09:00', end: '17:00', count: 3, days: [5, 1, 1, 9, -1, 2.5, 'x'], minGapMinutes: 30 },
        { id: 'd', kind: 'date', date: '2026-02-03', time: '09:00' },
        { id: 'neg', kind: 'window', start: '09:00', end: '17:00', count: 2, days: [], minGapMinutes: -5 },
      ],
      maxPerDay: 2,
    })!;
    expect(plan.slots[0]).toEqual({ id: 'w', kind: 'window', start: '09:00', end: '17:00', count: 3, days: [1, 5], minGapMinutes: 30 });
    expect(plan.slots[1]).toEqual({ id: 'd', kind: 'date', date: '2026-02-03', time: '09:00' });
    expect(plan.slots[2]).toEqual({ id: 'neg', kind: 'window', start: '09:00', end: '17:00', count: 2, days: [] });
    expect(plan.maxPerDay).toBe(2);
  });

  it('drops invalid quiet and maxPerDay', () => {
    const plan = normalizeReminderPlan({ slots: [], quiet: { start: '1', end: '2' }, maxPerDay: -1 })!;
    expect(plan).toEqual({ slots: [] });
    expect(normalizeReminderPlan({ slots: [], maxPerDay: 1.5 })).toEqual({ slots: [] });
  });

  it('keeps at most 50 slots', () => {
    const slots = Array.from({ length: 80 }, (_, i) => ({ id: `s${i}`, kind: 'fixed', time: '08:00', days: [1] }));
    expect(normalizeReminderPlan({ slots })!.slots).toHaveLength(50);
  });
});

describe('normalizeQuietHours', () => {
  it('accepts valid and rejects malformed', () => {
    expect(normalizeQuietHours({ start: '21:30', end: '07:00' })).toEqual({ start: '21:30', end: '07:00' });
    expect(normalizeQuietHours({ start: '24:00', end: '07:00' })).toBeNull();
    expect(normalizeQuietHours({ start: '21:30' })).toBeNull();
    expect(normalizeQuietHours(null)).toBeNull();
    expect(normalizeQuietHours('21:30-07:00')).toBeNull();
  });

  it('keeps start === end (it means none, handled at use)', () => {
    expect(normalizeQuietHours({ start: '08:00', end: '08:00' })).toEqual({ start: '08:00', end: '08:00' });
  });
});

describe('isSourceEnabled', () => {
  const s = (over: Partial<NotificationSettings>): NotificationSettings => ({ ...defaults, ...over });

  it('uses the source default when the user has not chosen', () => {
    expect(isSourceEnabled(s({}), 'app:x')).toBe(false);
    expect(isSourceEnabled(s({}), 'app:x', true)).toBe(true);
  });

  it('user choice beats the default', () => {
    expect(isSourceEnabled(s({ sources: { a: { enabled: true } } }), 'a', false)).toBe(true);
    expect(isSourceEnabled(s({ sources: { a: { enabled: false } } }), 'a', true)).toBe(false);
    expect(isSourceEnabled(s({ sources: { a: {} } }), 'a', true)).toBe(true);
  });

  it('master switch off disables everything', () => {
    expect(isSourceEnabled(s({ enabled: false, sources: { a: { enabled: true } } }), 'a', true)).toBe(false);
  });
});

describe('NotificationSettingsStore', () => {
  it('returns defaults when nothing is stored', () => {
    const db = new MemoryUserDb();
    expect(new NotificationSettingsStore(db.items).get()).toEqual(defaults);
  });

  it('round-trips settings through the user-data repository', () => {
    const db = new MemoryUserDb();
    const store = new NotificationSettingsStore(db.items);
    const settings: NotificationSettings = {
      version: 1,
      enabled: false,
      quiet: { start: '21:30', end: '07:00' },
      sources: {
        'app:votd': { enabled: true, plan: { slots: [{ id: 'daily', kind: 'fixed', time: '07:15', days: [0, 1, 2, 3, 4, 5, 6] }] } },
      },
    };
    expect(store.put(settings)).toEqual(settings);
    // a second store over the same repository sees it
    expect(new NotificationSettingsStore(db.items).get()).toEqual(settings);
    const item = db.items.get(NOTIFICATIONS_OWNER, NOTIFICATIONS_COLLECTION, NOTIFICATIONS_SETTINGS_KEY);
    expect(item?.valueType).toBe('json');
  });

  it('normalizes on put', () => {
    const db = new MemoryUserDb();
    const store = new NotificationSettingsStore(db.items);
    const out = store.put({ ...defaults, quiet: { start: 'bad', end: '07:00' } });
    expect(out.quiet).toBeNull();
    expect(store.get().quiet).toBeNull();
  });

  it('update reads, changes and writes', () => {
    const db = new MemoryUserDb();
    const store = new NotificationSettingsStore(db.items);
    store.update((s) => ({ ...s, enabled: false }));
    store.update((s) => ({ ...s, sources: { ...s.sources, a: { enabled: true } } }));
    expect(store.get()).toEqual({ ...defaults, enabled: false, sources: { a: { enabled: true } } });
  });

  it('falls back to defaults on a corrupt stored value', () => {
    const db = new MemoryUserDb();
    db.items.put(
      new UserDataItem({
        ownerUuid: NOTIFICATIONS_OWNER,
        collection: NOTIFICATIONS_COLLECTION,
        itemKey: NOTIFICATIONS_SETTINGS_KEY,
        value: '{not json',
        valueType: 'json',
      }),
    );
    const store = new NotificationSettingsStore(db.items);
    expect(store.get()).toEqual(defaults);
    // and a JSON value of the wrong shape
    db.items.put(
      new UserDataItem({
        ownerUuid: NOTIFICATIONS_OWNER,
        collection: NOTIFICATIONS_COLLECTION,
        itemKey: NOTIFICATIONS_SETTINGS_KEY,
        value: '[1,2,3]',
        valueType: 'json',
      }),
    );
    expect(store.get()).toEqual(defaults);
  });
});
