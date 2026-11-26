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

/**
 * "Move the dates" can be undone (task 0222 R3-1): the schedule as it was, held here (not in a pane's state) so it
 * survives the pane being closed and reopened. It is valid until the next reading day or the next schedule edit.
 */
export interface ScheduleUndo {
  enrollmentId: string;
  /** The enrollment's `startDate` and `catchUp` before the move. */
  oldStartDate: string;
  oldCatchUp: { extraPerDay: number } | null;
  /** The `startDate` the move produced: a different one later means the schedule was edited since. */
  newStartDate: string;
  /** The reading date the move happened on. */
  movedOn: string;
}

/** The undo for this enrollment while it still applies, else null. `today` is the current reading date. */
export function validScheduleUndo(
  undo: ScheduleUndo | null, enrollment: { id: string; startDate: string }, today: string | null,
): ScheduleUndo | null {
  if (!undo || undo.enrollmentId !== enrollment.id) return null;
  if (enrollment.startDate !== undo.newStartDate) return null;
  if (today !== null && today !== undo.movedOn) return null;
  return undo;
}

interface State {
  request: NavRequest | null;
  scheduleUndo: ScheduleUndo | null;
  setScheduleUndo: (u: ScheduleUndo | null) => void;
  show: (r: Omit<NavRequest, 'nonce'>) => void;
  /** Take the pending request (and clear it). */
  consume: () => NavRequest | null;
}

let nonce = 0;

export const useReadingPlanNavStore = create<State>((set, get) => ({
  request: null,
  scheduleUndo: null,
  setScheduleUndo: (scheduleUndo) => set({ scheduleUndo }),
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
  useReadingPlanNavStore.setState({ request: null, scheduleUndo: null });
}
