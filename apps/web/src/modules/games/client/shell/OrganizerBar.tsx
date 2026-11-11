/**
 * The organizer's controls on a shared screen that holds control: a laptop on a
 * projector with no phone to hand.
 *
 * It is the one place a control appears on the screen the room is watching, so
 * it stays out of the way: it shows when the pointer moves, hides again after a
 * few seconds, and stays while the pointer is on it or something in it has
 * focus. The exception is a pending judgement, which stays up until ruled on.
 *
 * It draws no answer, and no player's words. A judgement is shown as the fact
 * that there is one, with the two verdicts, because the answers in a judged
 * game are said aloud. This component never reads those fields.
 */

import { useCallback, useEffect, useRef, useState } from 'preact/hooks';
import type { HostCommand, ScreenSnapshot } from '../../shared/protocol.js';
import { mainActionFor } from './mainAction.js';
import { gt } from './t.js';

export interface BarTimers {
  set(task: () => void, ms: number): unknown;
  clear(handle: unknown): void;
}

const GLOBAL_TIMERS: BarTimers = {
  set: (task, ms) => setTimeout(task, ms),
  clear: (handle) => clearTimeout(handle as ReturnType<typeof setTimeout>),
};

export const BAR_HIDE_MS = 3000;

export interface OrganizerBarProps {
  snapshot: ScreenSnapshot;
  onCommand(command: HostCommand): void;
  hideAfterMs?: number;
  /** Replaceable so a test can drive time by hand. */
  timers?: BarTimers;
}

/** A key typed into a field, or aimed at a control, belongs to that element. */
function ownsKey(target: EventTarget | null, activation: boolean): boolean {
  if (!(target instanceof Element)) return false;
  if (target.closest('input, textarea, select, [contenteditable]') !== null) return true;
  return activation && target.closest('button, a[href], [role="button"]') !== null;
}

export function OrganizerBar({
  snapshot,
  onCommand,
  hideAfterMs = BAR_HIDE_MS,
  timers = GLOBAL_TIMERS,
}: OrganizerBarProps) {
  const control = snapshot.control;
  const [awake, setAwake] = useState(false);
  const [held, setHeld] = useState(false);
  const timer = useRef<unknown>(null);

  // The listeners below outlive any one render, so they read the latest props here.
  const latest = useRef({ snapshot, onCommand, timers, hideAfterMs });
  latest.current = { snapshot, onCommand, timers, hideAfterMs };

  const wake = useCallback(() => {
    const { timers: clock, hideAfterMs: after } = latest.current;
    if (timer.current !== null) clock.clear(timer.current);
    setAwake(true);
    timer.current = clock.set(() => {
      timer.current = null;
      setAwake(false);
    }, after);
  }, []);

  const present = control !== undefined;
  // Where the room was when a key last sent something. A second press before
  // the room has moved would act on a stale picture — a double Space in the
  // reveal would skip a question, a double P would pause twice — so keys wait
  // until the snapshot shows the first press landed.
  const sentAt = useRef<string | null>(null);

  useEffect(() => {
    if (!present) return undefined;
    const onKey = (event: KeyboardEvent) => {
      if (event.defaultPrevented || event.ctrlKey || event.metaKey || event.altKey) return;
      const { snapshot: current, onCommand: send } = latest.current;
      const here = `${current.phase}:${current.round}:${current.paused}`;
      const mainKey = event.key === ' ' || event.key === 'Enter';
      const pauseKey = event.key === 'p' || event.key === 'P';
      if (sentAt.current === here && (mainKey || pauseKey)) {
        // Still waiting on the last press: swallow this one, unless it was
        // meant for a field or button that handles the key itself.
        if (!ownsKey(event.target, mainKey)) event.preventDefault();
        return;
      }
      if (event.key === ' ' || event.key === 'Enter') {
        if (ownsKey(event.target, true)) return;
        const action = mainActionFor(current);
        if (action === null) return;
        event.preventDefault();
        sentAt.current = here;
        send(action.command);
        wake();
        return;
      }
      if (event.key === 'p' || event.key === 'P') {
        if (ownsKey(event.target, false)) return;
        if (current.phase === 'lobby' || current.phase === 'summary') return;
        event.preventDefault();
        sentAt.current = here;
        send({ cmd: current.paused ? 'resume' : 'pause' });
        wake();
      }
    };
    document.addEventListener('pointermove', wake);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('pointermove', wake);
      document.removeEventListener('keydown', onKey);
      if (timer.current !== null) {
        latest.current.timers.clear(timer.current);
        timer.current = null;
      }
    };
  }, [present, wake]);

  if (control === undefined) return null;

  const judging = control.pendingJudge !== null;
  if (!awake && !held && !judging) return null;

  const action = mainActionFor(snapshot);
  const { phase, paused } = snapshot;
  const running = phase !== 'lobby' && phase !== 'summary';
  const skippable = phase === 'question' || phase === 'answering' || phase === 'reveal';

  const hold = () => setHeld(true);
  const release = () => {
    setHeld(false);
    wake();
  };

  return (
    <div
      class="organizer-bar"
      role="toolbar"
      aria-label={gt('games.screen.bar.label', 'Organizer controls')}
      onPointerEnter={hold}
      onPointerLeave={release}
      onFocusIn={hold}
      onFocusOut={release}
    >
      {judging && (
        <div class="organizer-bar-judge" role="group" aria-label={gt('games.screen.bar.judgeLabel', 'Answer to check')}>
          <span class="organizer-bar-judge-text">{gt('games.screen.bar.judgeLabel', 'Answer to check')}</span>
          <button type="button" class="judge-correct" onClick={() => onCommand({ cmd: 'judge', verdict: 'correct' })}>
            {gt('games.screen.bar.correct', 'Correct')}
          </button>
          <button type="button" class="judge-incorrect" onClick={() => onCommand({ cmd: 'judge', verdict: 'incorrect' })}>
            {gt('games.screen.bar.incorrect', 'Incorrect')}
          </button>
        </div>
      )}
      <span class="organizer-bar-hint">
        {gt('games.screen.bar.keys', 'Space: next step · P: pause')}
      </span>
      <span class="organizer-bar-spacer" />
      {running && (
        <button type="button" class="btn-quiet" onClick={() => onCommand({ cmd: paused ? 'resume' : 'pause' })}>
          {paused ? gt('games.screen.bar.resume', 'Resume') : gt('games.screen.bar.pause', 'Pause')}
        </button>
      )}
      {skippable && (
        <button type="button" class="btn-quiet" onClick={() => onCommand({ cmd: 'skip' })}>
          {gt('games.screen.bar.skip', 'Skip')}
        </button>
      )}
      {action !== null && (
        <button type="button" class="btn-primary" onClick={() => onCommand(action.command)}>
          {action.label}
        </button>
      )}
    </div>
  );
}
