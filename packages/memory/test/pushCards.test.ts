/**
 * Push card logic tests: settings validation, candidate selection,
 * notification text and reminder items.
 */

import { describe, it, expect } from 'vitest';
import {
  DEFAULT_PUSH_SETTINGS,
  normalizePushSettings,
  selectForFires,
  notificationFor,
  cueFor,
  reminderKey,
  buildReminderItems,
  statusMessage,
} from '../src/core/pushCards';
import { fixedOffsetCalendar } from '../src/core/reminderPlan';
import type { FireTime, PushCandidate } from '../src/core/pushTypes';

const cal = fixedOffsetCalendar(0);
const HOUR = 3600_000;
const DAY = 24 * HOUR;
const D0 = Date.UTC(2026, 8, 28);
const fire = (day: number, h: number): FireTime => ({ at: D0 + day * DAY + h * HOUR, slotId: 's' });

function cand(id: number, o: Partial<PushCandidate> = {}): PushCandidate {
  return {
    passageId: id,
    reference: 'Ref ' + id,
    lastAttemptAt: D0 - 5 * DAY,
    recallDueAt: null,
    wellLearned: false,
    ...o,
  };
}
const base = { source: 'dueThenReview' as const, pinned: [], usedByDay: new Map<number, Set<number>>(), cal };
const ids = (r: { passageId: number }[]) => r.map((x) => x.passageId);

describe('selectForFires', () => {
  it('ignores passages never attempted', () => {
    const r = selectForFires([fire(0, 8)], [cand(1, { lastAttemptAt: null })], base);
    expect(r).toEqual([]);
  });

  it('picks the most overdue first, ties by id', () => {
    const cs = [
      cand(3, { lastAttemptAt: D0 - 2 * DAY }),
      cand(2, { lastAttemptAt: D0 - 9 * DAY }),
      cand(1, { lastAttemptAt: D0 - 9 * DAY }),
    ];
    const r = selectForFires([fire(0, 8), fire(0, 12), fire(0, 16)], cs, base);
    expect(ids(r)).toEqual([1, 2, 3]);
  });

  it('prefers recallDueAt over lastAttemptAt', () => {
    const cs = [
      cand(1, { lastAttemptAt: D0 - 9 * DAY, recallDueAt: D0 + 5 * DAY }), // not due
      cand(2, { lastAttemptAt: D0 - 1 * DAY }),
    ];
    expect(ids(selectForFires([fire(0, 8)], cs, base))).toEqual([2]);
  });

  it('does not reuse a passage twice on one local day, including this run', () => {
    const r = selectForFires([fire(0, 8), fire(0, 12)], [cand(1)], base);
    expect(ids(r)).toEqual([1]);
  });

  it('respects passages already used that day (usedByDay)', () => {
    const used = new Map([[D0, new Set([1])]]);
    const r = selectForFires([fire(0, 8)], [cand(1), cand(2)], { ...base, usedByDay: used });
    expect(ids(r)).toEqual([2]);
  });

  it('skips a passage seen within the last hour', () => {
    const t = fire(0, 8).at;
    const r = selectForFires([fire(0, 8)], [cand(1, { lastAttemptAt: t - 30 * 60_000 }), cand(2)], base);
    expect(ids(r)).toEqual([2]);
  });

  it('offers a single due passage at 08:00 on consecutive days', () => {
    const r = selectForFires([fire(0, 8), fire(1, 8), fire(2, 8)], [cand(1)], base);
    expect(ids(r)).toEqual([1, 1, 1]);
  });

  it('does not repeat the same day; others go first next morning', () => {
    const r = selectForFires([fire(0, 8), fire(1, 8)], [cand(1), cand(2)], base);
    expect(ids(r)).toEqual([1, 2]);
    expect(ids(selectForFires([fire(0, 8), fire(0, 12)], [cand(1)], base))).toEqual([1]);
  });

  it('dueThenReview falls back to well-learned passages, least recently seen', () => {
    const cs = [
      cand(1, { recallDueAt: D0 + 30 * DAY, wellLearned: true, lastAttemptAt: D0 - 2 * DAY }),
      cand(2, { recallDueAt: D0 + 30 * DAY, wellLearned: true, lastAttemptAt: D0 - 6 * DAY }),
      cand(3, { recallDueAt: D0 + 30 * DAY, wellLearned: false, lastAttemptAt: D0 - 9 * DAY }),
    ];
    expect(ids(selectForFires([fire(0, 8)], cs, base))).toEqual([2]);
  });

  it('dueOnly drops the fire when nothing is due', () => {
    const cs = [cand(1, { recallDueAt: D0 + 30 * DAY, wellLearned: true })];
    expect(selectForFires([fire(0, 8)], cs, { ...base, source: 'dueOnly' })).toEqual([]);
  });

  it('pinned restricts the pool to pinned passages', () => {
    const cs = [cand(1, { lastAttemptAt: D0 - 9 * DAY }), cand(2)];
    const r = selectForFires([fire(0, 8), fire(0, 12)], cs, { ...base, source: 'pinned', pinned: [2] });
    expect(ids(r)).toEqual([2]); // passage 1 is excluded; 2 is not repeated the same day
  });
});

describe('notificationFor', () => {
  it('shows the reference and a prompt', () => {
    expect(notificationFor('John 3:16', { lockScreen: 'reference' })).toEqual({
      title: 'Memory card',
      body: 'John 3:16 · Can you say it?',
      tag: 'memory-card',
    });
  });
  it('uses a generic body that hides the reference', () => {
    const n = notificationFor('John 3:16', { lockScreen: 'generic' });
    expect(n.body).toBe('A memory card is ready.');
    expect(n.body).not.toContain('John');
  });
});

describe('cueFor', () => {
  it('is null unless the prompt is firstWords', () => {
    expect(cueFor(['For', 'God', 'so', 'loved'], 'reference')).toBeNull();
  });
  it('takes the first three words with an ellipsis', () => {
    expect(cueFor(['For', 'God', 'so', 'loved'], 'firstWords')).toBe('For God so…');
  });
  it('has no ellipsis when the verse is short', () => {
    expect(cueFor(['Jesus', 'wept'], 'firstWords')).toBe('Jesus wept');
    expect(cueFor(['a', 'b', 'c'], 'firstWords')).toBe('a b c');
  });
  it('is null for empty text', () => {
    expect(cueFor([], 'firstWords')).toBeNull();
  });
});

describe('reminderKey', () => {
  it('has the card:<passageId>:<at> format', () => {
    expect(reminderKey(7, 1234)).toBe('card:7:1234');
  });
});

describe('buildReminderItems', () => {
  const refs = new Map([
    [1, 'John 3:16'],
    [2, 'Psalm 23:1'],
  ]);
  it('builds keyed items with passage data and no verse text', () => {
    const items = buildReminderItems([{ at: D0 + 8 * HOUR, passageId: 1 }], refs, { lockScreen: 'reference' });
    expect(items).toEqual([
      {
        key: 'card:1:' + (D0 + 8 * HOUR),
        fireAt: D0 + 8 * HOUR,
        title: 'Memory card',
        body: 'John 3:16 · Can you say it?',
        tag: 'memory-card',
        data: { v: 1, passageId: 1 },
      },
    ]);
  });

  it('caps at 20 items, earliest first', () => {
    const many = Array.from({ length: 30 }, (_, i) => ({ at: D0 + (i + 1) * 60_000, passageId: 1 }));
    const items = buildReminderItems(many, refs, { lockScreen: 'reference' });
    expect(items).toHaveLength(20);
    expect(items[0].fireAt).toBe(D0 + 60_000);
    expect(items[19].fireAt).toBe(D0 + 20 * 60_000);
  });

  it('keeps only items inside the horizon measured from now', () => {
    const a = [
      { at: D0 + 2 * DAY, passageId: 1 },
      { at: D0 + 4 * DAY, passageId: 2 },
    ];
    expect(buildReminderItems(a, refs, { lockScreen: 'reference' }, 20, 3 * DAY, D0)).toHaveLength(1);
  });

  it('skips passages without a reference', () => {
    expect(buildReminderItems([{ at: D0, passageId: 99 }], refs, { lockScreen: 'reference' })).toEqual([]);
  });
});

describe('normalizePushSettings', () => {
  it('returns defaults for garbage', () => {
    for (const raw of [null, undefined, 'x', 5, [], { plan: 7 }]) {
      const s = normalizePushSettings(raw);
      expect(s).toEqual(DEFAULT_PUSH_SETTINGS);
    }
  });

  it('does not share state with the defaults object', () => {
    const s = normalizePushSettings(null);
    s.plan.slots.push({ id: 'x', kind: 'fixed', time: '09:00', days: [1] });
    expect(DEFAULT_PUSH_SETTINGS.plan.slots).toHaveLength(1);
  });

  it('clamps maxPerDay to 1..12 and window count to 1..6', () => {
    const mk = (maxPerDay: number, count: number) =>
      normalizePushSettings({
        enabled: true,
        plan: { maxPerDay, slots: [{ id: 'w', kind: 'window', start: '09:00', end: '17:00', count, days: [1] }] },
      });
    expect(mk(0, 0).plan.maxPerDay).toBe(1);
    expect(mk(99, 99).plan.maxPerDay).toBe(12);
    const slot = mk(3, 99).plan.slots[0];
    expect(slot.kind === 'window' && slot.count).toBe(6);
    const low = mk(3, -4).plan.slots[0];
    expect(low.kind === 'window' && low.count).toBe(1);
  });

  it('drops slots with bad times; keeps an empty days list; keeps an explicitly empty slots array', () => {
    const s = normalizePushSettings({
      plan: {
        slots: [
          { id: 'a', kind: 'fixed', time: '24:00', days: [1] },
          { id: 'b', kind: 'fixed', time: '09:00', days: [] },
        ],
      },
    });
    expect(s.plan.slots).toEqual([{ id: 'b', kind: 'fixed', time: '09:00', days: [] }]);
    expect(normalizePushSettings({ plan: { slots: [] } }).plan.slots).toEqual([]);
    expect(normalizePushSettings({ plan: {} }).plan.slots).toEqual(DEFAULT_PUSH_SETTINGS.plan.slots);
  });

  it('dedupes and filters days, keeps valid slots', () => {
    const s = normalizePushSettings({
      enabled: true,
      plan: { slots: [{ id: 'a', kind: 'fixed', time: '09:30', days: [3, 1, 3, 9, 'x'] }] },
    });
    expect(s.enabled).toBe(true);
    expect(s.plan.slots).toEqual([{ id: 'a', kind: 'fixed', time: '09:30', days: [1, 3] }]);
  });

  it('rejects invalid quiet hours and keeps valid ones', () => {
    const bad = normalizePushSettings({ plan: { quiet: { start: '25:00', end: '07:00' } } });
    expect(bad.plan.quiet).toEqual(DEFAULT_PUSH_SETTINGS.plan.quiet);
    const ok = normalizePushSettings({ plan: { quiet: { start: '22:00', end: '06:00' } } });
    expect(ok.plan.quiet).toEqual({ start: '22:00', end: '06:00' });
  });

  it('validates enums and pinned ids', () => {
    const s = normalizePushSettings({
      source: 'pinned',
      pinnedPassageIds: [3, 3, -1, 'a', 4.5, 7],
      prompt: 'firstWords',
      lockScreen: 'generic',
    });
    expect(s.source).toBe('pinned');
    expect(s.pinnedPassageIds).toEqual([3, 7]);
    expect(s.prompt).toBe('firstWords');
    expect(s.lockScreen).toBe('generic');
    const bad = normalizePushSettings({ source: 'x', prompt: 'y', lockScreen: 'z' });
    expect(bad.source).toBe('dueThenReview');
    expect(bad.prompt).toBe('reference');
    expect(bad.lockScreen).toBe('reference');
  });
});

describe('statusMessage', () => {
  const caps = (permission: any, whenClosed: any = 'fires') => ({ permission, whenClosed, actions: false });
  it('explains each situation', () => {
    expect(statusMessage(true, caps('granted'), false)).toMatch(/off/);
    expect(statusMessage(false, null, true)).toMatch(/wait here/);
    expect(statusMessage(true, caps('denied'), true)).toMatch(/blocked/);
    expect(statusMessage(true, caps('prompt'), true)).toMatch(/Allow notifications/);
    expect(statusMessage(true, caps('unsupported'), true)).toMatch(/not supported/);
    expect(statusMessage(true, caps('granted'), true)).toMatch(/even when the app is closed/);
    expect(statusMessage(true, caps('granted', 'background-only'), true)).toMatch(/Keep running in background/);
    expect(statusMessage(true, caps('granted', 'never'), true)).toMatch(/app is open/);
  });
});
