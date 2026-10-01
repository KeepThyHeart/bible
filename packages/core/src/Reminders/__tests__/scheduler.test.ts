import { describe, expect, it, vi } from 'vitest';
import { createMemoryStatePort } from '../ports';
import {
  ReminderScheduler,
  sanitizeReminderItems,
  type FireContext,
  type ItemSource,
  type PresentedNotification,
  type ReminderSchedulerOptions,
  type RuleSource,
} from '../ReminderScheduler';
import type { NotificationSettings } from '../settings';
import type { ReminderItem, ReminderPlan } from '../types';

const MIN = 60_000;
const HOUR = 3_600_000;
const DAY = 86_400_000;
const ALL = [0, 1, 2, 3, 4, 5, 6] as const;
const z = (s: string) => Date.parse(s);
const flush = () => new Promise<void>((r) => setTimeout(r, 0));

const T0 = z('2026-01-10T07:00:00Z');
const T8 = z('2026-01-10T08:00:00Z');

const daily = (...times: string[]): ReminderPlan => ({
  slots: times.map((t, i) => ({ id: times.length === 1 ? 'd' : `d${i}`, kind: 'fixed' as const, time: t, days: [...ALL] })),
});

interface Harness {
  now: number;
  delay: number | null;
  cb: (() => void) | null;
  shows: PresentedNotification[];
  errors: Array<[unknown, string]>;
  settings: NotificationSettings;
  state: ReturnType<typeof createMemoryStatePort>;
  changes: number;
  build(over?: Partial<ReminderSchedulerOptions>): ReminderScheduler;
  /** Run the armed timer callback, as the platform timer would. */
  fire(): Promise<void>;
}

function harness(over: { now?: number; settings?: Partial<NotificationSettings>; state?: ReturnType<typeof createMemoryStatePort> } = {}): Harness {
  const h: Harness = {
    now: over.now ?? T0,
    delay: null,
    cb: null,
    shows: [],
    errors: [],
    settings: { version: 1, enabled: true, quiet: null, sources: {}, ...over.settings },
    state: over.state ?? createMemoryStatePort(),
    changes: 0,
    build(o = {}) {
      return new ReminderScheduler({
        clock: { now: () => h.now },
        timer: {
          set(d, cb) {
            h.delay = d;
            h.cb = cb;
          },
          clear() {
            h.delay = null;
            h.cb = null;
          },
        },
        presenter: { show: (n) => void h.shows.push(n) },
        state: h.state,
        settings: () => h.settings,
        timeZone: () => 'UTC',
        guardMs: 10 * DAY,
        onChange: () => void h.changes++,
        onError: (e, c) => void h.errors.push([e, c]),
        strings: { collapsed: (label, count) => ({ title: label, body: `${count} cards waiting` }) },
        ...o,
      });
    },
    async fire() {
      const cb = h.cb;
      expect(cb).toBeTruthy();
      cb!();
      await flush();
    },
  };
  return h;
}

const enabled = (...ids: string[]): NotificationSettings['sources'] => Object.fromEntries(ids.map((i) => [i, { enabled: true }]));

function ruleSource(over: Partial<RuleSource> = {}): RuleSource & { ctxs: FireContext[] } {
  const ctxs: FireContext[] = [];
  return {
    kind: 'rules',
    id: 'app:votd',
    label: 'Verse of the day',
    plan: () => daily('08:00'),
    render: (ctx) => {
      ctxs.push(ctx);
      return { title: 'Verse', body: `fire ${ctx.fire.at}`, target: { kind: 'verse', verseId: 1001001 } };
    },
    ...over,
    ctxs,
  };
}

const itemSource = (over: Partial<ItemSource> = {}): ItemSource => ({ kind: 'items', id: 'ext:mem', label: 'Memory', ...over });
const item = (key: string, fireAt: number, extra: Partial<ReminderItem> = {}): ReminderItem => ({ key, fireAt, title: `T ${key}`, body: `B ${key}`, ...extra });

describe('rule sources', () => {
  it('arms for the next fire, fires on time with rendered content and target', async () => {
    const h = harness({ settings: { sources: enabled('app:votd') } });
    const s = h.build();
    const src = ruleSource();
    s.registerSource(src);
    await s.start();
    expect(h.shows).toHaveLength(0);
    expect(h.delay).toBe(HOUR); // 07:00 -> 08:00

    h.now = T8;
    await h.fire();
    expect(h.shows).toHaveLength(1);
    const n = h.shows[0];
    expect(n).toMatchObject({
      sourceId: 'app:votd',
      title: 'Verse',
      body: `fire ${T8}`,
      target: { kind: 'verse', verseId: 1001001 },
      missed: false,
      count: 1,
      dueAt: T8,
      keys: [`d@${T8}`],
    });
    expect(src.ctxs).toHaveLength(1);
    expect(src.ctxs[0]).toMatchObject({ sourceId: 'app:votd', missed: false, count: 1, timeZone: 'UTC' });
    expect(src.ctxs[0].fire.at).toBe(T8);
    expect(h.delay).toBe(DAY); // re-armed for tomorrow
    expect(h.state.current?.checkpoints['app:votd']).toBe(T8);
    expect(h.errors).toEqual([]);
  });

  it('arms for at most guardMs', async () => {
    const h = harness({ settings: { sources: enabled('app:votd') } });
    const s = h.build({ guardMs: 30 * MIN });
    s.registerSource(ruleSource());
    await s.start();
    expect(h.delay).toBe(30 * MIN);
  });

  it('does not fire a second time on a repeated wake', async () => {
    const h = harness({ settings: { sources: enabled('app:votd') } });
    const s = h.build();
    s.registerSource(ruleSource());
    await s.start();
    h.now = T8;
    await s.wake();
    await s.wake();
    await s.refresh();
    expect(h.shows).toHaveLength(1);
  });

  it('shows nothing when render returns null, but the checkpoint advances', async () => {
    const h = harness({ settings: { sources: enabled('app:votd') } });
    const s = h.build();
    s.registerSource(ruleSource({ render: () => null }));
    await s.start();
    h.now = T8;
    await h.fire();
    expect(h.shows).toHaveLength(0);
    expect(h.state.current?.checkpoints['app:votd']).toBe(T8);
  });

  it('a render that throws is reported and does not stop other sources', async () => {
    const h = harness({ settings: { sources: enabled('app:a', 'app:b') } });
    const s = h.build();
    s.registerSource(ruleSource({ id: 'app:a', render: () => { throw new Error('boom'); } }));
    s.registerSource(ruleSource({ id: 'app:b' }));
    await s.start();
    h.now = T8;
    await h.fire();
    expect(h.shows.map((n) => n.sourceId)).toEqual(['app:b']);
    expect(h.errors.map(([, c]) => c)).toEqual(['render:app:a']);
  });

  it('a disabled source (the default for app sources) shows nothing, and enabling later does not replay', async () => {
    const h = harness();
    const s = h.build();
    s.registerSource(ruleSource());
    await s.start();
    expect(h.delay).toBe(10 * DAY); // nothing enabled: only the guard
    h.now = T8;
    await s.wake();
    expect(h.shows).toHaveLength(0);
    expect(h.state.current?.checkpoints['app:votd']).toBe(T8);

    h.settings = { ...h.settings, sources: enabled('app:votd') };
    h.now = T8 + MIN;
    await s.refresh();
    expect(h.shows).toHaveLength(0);
    // ...but the next day's fire does happen.
    h.now = T8 + DAY;
    await s.wake();
    expect(h.shows).toHaveLength(1);
  });

  it('the master switch off silences every source', async () => {
    const h = harness({ settings: { enabled: false, sources: enabled('app:votd', 'ext:mem') } });
    const s = h.build();
    s.registerSource(ruleSource());
    s.registerSource(itemSource());
    await s.start();
    await s.replaceItems('ext:mem', [item('a', T0 + HOUR)]);
    h.now = T8 + DAY;
    await s.wake();
    expect(h.shows).toHaveLength(0);
    expect(s.nextDue()).toBeNull();
    expect(s.listSources().every((i) => !i.enabled && i.nextAt === null)).toBe(true);
  });

  it('a user plan in settings overrides the source plan unless userEditable is false', async () => {
    const user: ReminderPlan = daily('09:30');
    const h = harness({ settings: { sources: { 'app:votd': { enabled: true, plan: user }, 'app:fixed': { enabled: true, plan: user } } } });
    const s = h.build();
    s.registerSource(ruleSource());
    s.registerSource(ruleSource({ id: 'app:fixed', label: 'Fixed', userEditable: false }));
    await s.start();
    const info = Object.fromEntries(s.listSources().map((i) => [i.id, i]));
    expect(info['app:votd'].plan).toEqual(user);
    expect(info['app:votd'].nextAt).toBe(z('2026-01-10T09:30:00Z'));
    expect(info['app:votd'].userEditable).toBe(true);
    expect(info['app:fixed'].plan).toEqual(daily('08:00'));
    expect(info['app:fixed'].nextAt).toBe(T8);
    expect(info['app:fixed'].userEditable).toBe(false);
    expect(s.nextDue()).toEqual({ sourceId: 'app:fixed', at: T8 });
  });

  it('listSources reports state, kind, default and next fire for a rule source', async () => {
    const h = harness();
    const s = h.build();
    s.registerSource(ruleSource({ description: 'desc' }));
    await s.start();
    expect(s.listSources()).toEqual([
      {
        id: 'app:votd', kind: 'rules', label: 'Verse of the day', description: 'desc', enabled: false, defaultEnabled: false,
        registered: true, plan: daily('08:00'), userEditable: true, nextAt: null, pending: 0,
      },
    ]);
    h.settings = { ...h.settings, sources: enabled('app:votd') };
    expect(s.listSources()[0]).toMatchObject({ enabled: true, nextAt: T8 });
  });

  it('defaultEnabled on a rule source turns it on without a user choice', async () => {
    const h = harness();
    const s = h.build();
    s.registerSource(ruleSource({ defaultEnabled: true }));
    await s.start();
    h.now = T8;
    await s.wake();
    expect(h.shows).toHaveLength(1);
  });

  it('wake before start does nothing; stop clears the timer; unregister stops the source', async () => {
    const h = harness({ settings: { sources: enabled('app:votd') } });
    const s = h.build();
    const off = s.registerSource(ruleSource());
    await s.wake();
    expect(h.delay).toBeNull();
    await s.start();
    expect(h.delay).toBe(HOUR);
    off();
    await flush();
    h.now = T8;
    await s.wake();
    expect(h.shows).toHaveLength(0);
    s.stop();
    expect(h.delay).toBeNull();
    await s.wake();
    expect(h.delay).toBeNull();
  });
});

describe('missed fires', () => {
  it('a late wake by 3 minutes is on time; by 10 minutes is missed', async () => {
    for (const [late, missed] of [[3 * MIN, false], [5 * MIN, false], [10 * MIN, true]] as const) {
      const h = harness({ settings: { sources: enabled('app:votd') } });
      const s = h.build();
      s.registerSource(ruleSource());
      await s.start();
      h.now = T8 + late;
      await s.wake();
      expect(h.shows).toHaveLength(1);
      expect(h.shows[0].missed).toBe(missed);
      expect(h.shows[0].count).toBe(1);
      expect(h.shows[0].dueAt).toBe(T8);
    }
  });

  it('app closed for three days: one missed notification for the fire within 12 hours, older ones dropped', async () => {
    const h = harness({ settings: { sources: enabled('app:votd') } });
    const a = h.build();
    a.registerSource(ruleSource());
    await a.start();
    h.now = T8;
    await a.wake();
    expect(h.shows).toHaveLength(1);
    a.stop();

    // "Closed" for three days; the new instance shares the state port.
    h.shows.length = 0;
    h.now = z('2026-01-13T12:00:00Z');
    const b = h.build();
    const src = ruleSource();
    b.registerSource(src); // registered before start
    await b.start();
    expect(h.shows).toHaveLength(1);
    expect(h.shows[0]).toMatchObject({ missed: true, count: 1, dueAt: z('2026-01-13T08:00:00Z') });
    expect(src.ctxs).toHaveLength(1);
    expect(src.ctxs[0].missed).toBe(true);
  });

  it('registering after start gives the same result', async () => {
    const h = harness({ settings: { sources: enabled('app:votd') } });
    const a = h.build();
    a.registerSource(ruleSource());
    await a.start();
    a.stop();
    h.now = z('2026-01-13T12:00:00Z');
    const b = h.build();
    await b.start();
    b.registerSource(ruleSource());
    await flush();
    expect(h.shows).toHaveLength(1);
    expect(h.shows[0]).toMatchObject({ missed: true, count: 1 });
  });

  it('several fires within 12 hours collapse to one, counted, with the latest rendered', async () => {
    const h = harness({ settings: { sources: enabled('app:votd') } });
    const plan = daily('08:00', '09:00', '10:00');
    const a = h.build();
    a.registerSource(ruleSource({ plan: () => plan }));
    await a.start();
    a.stop();

    h.now = z('2026-01-11T11:00:00Z');
    const b = h.build();
    const src = ruleSource({ plan: () => plan });
    b.registerSource(src);
    await b.start();
    expect(h.shows).toHaveLength(1);
    const n = h.shows[0];
    expect(n.missed).toBe(true);
    expect(n.count).toBe(3);
    expect(n.dueAt).toBe(z('2026-01-11T10:00:00Z'));
    expect(n.keys).toEqual([
      `d0@${z('2026-01-11T08:00:00Z')}`,
      `d1@${z('2026-01-11T09:00:00Z')}`,
      `d2@${z('2026-01-11T10:00:00Z')}`,
    ]);
    expect(src.ctxs).toHaveLength(1);
    expect(src.ctxs[0]).toMatchObject({ missed: true, count: 3 });
    expect(src.ctxs[0].fire.at).toBe(z('2026-01-11T10:00:00Z'));
  });

  it('on-time fires each get a notification when several are due within tolerance', async () => {
    const h = harness({ settings: { sources: enabled('app:votd') } });
    const s = h.build();
    s.registerSource(ruleSource({ plan: () => daily('08:00', '08:02') }));
    await s.start();
    h.now = T8 + 3 * MIN;
    await s.wake();
    expect(h.shows.map((n) => [n.missed, n.count])).toEqual([[false, 1], [false, 1]]);
  });

  it('a clock that jumps far back resets the checkpoint, and later fires still happen', async () => {
    const future = T0 + 10 * DAY;
    const state = createMemoryStatePort({ version: 1, checkpoints: { 'app:votd': future }, items: {}, labels: {} });
    const h = harness({ settings: { sources: enabled('app:votd') }, state });
    const s = h.build();
    s.registerSource(ruleSource());
    await s.start();
    expect(h.state.current?.checkpoints['app:votd']).toBe(T0);
    h.now = T8;
    await s.wake();
    expect(h.shows).toHaveLength(1);
  });
});

describe('global quiet hours', () => {
  it('holds a 22:00 fire, arms for 07:00, then shows one missed notification', async () => {
    const h = harness({
      now: z('2026-01-10T20:00:00Z'),
      settings: { quiet: { start: '21:30', end: '07:00' }, sources: enabled('app:votd') },
    });
    const s = h.build();
    s.registerSource(ruleSource({ plan: () => daily('22:00') }));
    await s.start();
    expect(h.delay).toBe(2 * HOUR);

    h.now = z('2026-01-10T22:00:00Z');
    await h.fire();
    expect(h.shows).toHaveLength(0);
    expect(h.delay).toBe(9 * HOUR);

    h.now = z('2026-01-11T07:00:00Z');
    await h.fire();
    expect(h.shows).toHaveLength(1);
    expect(h.shows[0]).toMatchObject({ missed: true, count: 1, dueAt: z('2026-01-10T22:00:00Z') });
    expect(h.delay).toBe(15 * HOUR); // next 22:00
  });

  it('holds item reminders too and collapses what came due', async () => {
    const h = harness({
      now: z('2026-01-10T20:00:00Z'),
      settings: { quiet: { start: '21:30', end: '07:00' } },
    });
    const s = h.build();
    s.registerSource(itemSource());
    await s.start();
    await s.replaceItems('ext:mem', [item('a', z('2026-01-10T22:00:00Z')), item('b', z('2026-01-10T23:00:00Z'))]);
    h.now = z('2026-01-10T23:30:00Z');
    await s.wake();
    expect(h.shows).toHaveLength(0);
    expect(s.listItems('ext:mem')).toHaveLength(2);
    h.now = z('2026-01-11T07:00:00Z');
    await s.wake();
    expect(h.shows).toHaveLength(1);
    expect(h.shows[0]).toMatchObject({ title: 'Memory', body: '2 cards waiting', count: 2, missed: true, keys: ['a', 'b'] });
  });

  it('with the master switch off, quiet hours do not hold the timer', async () => {
    const h = harness({
      now: z('2026-01-10T23:00:00Z'),
      settings: { enabled: false, quiet: { start: '21:30', end: '07:00' } },
    });
    const s = h.build({ guardMs: HOUR });
    await s.start();
    expect(h.delay).toBe(HOUR);
  });
});

describe('item sources', () => {
  it('sanitizes replaced items', async () => {
    const h = harness();
    const s = h.build();
    await s.start();
    const items = [
      item('a', T0 + HOUR),
      item('a', T0 + 2 * HOUR), // duplicate key
      item('big', T0 + HOUR, { data: { x: 'y'.repeat(2000) } }),
      item('edge-ok', T0 + HOUR, { data: 'y'.repeat(1022) }), // 1024 bytes as JSON
      item('edge-big', T0 + HOUR, { data: 'y'.repeat(1023) }), // 1025 bytes
      item('nan', NaN),
      { key: 'str', fireAt: 'soon', title: 't', body: 'b' },
      { key: '', fireAt: T0 + HOUR, title: 't', body: 'b' },
      { key: 'k'.repeat(201), fireAt: T0 + HOUR, title: 't', body: 'b' },
      { key: 'notitle', fireAt: T0 + HOUR, body: 'b' },
      null,
      'junk',
      item('data', T0 + 3 * HOUR, { data: { n: 1 } }),
      item('long', T0 + 4 * HOUR, { title: 'x'.repeat(500), body: 'y'.repeat(900), tag: 'z'.repeat(300) }),
      item('ancient', T0 - 2 * DAY),
    ];
    const res = await s.replaceItems('ext:mem', items, 'Memory');
    expect(res).toEqual({ accepted: 4 });
    const list = s.listItems('ext:mem');
    expect(list.map((i) => i.key).sort()).toEqual(['a', 'data', 'edge-ok', 'long']);
    expect(list.find((i) => i.key === 'a')!.fireAt).toBe(T0 + HOUR); // first duplicate wins
    const long = list.find((i) => i.key === 'long')!;
    expect(long.title).toHaveLength(120);
    expect(long.body).toHaveLength(500);
    expect(long.tag).toHaveLength(100);
    expect(list.find((i) => i.key === 'data')!.data).toEqual({ n: 1 });
    // sorted by fireAt
    expect(list.map((i) => i.fireAt)).toEqual([...list.map((i) => i.fireAt)].sort((a, b) => a - b));
  });

  it('keeps the earliest 64 items', async () => {
    const h = harness();
    const s = h.build();
    await s.start();
    const items = Array.from({ length: 70 }, (_, i) => item(`k${i}`, T0 + (70 - i) * HOUR)); // k69 is earliest
    const res = await s.replaceItems('ext:mem', items);
    expect(res.accepted).toBe(64);
    const list = s.listItems('ext:mem');
    expect(list).toHaveLength(64);
    expect(list[0].fireAt).toBe(T0 + HOUR);
    expect(list[63].fireAt).toBe(T0 + 64 * HOUR);
  });

  it('replaceItems is idempotent, an empty list clears, a non-array clears, listItems returns copies', async () => {
    const h = harness();
    const s = h.build();
    await s.start();
    const items = [item('a', T0 + HOUR)];
    await s.replaceItems('ext:mem', items);
    await s.replaceItems('ext:mem', items);
    expect(s.listItems('ext:mem')).toHaveLength(1);
    s.listItems('ext:mem')[0].title = 'mutated';
    expect(s.listItems('ext:mem')[0].title).toBe('T a');
    expect(await s.replaceItems('ext:mem', [])).toEqual({ accepted: 0 });
    expect(s.listItems('ext:mem')).toEqual([]);
    await s.replaceItems('ext:mem', items);
    expect(await s.replaceItems('ext:mem', 'nope')).toEqual({ accepted: 0 });
    expect(s.listItems('ext:mem')).toEqual([]);
  });

  it('sanitizeReminderItems drops past-by-more-than-a-day and non-arrays', () => {
    expect(sanitizeReminderItems(undefined, T0)).toEqual([]);
    expect(sanitizeReminderItems([item('old', T0 - DAY - 1), item('edge', T0 - DAY)], T0).map((i) => i.key)).toEqual(['edge']);
    expect(sanitizeReminderItems([item('f', 1.9e12 + 0.7)], T0)[0].fireAt).toBe(Math.floor(1.9e12 + 0.7));
  });

  it('shows due items individually on time, with data, a tag and the extension target', async () => {
    const h = harness();
    const s = h.build();
    s.registerSource(itemSource());
    await s.start();
    await s.replaceItems('ext:mem', [item('a', T0 + HOUR, { data: { card: 7 }, tag: 'card-7' }), item('b', T0 + 2 * HOUR)]);
    expect(h.delay).toBe(HOUR);
    h.now = T0 + HOUR;
    await h.fire();
    expect(h.shows).toHaveLength(1);
    expect(h.shows[0]).toMatchObject({
      sourceId: 'ext:mem', title: 'T a', body: 'B a', tag: 'card-7', keys: ['a'], data: { card: 7 },
      missed: false, count: 1, dueAt: T0 + HOUR, target: { kind: 'extension', extensionId: 'mem' },
    });
    expect(s.listItems('ext:mem').map((i) => i.key)).toEqual(['b']);
    expect(h.delay).toBe(HOUR);
  });

  it('is on by default but a user can turn it off (items are consumed, nothing shown)', async () => {
    const h = harness({ settings: { sources: { 'ext:mem': { enabled: false } } } });
    const s = h.build();
    s.registerSource(itemSource());
    await s.start();
    await s.replaceItems('ext:mem', [item('a', T0 + HOUR)]);
    h.now = T0 + 2 * HOUR;
    await s.wake();
    expect(h.shows).toHaveLength(0);
    expect(s.listItems('ext:mem')).toEqual([]);
  });

  it('an explicit source.target wins over the ext: default', async () => {
    const h = harness();
    const s = h.build();
    s.registerSource(itemSource({ target: { kind: 'extension', extensionId: 'mem', panelId: 'cards' } }));
    await s.start();
    await s.replaceItems('ext:mem', [item('a', T0 + 1)]);
    h.now = T0 + 1;
    await s.wake();
    expect(h.shows[0].target).toEqual({ kind: 'extension', extensionId: 'mem', panelId: 'cards' });
  });

  it('no default target for a non ext: item source id', async () => {
    const h = harness({ settings: { sources: enabled('other') } });
    const s = h.build();
    await s.start();
    await s.replaceItems('other', [item('a', T0 + 1)]);
    h.now = T0 + 1;
    await s.wake();
    expect(h.shows).toHaveLength(1);
    expect(h.shows[0].target).toBeUndefined();
  });

  it('several missed items collapse into one notification; onMissed gets summarized and dropped keys', async () => {
    const h = harness({ now: T0 - 14 * HOUR });
    const onMissed = vi.fn();
    const s = h.build();
    s.registerSource(itemSource({ onMissed }));
    await s.start();
    await s.replaceItems('ext:mem', [
      item('old', T0 - 13 * HOUR),
      item('m1', T0 - 2 * HOUR),
      item('m2', T0 - HOUR),
      item('now', T0 - MIN),
      item('later', T0 + HOUR),
    ]);
    h.now = T0;
    await s.wake();
    expect(h.shows.map((n) => [n.keys, n.missed, n.count])).toEqual([
      [['now'], false, 1],
      [['m1', 'm2'], true, 2],
    ]);
    const collapsed = h.shows[1];
    expect(collapsed).toMatchObject({
      title: 'Memory', body: '2 cards waiting', dueAt: T0 - HOUR, target: { kind: 'extension', extensionId: 'mem' },
    });
    expect(collapsed.data).toBeUndefined();
    expect(onMissed).toHaveBeenCalledTimes(1);
    expect(onMissed).toHaveBeenCalledWith({ sourceId: 'ext:mem', summarized: ['m1', 'm2'], dropped: ['old'] });
    expect(s.listItems('ext:mem').map((i) => i.key)).toEqual(['later']);
  });

  it('a single missed item is shown as itself, marked missed', async () => {
    const h = harness({ now: T0 - 14 * HOUR });
    const s = h.build();
    s.registerSource(itemSource());
    await s.start();
    await s.replaceItems('ext:mem', [item('m1', T0 - 2 * HOUR, { data: 1 })]);
    h.now = T0;
    await s.wake();
    expect(h.shows).toHaveLength(1);
    expect(h.shows[0]).toMatchObject({ title: 'T m1', missed: true, count: 1, data: 1 });
  });

  it('the source may supply its own collapsed content', async () => {
    const h = harness({ now: T0 - 14 * HOUR });
    const s = h.build();
    s.registerSource(itemSource({ collapse: (items) => ({ title: 'Cards', body: items.map((i) => i.key).join('+') }) }));
    await s.start();
    await s.replaceItems('ext:mem', [item('m1', T0 - 2 * HOUR), item('m2', T0 - HOUR)]);
    h.now = T0;
    await s.wake();
    expect(h.shows[0]).toMatchObject({
      title: 'Cards', body: 'm1+m2', count: 2, target: { kind: 'extension', extensionId: 'mem' },
    });
  });

  it('falls back to the default collapsed text when no strings are given', async () => {
    const h = harness({ now: T0 - 14 * HOUR });
    const s = h.build({ strings: undefined });
    s.registerSource(itemSource());
    await s.start();
    await s.replaceItems('ext:mem', [item('m1', T0 - 2 * HOUR), item('m2', T0 - HOUR)]);
    h.now = T0;
    await s.wake();
    expect(h.shows[0]).toMatchObject({ title: 'Memory', body: '2 reminders waiting' });
  });

  it('re-sending items that already fired does not fire them again (idempotent replaceAll)', async () => {
    const h = harness();
    const s = h.build();
    s.registerSource(itemSource());
    await s.start();
    await s.replaceItems('ext:mem', [item('a', T0 + HOUR), item('b', T0 + 2 * HOUR)]);
    h.now = T0 + HOUR;
    await h.fire();
    expect(h.shows.map((n) => n.keys)).toEqual([['a']]);
    await s.replaceItems('ext:mem', [item('a', T0 + HOUR), item('b', T0 + 2 * HOUR)]);
    expect(h.shows).toHaveLength(1);
    expect(s.listItems('ext:mem').map((i) => i.key)).toEqual(['b']);
  });

  it('keeps items replaced before start() and merges them over the saved state', async () => {
    const state = createMemoryStatePort({ version: 1, checkpoints: { 'ext:old': T0 - HOUR }, items: { 'ext:old': [item('o', T0 + 3 * HOUR)] }, labels: {} });
    const h = harness({ state });
    const s = h.build();
    expect((await s.replaceItems('ext:mem', [item('a', T0 + HOUR)])).accepted).toBe(1);
    await s.start();
    expect(s.listItems('ext:mem').map((i) => i.key)).toEqual(['a']);
    expect(s.listItems('ext:old').map((i) => i.key)).toEqual(['o']);
  });

  it('collapses a burst of more than three on-time items from one source', async () => {
    const h = harness();
    const s = h.build();
    s.registerSource(itemSource());
    await s.start();
    await s.replaceItems('ext:mem', ['a', 'b', 'c', 'd'].map((k) => item(k, T0 + HOUR)));
    h.now = T0 + HOUR;
    await h.fire();
    expect(h.shows).toHaveLength(1);
    expect(h.shows[0].count).toBe(4);
  });

  it('an item source that is not allowed (extension disabled or permission revoked) never fires', async () => {
    const h = harness();
    let allowed = false;
    const s = h.build({ isItemSourceAllowed: () => allowed });
    await s.start();
    await s.replaceItems('ext:mem', [item('a', T0 + HOUR)], 'Memory');
    expect(s.listSources().find((x) => x.id === 'ext:mem')?.enabled).toBe(false);
    h.now = T0 + HOUR;
    await s.wake();
    expect(h.shows).toHaveLength(0);
    allowed = true;
    await s.replaceItems('ext:mem', [item('b', T0 + 2 * HOUR)]);
    h.now = T0 + 2 * HOUR;
    await s.wake();
    expect(h.shows.map((n) => n.keys)).toEqual([['b']]);
  });

  it('items persist across a restart and fire without the source being registered', async () => {
    const h = harness();
    const a = h.build();
    a.registerSource(itemSource());
    await a.start();
    await a.replaceItems('ext:mem', [item('a', T0 + 2 * HOUR, { data: { n: 1 } })]);
    a.stop();

    const b = h.build();
    await b.start();
    expect(b.listItems('ext:mem').map((i) => i.key)).toEqual(['a']);
    expect(h.delay).toBe(2 * HOUR);
    h.now = T0 + 2 * HOUR;
    await h.fire();
    expect(h.shows).toHaveLength(1);
    expect(h.shows[0]).toMatchObject({ sourceId: 'ext:mem', keys: ['a'], data: { n: 1 }, target: { kind: 'extension', extensionId: 'mem' } });
  });

  it('items due while the app was closed are shown collapsed on the next start', async () => {
    const h = harness();
    const a = h.build();
    await a.start();
    await a.replaceItems('ext:mem', [item('a', T0 + 2 * HOUR), item('b', T0 + 3 * HOUR)], 'Memory');
    a.stop();
    h.now = T0 + 5 * HOUR;
    const b = h.build();
    await b.start();
    expect(h.shows).toHaveLength(1);
    expect(h.shows[0]).toMatchObject({ title: 'Memory', count: 2, missed: true });
  });

  it('listSources shows a remembered item source (label, pending, next) after restart and forgetSource removes it', async () => {
    const h = harness();
    const a = h.build();
    a.registerSource(itemSource());
    await a.start();
    await a.replaceItems('ext:mem', [item('a', T0 + HOUR), item('b', T0 + 2 * HOUR)]);
    a.stop();

    const b = h.build();
    await b.start();
    expect(b.listSources()).toEqual([
      {
        id: 'ext:mem', kind: 'items', label: 'Memory', description: undefined, enabled: true, defaultEnabled: true,
        registered: false, plan: null, userEditable: false, nextAt: T0 + HOUR, pending: 2,
      },
    ]);
    expect(b.nextDue()).toEqual({ sourceId: 'ext:mem', at: T0 + HOUR });

    await b.forgetSource('ext:mem');
    expect(b.listSources()).toEqual([]);
    expect(b.nextDue()).toBeNull();
    expect(h.state.current?.items).toEqual({});
    expect(h.state.current?.labels).toEqual({});
  });

  it('labels from replaceItems are remembered even with no registration', async () => {
    const h = harness();
    const s = h.build();
    await s.start();
    await s.replaceItems('ext:other', [item('a', T0 + HOUR)], 'Other ext');
    expect(s.listSources().map((i) => [i.id, i.label, i.registered])).toEqual([['ext:other', 'Other ext', false]]);
  });
});

describe('activate', () => {
  it('returns the activation, calls onActivated, and returns null the second time and for unknown ids', async () => {
    const h = harness();
    const onActivated = vi.fn();
    const s = h.build();
    s.registerSource(itemSource({ onActivated }));
    await s.start();
    await s.replaceItems('ext:mem', [item('a', T0 + HOUR, { data: { card: 3 } })]);
    h.now = T0 + HOUR;
    await s.wake();
    const n = h.shows[0];
    h.now = T0 + HOUR + 5000;
    const act = s.activate(n.id);
    expect(act).toEqual({
      sourceId: 'ext:mem', keys: ['a'], data: { card: 3 }, dueAt: T0 + HOUR, activatedAt: T0 + HOUR + 5000,
      target: { kind: 'extension', extensionId: 'mem' },
    });
    expect(onActivated).toHaveBeenCalledTimes(1);
    expect(onActivated).toHaveBeenCalledWith(act);
    expect(s.activate(n.id)).toBeNull();
    expect(s.activate('nope')).toBeNull();
    expect(onActivated).toHaveBeenCalledTimes(1);
  });

  it('works for a rule source and survives a throwing onActivated', async () => {
    const h = harness({ settings: { sources: enabled('app:votd') } });
    const s = h.build();
    s.registerSource(ruleSource({ onActivated: () => { throw new Error('x'); } }));
    await s.start();
    h.now = T8;
    await s.wake();
    const act = s.activate(h.shows[0].id);
    expect(act).toMatchObject({ sourceId: 'app:votd', keys: [`d@${T8}`], target: { kind: 'verse', verseId: 1001001 } });
    expect(h.errors.map(([, c]) => c)).toEqual(['activate:app:votd']);
  });

  it('presented ids are unique', async () => {
    const h = harness();
    const s = h.build();
    await s.presentNow('app:votd', { title: 'a', body: 'a' });
    await s.presentNow('app:votd', { title: 'b', body: 'b' });
    expect(new Set(h.shows.map((n) => n.id)).size).toBe(2);
  });
});

describe('concurrency and misc', () => {
  it('concurrent wake() calls do not double-present', async () => {
    const h = harness({ settings: { sources: enabled('app:votd') } });
    const s = h.build();
    const src = ruleSource({
      render: async (ctx) => {
        await flush();
        return { title: 'Verse', body: String(ctx.fire.at) };
      },
    });
    s.registerSource(src);
    await s.start();
    h.now = T8;
    await Promise.all([s.wake(), s.wake(), s.refresh(), s.wake()]);
    await flush();
    expect(h.shows).toHaveLength(1);
  });

  it('presentNow shows immediately, outside any schedule', async () => {
    const h = harness();
    const s = h.build();
    await s.presentNow('app:test', { title: 'Test', body: 'Hello', target: { kind: 'route', route: 'settings/notifications' } });
    expect(h.shows).toHaveLength(1);
    expect(h.shows[0]).toMatchObject({
      sourceId: 'app:test', title: 'Test', body: 'Hello', keys: [], count: 1, missed: false, dueAt: T0,
      target: { kind: 'route', route: 'settings/notifications' },
    });
  });

  it('a throwing presenter, state port and settings function are reported, not fatal', async () => {
    const h = harness({ settings: { sources: enabled('app:votd') } });
    const s = h.build({
      presenter: { show: () => { throw new Error('show'); } },
      state: { load: () => { throw new Error('load'); }, save: () => { throw new Error('save'); } },
    });
    s.registerSource(ruleSource());
    await s.start();
    h.now = T8;
    await s.wake();
    expect(h.errors.map(([, c]) => c)).toEqual(expect.arrayContaining(['state.load', 'state.save', 'present:app:votd']));
    expect(h.delay).not.toBeNull();

    const s2 = h.build({ settings: () => { throw new Error('settings'); } });
    s2.registerSource(ruleSource());
    await s2.start();
    expect(h.errors.some(([, c]) => c === 'settings')).toBe(true);
  });

  it('timeZone() is read on every wake: a zone change moves the next fire', async () => {
    let tz = 'UTC';
    const h = harness({ settings: { sources: enabled('app:votd') } });
    const s = h.build({ timeZone: () => tz });
    s.registerSource(ruleSource());
    await s.start();
    expect(h.delay).toBe(HOUR);
    tz = 'America/New_York'; // 08:00 EST = 13:00Z
    await s.refresh();
    expect(h.delay).toBe(6 * HOUR);
  });

  it('onChange fires after a wake', async () => {
    const h = harness();
    const s = h.build();
    await s.start();
    const before = h.changes;
    await s.wake();
    expect(h.changes).toBeGreaterThan(before);
  });

  it('start() twice does not reload or double-fire', async () => {
    const h = harness({ settings: { sources: enabled('app:votd') } });
    const s = h.build();
    s.registerSource(ruleSource());
    await s.start();
    await s.start();
    h.now = T8;
    await s.wake();
    expect(h.shows).toHaveLength(1);
  });
});
