/**
 * How many clues a screen should be showing, worked out from the server's clock.
 *
 * The tempting version counts from when the question arrived. That version is
 * wrong on exactly the phones that matter: one that woke from lock halfway
 * through, one whose message took two seconds over cellular, one that reloaded.
 * Each would show clue two at a different moment, and "got it at clue two" would
 * stop meaning the same thing across the room. So the only inputs are the
 * room's deadline, the length of the window, and the synchronised clock:
 * the phase opened at `phaseEndsAt − answerWindowMs`, and clue `n` appears
 * `n − 1` intervals after that, on every screen at once.
 *
 * A pause needs no special arithmetic. The room moves its deadline by the
 * length of the pause, so the opening worked back from it moves too, and the
 * clue on the screen after a resume is the clue that was there before it.
 * While the pause lasts, the screen holds what it was showing.
 */

import { useEffect, useRef, useState } from 'preact/hooks';
import type { ServerTime, SnapshotCommon } from '../../../shared/protocol.js';
import type { ClockPort } from '../../shell/clockPort.js';
import type { WhoAmIRound } from './payload.js';

/** When the answering phase opened, or null when the room gave no deadline. */
export function openedAtFor(phaseEndsAt: ServerTime | null, answerWindowMs: number): ServerTime | null {
  return phaseEndsAt === null ? null : phaseEndsAt - answerWindowMs;
}

/**
 * Clues on the screen at `now`, counted from one: one from the opening, a
 * further one at each interval, never more than the question has.
 */
export function scheduledClues(
  openedAt: ServerTime,
  now: ServerTime,
  intervalMs: number,
  clueCount: number
): number {
  const count = Math.max(1, clueCount);
  const elapsed = now - openedAt;
  if (!Number.isFinite(elapsed) || elapsed < 0 || intervalMs <= 0) return 1;
  return Math.min(count, Math.floor(elapsed / intervalMs) + 1);
}

/**
 * The number of clues to show now, re-rendering the caller at each clue's
 * moment.
 *
 * The next clue is scheduled through the clock port as well as read from it,
 * so a phone that was locked through a clue lands on the right one the moment
 * it wakes, and a clock measurement that lands mid-round moves the schedule to
 * the truth rather than finishing the round on a stale offset.
 */
export function useCluesShown(round: WhoAmIRound, snapshot: SnapshotCommon, clock: ClockPort): number {
  const count = round.clues.length;
  const interval = round.clueIntervalMs;
  const openedAt = openedAtFor(snapshot.phaseEndsAt, round.answerWindowMs);
  const paused = snapshot.paused;
  const [, rerender] = useState(0);
  /** What was last on the screen, so a pause can hold it. */
  const last = useRef<{ openedAt: ServerTime; shown: number } | null>(null);

  useEffect(() => {
    if (openedAt === null || paused) return;
    let cancel: () => void = () => undefined;
    const bump = (): void => rerender((value) => value + 1);

    const arm = (): void => {
      cancel();
      cancel = () => undefined;
      const current = scheduledClues(openedAt, clock.serverNow(), interval, count);
      if (current >= count) return;
      // A clock port may run a task at once when its moment has passed; the
      // flag keeps that nested arm's canceller rather than overwriting it.
      let fired = false;
      const stop = clock.showAt(openedAt + current * interval, () => {
        fired = true;
        bump();
        arm();
      });
      if (!fired) cancel = stop;
    };

    arm();
    const stopListening = clock.onChange(() => {
      bump();
      arm();
    });
    return () => {
      cancel();
      stopListening();
    };
  }, [openedAt, paused, interval, count, clock]);

  if (openedAt === null) return 1;

  let shown: number;
  if (paused) {
    // Hold what was showing when the pause arrived. A screen that mounted
    // mid-pause has nothing to hold, and falls back to the last moment the
    // room itself observed, which is when the pause began.
    const held = last.current;
    shown =
      held !== null && held.openedAt === openedAt
        ? held.shown
        : scheduledClues(openedAt, snapshot.serverTime, interval, count);
  } else {
    shown = scheduledClues(openedAt, clock.serverNow(), interval, count);
  }
  last.current = { openedAt, shown };
  return shown;
}
