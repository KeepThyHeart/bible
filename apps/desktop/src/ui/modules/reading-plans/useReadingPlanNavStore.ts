/**
 * A request to open the Reading plans app on the full plan with one reading highlighted (the reader's
 * "View reading plan"). The pane consumes it once it is mounted; `nonce` makes repeated requests distinct.
 */
import { create } from 'zustand';
import { openApp } from '../../apps/appHost';

export interface NavRequest {
  enrollmentId: string;
  day: number;
  index: number;
  nonce: number;
}

interface State {
  request: NavRequest | null;
  show: (r: Omit<NavRequest, 'nonce'>) => void;
  /** Take the pending request (and clear it). */
  consume: () => NavRequest | null;
}

let nonce = 0;

export const useReadingPlanNavStore = create<State>((set, get) => ({
  request: null,
  show: (r) => set({ request: { ...r, nonce: ++nonce } }),
  consume: () => {
    const request = get().request;
    if (request) set({ request: null });
    return request;
  },
}));

/** Open the Reading plans app on the full plan with this reading highlighted. */
export function viewPlanReading(ref: { enrollmentId: string; day: number; index: number }): void {
  useReadingPlanNavStore.getState().show(ref); // allow-getstate: event handler
  void openApp('reading-plans');
}

/** Tests only. */
export function resetReadingPlanNavForTests(): void {
  useReadingPlanNavStore.setState({ request: null });
}
