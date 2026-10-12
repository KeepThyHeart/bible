/**
 * Push cards (task 0072): pure decisions.
 *
 * Settings validation, choosing which passage each reminder fire shows, the
 * notification text, and building the items handed to the host. No storage,
 * no clock, no host API: `pushController.ts` does the I/O around this.
 *
 * Privacy rule enforced here: a notification never contains verse text, only
 * the reference (or nothing at all with the generic lock-screen setting).
 */

import { tc } from './messages';
import type {
  FireTime,
  JsonValue,
  PushCandidate,
  PushCardSettings,
  ReminderCapabilities,
  ReminderItem,
  ReminderSlot,
  Weekday,
} from './pushTypes';
import type { Calendar } from './reminderPlan';
import { parseWallTime } from './reminderPlan';

const DAY_MS = 24 * 60 * 60 * 1000;
const HOUR_MS = 60 * 60 * 1000;
const ALL_DAYS: Weekday[] = [0, 1, 2, 3, 4, 5, 6];

/** A passage seen less than this long before a fire is not shown again. */
const MIN_REPEAT_MS = HOUR_MS;

export const DEFAULT_PUSH_SETTINGS: PushCardSettings = {
  enabled: false,
  plan: {
    slots: [{ id: 'morning', kind: 'fixed', time: '08:00', days: [...ALL_DAYS] }],
    quiet: { start: '21:30', end: '07:00' },
    maxPerDay: 3,
  },
  source: 'dueThenReview',
  pinnedPassageIds: [],
  prompt: 'reference',
  lockScreen: 'reference',
};

function defaults(): PushCardSettings {
  return JSON.parse(JSON.stringify(DEFAULT_PUSH_SETTINGS)) as PushCardSettings;
}

function isObj(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

function clampInt(v: unknown, lo: number, hi: number, fallback: number): number {
  if (typeof v !== 'number' || !Number.isFinite(v)) return fallback;
  return Math.min(hi, Math.max(lo, Math.round(v)));
}

function normalizeDays(v: unknown): Weekday[] | null {
  if (!Array.isArray(v)) return null;
  const days = new Set<number>();
  for (const d of v) if (Number.isInteger(d) && d >= 0 && d <= 6) days.add(d as number);
  // An empty list is valid: the slot exists but never fires.
  return [...days].sort((a, b) => a - b) as Weekday[];
}

function normalizeSlot(raw: unknown, index: number): ReminderSlot | null {
  if (!isObj(raw)) return null;
  const days = normalizeDays(raw.days);
  if (!days) return null;
  const id = typeof raw.id === 'string' && raw.id ? raw.id : 'slot-' + index;
  if (raw.kind === 'fixed') {
    if (typeof raw.time !== 'string' || !parseWallTime(raw.time)) return null;
    return { id, kind: 'fixed', time: raw.time, days };
  }
  if (raw.kind === 'window') {
    if (typeof raw.start !== 'string' || typeof raw.end !== 'string') return null;
    if (!parseWallTime(raw.start) || !parseWallTime(raw.end)) return null;
    return { id, kind: 'window', start: raw.start, end: raw.end, count: clampInt(raw.count, 1, 6, 1), days };
  }
  return null;
}

/** Validate untrusted stored settings; anything unusable falls back to the default for that part. */
export function normalizePushSettings(raw: unknown): PushCardSettings {
  const out = defaults();
  if (!isObj(raw)) return out;
  out.enabled = raw.enabled === true;

  if (isObj(raw.plan)) {
    if (Array.isArray(raw.plan.slots)) {
      const slots: ReminderSlot[] = [];
      const ids = new Set<string>();
      raw.plan.slots.forEach((s, i) => {
        const slot = normalizeSlot(s, i);
        if (!slot) return;
        if (ids.has(slot.id)) slot.id = slot.id + '-' + i;
        ids.add(slot.id);
        slots.push(slot);
      });
      // An explicitly provided list (even empty) is kept as is.
      out.plan.slots = slots;
    }
    const q = raw.plan.quiet;
    if (isObj(q) && typeof q.start === 'string' && typeof q.end === 'string') {
      if (parseWallTime(q.start) && parseWallTime(q.end)) out.plan.quiet = { start: q.start, end: q.end };
    }
    out.plan.maxPerDay = clampInt(raw.plan.maxPerDay, 1, 12, out.plan.maxPerDay);
  }

  if (raw.source === 'dueThenReview' || raw.source === 'dueOnly' || raw.source === 'pinned') out.source = raw.source;
  if (Array.isArray(raw.pinnedPassageIds)) {
    out.pinnedPassageIds = [
      ...new Set(raw.pinnedPassageIds.filter((x): x is number => Number.isInteger(x) && x > 0)),
    ];
  }
  if (raw.prompt === 'reference' || raw.prompt === 'firstWords') out.prompt = raw.prompt;
  if (raw.lockScreen === 'reference' || raw.lockScreen === 'generic') out.lockScreen = raw.lockScreen;
  return out;
}

export interface SelectOptions {
  source: PushCardSettings['source'];
  /** Used only when `source` is 'pinned'. */
  pinned: number[];
  /** Passages already used per local day (key: start of that day). */
  usedByDay: Map<number, Set<number>>;
  cal: Calendar;
}

/**
 * Choose the passage for each fire, in time order.
 *
 * Pool: passages the user has attempted at least once (pinned: only the
 * pinned ones). A passage is skipped when seen within the last hour or
 * already used that local day. Preference: most overdue first, then (for
 * 'dueThenReview') well-learned passages seen longest ago. A fire with no
 * candidate is dropped rather than padded. After each assignment the passage
 * is treated as seen at that fire and not due again until the next local day, so one run
 * spreads across passages and tomorrow morning does not repeat today's.
 */
export function selectForFires(
  fires: FireTime[],
  candidates: PushCandidate[],
  opts: SelectOptions,
): { at: number; passageId: number }[] {
  const pinned = new Set(opts.pinned);
  const pool = candidates
    .filter((c) => c.lastAttemptAt !== null && (opts.source !== 'pinned' || pinned.has(c.passageId)))
    .map((c) => ({
      id: c.passageId,
      wellLearned: c.wellLearned,
      lastSeen: c.lastAttemptAt as number,
      due: (c.recallDueAt ?? c.lastAttemptAt) as number,
    }));
  const used = new Map<number, Set<number>>();
  for (const [k, v] of opts.usedByDay) used.set(k, new Set(v));

  const out: { at: number; passageId: number }[] = [];
  for (const fire of [...fires].sort((a, b) => a.at - b.at)) {
    const t = fire.at;
    const day = opts.cal.startOfDay(t);
    const usedToday = used.get(day) ?? new Set<number>();
    const eligible = pool.filter((p) => p.lastSeen <= t - MIN_REPEAT_MS && !usedToday.has(p.id));

    let pick = eligible
      .filter((p) => p.due <= t)
      .sort((a, b) => a.due - b.due || a.id - b.id)[0];
    if (!pick && opts.source !== 'dueOnly') {
      pick = eligible
        .filter((p) => p.wellLearned)
        .sort((a, b) => a.lastSeen - b.lastSeen || a.id - b.id)[0];
    }
    if (!pick) continue;

    out.push({ at: t, passageId: pick.id });
    pick.lastSeen = t;
    // Not due again until the next local day; usedByDay stops same-day repeats.
    pick.due = opts.cal.addDays(day, 1);
    usedToday.add(pick.id);
    used.set(day, usedToday);
  }
  return out;
}

/** Notification content. Never includes verse text. */
export function notificationFor(
  reference: string,
  settings: Pick<PushCardSettings, 'lockScreen'>,
): { title: string; body: string; tag: string } {
  return {
    title: tc('memory.core.notifTitle', 'Memory card'),
    body: settings.lockScreen === 'generic'
        ? tc('memory.core.notifBodyGeneric', 'A memory card is ready.')
        : tc('memory.core.notifBodyReference', '{reference} · Can you say it?', { reference }),
    tag: 'memory-card',
  };
}

/** In-app cue under the reference: the first three words, or null when the prompt is reference-only. */
export function cueFor(words: string[] | string, prompt: PushCardSettings['prompt']): string | null {
  if (prompt !== 'firstWords') return null;
  const list = (Array.isArray(words) ? words : words.split(/\s+/)).filter((w) => w.length > 0);
  if (list.length === 0) return null;
  return list.length <= 3 ? list.join(' ') : list.slice(0, 3).join(' ') + '…';
}

export function reminderKey(passageId: number, at: number): string {
  return 'card:' + passageId + ':' + at;
}

/**
 * ReminderItems for the host: the earliest `limit` assignments inside the
 * horizon. The horizon is measured from `now` when given, else from the
 * earliest assignment. Assignments whose passage has no reference are skipped.
 */
export function buildReminderItems(
  assignments: { at: number; passageId: number }[],
  refs: Map<number, string>,
  settings: Pick<PushCardSettings, 'lockScreen'>,
  limit = 20,
  horizonMs = 3 * DAY_MS,
  now?: number,
): ReminderItem[] {
  const sorted = [...assignments].sort((a, b) => a.at - b.at);
  if (sorted.length === 0) return [];
  const anchor = now ?? sorted[0].at;
  const items: ReminderItem[] = [];
  for (const a of sorted) {
    if (items.length >= limit) break;
    if (a.at > anchor + horizonMs) break;
    const ref = refs.get(a.passageId);
    if (ref === undefined) continue;
    const n = notificationFor(ref, settings);
    items.push({
      key: reminderKey(a.passageId, a.at),
      fireAt: a.at,
      title: n.title,
      body: n.body,
      tag: n.tag,
      data: { v: 1, passageId: a.passageId } as JsonValue,
    });
  }
  return items;
}

/** The settings-screen sentence saying what will happen, from what the host reports. */
export function statusMessage(
  hostApi: boolean,
  caps: ReminderCapabilities | null,
  enabled: boolean,
): string {
  if (!enabled) return tc('memory.core.statusOff', 'Memory cards are off.');
  if (!hostApi || !caps) {
    return tc('memory.core.statusNoHostApi', 'This app cannot send notifications. Cards will wait here until you open the app.');
  }
  switch (caps.permission) {
    case 'denied':
      return tc('memory.core.statusDenied', 'Notifications are blocked for this site. Cards will wait here until you open the app.');
    case 'unsupported':
      return tc('memory.core.statusUnsupported', 'Notifications are not supported here. Cards will wait here until you open the app.');
    case 'prompt':
      return tc('memory.core.statusPrompt', 'Allow notifications to get cards when the app is closed. Until then, cards wait here.');
    case 'granted':
      if (caps.whenClosed === 'fires') return tc('memory.core.statusFires', 'Cards arrive as notifications, even when the app is closed.');
      if (caps.whenClosed === 'background-only') {
        return tc('memory.core.statusBackgroundOnly', 'Cards only arrive while the app is running. Turn on Keep running in background.');
      }
      return tc('memory.core.statusOpenOnly', 'Cards only arrive while the app is open. Otherwise they wait here.');
  }
}
