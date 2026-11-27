/**
 * The reading the user opened from a reading plan (task 0196): what the reader shows its "start of
 * reading" and "end of reading" blocks for. Opening a reading from the plan views calls `openPlanReading`,
 * which records it here and navigates the reader to its first verse. `info` is kept in step with the
 * plan service (marking read or unread anywhere, or a plan change, refreshes it).
 */
import { create } from 'zustand';
import { ReadingPlans } from '@bible/core/browser';
import { currentRolloverHour, getReadingPlanService } from './readingPlansAPI';
import { watchReadingDay } from './readingDayWatcher';
import { navigateToVerseInPrimary } from '../../stores/crossStoreBridge';
import { syncPanesWithVerse } from '../../stores/syncPanesWithVerse';
import { usePreferencesStore } from '../../stores/usePreferencesStore';
import { openApp } from '../../apps/appHost';
import { canUseReadingTab, clearReadingTabScope, openInReadingTab, readingTabTitle } from './planReadingTab';

export interface ActiveReadingRef {
  enrollmentId: string;
  day: number;
  index: number;
}

export interface ActiveReadingInfo extends ActiveReadingRef {
  planKey: string;
  planName: string;
  dayCount: number;
  /** Readings in this day (>1: a multi-passage day). */
  readingCount: number;
  reading: ReadingPlans.Reading;
  done: boolean;
  /** The next passage of the same day, else the first of the next day. */
  next: ReadingPlans.PlanReadingRef | null;
}

interface State {
  ref: ActiveReadingRef | null;
  info: ActiveReadingInfo | null;
  /** Record the reading and load its info (no navigation). */
  activate: (ref: ActiveReadingRef) => Promise<void>;
  refresh: () => Promise<void>;
  setDone: (done: boolean) => Promise<void>;
  clear: () => void;
}

let unsubscribe: (() => void) | null = null;
let subscribedService: ReadingPlans.ReadingPlanService | null = null;
let loadToken = 0;
let openedOn = '';
let stopDayWatch: (() => void) | null = null;

export const useActiveReadingStore = create<State>((set, get) => ({
  ref: null,
  info: null,
  activate: async (ref) => {
    set({ ref, info: null });
    const service = getReadingPlanService();
    if (subscribedService !== service) {
      unsubscribe?.();
      subscribedService = service;
      unsubscribe = service.subscribe((e) => { if (e.type === 'changed') void get().refresh(); });
    }
    // A new reading day ends the reading the user opened yesterday.
    openedOn = service.today();
    stopDayWatch ??= watchReadingDay(() => {
      // Focus ticks too: only a changed reading day ends the reading.
      if (getReadingPlanService().today() === openedOn) return;
      loadToken++;
      set({ ref: null, info: null });
    }, currentRolloverHour);
    await get().refresh();
  },
  refresh: async () => {
    const ref = get().ref;
    if (!ref) return;
    const token = ++loadToken;
    try {
      const service = getReadingPlanService();
      const detail = await service.detail(ref.enrollmentId);
      const progress = await service.dayProgress(ref.enrollmentId, ref.day);
      const reading = detail.plan.days[ref.day - 1]?.readings[ref.index];
      if (token !== loadToken || get().ref !== ref) return;
      if (!reading) { set({ info: null }); return; }
      set({
        info: {
          ...ref,
          planKey: detail.enrollment.planKey,
          planName: detail.enrollment.planName,
          dayCount: detail.plan.days.length,
          readingCount: detail.plan.days[ref.day - 1].readings.length,
          reading,
          done: progress.includes(ref.index),
          next: ReadingPlans.nextReadingAfter(detail.plan, ref.day, ref.index),
        },
      });
    } catch {
      // The enrollment is gone (removed) or unreadable: forget the reading.
      if (token === loadToken) set({ ref: null, info: null });
    }
  },
  setDone: async (done) => {
    const ref = get().ref;
    if (!ref) return;
    await getReadingPlanService().setReadingDone(ref.enrollmentId, ref.day, ref.index, done, 'reader');
    await get().refresh();
  },
  clear: () => { loadToken++; clearReadingTabScope(); set({ ref: null, info: null }); },
}));

/** One of today's readings with the plan facts the end block needs; see `todaySetFor`. */
export interface TodayEntry {
  view: ReadingPlans.TodayView;
  r: ReadingPlans.TodayReadingRef;
  /** `nextDueReading`: the next unticked reading of today's set (null: the day, or today's set, is done). */
  next: ReadingPlans.PlanReadingRef | null;
  /** The plan day after `r.day`, or null at the plan's end (for "Read ahead"). */
  nextDay: number | null;
}

const todaySets = new WeakMap<readonly ReadingPlans.TodayView[], TodayEntry[]>();

/**
 * Every reading of today's set (ticked and unticked) over all active plans, computed once per `todays` array
 * (the plan store replaces the array on each refresh), so the per-verse reader slot only filters a short list.
 */
export function todaySetFor(todays: readonly ReadingPlans.TodayView[]): TodayEntry[] {
  let set = todaySets.get(todays);
  if (!set) {
    set = todays.flatMap((view) => ReadingPlans.todaysReadings(view).map((r) => ({
      view,
      r,
      next: ReadingPlans.nextDueReading(view, r.day, r.index),
      nextDay: r.day < view.dayCount ? r.day + 1 : null,
    })));
    todaySets.set(todays, set);
  }
  return set;
}

/** Tick (or untick) a reading from the reader. The reading becomes the active one first, so its end block stays for undo. */
export async function markReadingFromReader(ref: ActiveReadingRef, done: boolean): Promise<void> {
  const store = useActiveReadingStore.getState(); // allow-getstate: event handler
  const cur = store.ref;
  if (!cur || cur.enrollmentId !== ref.enrollmentId || cur.day !== ref.day || cur.index !== ref.index) {
    await store.activate(ref);
  }
  await useActiveReadingStore.getState().setDone(done); // allow-getstate: event handler
}

function openInCurrentTab(start: number): void {
  navigateToVerseInPrimary(start);
  syncPanesWithVerse(start);
  void openApp('study');
}

/**
 * Open a plan reading at its first verse and remember it for the reader's blocks. Where it opens follows the
 * `readingPlanOpenIn` pref: a reusable reading tab ('tab', default) or the current Bible tab ('current', the
 * old behaviour, also the fallback when no tab can be made).
 */
export function openPlanReading(target: { enrollmentId: string; day: number; index: number; reading: ReadingPlans.Reading }): void {
  void useActiveReadingStore.getState().activate({ enrollmentId: target.enrollmentId, day: target.day, index: target.index }); // allow-getstate: event handler
  const start = target.reading.start;
  if (usePreferencesStore.getState().readingPlanOpenIn === 'tab' && canUseReadingTab()) { // allow-getstate: event handler
    void openInReadingTab(target, readingTabTitle(target.reading)).then((ok) => { if (!ok) openInCurrentTab(start); });
    return;
  }
  openInCurrentTab(start);
}

/** Tests only. */
export function resetActiveReadingForTests(): void {
  unsubscribe?.();
  unsubscribe = null;
  subscribedService = null;
  stopDayWatch?.();
  stopDayWatch = null;
  loadToken++;
  useActiveReadingStore.setState({ ref: null, info: null });
}
