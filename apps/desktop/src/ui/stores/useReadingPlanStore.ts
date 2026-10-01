/**
 * Reading plans store (task 0073): today's view of every active plan, kept in step with the
 * ReadingPlanService. The Reading plans pane and the Bible-pane "today's reading" bar read it.
 * The service is only touched once something asks for a refresh, so a reader with no plans pays
 * one IPC call.
 */
import { create } from 'zustand';
import type { ReadingPlans } from '@bible/core/browser';
import { getReadingPlanService, setReadingPlanRolloverHour } from '../services/readingPlansAPI';
import { usePreferencesStore } from './usePreferencesStore';

interface ReadingPlanState {
  todays: ReadingPlans.TodayView[];
  loading: boolean;
  /** True once a refresh has completed (successfully or not). */
  loaded: boolean;
  error: string | null;
  refresh: () => Promise<void>;
  /** Refresh only when nothing has been loaded yet. */
  ensureLoaded: () => Promise<void>;
}

let unsubscribeService: (() => void) | null = null;
let subscribedService: ReadingPlans.ReadingPlanService | null = null;
let prefsSubscribed = false;

function subscribeOnce(refresh: () => Promise<void>): void {
  const service = getReadingPlanService();
  if (subscribedService !== service) {
    unsubscribeService?.();
    subscribedService = service;
    unsubscribeService = service.subscribe((event) => {
      if (event.type === 'changed') void refresh();
    });
  }
  if (!prefsSubscribed) {
    prefsSubscribed = true;
    setReadingPlanRolloverHour(usePreferencesStore.getState().readingPlanRolloverHour);
    let last = usePreferencesStore.getState().readingPlanRolloverHour;
    usePreferencesStore.subscribe((state) => {
      if (state.readingPlanRolloverHour === last) return;
      last = state.readingPlanRolloverHour;
      setReadingPlanRolloverHour(last);
      void refresh();
    });
  }
}

export const useReadingPlanStore = create<ReadingPlanState>((set, get) => ({
  todays: [],
  loading: false,
  loaded: false,
  error: null,
  refresh: async () => {
    subscribeOnce(get().refresh);
    set({ loading: true });
    try {
      const todays = await getReadingPlanService().todayViews();
      set({ todays, loading: false, loaded: true, error: null });
    } catch (err) {
      set({ loading: false, loaded: true, error: err instanceof Error ? err.message : String(err) });
    }
  },
  ensureLoaded: async () => {
    if (get().loaded || get().loading) return;
    await get().refresh();
  },
}));

/** Tests only: forget the subscriptions so a fresh service can be injected. */
export function resetReadingPlanStoreForTests(): void {
  unsubscribeService?.();
  unsubscribeService = null;
  subscribedService = null;
  useReadingPlanStore.setState({ todays: [], loading: false, loaded: false, error: null });
}
