import { describe, expect, it } from 'vitest';
import {
  formatVerseIdRange, minContextDays,
  bc, civilToInstant, instantToCivil, formatInstant, formatSpan, computeTicks, zoomView, panView, clampView,
  layoutTimeline, packRows, resolveItems, chronologyChain, itemsForPassage, createTimelineStore, xOf, tOf,
  type TimelineDataset, type TimelineItemDto,
} from './index';

const item = (id: number, over: Partial<TimelineItemDto>): TimelineItemDto => ({
  id, slug: `i${id}`, kind: 'reign', laneId: 'judah', title: `Item ${id}`, reviewed: false, passages: [], dates: {}, ...over,
});

const y = (yr: number) => civilToInstant(yr, 1, 1);
const dataset: TimelineDataset = {
  info: { name: 'Test' },
  chronologies: [
    { id: 'ussher', name: 'Ussher', isDefault: true, sortOrder: 0 },
    { id: 'alt', name: 'Alt', isDefault: false, sortOrder: 1, fallbackId: 'ussher' },
  ],
  lanes: [{ id: 'judah', name: 'Judah', sortOrder: 0 }, { id: 'events', name: 'Events', sortOrder: 1 }],
  items: [
    item(1, { title: 'Rehoboam', dates: { ussher: { start: y(bc(975)), end: y(bc(957)), precision: 'year', circa: false } }, passages: [{ start: 11043000, end: 14031000, primary: true }] }),
    item(2, { title: 'Abijah', dates: { ussher: { start: y(bc(958)), end: y(bc(954)), precision: 'year', circa: false }, alt: { start: y(bc(950)), end: y(bc(946)), precision: 'year', circa: false } }, passages: [{ start: 11015001, end: 11015008, primary: true }] }),
    item(3, { kind: 'event', laneId: 'events', title: 'Crucifixion', dates: { ussher: { start: civilToInstant(33, 4, 3, 9), precision: 'hour', circa: false } }, passages: [{ start: 43019016, end: 43019030, primary: true }] }),
  ],
};

describe('calendar', () => {
  it('matches known Julian day numbers', () => {
    expect(civilToInstant(-4712, 1, 1)).toBe(0);
    expect(civilToInstant(1, 1, 1)).toBe(1721424);
  });
  it('round-trips civil dates including hours', () => {
    const c = instantToCivil(civilToInstant(33, 4, 3, 15));
    expect(c).toMatchObject({ year: 33, month: 4, day: 3, hour: 15, minute: 0 });
    expect(instantToCivil(civilToInstant(bc(4004), 10, 23))).toMatchObject({ year: -4003, month: 10, day: 23 });
  });
  it('formats no more precisely than the precision', () => {
    const t = civilToInstant(33, 4, 3, 9);
    expect(formatInstant(t, 'year')).toBe('AD 33');
    expect(formatInstant(t, 'day')).toBe('April 3, AD 33');
    expect(formatInstant(t, 'hour')).toBe('April 3, AD 33, 09:00');
    expect(formatInstant(y(bc(1491)), 'year', true)).toBe('c. 1491 BC');
    expect(formatInstant(y(bc(1450)), 'century')).toBe('1500 BC');
  });
  it('formats spans with an inclusive last year', () => {
    expect(formatSpan(y(bc(975)), y(bc(957)), 'year')).toBe('975 BC to 958 BC');
  });
});

describe('scale', () => {
  const bounds = { start: 0, end: 10000 };
  it('zoom keeps the anchor fixed and respects bounds', () => {
    const v = { start: 1000, end: 3000 };
    const z = zoomView(v, 2, 2000, bounds);
    expect(z.end - z.start).toBeCloseTo(1000);
    expect(xOf(z, 800, 2000)).toBeCloseTo(xOf(v, 800, 2000));
    const out = zoomView(v, 0.0001, 2000, bounds);
    expect(out.end - out.start).toBeLessThanOrEqual(10000);
    expect(tOf(v, 100, 50)).toBe(2000);
  });
  it('pan clamps', () => {
    expect(panView({ start: 100, end: 200 }, -500, bounds).start).toBe(0);
    expect(clampView({ start: 9990, end: 10100 }, bounds).end).toBe(10000);
  });
  it('ticks get finer as the view narrows', () => {
    const wide = computeTicks({ start: y(bc(4004)), end: y(33) }, 1000);
    const week = computeTicks({ start: civilToInstant(33, 3, 29), end: civilToInstant(33, 4, 6) }, 1000);
    const day = computeTicks({ start: civilToInstant(33, 4, 3), end: civilToInstant(33, 4, 4) }, 1000);
    expect(wide.length).toBeGreaterThan(3);
    expect(wide.length).toBeLessThan(30);
    expect(week.some((t) => /Apr/.test(t.label))).toBe(true);
    expect(day.some((t) => /:00$/.test(t.label))).toBe(true);
  });
  it('day ticks omit the year except on the first and major ticks', () => {
    const t = computeTicks({ start: civilToInstant(33, 4, 20), end: civilToInstant(33, 4, 26) }, 1000);
    expect(t.length).toBeGreaterThan(3);
    expect(t[0].label).toMatch(/, /);
    expect(t.slice(1).every((k) => /^[A-Za-z]{3} \d+$/.test(k.label))).toBe(true);
  });
});

describe('chronology and passages', () => {
  it('falls back along the chain', () => {
    expect(chronologyChain(dataset, 'alt')).toEqual(['alt', 'ussher']);
    const r = resolveItems(dataset, 'alt');
    expect(r.find((x) => x.item.id === 1)?.viaFallback).toBe(true);
    expect(r.find((x) => x.item.id === 2)?.viaFallback).toBe(false);
  });
  it('finds items covering a verse, primary first', () => {
    expect(itemsForPassage(dataset, 11015003).map((i) => i.id)).toEqual([2, 1].filter((i) => i === 2));
    expect(itemsForPassage(dataset, 11043500).map((i) => i.id)).toEqual([1]);
    expect(itemsForPassage(dataset, 1001001)).toEqual([]);
  });
});

describe('layout', () => {
  it('packs overlapping items into separate rows and cull off-screen ones', () => {
    const rows = packRows(resolveItems({ ...dataset, items: [dataset.items[0], item(9, { dates: { ussher: { start: y(bc(970)), end: y(bc(960)), precision: 'year', circa: false } } })] }, 'ussher'));
    expect(new Set(rows.values()).size).toBe(2);
    const layout = layoutTimeline(resolveItems(dataset, 'ussher'), dataset.lanes, { start: y(bc(980)), end: y(bc(940)) }, { width: 800 });
    expect(layout.lanes.map((l) => l.lane.id)).toEqual(['judah', 'events']);
    expect(layout.culled).toBe(1);
    const m = layout.lanes[0].marks.find((k) => k.itemId === 1)!;
    expect(m.isSpan).toBe(true);
    expect(m.labelVisible).toBe(true);
  });
  it('distinguishes hour-level events at day zoom', () => {
    const ds = { ...dataset, items: [item(20, { kind: 'event', laneId: 'events', title: 'A', dates: { ussher: { start: civilToInstant(33, 4, 3, 9), precision: 'hour', circa: false } } }), item(21, { kind: 'event', laneId: 'events', title: 'B', dates: { ussher: { start: civilToInstant(33, 4, 3, 15), precision: 'hour', circa: false } } })] };
    const l = layoutTimeline(resolveItems(ds, 'ussher'), ds.lanes, { start: civilToInstant(33, 4, 3), end: civilToInstant(33, 4, 4) }, { width: 1000 });
    const [a, b] = l.lanes[0].marks;
    expect(b.x - a.x).toBeGreaterThan(200);
  });
});

describe('store', () => {
  it('starts on the default chronology and fits the data', () => {
    const s = createTimelineStore(dataset, { width: 900 });
    expect(s.getSnapshot().chronologyId).toBe('ussher');
    expect(s.getResolved()).toHaveLength(3);
    expect(s.getSnapshot().view).toEqual(s.getBounds());
  });
  it('keeps snapshot and layout identity stable until state changes', () => {
    const s = createTimelineStore(dataset);
    expect(s.getSnapshot()).toBe(s.getSnapshot());
    expect(s.getLayout()).toBe(s.getLayout());
    const before = s.getLayout();
    s.zoomAt(2, 400);
    expect(s.getLayout()).not.toBe(before);
  });
  it('switches chronology and notifies', () => {
    const s = createTimelineStore(dataset);
    let n = 0;
    s.subscribe(() => n++);
    s.setChronology('alt');
    expect(s.getSnapshot().chronologyId).toBe('alt');
    expect(n).toBe(1);
    s.setChronology('nope');
    expect(s.getSnapshot().chronologyId).toBe('alt');
  });
  it('focuses a passage and frames the item', () => {
    const s = createTimelineStore(dataset);
    expect(s.focusPassage(43019020)).toBe(true);
    const st = s.getSnapshot();
    expect(st.selectedId).toBe(3);
    expect(st.view.start).toBeLessThan(civilToInstant(33, 4, 3, 9));
    expect(st.view.end).toBeGreaterThan(civilToInstant(33, 4, 3, 9));
    // hour precision: at least 2 days of context, centred on the item
    expect(st.view.end - st.view.start).toBeGreaterThanOrEqual(2 - 1e-9);
    expect(st.view.end - st.view.start).toBeLessThan(3);
    const view = st.view;
    s.zoomAt(2, 400);
    const zoomed = s.getSnapshot().view;
    expect(s.focusPassage(43019020)).toBe(true);
    expect(s.getSnapshot().view).toBe(zoomed);
    expect(zoomed).not.toEqual(view);
    expect(s.focusPassage(1001001)).toBe(false);
  });
  it('filters and toggles lanes', () => {
    const s = createTimelineStore(dataset);
    s.toggleLane('judah');
    expect(s.getLayout().lanes.map((l) => l.lane.id)).toEqual(['events']);
    s.toggleLane('judah');
    s.setKinds(['event']);
    expect(s.getLayout().lanes.map((l) => l.lane.id)).toEqual(['events']);
  });
});

describe('formatVerseIdRange', () => {
  const name = (b: number) => (b === 1 ? 'Genesis' : b === 65 ? 'Jude' : `Book${b}`);
  it('formats verses and chapters, treating 999 as chapter end', () => {
    expect(formatVerseIdRange(1001001, undefined, name)).toBe('Genesis 1:1');
    expect(formatVerseIdRange(1001001, 1001003, name)).toBe('Genesis 1:1-3');
    expect(formatVerseIdRange(1001001, 1002003, name)).toBe('Genesis 1:1-2:3');
    expect(formatVerseIdRange(1005001, 1005999, name)).toBe('Genesis 5');
    expect(formatVerseIdRange(1005001, 1006999, name)).toBe('Genesis 5-6');
    expect(formatVerseIdRange(1005003, 1006999, name)).toBe('Genesis 5:3-6');
    expect(formatVerseIdRange(1005003, 1005999, name)).toBe('Genesis 5:3ff');
    expect(formatVerseIdRange(1050001, 2003999, name)).toBe('Genesis 50 - Book2 3');
    expect(formatVerseIdRange(65001001, 65001999, name, { isSingleChapterBook: () => true })).toBe('Jude');
  });
});

describe('layout compaction and focus framing', () => {
  it('sizes lanes from visible marks only', () => {
    const a = item(31, { laneId: 'events', kind: 'event', title: 'A', dates: { ussher: { start: 100, end: 200, precision: 'year', circa: false } } });
    const b = item(32, { laneId: 'events', kind: 'event', title: 'B', dates: { ussher: { start: 150, end: 250, precision: 'year', circa: false } } });
    const c = item(33, { laneId: 'events', kind: 'event', title: 'C', dates: { ussher: { start: 5000, end: 6000, precision: 'year', circa: false } } });
    const ds = { ...dataset, items: [a, b, c] };
    const all = resolveItems(ds, 'ussher');
    const wide = layoutTimeline(all, ds.lanes, { start: 0, end: 7000 }, { width: 800 });
    const narrow = layoutTimeline(all, ds.lanes, { start: 4900, end: 6100 }, { width: 800 });
    expect(wide.lanes[0].rows).toBe(2);
    expect(narrow.lanes[0].rows).toBe(1);
    expect(narrow.lanes[0].marks[0].row).toBe(0);
  });
  it('minContextDays follows precision', () => {
    expect(minContextDays('year')).toBeGreaterThanOrEqual(50 * 365);
    expect(minContextDays('day')).toBe(60);
    expect(minContextDays('hour')).toBe(2);
  });
});
