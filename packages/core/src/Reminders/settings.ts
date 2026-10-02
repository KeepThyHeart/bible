/**
 * The user's notification preferences, stored as one `user_data_item`
 * (owner `app:notifications`, collection `settings`, key `preferences`, JSON),
 * so they are backed up with the rest of the user data (`user_data_item` is
 * classified `content` in the backup registry) and will sync with it.
 *
 * Device-only switches (tray, start at login) are NOT here: they change the
 * operating system's behaviour on one machine and must not follow a backup to
 * another. Desktop keeps them next to its pending set.
 */
import { UserDataItem, appOwner } from '../Data/Models/User/UserDataItem';
import type { IUserDataRepository } from '../Data/Repositories/IUserDataRepository';
import { parseCivilDate, parseWallTime } from './time';
import type { QuietHours, ReminderPlan, ReminderSlot, Weekday } from './types';

export const NOTIFICATIONS_OWNER = appOwner('notifications');
export const NOTIFICATIONS_COLLECTION = 'settings';
export const NOTIFICATIONS_SETTINGS_KEY = 'preferences';

export interface SourcePreference {
  /** Absent: the source's own default (`defaultEnabled`). */
  enabled?: boolean;
  /** The user's own schedule for a rule source; absent: the source's plan. */
  plan?: ReminderPlan;
}

export interface NotificationSettings {
  version: 1;
  /** Master switch. Off: nothing fires, from any source. */
  enabled: boolean;
  /** Global quiet hours: notifications due inside them are held and shown, collapsed, when they end. */
  quiet: QuietHours | null;
  /** Per-source preferences by source id. */
  sources: Record<string, SourcePreference>;
}

export const DEFAULT_NOTIFICATION_SETTINGS: NotificationSettings = Object.freeze({
  version: 1,
  enabled: true,
  quiet: null,
  sources: {},
}) as NotificationSettings;

const isObj = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);
const isWall = (v: unknown): v is string => typeof v === 'string' && parseWallTime(v) !== null;

function normDays(v: unknown): Weekday[] | null {
  if (!Array.isArray(v)) return null;
  const set = new Set<Weekday>();
  for (const d of v) if (Number.isInteger(d) && d >= 0 && d <= 6) set.add(d as Weekday);
  return [...set].sort();
}

export function normalizeQuietHours(v: unknown): QuietHours | null {
  if (!isObj(v) || !isWall(v.start) || !isWall(v.end)) return null;
  return { start: v.start.trim(), end: v.end.trim() };
}

function normSlot(v: unknown): ReminderSlot | null {
  if (!isObj(v) || typeof v.id !== 'string' || v.id === '' || v.id.length > 100) return null;
  const id = v.id;
  if (v.kind === 'fixed') {
    const days = normDays(v.days);
    return isWall(v.time) && days ? { id, kind: 'fixed', time: v.time.trim(), days } : null;
  }
  if (v.kind === 'window') {
    const days = normDays(v.days);
    const count = Number(v.count);
    if (!isWall(v.start) || !isWall(v.end) || !days || !Number.isInteger(count) || count < 1 || count > 48) return null;
    const slot: ReminderSlot = { id, kind: 'window', start: v.start.trim(), end: v.end.trim(), count, days };
    if (Number.isFinite(v.minGapMinutes) && (v.minGapMinutes as number) >= 0) slot.minGapMinutes = v.minGapMinutes as number;
    return slot;
  }
  if (v.kind === 'date') {
    return typeof v.date === 'string' && parseCivilDate(v.date) && isWall(v.time)
      ? { id, kind: 'date', date: v.date, time: v.time.trim() }
      : null;
  }
  return null;
}

/** A clean copy of a plan, or null when it is not a plan. Bad slots are dropped. */
export function normalizeReminderPlan(v: unknown): ReminderPlan | null {
  if (!isObj(v) || !Array.isArray(v.slots)) return null;
  const slots: ReminderSlot[] = [];
  const seen = new Set<string>();
  for (const s of v.slots.slice(0, 50)) {
    const n = normSlot(s);
    if (n && !seen.has(n.id)) {
      seen.add(n.id);
      slots.push(n);
    }
  }
  const plan: ReminderPlan = { slots };
  const quiet = normalizeQuietHours(v.quiet);
  if (quiet) plan.quiet = quiet;
  if (Number.isInteger(v.maxPerDay) && (v.maxPerDay as number) >= 0) plan.maxPerDay = v.maxPerDay as number;
  return plan;
}

/** Defaults for anything missing or malformed; never throws. */
export function normalizeNotificationSettings(v: unknown): NotificationSettings {
  if (!isObj(v)) return { ...DEFAULT_NOTIFICATION_SETTINGS, sources: {} };
  const sources: Record<string, SourcePreference> = {};
  if (isObj(v.sources)) {
    for (const [id, raw] of Object.entries(v.sources)) {
      if (!isObj(raw) || id === '' || id.length > 200) continue;
      const pref: SourcePreference = {};
      if (typeof raw.enabled === 'boolean') pref.enabled = raw.enabled;
      const plan = normalizeReminderPlan(raw.plan);
      if (plan) pref.plan = plan;
      sources[id] = pref;
    }
  }
  return {
    version: 1,
    enabled: typeof v.enabled === 'boolean' ? v.enabled : DEFAULT_NOTIFICATION_SETTINGS.enabled,
    quiet: normalizeQuietHours(v.quiet),
    sources,
  };
}

/** Whether `sourceId` is on under `settings`, given the source's own default. */
export function isSourceEnabled(settings: NotificationSettings, sourceId: string, defaultEnabled = false): boolean {
  if (!settings.enabled) return false;
  return settings.sources[sourceId]?.enabled ?? defaultEnabled;
}

/** Reads and writes {@link NotificationSettings} in the user-data store. */
export class NotificationSettingsStore {
  constructor(private readonly repo: IUserDataRepository) {}

  get(): NotificationSettings {
    const item = this.repo.get(NOTIFICATIONS_OWNER, NOTIFICATIONS_COLLECTION, NOTIFICATIONS_SETTINGS_KEY);
    if (!item?.value) return normalizeNotificationSettings(null);
    try {
      return normalizeNotificationSettings(JSON.parse(item.value));
    } catch {
      return normalizeNotificationSettings(null);
    }
  }

  /** Normalizes, stores and returns what was stored. */
  put(settings: NotificationSettings): NotificationSettings {
    const clean = normalizeNotificationSettings(settings);
    this.repo.put(
      new UserDataItem({
        ownerUuid: NOTIFICATIONS_OWNER,
        collection: NOTIFICATIONS_COLLECTION,
        itemKey: NOTIFICATIONS_SETTINGS_KEY,
        value: JSON.stringify(clean),
        valueType: 'json',
      }),
    );
    return clean;
  }

  /** Read, change, write. */
  update(fn: (s: NotificationSettings) => NotificationSettings): NotificationSettings {
    return this.put(fn(this.get()));
  }
}
