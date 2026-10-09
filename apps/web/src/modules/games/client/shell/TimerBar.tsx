/**
 * The timer bar, driven by the deadline the server sent.
 *
 * The tempting version of this starts a countdown when a message arrives. That
 * version drifts: the message took time to arrive, the phone throttled the tab
 * while it was locked, and two phones then disagree about how long is left in
 * front of a room that can see both. So the only inputs are `phaseEndsAt` and
 * the synchronised clock, and the bar recomputes from them every frame.
 *
 * The full width of the bar is the longest remaining time seen for this
 * deadline. A phone that joined halfway through a round therefore shows a bar
 * that starts part-full and empties honestly, rather than pretending the round
 * began when the phone woke up.
 */

import { useEffect, useRef, useState } from 'preact/hooks';
import type { ServerTime } from '../../shared/protocol.js';
import { useClock } from './clockPort.js';
import { gt } from './t.js';

export interface TimerBarProps {
  endsAt: ServerTime | null;
  /**
   * The phase's full length, from the snapshot's `phaseDurationMs`. It is per
   * phase rather than the room's answer window because rounds set their own:
   * a clue round runs long, a reading phase runs short, a timed turn is a
   * minute. Null when the server did not say, and then the bar is as full as
   * the longest wait it has seen.
   */
  durationMs: number | null;
  paused: boolean;
}

/**
 * The smallest change in remaining time worth a re-render. A progress bar
 * reads just as smoothly updated a few dozen times a second as it does every
 * animation frame, and holding still between whole-second boundaries is what
 * keeps `aria-valuetext` (below) from mutating on every frame — some screen
 * readers treat any attribute change on a `progressbar` as reason to
 * re-announce it, and "12 seconds left" repeated sixty times a second is
 * noise, not information.
 */
const MIN_STEP_MS = 100;

export function TimerBar({ endsAt, durationMs, paused }: TimerBarProps) {
  const clock = useClock();
  const [remaining, setRemaining] = useState(() => (endsAt === null ? 0 : clock.msUntil(endsAt)));
  const spanRef = useRef<{ endsAt: ServerTime; total: number } | null>(null);

  useEffect(() => {
    if (endsAt === null) {
      spanRef.current = null;
      setRemaining(0);
      return;
    }

    if (paused) {
      // The server leaves `phaseEndsAt` exactly where it was while paused,
      // and gives every deadline back the whole length of the pause on
      // resume (`handleResume` shifts them forward) — so `endsAt` itself
      // does not move during a pause, but wall-clock time still does, and
      // `clock.msUntil(endsAt)` would keep shrinking if this kept reading
      // it. That was the bug: the bar visibly drained through a pause it
      // should have been holding still through. Read it once, when the
      // pause begins, and hold still — no animation frame loop, no deadline
      // schedule, no clock-change listener — until `paused` goes false again.
      setRemaining(clock.msUntil(endsAt));
      return;
    }

    let frame = 0;
    let cancelled = false;
    // Reset per mount/deadline, so the first frame of a fresh round always
    // commits regardless of how close it lands to a previous deadline's last
    // value.
    let lastCommitted: number | null = null;

    const read = () => {
      if (cancelled) return;
      const value = clock.msUntil(endsAt);
      // Zero always commits, so the bar reliably lands on empty rather than
      // stopping one throttle step short of it.
      if (lastCommitted !== null && value !== 0 && Math.abs(value - lastCommitted) < MIN_STEP_MS) {
        return;
      }
      lastCommitted = value;
      setRemaining(value);
    };

    const tick = () => {
      read();
      if (cancelled) return;
      if (typeof requestAnimationFrame === 'function') frame = requestAnimationFrame(tick);
    };
    tick();

    // Frames stop arriving in a backgrounded tab, so the deadline is scheduled
    // as well as animated: the bar lands on zero even if the phone was locked
    // through the whole window and no frame ever ran.
    const cancelDeadline = clock.showAt(endsAt, read);

    // A measurement that lands mid-round moves the deadline under us, and the
    // bar should jump to the truth rather than finish the round on a stale one.
    const stopListening = clock.onChange(read);

    return () => {
      cancelled = true;
      if (frame) cancelAnimationFrame(frame);
      cancelDeadline();
      stopListening();
    };
  }, [endsAt, clock, paused]);

  if (endsAt === null) return null;

  const previous = spanRef.current;
  const nominal = durationMs !== null && durationMs > 0 ? durationMs : 0;
  const seen = previous !== null && previous.endsAt === endsAt ? previous.total : 0;
  const total = Math.max(nominal, seen, remaining, 1);
  spanRef.current = { endsAt, total };

  const fraction = Math.min(1, Math.max(0, remaining / total));
  const seconds = Math.ceil(remaining / 1000);
  const low = fraction <= 0.25;

  return (
    <div class="timerbar" data-low={low ? 'true' : 'false'} data-paused={paused ? 'true' : 'false'}>
      <div
        class="timerbar-track"
        role="progressbar"
        aria-label={gt('games.timer.remaining', 'Time remaining')}
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={Math.round(fraction * 100)}
        aria-valuetext={gt('games.timer.secondsLeft', '{seconds} seconds left', { seconds })}
      >
        <div class="timerbar-fill" style={{ width: `${fraction * 100}%` }} />
      </div>
      <span class="timerbar-label">{paused ? gt('games.timer.paused', 'Paused') : gt('games.timer.secondsShort', '{seconds}s', { seconds })}</span>
    </div>
  );
}
